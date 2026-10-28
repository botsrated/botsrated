"""Payment-client wrap that pairs with Google ADK.

Register :func:`attach_payment_guard` on the x402 client a Google ADK app already uses to pay.
:func:`botsrated_before_tool_callback` is an optional ``before_tool_callback`` for opaque paid tools.
This package does not build an agent, a runner, a session service, or an agent loop.
"""

from google_adk_botsrated.callback import BOTSRATED_PAYMENT_REASON, botsrated_before_tool_callback
from google_adk_botsrated.guard import attach_payment_guard
from google_adk_botsrated.preflight import botsrated_preflight

__all__ = [
    "BOTSRATED_PAYMENT_REASON",
    "attach_payment_guard",
    "botsrated_before_tool_callback",
    "botsrated_preflight",
]
