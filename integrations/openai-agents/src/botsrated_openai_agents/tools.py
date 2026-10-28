"""Free BotsRated preflight tools for an OpenAI Agents SDK app.

Building or calling these does not register a payment hook. Pass the HTTP callable to
the SDK's ``function_tool`` yourself, and pass ``mcp_url`` to the SDK's MCP client if
you want the hosted server. This module does not construct an ``Agent`` or a ``Runner``.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

BOTSRATED_MCP_URL = "https://botsrated.com/mcp"
"""Hosted MCP server (streamable HTTP, no auth). Free tool: preflight. Paid tools stay opt-in on that server."""

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


@dataclass(frozen=True)
class FreePreflightTools:
    """Free preflight only. Holding this object does not register a payment hook."""

    http: tuple[Callable[..., str], ...]
    mcp_url: str


def botsrated_preflight(url: str) -> str:
    """Free BotsRated preflight of an x402 seller. No key, rate limits. Call before paying.

    Args:
        url: The seller URL or host you are about to pay, for example https://api.example.com/v1/data.

    Returns:
        JSON facts from the latest unpaid probe (status, valid 402, latency, observed price and
        payTo, receipt URL). ``covered`` false means BotsRated has no measurements for this host.
        Facts are measurements, not an endorsement. This function does not pay and does not
        register a payment hook.
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


def botsrated_preflight_tools() -> FreePreflightTools:
    """Return the free HTTP preflight callable and the hosted MCP URL.

    Does not register a payment hook. Same rule as ``botsrated_tools()`` in langchain-botsrated:
    free preflight only. Registering the payment hook is a separate step on the x402 client.
    """
    return FreePreflightTools(http=(botsrated_preflight,), mcp_url=BOTSRATED_MCP_URL)
