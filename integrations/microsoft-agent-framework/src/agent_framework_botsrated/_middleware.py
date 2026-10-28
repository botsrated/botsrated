"""BotsRated pre-payment check for Microsoft Agent Framework function tools."""

from __future__ import annotations

import asyncio
import inspect
import json
import re
from collections.abc import Awaitable, Callable, Collection, Mapping
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from agent_framework import FunctionInvocationContext, FunctionMiddleware, FunctionTool, MiddlewareFailure, tool
from botsrated import BotsRatedClient, Decision, GuardPolicy, PrePaymentGuard, Reason
from pydantic import BaseModel, Field

from agent_framework_botsrated.guard import FailMode, PresetName, build_payment_guard

DECISION_METADATA_KEY = "botsrated_decision"
"""Key of the ``botsrated.Decision`` stored in ``FunctionInvocationContext.metadata`` for checked calls."""

DEFAULT_NETWORK = "eip155:8453"


# Keeps this package's documented default on every botsrated version: a payTo BotsRated's probes never recorded
# for the host blocks the payment (botsrated 0.2 made that advice-only by default).
DEFAULT_POLICY = GuardPolicy(pay_to_mismatch="block")


@dataclass(frozen=True)
class PaymentQuote:
    """The x402 payment option a payment tool is about to pay."""

    url: str
    pay_to: str
    amount: str
    network: str = DEFAULT_NETWORK
    scheme: str = "exact"

    def requirements(self) -> dict[str, str]:
        return {"scheme": self.scheme, "network": self.network, "payTo": self.pay_to, "amount": self.amount}


QuoteExtractor = Callable[[Mapping[str, Any]], PaymentQuote]
"""Reads the payment quote from a payment tool's arguments. Raise any exception if it can't."""


def _first(args: Mapping[str, Any], *names: str) -> Any:
    for name in names:
        value = args.get(name)
        if value not in (None, ""):
            return value
    return None


def default_quote_extractor(args: Mapping[str, Any]) -> PaymentQuote:
    """Read ``url``, ``pay_to`` (or ``payTo``), ``amount`` and optional ``network``/``scheme`` arguments."""
    url = _first(args, "url", "resource_url", "resource")
    pay_to = _first(args, "pay_to", "payTo")
    amount = _first(args, "amount", "amount_atomic", "max_amount_required", "maxAmountRequired")
    if not isinstance(url, str) or not isinstance(pay_to, str) or amount is None:
        missing = [n for n, v in (("url", url), ("pay_to", pay_to), ("amount", amount)) if v is None]
        raise ValueError(f"payment arguments are missing or not text: {', '.join(missing) or 'url/pay_to'}")
    # ASCII digits only: str.isdigit() also accepts e.g. Arabic-Indic or full-width digits.
    if isinstance(amount, bool) or re.fullmatch(r"[0-9]+", str(amount)) is None:
        raise ValueError("amount must be an integer number of atomic units")
    network = _first(args, "network") or DEFAULT_NETWORK
    scheme = _first(args, "scheme") or "exact"
    return PaymentQuote(url=url, pay_to=pay_to, amount=str(amount), network=str(network), scheme=str(scheme))


class _TokenOmitted:
    """Sentinel: the middleware caller did not pass ``token``."""


_TOKEN_OMITTED = _TokenOmitted()


def _decision_text(decision: Any) -> str:
    summary = getattr(decision, "summary", None)
    if callable(summary):
        text = summary()
        if isinstance(text, str) and text:
            return text
    message = getattr(decision, "message", None)
    if isinstance(message, str) and message:
        return message
    return "Payment stopped by your payment policy."


def _uses_payment_context(guard: Any) -> bool:
    """True for ``PaymentGuard`` (one payment-context argument) and the same shape of stub."""
    try:
        from botsrated.payment_guard import PaymentGuard
    except ImportError:
        payment_guard: type | tuple[type, ...] = ()
    else:
        payment_guard = PaymentGuard
    if isinstance(guard, payment_guard):
        return True
    decide = getattr(guard, "decide", None)
    if not callable(decide):
        return False
    try:
        params = inspect.signature(decide).parameters.values()
    except (TypeError, ValueError):
        return False
    positional = [
        param
        for param in params
        if param.name != "self"
        and param.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    ]
    return len(positional) == 1


def _payment_context(quote: PaymentQuote) -> dict[str, Any]:
    requirements = quote.requirements()
    return {
        "payment_required": {"x402Version": 2, "resource": {"url": quote.url}, "accepts": [requirements]},
        "selected_requirements": requirements,
    }


def _decide_payment_context(guard: Any, quote: PaymentQuote) -> Any:
    ctx = _payment_context(quote)
    try:
        request = getattr(guard, "request", None)
        if callable(request):
            with request(quote.url):
                return guard.decide(ctx)
        return guard.decide(ctx)
    except Exception:  # noqa: BLE001 - a guard failure must not be turned into a pass
        return Decision(
            "block",
            None,
            [Reason("hook_error", "the payment guard could not evaluate this payment.", "block")],
        )


class BotsRatedPaymentBlocked(MiddlewareFailure):
    """Raised for a blocked payment when the middleware uses ``on_block="raise"``. It ends the run."""

    def __init__(self, decision: Any) -> None:
        super().__init__(_decision_text(decision))
        self.decision = decision


def _as_mapping(arguments: BaseModel | Mapping[str, Any]) -> Mapping[str, Any]:
    if isinstance(arguments, BaseModel):
        return arguments.model_dump(mode="json")
    return arguments


class BotsRatedPaymentMiddleware(FunctionMiddleware):
    """Function middleware that checks an x402 payment with BotsRated before a payment tool runs.

    Only the functions named in ``payment_tools`` are checked; every other call passes through
    untouched. For a payment tool, the middleware reads the quote (URL, payTo, amount, network)
    from the call's arguments and asks BotsRated's free preflight (no key, no wallet) whether
    that payTo was observed for the seller. A blocked call never reaches ``call_next``: the
    reason becomes the call's result, so the model reads it, or with ``on_block="raise"`` the
    run ends with ``BotsRatedPaymentBlocked``.

    Pass ``guard`` from :func:`agent_framework_botsrated.attach_payment_guard` to judge the quote
    with that same ``PaymentGuard``. Pass ``preset``, ``fail_mode``, or ``token`` (and no
    ``guard``) to build that guard here, without registering it on an x402 client. Omit all of
    them to keep the historical free-preflight guard: a payTo that BotsRated has not seen for
    the host is blocked; an uncovered host or stale data is allowed; a price above the observed
    one is a warning. If BotsRated can't be reached, that historical guard allows the payment
    (``fail_open=True``). If the quote can't be read from the arguments, the call is blocked.

    ``fail_mode`` or ``token`` without ``preset`` still blocks an unobserved payTo. That is the
    historical default (``pay_to_mismatch="block"``). It does not switch to PaymentGuard's
    advice-only zero-config policy. ``preset="warn"`` is advice only when you select it.
    ``carefulBuyer`` and ``strict`` block an unobserved payTo. A remote pass does not clear a
    local block. ``fail_mode`` ``"closed"`` stops the payment when a remote check returns no
    decision; ``"open"`` records info. A missing decision is not a pass.

    Args:
        payment_tools: Names of the payment functions to check, or a mapping from name to a
            ``QuoteExtractor`` (``None`` uses ``default_quote_extractor``).
        guard: A ``PaymentGuard`` from ``attach_payment_guard``, or a ``PrePaymentGuard``.
            Omit it, and omit ``preset`` / ``fail_mode`` / ``token``, for the historical guard.
        on_block: ``"result"`` (default) returns the reason as the call's result; ``"raise"``
            ends the run with ``BotsRatedPaymentBlocked``.
        preset: ``warn``, ``carefulBuyer``, or ``strict`` when building a ``PaymentGuard`` here.
            Omit it and an unobserved payTo still blocks, including when ``fail_mode`` or
            ``token`` is set. ``warn`` is advice only when selected.
        fail_mode: ``"open"`` or ``"closed"`` for that ``PaymentGuard``. Omit it to fail open.
        token: Remote-policy token for that ``PaymentGuard``. Omit the argument to leave the
            historical guard in place. ``None`` reads ``BOTSRATED_TOKEN``.
    """

    def __init__(
        self,
        payment_tools: Collection[str] | Mapping[str, QuoteExtractor | None],
        *,
        guard: Any | None = None,
        on_block: Literal["result", "raise"] = "result",
        preset: PresetName | None = None,
        fail_mode: FailMode | None = None,
        token: str | None | _TokenOmitted = _TOKEN_OMITTED,
    ) -> None:
        if isinstance(payment_tools, str):
            payment_tools = [payment_tools]
        if isinstance(payment_tools, Mapping):
            self.extractors: dict[str, QuoteExtractor] = {
                name: extractor or default_quote_extractor for name, extractor in payment_tools.items()
            }
        else:
            self.extractors = {name: default_quote_extractor for name in payment_tools}
        if not self.extractors:
            raise ValueError("payment_tools must name at least one payment function")
        token_passed = not isinstance(token, _TokenOmitted)
        if guard is not None and (preset is not None or fail_mode is not None or token_passed):
            raise ValueError("pass guard or preset/fail_mode/token, not both")
        if guard is not None:
            self.guard = guard
        elif preset is not None or fail_mode is not None or token_passed:
            built = build_payment_guard(
                preset=preset,
                fail_mode=fail_mode,
                token=None if isinstance(token, _TokenOmitted) else token,
            )
            if preset is None:
                # PaymentGuard's zero-config policy is advice-only. fail_mode or token must
                # not downgrade the historical payTo block (DEFAULT_POLICY) into a warning.
                from botsrated.payment_guard import PaymentGuardPolicy

                built.policy = PaymentGuardPolicy(pay_to_mismatch="block")
            self.guard = built
        else:
            self.guard = PrePaymentGuard(BotsRatedClient(), policy=DEFAULT_POLICY)
        self.on_block = on_block

    async def process(
        self,
        context: FunctionInvocationContext,
        call_next: Callable[[], Awaitable[None]],
    ) -> None:
        extractor = self.extractors.get(context.function.name)
        if extractor is None:
            await call_next()
            return
        try:
            quote = extractor(_as_mapping(context.arguments))
        except Exception as error:  # noqa: BLE001 - any unreadable quote fails closed
            decision: Any = Decision("block", None, [Reason("quote_unreadable", str(error), "block")])
        else:
            if _uses_payment_context(self.guard):
                decision = await asyncio.to_thread(_decide_payment_context, self.guard, quote)
            else:
                decision = await asyncio.to_thread(self.guard.decide, quote.url, quote.requirements())
        context.metadata[DECISION_METADATA_KEY] = decision
        callback = getattr(self.guard, "on_decision", None)
        if callback:
            callback(decision)
        if getattr(decision, "action", None) == "allow":
            await call_next()
            return
        if self.on_block == "raise":
            raise BotsRatedPaymentBlocked(decision)
        context.result = f"Payment tool '{context.function.name}' was not executed. {_decision_text(decision)}"


def decision_to_dict(decision: Decision) -> dict[str, Any]:
    return {
        "action": decision.action,
        "host": decision.host,
        "reasons": [{"code": r.code, "detail": r.detail, "effect": r.effect} for r in decision.reasons],
        "receipt_url": decision.facts.receipt_url if decision.facts else None,
    }


def botsrated_check_payment_tool(guard: PrePaymentGuard | None = None) -> FunctionTool:
    """A function tool the model can call to check an x402 payment option before paying it (free preflight).

    This tool does not attach a payment guard and does not register an x402 hook.
    """
    checker = guard or PrePaymentGuard(BotsRatedClient(), policy=DEFAULT_POLICY)

    async def botsrated_check_payment(
        url: Annotated[str, Field(description="The seller URL you are about to pay.")],
        pay_to: Annotated[str, Field(description="The payTo address from the seller's 402 payment option.")],
        amount: Annotated[str, Field(description="The amount in atomic units from that option.")],
        network: Annotated[str, Field(description="The CAIP-2 network of that option.")] = DEFAULT_NETWORK,
    ) -> str:
        """Check an x402 payment option against BotsRated's measurements BEFORE paying it."""
        quote = PaymentQuote(url=url, pay_to=pay_to, amount=amount, network=network)
        decision = await asyncio.to_thread(checker.decide, quote.url, quote.requirements())
        return json.dumps(decision_to_dict(decision))

    return tool(botsrated_check_payment)
