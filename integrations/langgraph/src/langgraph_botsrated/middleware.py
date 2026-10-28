"""Optional pre-pay wrapper for an opaque LangGraph node.

The node is not inspected. Before it runs, the same ``PaymentGuard`` passed in judges
the payment context. This module does not build a graph.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable, Mapping
from typing import Any

BOTSRATED_PAYMENT_REASON = "botsrated_payment_reason"
"""The only state field this helper writes, and only as a returned partial update when the guard blocks.

The input state is not mutated. On allow, the node's return value is passed through with no extra key.
"""

_CONTEXT_KEYS = ("payment_context", "x402", "payment")
_UNREADABLE = "Payment stopped by your payment policy. The payment context for this node could not be read."
_GUARD_ERROR = "Payment stopped by your payment policy. The payment guard could not evaluate this payment."


def _stop(message: str) -> dict[str, str]:
    return {BOTSRATED_PAYMENT_REASON: message}


def _context_from_state(state: Any) -> Any:
    """Read a payment context the caller already placed on state. Does not read the node."""
    if isinstance(state, Mapping):
        for key in _CONTEXT_KEYS:
            if key in state and state[key] is not None:
                return state[key]
        if "payment_required" in state or "selected_requirements" in state or "paymentRequired" in state:
            return state
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


def _read_context(state: Any, context: Callable[[Any], Any] | None) -> tuple[Any, dict[str, str] | None]:
    try:
        ctx = context(state) if context is not None else _context_from_state(state)
    except Exception:  # noqa: BLE001 - an unreadable quote must not fall through to the pay node
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


async def _adecide(guard: Any, ctx: Any) -> dict[str, str] | None:
    url = _resource_url(ctx)
    try:
        if hasattr(guard, "adecide"):
            if url and hasattr(guard, "request"):
                with guard.request(url):
                    decision = await guard.adecide(ctx)
            else:
                decision = await guard.adecide(ctx)
        elif url and hasattr(guard, "request"):
            with guard.request(url):
                decision = guard.decide(ctx)
        else:
            decision = guard.decide(ctx)
    except Exception:  # noqa: BLE001 - a guard failure must not be turned into a pass
        return _stop(_GUARD_ERROR)
    return _from_decision(decision)


def botsrated_payment_middleware(
    guard: Any,
    node: Callable[..., Any],
    *,
    context: Callable[[Any], Any] | None = None,
) -> Callable[..., Any]:
    """Return a node that runs ``guard`` before ``node``.

    ``node`` is opaque: it is not opened or rewritten. ``context(state)`` returns the x402
    payment-creation context (or a dict with the same fields) the guard should judge.
    When ``context`` is omitted, the helper reads ``payment_context``, ``x402``, or
    ``payment`` from state, or state itself when it already holds ``payment_required``.
    If that context cannot be read, the node is not called.

    On block, the node is not called. The return value is a new dict whose only key is
    :data:`BOTSRATED_PAYMENT_REASON`. The input state object is not mutated.
    On allow, the node's return value is returned unchanged.

    ``guard`` is the same object :func:`langgraph_botsrated.attach_payment_guard` returned
    (or any object with ``decide``). This helper does not call ``install`` and does not
    build a graph. Add the result with your own ``graph.add_node``.
    """

    if inspect.iscoroutinefunction(node):

        async def wrapped(state: Any, *args: Any, **kwargs: Any) -> Any:
            ctx, stopped = _read_context(state, context)
            if stopped is None:
                stopped = await _adecide(guard, ctx)
            if stopped is not None:
                return stopped
            return await node(state, *args, **kwargs)

        return wrapped

    def wrapped_sync(state: Any, *args: Any, **kwargs: Any) -> Any:
        ctx, stopped = _read_context(state, context)
        if stopped is None:
            stopped = _decide(guard, ctx)
        if stopped is not None:
            return stopped
        return node(state, *args, **kwargs)

    return wrapped_sync
