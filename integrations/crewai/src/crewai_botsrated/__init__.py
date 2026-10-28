"""Payment-client wrap that pairs with CrewAI.

Register :func:`attach_payment_guard` on the x402 client a CrewAI app already uses to pay.
:func:`register_botsrated_pre_tool_hook` is an optional before-pay hook for named paid tools.
This package does not run a crew or an agent loop.
"""

from crewai_botsrated.guard import attach_payment_guard
from crewai_botsrated.hooks import botsrated_preflight, register_botsrated_pre_tool_hook

__all__ = [
    "attach_payment_guard",
    "botsrated_preflight",
    "register_botsrated_pre_tool_hook",
]
