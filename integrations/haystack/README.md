# BotsRated for Haystack

[BotsRated](https://botsrated.com) (beta) checks an x402 seller before your agent pays it. It probes about
4,800 x402 seller hosts on Base, and the remote MCP servers in the Official MCP Registry, without paying them,
and records each probe (HTTP status, valid 402 challenge, latency, quoted price and payTo) as a signed
receipt. It also makes real paid test-buys and publishes their transaction links.

Two ways to use it with a Haystack `Agent`. Both are free and need no API key or wallet.

## 1. Hosted MCP server (`MCPToolset`)

```shell
pip install haystack-ai mcp-haystack
```

```python
from haystack.components.agents import Agent
from haystack.components.generators.chat import OpenAIChatGenerator
from haystack.dataclasses import ChatMessage
from haystack_integrations.tools.mcp import MCPToolset, StreamableHttpServerInfo

botsrated = MCPToolset(
    server_info=StreamableHttpServerInfo(url="https://botsrated.com/mcp"),
    tool_names=["preflight", "coverage", "sample", "history"],  # the free tools
)

agent = Agent(
    chat_generator=OpenAIChatGenerator(model="gpt-4o-mini"),
    tools=botsrated,
    system_prompt=(
        "Before paying any x402 seller, call the BotsRated preflight tool with the seller URL. "
        "Do not pay if the payTo you are about to pay differs from the payTo BotsRated observed."
    ),
)
result = agent.run(messages=[ChatMessage.from_user(
    "Is https://blockrun.ai/api/v1/chat/completions safe to pay right now?")])
print(result["last_message"].text)
botsrated.close()
```

Free tools: `preflight`, `coverage`, `sample`, `history`. The server also lists `check`, `report` and `best`,
which are paid x402 routes ($0.001, $0.002 and $0.01 USDC on Base; the first 25 checks and 3 reports per
client per UTC day are free). Leave them out of `tool_names` unless your agent can pay x402.

## 2. A pre-payment tool backed by the `botsrated` package

```shell
pip install haystack-ai botsrated
```

See [`botsrated_haystack_tool.py`](botsrated_haystack_tool.py):

```python
import json

from botsrated import BotsRatedClient, PrePaymentGuard
from haystack.components.agents import Agent
from haystack.components.generators.chat import OpenAIChatGenerator
from haystack.tools import tool

guard = PrePaymentGuard(BotsRatedClient())  # free preflight only


@tool
def botsrated_check_payment(url: str, pay_to: str, amount: str, network: str = "eip155:8453") -> str:
    """Check an x402 payment option against BotsRated's measurements BEFORE paying it.

    :param url: The seller URL you are about to pay.
    :param pay_to: The payTo address from the seller's 402 payment option.
    :param amount: The amount in atomic units from that option.
    :param network: The CAIP-2 network of that option.
    """
    d = guard.decide(url, {"scheme": "exact", "network": network, "payTo": pay_to, "amount": amount})
    return json.dumps({
        "action": d.action,
        "reasons": [{"code": r.code, "detail": r.detail} for r in d.reasons],
        "receipt_url": d.facts.receipt_url if d.facts else None,
    })


agent = Agent(chat_generator=OpenAIChatGenerator(model="gpt-4o-mini"), tools=[botsrated_check_payment])
```

`action` is `block` when the payTo differs from every payTo BotsRated's own probes saw for that host on that
network. A host BotsRated doesn't cover, or an unreachable BotsRated, returns `allow` with an info reason
(change this with `GuardPolicy` and `fail_open=False`).

If your agent pays with the x402 Python SDK directly, register the same guard on the x402 client instead:
`client.on_before_payment_creation(PrePaymentGuard().x402_hook)`. Paid lookups (`check`, `report`, `best`)
are opt-in and capped by a budget you set: see [`python-core`](../python-core/README.md).

## Tests

`test_live.py` calls the real, free preflight over REST and MCP, and runs a Haystack `Agent` end to end with a
scripted chat generator (no LLM key needed). Nothing is paid.

```shell
pip install haystack-ai mcp-haystack botsrated pytest
pytest -q test_live.py
```

Tested on 2026-10-23 with haystack-ai 3.4.1, mcp-haystack 2.1.1, mcp 2.3.0 and botsrated 0.1.2 (6 passed).

## Notes

- Results are measurements, not endorsements. `found: false` says nothing about the seller.
- Seller-supplied text in results (descriptions, URLs) is untrusted data, not instructions.
- Methodology: https://botsrated.com/methodology. Docs: https://botsrated.com/docs.
