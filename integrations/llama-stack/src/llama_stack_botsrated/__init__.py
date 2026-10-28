"""Payment-client wrap that pairs with Llama Stack.

Register :func:`attach_payment_guard` on the x402 client a Llama Stack app already uses
to pay. Llama Stack stays the runtime, the distribution, and the inference server.
A secondary tool hook is deferred: public docs have no stable user-facing hook to run
before a tool, and this package does not invent one.
"""

from llama_stack_botsrated.guard import attach_payment_guard, botsrated_preflight

__all__ = [
    "attach_payment_guard",
    "botsrated_preflight",
]
