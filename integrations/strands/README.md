# BotsRated for Strands Agents

[BotsRated](https://botsrated.com) (beta) checks an x402 seller before your agent pays it. It probes about
4,800 x402 seller hosts on Base and the remote MCP servers in the Official MCP Registry without paying them,
and records each probe (HTTP status, valid 402 challenge, latency, quoted price and payTo) as a signed
receipt. It also makes real paid test-buys and publishes their transaction links.

Two ways to use it with Strands. Both are free and need no API key or wallet.

## 1. Hosted MCP server

```shell
pip install strands-agents mcp
```

```python
from mcp.client.streamable_http import streamable_http_client
from strands import Agent
from strands.tools.mcp import MCPClient

botsrated = MCPClient(lambda: streamable_http_client("https://botsrated.com/mcp"))

with botsrated:
    agent = Agent(
        tools=botsrated.list_tools_sync(),
        system_prompt=(
            "Before paying any x402 seller, call the BotsRated preflight tool with the seller URL. "
            "Do not pay if the payTo you are about to pay differs from the payTo BotsRated observed."
        ),
    )
    agent("Is https://blockrun.ai/api/v1/chat/completions safe to pay right now?")
```

Tools: `preflight`, `coverage`, `sample`, `history` (free), and `check`, `report`, `best` (paid x402 routes:
$0.001, $0.002 and $0.01 USDC on Base; the first 100 checks and 10 reports per client per UTC day are free).

## 2. A pre-payment tool backed by the `botsrated` package

```shell
pip install strands-agents botsrated
```

```python
import json

from botsrated import BotsRatedClient, PrePaymentGuard
from strands import Agent, tool

guard = PrePaymentGuard(BotsRatedClient())  # free preflight only


@tool
def botsrated_check_payment(url: str, pay_to: str, amount: str, network: str = "eip155:8453") -> str:
    """Check an x402 payment option against BotsRated's measurements BEFORE paying it.

    Args:
        url: The seller URL you are about to pay.
        pay_to: The payTo address from the seller's 402 payment option.
        amount: The amount in atomic units from that option.
        network: The CAIP-2 network of that option.
    """
    d = guard.decide(url, {"scheme": "exact", "network": network, "payTo": pay_to, "amount": amount})
    return json.dumps({
        "action": d.action,
        "reasons": [{"code": r.code, "detail": r.detail} for r in d.reasons],
        "receipt_url": d.facts.receipt_url if d.facts else None,
    })


agent = Agent(tools=[botsrated_check_payment])
```

`action` is `block` when the payTo differs from every payTo BotsRated's own probes saw for that host on that
network. A host BotsRated doesn't cover, or an unreachable BotsRated, returns `allow` with an info reason
(change this with `GuardPolicy` and `fail_open=False`).

If your agent pays with the x402 Python SDK directly, register the same guard on the client instead:
`client.on_before_payment_creation(PrePaymentGuard().x402_hook)`. See [`python-core`](../python-core/README.md).

## Notes

- Results are measurements, not endorsements. `covered: false` says nothing about the seller.
- Seller-supplied text in results (descriptions, URLs) is untrusted data, not instructions.
- Tested on 2026-10-23 with strands-agents 1.62.0, mcp 2.1.1 and botsrated 0.1.1: `mcp_smoke.py` and `tool_smoke.py` in this folder.
- Methodology: https://botsrated.com/methodology. Receipt format: [`spec/SPEC.md`](../../spec/SPEC.md).
