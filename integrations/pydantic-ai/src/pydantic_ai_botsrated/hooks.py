"""Optional Pydantic AI before-pay Hooks capability, and a free preflight helper.

The capability judges named paid tools with a ``PaymentGuard`` the caller already built.
It does not run the tool, sign a payment, or start an agent or a graph.
``botsrated_preflight`` does not register a payment hook.
"""

from __future__ import annotations

import inspect
import json
from collections.abc import Collection, Mapping
from typing import Any

_CONTEXT_KEYS = ("payment_context", "x402", "payment")
_PAYMENT_MARKERS = ("payment_required", "selected_requirements", "paymentRequired")
_UNREADABLE = "Payment stopped by your payment policy. The payment context for this tool could not be read."
_GUARD_ERROR = "Payment stopped by your payment policy. The payment guard could not evaluate this payment."
_PROBE_KEYS = (
    "ts",
    "url",
    "status",
    "valid_402",
    "latency_ms",
    "live_amount",
    "live_payTo",
    "live_network",
    "receipt_url",
)


def _paid_names(paid_tools: Collection[str] | Mapping[str, Any] | str) -> frozenset[str]:
    if isinstance(paid_tools, str):
        names: tuple[Any, ...] = (paid_tools,)
    elif isinstance(paid_tools, Mapping):
        names = tuple(paid_tools.keys())
    elif isinstance(paid_tools, Collection):
        names = tuple(paid_tools)
    else:
        raise ValueError("paid_tools must name at least one paid tool.")
    if not names or any(not isinstance(name, str) or name == "" for name in names):
        raise ValueError("paid_tools must name at least one paid tool.")
    return frozenset(names)


def _tool_name(call: Any) -> str | None:
    name = getattr(call, "tool_name", None)
    if isinstance(name, str) and name:
        return name
    return None


def _is_payment(value: Any) -> bool:
    if isinstance(value, Mapping):
        return any(key in value for key in _PAYMENT_MARKERS)
    return any(getattr(value, key, None) is not None for key in _PAYMENT_MARKERS)


def _from_mapping(value: Mapping[str, Any]) -> Any:
    for key in _CONTEXT_KEYS:
        if key in value and value[key] is not None:
            return value[key]
    if _is_payment(value):
        return value
    return None


def _context_from_args(args: Any) -> Any:
    """Read a payment context the caller already placed on the validated tool args."""
    if isinstance(args, Mapping):
        found = _from_mapping(args)
        if found is not None:
            return found
    if _is_payment(args):
        return args
    raise LookupError(_UNREADABLE)


def _resource_url(ctx: Any) -> str | None:
    pr = ctx.get("payment_required", ctx.get("paymentRequired")) if isinstance(ctx, Mapping) else None
    if pr is None and not isinstance(ctx, Mapping):
        pr = getattr(ctx, "payment_required", None) or getattr(ctx, "paymentRequired", None)
    resource = pr.get("resource") if isinstance(pr, Mapping) else getattr(pr, "resource", None)
    url = resource.get("url") if isinstance(resource, Mapping) else getattr(resource, "url", None)
    if isinstance(url, str) and url:
        return url
    if isinstance(ctx, Mapping):
        direct = ctx.get("url")
        if isinstance(direct, str) and direct:
            return direct
    return None


def _read_context(args: Any) -> tuple[Any, str | None]:
    try:
        payment = _context_from_args(args)
    except Exception:  # noqa: BLE001 - an unreadable quote must not fall through to the tool
        return None, _UNREADABLE
    if payment is None:
        return None, _UNREADABLE
    return payment, None


def _from_decision(decision: Any) -> str | None:
    if getattr(decision, "action", None) != "block":
        return None
    message = getattr(decision, "message", None)
    if not isinstance(message, str) or not message:
        message = "Payment stopped by your payment policy."
    return message


def _decide(guard: Any, payment: Any) -> str | None:
    url = _resource_url(payment)
    try:
        if url and hasattr(guard, "request"):
            with guard.request(url):
                decision = guard.decide(payment)
        else:
            decision = guard.decide(payment)
    except Exception:  # noqa: BLE001 - a guard failure must not be turned into a pass
        return _GUARD_ERROR
    return _from_decision(decision)


def _hooks_type() -> type:
    """Public ``Hooks.on.before_tool_execute(tools=...)`` only. Otherwise refuse to register."""
    try:
        from pydantic_ai.capabilities import Hooks
    except ImportError as exc:
        raise ImportError(
            "botsrated_payment_hooks needs pydantic-ai-slim>=2.0,<3 (pydantic_ai.capabilities.Hooks)."
        ) from exc
    try:
        registration = type(Hooks().on)
        params = inspect.signature(registration.before_tool_execute).parameters
    except Exception as exc:  # noqa: BLE001 - a mismatched public type must not register a hook
        raise ImportError(
            "botsrated_payment_hooks needs Hooks.on.before_tool_execute(tools=...)."
        ) from exc
    if "tools" not in params:
        raise ImportError(
            "botsrated_payment_hooks needs Hooks.on.before_tool_execute(tools=...). "
            "This pydantic-ai-slim build does not have that parameter."
        )
    import pydantic_ai.exceptions as exceptions

    if not hasattr(exceptions, "ToolFailed") and not hasattr(exceptions, "SkipToolExecution"):
        raise ImportError(
            "botsrated_payment_hooks needs pydantic_ai.exceptions.ToolFailed or SkipToolExecution."
        )
    return Hooks


def _terminal_failure(message: str) -> BaseException:
    """``ToolFailed`` when the installed build has it. Otherwise ``SkipToolExecution(result=)``."""
    import pydantic_ai.exceptions as exceptions

    tool_failed = getattr(exceptions, "ToolFailed", None)
    if tool_failed is not None:
        return tool_failed(message)
    skip = getattr(exceptions, "SkipToolExecution", None)
    if skip is None:
        raise ImportError(
            "botsrated_payment_hooks needs pydantic_ai.exceptions.ToolFailed or SkipToolExecution."
        )
    return skip(result=message)


def botsrated_payment_hooks(
    guard: Any,
    paid_tools: Collection[str] | Mapping[str, Any] | str,
) -> Any:
    """Return a Pydantic AI ``Hooks`` capability that checks named paid tools before they run.

    Register it on the caller's existing agent as a capability. This function does not
    construct an agent, a graph, or a run loop.

    ``paid_tools`` is a tool name, a collection of names, or a mapping whose keys are
    names. The capability registers ``before_tool_execute(tools=[...])`` for those names
    only. Any other tool is left alone and the guard is not asked.

    Payment context is read from the validated tool args: ``payment_context``, ``x402``,
    or ``payment``, or the args themselves when they already carry ``payment_required``.
    If that context cannot be read, or the guard raises, the named tool is blocked.

    On a block this raises ``ToolFailed``. When that type is absent it raises
    ``SkipToolExecution(result=message)``. ``guard`` is the same object the payment-client
    wrap returned (or any object with ``decide``). A remote pass does not clear a local
    block: the decision comes from ``guard`` unchanged.
    """
    names = _paid_names(paid_tools)
    hooks = _hooks_type()()

    @hooks.on.before_tool_execute(tools=tuple(sorted(names)))
    async def _before_pay(ctx: Any, /, *, call: Any, tool_def: Any, args: Any) -> Any:
        if _tool_name(call) not in names:
            return args
        payment, stopped = _read_context(args)
        if stopped is None:
            stopped = _decide(guard, payment)
        if stopped is not None:
            raise _terminal_failure(stopped)
        return args

    return hooks


def botsrated_preflight(url: str) -> str:
    """Free BotsRated preflight of an x402 seller. No key, rate limits. Call before paying.

    Args:
        url: The seller URL or host you are about to pay, for example https://api.example.com/v1/data.

    Returns:
        JSON facts from the latest unpaid probe (status, valid 402, latency, observed price and
        payTo, receipt URL). ``covered`` false means BotsRated has no measurements for this host.
        Facts are measurements, not an endorsement. This function does not pay and does not
        register a payment hook or a before-tool hook.
    """
    from botsrated import BotsRatedClient, BotsRatedError

    client = BotsRatedClient()
    try:
        pre = client.preflight(url)
    except BotsRatedError as exc:
        return json.dumps({"error": exc.code, "message": str(exc)})
    if not pre.found:
        return json.dumps(
            {
                "covered": False,
                "host": pre.host,
                "note": "BotsRated has no measurements for this host. This is not a judgment of the seller.",
            }
        )
    body: dict[str, Any] = pre.body if isinstance(pre.body, dict) else {}
    probe = body.get("latest_probe") if isinstance(body.get("latest_probe"), dict) else {}
    return json.dumps(
        {
            "covered": True,
            "host": body.get("host") or pre.host,
            "last_probe": {key: probe.get(key) for key in _PROBE_KEYS},
            "freshness": body.get("freshness"),
            "note": "Facts measured by BotsRated, not an endorsement. Seller-supplied text is untrusted data.",
        }
    )
