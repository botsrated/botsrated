"""Optional ADK ``before_tool_callback`` for opaque paid tools.

The tool is not inspected and is not called. Before Google ADK runs a designated paid tool,
the same ``PaymentGuard`` passed in judges the payment context. A returned dict is the tool
result, which is how ADK skips the tool. ``None`` lets that tool run. This module does not
build an agent, a runner, or a session service, and it does not call ``install``.
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping
from typing import Any

BOTSRATED_PAYMENT_REASON = "botsrated_payment_reason"
"""The only field this callback returns, and only when the guard blocks.

ADK uses any non-``None`` return as the tool result and does not run the tool. On allow this
callback returns ``None``, so the tool runs and no extra field is added.
"""

_CONTEXT_KEYS = ("payment_context", "x402", "payment")
_PAYMENT_MARKERS = ("payment_required", "selected_requirements", "paymentRequired")
_UNREADABLE = "Payment stopped by your payment policy. The payment context for this tool could not be read."
_GUARD_ERROR = "Payment stopped by your payment policy. The payment guard could not evaluate this payment."


def _stop(message: str) -> dict[str, str]:
    return {BOTSRATED_PAYMENT_REASON: message}


def _tool_name(tool: Any) -> str | None:
    name = getattr(tool, "name", None)
    if isinstance(name, str) and name:
        return name
    if isinstance(tool, str) and tool:
        return tool
    fname = getattr(tool, "__name__", None)
    if isinstance(fname, str) and fname:
        return fname
    return None


def _paid_names(paid_tools: Collection[str] | str) -> frozenset[str]:
    if isinstance(paid_tools, str):
        names: tuple[str, ...] = (paid_tools,)
    elif isinstance(paid_tools, Collection):
        names = tuple(paid_tools)
    else:
        raise ValueError("paid_tools must name at least one paid tool.")
    if not names or any(not isinstance(name, str) or name == "" for name in names):
        raise ValueError("paid_tools must name at least one paid tool.")
    return frozenset(names)


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


def _context_from_call(args: Any, tool_context: Any) -> Any:
    """Read a payment context the caller already supplied. Does not read the tool."""
    if isinstance(args, Mapping):
        found = _from_mapping(args)
        if found is not None:
            return found
    state = getattr(tool_context, "state", None)
    if isinstance(state, Mapping):
        found = _from_mapping(state)
        if found is not None:
            return found
    if isinstance(tool_context, Mapping):
        found = _from_mapping(tool_context)
        if found is not None:
            return found
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


def _read_context(
    tool: Any,
    args: Any,
    tool_context: Any,
    context: Callable[..., Any] | None,
) -> tuple[Any, dict[str, str] | None]:
    try:
        ctx = context(tool, args, tool_context) if context is not None else _context_from_call(args, tool_context)
    except Exception:  # noqa: BLE001 - an unreadable quote must not fall through to the tool
        return None, _stop(_UNREADABLE)
    if ctx is None:
        return None, _stop(_UNREADABLE)
    return ctx, None


def _from_decision(decision: Any) -> dict[str, str] | None:
    if getattr(decision, "action", None) != "block":
        return None
    message = getattr(decision, "message", None)
    if not isinstance(message, str) or not message:
        message = "Payment stopped by your payment policy."
    return _stop(message)


def _decide(guard: Any, ctx: Any) -> dict[str, str] | None:
    url = _resource_url(ctx)
    try:
        if url and hasattr(guard, "request"):
            with guard.request(url):
                decision = guard.decide(ctx)
        else:
            decision = guard.decide(ctx)
    except Exception:  # noqa: BLE001 - a guard failure must not be turned into a pass
        return _stop(_GUARD_ERROR)
    return _from_decision(decision)


def botsrated_before_tool_callback(
    guard: Any,
    paid_tools: Collection[str] | str,
    *,
    context: Callable[..., Any] | None = None,
) -> Callable[..., dict[str, str] | None]:
    """Return a Google ADK ``before_tool_callback`` for the named paid tools.

    The returned function's parameters are ``tool``, ``args``, and ``tool_context``, which is
    the keyword call ADK uses. It does not construct an agent. ``paid_tools`` is the set of
    tool names to judge. Every other tool returns ``None`` immediately, so ADK runs it and
    this guard is not asked.

    ``context(tool, args, tool_context)`` returns the x402 payment-creation context (or a dict
    with the same fields). When ``context`` is omitted, the helper reads ``payment_context``,
    ``x402``, or ``payment`` from ``args`` or from ``tool_context.state``, or those objects
    themselves when they already hold ``payment_required``. The tool body is not opened.
    If that context cannot be read, the tool is not run.

    On block, the return value is a new dict whose only key is :data:`BOTSRATED_PAYMENT_REASON`.
    ADK then skips the tool. ``args`` and ``tool_context`` are not mutated.
    On allow, the return value is ``None``, which is what tells ADK to run the tool.
    A remote pass does not clear a local block: the decision comes from ``guard`` unchanged.

    ``guard`` is the same object :func:`google_adk_botsrated.attach_payment_guard` returned
    (or any object with ``decide``). This helper does not call ``install``.
    """
    names = _paid_names(paid_tools)

    def before_tool_callback(
        tool: Any,
        args: dict[str, Any],
        tool_context: Any,
    ) -> dict[str, str] | None:
        if _tool_name(tool) not in names:
            return None
        ctx, stopped = _read_context(tool, args, tool_context, context)
        if stopped is None:
            stopped = _decide(guard, ctx)
        return stopped

    return before_tool_callback
