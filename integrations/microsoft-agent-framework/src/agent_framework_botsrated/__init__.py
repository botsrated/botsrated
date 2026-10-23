"""BotsRated pre-payment checks for Microsoft Agent Framework (Python)."""

from agent_framework_botsrated._middleware import (
    DECISION_METADATA_KEY,
    BotsRatedPaymentBlocked,
    BotsRatedPaymentMiddleware,
    PaymentQuote,
    QuoteExtractor,
    botsrated_check_payment_tool,
    decision_to_dict,
    default_quote_extractor,
)

BOTSRATED_MCP_URL = "https://botsrated.com/mcp"
"""BotsRated's remote MCP server (streamable HTTP, no auth). Free tools: preflight, coverage, sample, history."""

__all__ = [
    "BOTSRATED_MCP_URL",
    "DECISION_METADATA_KEY",
    "BotsRatedPaymentBlocked",
    "BotsRatedPaymentMiddleware",
    "PaymentQuote",
    "QuoteExtractor",
    "botsrated_check_payment_tool",
    "decision_to_dict",
    "default_quote_extractor",
]
__version__ = "0.1.0"
