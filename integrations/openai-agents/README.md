# botsrated-openai-agents

## Default install

Pairs with the [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/). Payment-client hook only: it does not replace `Agent` or `Runner`. Not a runtime. Not on the registry yet: `pip install -e integrations/openai-agents` (`botsrated>=0.3.1,<0.4`).

```python
# Free. No key for local attach. Not a runtime.
# Optional BOTSRATED_TOKEN for Desk remote policy.
from botsrated_openai_agents import attach_payment_guard
# Omit preset = advice. Omit fail_mode = open.
guard = attach_payment_guard(x402_client)
```

## Install in 3 steps

1. Install. Not on the registry yet. From a checkout, in a clean virtualenv: `pip install -e integrations/openai-agents` (pulls `botsrated>=0.3.1,<0.4`).
2. Attach to your x402 client. Installing does not attach a guard:
```python
from botsrated_openai_agents import attach_payment_guard
guard = attach_payment_guard(x402_client)
```
3. Omit `preset` for advice only (`carefulBuyer` / `strict` stop an unobserved payTo when you pass them). Omit `fail_mode` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Omit `fail_mode` and the guard stays open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Nothing defaults you to closed.

## Behavior

This is the OpenAI Agents SDK mirror of LangChain `attach_payment_guard` ([PR #14](https://github.com/botsrated/botsrated/pull/14)). You keep the SDK's `Agent` and `Runner`. The hook is the x402 client those paid calls already use:

```python
from agents import Agent, Runner
from botsrated_openai_agents import attach_payment_guard

guard = attach_payment_guard(x402_client)
# Omit token and the guard reads BOTSRATED_TOKEN. Agent and Runner stay the SDK's.
```

| Argument | Omit | Set |
|---|---|---|
| `preset` | Advice only (`warn`). An unobserved payTo is reported and the payment is not stopped. | `warn` (same advice), `carefulBuyer`, or `strict`. `carefulBuyer` and `strict` are the same stops: an unobserved payTo, an invalid payTo, a host mismatch, or an unknown paid URL blocks. `strict` is passed as that policy table because `PaymentGuard` preset names are `warn`, `carefulBuyer`, and `dry-run-only`. |
| `fail_mode` | Open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. | `"open"` or `"closed"`. Nothing defaults you to closed. |
| `token` | Reads `BOTSRATED_TOKEN` when it is set. Unset sends nothing extra. | An explicit token wins over `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`. A configured token without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk). |

The guard's lookup is the free preflight at `https://botsrated.com` (host name only). It does not sign a payment, does not custody funds, and does not add a payment-creation-failure hook. The client enforces a block by honoring the x402 `AbortResult` from `on_before_payment_creation`. Tell the guard which URL is being paid with `guard.request(url)` or `guard.wrap_get` on that client, the same way `PaymentGuard` documents it.

## Optional free preflight tools

`botsrated_preflight_tools()` returns a free HTTP preflight callable and `https://botsrated.com/mcp`. It does not attach a guard. Same rule as `botsrated_tools()` in the LangChain package.

```python
from agents import Agent, function_tool
from botsrated_openai_agents import botsrated_preflight_tools

free = botsrated_preflight_tools()
agent = Agent(
    name="buyer",
    instructions="Look up the seller with the free preflight tool before paying.",
    tools=[function_tool(fn) for fn in free.http],
)
# free.mcp_url is the hosted MCP server. Add it with the SDK's MCP client if you want it.
# The guard is still a separate attach_payment_guard(x402_client) on the payment client.
```

Tests: `pytest -m "not live"` in this directory.
