"""Payment-client wrap that pairs with Pydantic AI.

Register :func:`attach_payment_guard` on the x402 client a Pydantic AI app already uses to pay.
:func:`botsrated_payment_hooks` is an optional before-pay ``Hooks`` capability for named paid tools.
This package does not run an agent, a graph, or a run loop.
"""

from pydantic_ai_botsrated.guard import attach_payment_guard
from pydantic_ai_botsrated.hooks import botsrated_payment_hooks, botsrated_preflight

__all__ = [
    "attach_payment_guard",
    "botsrated_payment_hooks",
    "botsrated_preflight",
]
