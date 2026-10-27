# agent-framework-botsrated: BotsRated pre-payment check for Microsoft Agent Framework (Python)

Function middleware for [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) that checks an
x402 payment with [BotsRated](https://botsrated.com) **before a payment tool runs**. BotsRated probes x402 sellers on
Base and records which `payTo` wallet each one actually quoted. The middleware asks BotsRated's free preflight
(no API key, no wallet) whether the `payTo` your agent is about to pay was observed for that seller, and stops the call
if it wasn't.

Maintained by BotsRated, not by Microsoft. Issues: https://github.com/botsrated/botsrated/issues/new

## Install

```bash
pip install agent-framework-botsrated
# with the hosted MCP server example:
pip install "agent-framework-botsrated[mcp]"
```

Requires Python 3.10+, `agent-framework-core>=1.22,<2` and [`botsrated`](https://pypi.org/project/botsrated/) 0.1.6+ (below 0.3; from agent-framework-botsrated 0.1.3).
Tested with agent-framework-core 1.22.0 (with mcp 1.30) and 1.23.0 (with mcp 2.3). agent-framework-core 1.22 can't
initialize MCP sessions with mcp 2.x, so pin `mcp<2` there if you use the hosted MCP server.

## Middleware: check payments before they run

```python
from agent_framework import Agent
from agent_framework_botsrated import BotsRatedPaymentMiddleware


def pay_x402(url: str, pay_to: str, amount: str, network: str = "eip155:8453") -> str:
    """Pay an x402 seller."""
    ...  # your payment code


agent = Agent(
    client=chat_client,
    tools=[pay_x402],
    middleware=[BotsRatedPaymentMiddleware(["pay_x402"])],
)
```

- Only the functions you name are checked. Every other function call passes through untouched.
- The quote is read from the call's arguments: `url`, `pay_to` (or `payTo`), `amount` (atomic units) and optional
  `network` (CAIP-2, default `eip155:8453`). For other argument names pass an extractor:
  `BotsRatedPaymentMiddleware({"buy": lambda a: PaymentQuote(url=a["endpoint"], pay_to=a["recipient"], amount=str(a["atomic"]))})`.
- A blocked call never reaches `call_next`. The reason (with a link to the BotsRated probe receipt) becomes the call's
  result, so the model reads it. With `on_block="raise"` the run ends with `BotsRatedPaymentBlocked` (a
  `MiddlewareFailure`).
- The `botsrated.Decision` is stored in `context.metadata["botsrated_decision"]`; `guard.on_decision` is also called.

Default policy (from `botsrated.GuardPolicy`, configurable through `guard=PrePaymentGuard(policy=...)`):

| Situation | Result |
|---|---|
| `payTo` never observed by BotsRated for that host (same network) | **blocked** (`payto_not_observed`; `payto_mismatch` with botsrated 0.1.x). The default guard passes `GuardPolicy(pay_to_mismatch="block")`, so this holds with botsrated 0.2, whose own default is advice-only |
| Quote can't be read from the arguments | **blocked** (`quote_unreadable`) |
| Price above the last observed price on the same route | allowed with a warning |
| Host not covered, or data older than 24 h | allowed (info) |
| BotsRated unreachable | allowed (`fail_open=True`); set `PrePaymentGuard(fail_open=False)` to block |

The middleware checks what the payment tool was asked to pay. If your tool fetches the 402 itself and signs it, also
register `botsrated.PrePaymentGuard(policy=botsrated.GuardPolicy(pay_to_mismatch="block")).x402_hook` on your
`x402Client`'s `on_before_payment_creation` so the check runs on the exact quote being signed (without that policy,
botsrated 0.2's guard only warns about an unobserved payTo), and make the request through `guard.wrap_get(...)` (or inside
`with botsrated.paying_request(url):`) so the guard checks the host actually being paid rather than the
seller-supplied 402 `resource.url` (botsrated 0.1.5+).

## Tool: let the model check a payment option

```python
from agent_framework_botsrated import botsrated_check_payment_tool

agent = Agent(client=chat_client, tools=[botsrated_check_payment_tool(), pay_x402])
```

`botsrated_check_payment(url, pay_to, amount, network)` returns JSON with `action` (`allow`/`block`), `reasons` and
`receipt_url`. It uses the free preflight only.

## Hosted MCP server (no package needed)

BotsRated also runs a remote MCP server (streamable HTTP, no auth). Its free tools are `preflight`, `coverage`,
`sample` and `history`:

```python
from agent_framework import MCPStreamableHTTPTool

botsrated_mcp = MCPStreamableHTTPTool(
    name="botsrated",
    url="https://botsrated.com/mcp",
    allowed_tools=["preflight", "coverage", "sample", "history"],
)
async with botsrated_mcp:
    result = await Agent(client=chat_client, tools=[botsrated_mcp]).run("Is blockrun.ai a known x402 seller?")
```

The paid lookups (`check` $0.001, `report` $0.002, `best` $0.01 USDC on Base; the first 25 checks and 3 reports per
client IP per UTC day are free) are not used by this package unless you pass a paid-enabled `BotsRatedClient` to the guard.

## Run the example and tests

```bash
pip install -e ".[mcp]" pytest pytest-asyncio
python examples/quickstart.py   # scripted model, real free preflight, stub payment
pytest -m "not live"            # offline
pytest -m live                  # real free BotsRated preflight + hosted MCP server; nothing is paid
```

`examples/quickstart.py` uses a scripted chat client instead of a model, so it runs without an API key. One payment
call uses an unknown `payTo` and is blocked; the other uses the `payTo` BotsRated observed for blockrun.ai and runs.

BotsRated results are measurements, not endorsements. MIT licensed.
