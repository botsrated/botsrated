# agent-framework-botsrated

## One-click attach

Pairs with Microsoft Agent Framework. Not a second runtime. Free. No key for local attach. Published on PyPI.

```bash
pip install agent-framework-botsrated
```

```python
from agent_framework_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)  # omit preset = advice; omit fail_mode = open
```

Preflight and the guard surface signed receipt links (`receipt_url`). When org ledger is enabled, paid checks write there by default. No custody. Facts, not grades.

## Install in 3 steps

1. Install the published package: `pip install agent-framework-botsrated` (PyPI 0.1.4). That release includes the middleware, the check tool, and `attach_payment_guard`. It depends on `botsrated>=0.3.0,<0.4`.
2. Name the payment tools. Installing does not attach an x402 guard:
```python
from agent_framework_botsrated import BotsRatedPaymentMiddleware

middleware = [BotsRatedPaymentMiddleware(["pay_x402"])]
```
3. With no preset, an unobserved payTo is blocked, and so is an invalid payTo. Omit `fail_mode` to stay open.

`attach_payment_guard` is in PyPI 0.1.4. Installing does not attach a guard:

```python
from agent_framework_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)
```

Omit `preset` for advice only (`carefulBuyer` / `strict` stop an unobserved payTo when you pass them). Omit `fail_mode` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Omit `fail_mode` and the guard stays open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Nothing defaults you to closed.

## Default install

Pairs with [Microsoft Agent Framework](https://github.com/microsoft/agent-framework). Payment-client wrap, and the existing function middleware for an opaque payment tool. Not an agent or workflow runtime. The guard is not a runtime. Free. No key for local attach.

**Status: published on PyPI: [`agent-framework-botsrated`](https://pypi.org/project/agent-framework-botsrated/) 0.1.4** (this release; includes the middleware, the check tool, and `attach_payment_guard`). It depends on [`botsrated`](https://pypi.org/project/botsrated/) `>=0.3.0,<0.4`.

```python
from agent_framework_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)
```

Omit `preset` for advice only (`warn`). `carefulBuyer` and `strict` block an unobserved payTo only when you select them. Omit `fail_mode` to stay open. Free preflight is `https://botsrated.com` only. No custody and no payment signing.

## What it checks

Function middleware and a payment-client hook for [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) that check an
x402 payment with [BotsRated](https://botsrated.com) **before pay**. BotsRated probes x402 sellers on
Base and records which `payTo` wallet each one actually quoted. The check asks BotsRated's free preflight
(no API key, no wallet) whether the `payTo` your agent is about to pay was observed for that seller.

Maintained by BotsRated, not by Microsoft. Issues: https://github.com/botsrated/botsrated/issues/new

## Install

```bash
pip install agent-framework-botsrated
# with the hosted MCP server example:
pip install "agent-framework-botsrated[mcp]"
```

PyPI 0.1.4 requires Python 3.10+, `agent-framework-core>=1.22,<2`, and [`botsrated`](https://pypi.org/project/botsrated/) `>=0.3.0,<0.4`.
Tested with agent-framework-core 1.22.0 (with mcp 1.30) and 1.23.0 (with mcp 2.3). agent-framework-core 1.22 can't
initialize MCP sessions with mcp 2.x, so pin `mcp<2` there if you use the hosted MCP server.

## Middleware and token

`attach_payment_guard` is the hook. Keep your `Agent`. When the x402 client sits inside a payment tool, pass that same guard to the existing middleware. `BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

```python
import os
from agent_framework import Agent
from agent_framework_botsrated import BotsRatedPaymentMiddleware, attach_payment_guard

guard = attach_payment_guard(
    x402_client,
    preset="carefulBuyer",
    fail_mode="open",
    token=os.getenv("BOTSRATED_TOKEN"),
)
agent = Agent(
    client=chat_client,
    tools=[paid_tool],
    middleware=[BotsRatedPaymentMiddleware(["paid_tool"], guard=guard)],
)
```

`BotsRatedPaymentMiddleware(["paid_tool"], preset="carefulBuyer", fail_mode="open", token=...)` builds that same guard when you do not already have one. It does not register x402 hooks. Only the named payment tools are checked. On a block, `on_block="raise"` raises `BotsRatedPaymentBlocked`. The default returns the blocked reason and does not run the tool. `botsrated_check_payment_tool()` is the free preflight and does not attach a guard.

`BotsRatedPaymentMiddleware(["paid_tool"])` with no guard, preset, fail_mode, or token keeps the existing free-preflight guard: an unobserved payTo is blocked, and an invalid payTo is blocked. Setting `fail_mode` or `token` without a `preset` keeps both of those blocks (`pay_to_mismatch="block"` and `pay_to_invalid="block"`). It does not switch the default to advice-only, and it does not change `fail_mode` (omit it to stay open). `preset="warn"` is advice only when selected.

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
| `payTo` is not a 20-byte hex address | **blocked**. The historical guard uses `pay_to_mismatch`. A `PaymentGuard` built with `fail_mode` or `token` and no `preset` sets `pay_to_invalid="block"` as well |
| Quote can't be read from the arguments | **blocked** (`quote_unreadable`) |
| Price above the last observed price on the same route | allowed with a warning |
| Host not covered, or data older than 24 h | allowed (info) |
| BotsRated unreachable | allowed (`fail_open=True`); set `PrePaymentGuard(fail_open=False)` to block |

The middleware checks what the payment tool was asked to pay. If your tool fetches the 402 itself and signs it, wrap
that client with `attach_payment_guard` so the check runs on the quote being signed. Call `guard.request(url)` or
`guard.wrap_get(...)` around the paying request so the guard sees the host actually being paid, rather than only the
seller-supplied 402 `resource.url`.

## Tool: let the model check a payment option

```python
from agent_framework_botsrated import botsrated_check_payment_tool

agent = Agent(client=chat_client, tools=[botsrated_check_payment_tool(), pay_x402])
```

`botsrated_check_payment(url, pay_to, amount, network)` returns JSON with `action` (`allow`/`block`), `reasons` and
`receipt_url`. It uses the free preflight only. It does not attach a guard.

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
pip install -e ".[mcp]" pytest pytest-asyncio respx
python examples/quickstart.py   # scripted model, real free preflight, stub payment
pytest -m "not live"            # offline; no network and no provider call
pytest -m live                  # real free BotsRated preflight + hosted MCP server; nothing is paid
```

`examples/quickstart.py` uses a scripted chat client instead of a model, so it runs without an API key. One payment
call uses an unknown `payTo` and is blocked; the other uses the `payTo` BotsRated observed for blockrun.ai and runs.

BotsRated results are measurements, not endorsements. MIT licensed.
