"""Payment-client hook that pairs with the OpenAI Agents SDK.

Register :func:`attach_payment_guard` on the x402 client the agent already uses to pay.
This package does not replace ``Agent`` or ``Runner``.
"""

from botsrated_openai_agents.guard import attach_payment_guard
from botsrated_openai_agents.tools import BOTSRATED_MCP_URL, FreePreflightTools, botsrated_preflight_tools

__all__ = [
    "BOTSRATED_MCP_URL",
    "FreePreflightTools",
    "attach_payment_guard",
    "botsrated_preflight_tools",
]
