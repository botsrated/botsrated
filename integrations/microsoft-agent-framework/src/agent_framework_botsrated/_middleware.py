"""BotsRated pre-payment check for Microsoft Agent Framework function tools."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Collection, Mapping
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from agent_framework import FunctionInvocationContext, FunctionMiddleware, FunctionTool, MiddlewareFailure, tool
from botsrated import BotsRatedClient, Decision, PrePaymentGuard, Reason
from pydantic import BaseModel, Field

DECISION_METADATA_KEY = "botsrated_decision"
"""Key of the ``botsrated.Decision`` stored in ``FunctionInvocationContext.metadata`` for checked calls."""

DEFAULT_NETWORK = "eip155:8453"


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
    if isinstance(amount, bool) or not str(amount).isdigit():
        raise ValueError("amount must be an integer number of atomic units")
    network = _first(args, "network") or DEFAULT_NETWORK
    scheme = _first(args, "scheme") or "exact"
    return PaymentQuote(url=url, pay_to=pay_to, amount=str(amount), network=str(network), scheme=str(scheme))


class BotsRatedPaymentBlocked(MiddlewareFailure):
    """Raised for a blocked payment when the middleware uses ``on_block="raise"``. It ends the run."""

    def __init__(self, decision: Decision) -> None:
        super().__init__(decision.summary())
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

    Default policy (from ``botsrated.GuardPolicy``): a payTo that BotsRated has not seen for the
    host is blocked; an uncovered host or stale data is allowed; a price above the observed one
    is a warning. If BotsRated can't be reached, the payment is allowed (``fail_open=True`` on
    the guard). If the quote can't be read from the arguments, the call is blocked.

    Args:
        payment_tools: Names of the payment functions to check, or a mapping from name to a
            ``QuoteExtractor`` (``None`` uses ``default_quote_extractor``).
        guard: A ``botsrated.PrePaymentGuard``. Defaults to a free-only guard (nothing is paid).
        on_block: ``"result"`` (default) returns the reason as the call's result; ``"raise"`` ends the run.
    """

    def __init__(
        self,
        payment_tools: Collection[str] | Mapping[str, QuoteExtractor | None],
        *,
        guard: PrePaymentGuard | None = None,
        on_block: Literal["result", "raise"] = "result",
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
        self.guard = guard or PrePaymentGuard(BotsRatedClient())
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
            decision = Decision("block", None, [Reason("quote_unreadable", str(error), "block")])
        else:
            decision = await asyncio.to_thread(self.guard.decide, quote.url, quote.requirements())
        context.metadata[DECISION_METADATA_KEY] = decision
        if self.guard.on_decision:
            self.guard.on_decision(decision)
        if decision.action == "allow":
            await call_next()
            return
        if self.on_block == "raise":
            raise BotsRatedPaymentBlocked(decision)
        context.result = f"Payment tool '{context.function.name}' was not executed. {decision.summary()}"


def decision_to_dict(decision: Decision) -> dict[str, Any]:
    return {
        "action": decision.action,
        "host": decision.host,
        "reasons": [{"code": r.code, "detail": r.detail, "effect": r.effect} for r in decision.reasons],
        "receipt_url": decision.facts.receipt_url if decision.facts else None,
    }


def botsrated_check_payment_tool(guard: PrePaymentGuard | None = None) -> FunctionTool:
    """A function tool the model can call to check an x402 payment option before paying it (free preflight)."""
    checker = guard or PrePaymentGuard(BotsRatedClient())

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
