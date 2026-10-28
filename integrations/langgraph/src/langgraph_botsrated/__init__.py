"""Payment-client wrap that pairs with LangGraph.

Register :func:`attach_payment_guard` on the x402 client a LangGraph app already uses to pay.
:func:`botsrated_payment_middleware` is an optional pre-pay wrapper for an opaque pay node.
This package does not build a graph, a checkpoint store, or an agent loop.
"""

from langgraph_botsrated.guard import attach_payment_guard
from langgraph_botsrated.middleware import BOTSRATED_PAYMENT_REASON, botsrated_payment_middleware
from langgraph_botsrated.preflight import botsrated_preflight

__all__ = [
    "BOTSRATED_PAYMENT_REASON",
    "attach_payment_guard",
    "botsrated_payment_middleware",
    "botsrated_preflight",
]
