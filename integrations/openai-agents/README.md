# botsrated-openai-agents

## Install in 3 steps

1. Install. `botsrated-openai-agents` is publishing soon (not on PyPI yet). From a checkout: `pip install -e integrations/openai-agents` (pulls `botsrated>=0.3.0,<0.4`).
2. Attach to your x402 client:
```python
from botsrated_openai_agents import attach_payment_guard
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
```
3. Pick `preset` (`warn` advice only is the default; `carefulBuyer` / `strict` stop an unobserved payTo) and `fail_mode` (`"open"` default, or `"closed"`).

## Default install

Pairs with the [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/). Payment-client hook only: it does not replace `Agent` or `Runner`. Not published. From a checkout: `pip install -e integrations/openai-agents` (needs `botsrated>=0.3.0,<0.4`).

```python
from botsrated_openai_agents import attach_payment_guard
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
```

Omit `preset` for advice only. `carefulBuyer` and `strict` block an unobserved payTo only when selected. Omit `fail_mode` to fail open. Free preflight at `https://botsrated.com`. Does not sign payments or hold funds.

## Behavior

This is the OpenAI Agents SDK mirror of LangChain `attach_payment_guard` ([PR #14](https://github.com/botsrated/botsrated/pull/14)). You keep the SDK's `Agent` and `Runner`. The hook is the x402 client those paid calls already use:

```python
import os
from agents import Agent, Runner
from botsrated_openai_agents import attach_payment_guard

guard = attach_payment_guard(
    x402_client,
    token=os.getenv("BOTSRATED_TOKEN"),
)
# Agent(...) and Runner.run(...) stay the SDK's. Pay through x402_client.
```

| Argument | Omit | Set |
|---|---|---|
| `preset` | Advice only (`warn`). An unobserved payTo is reported and the payment is not stopped. | `warn` (same advice), `carefulBuyer`, or `strict`. `carefulBuyer` and `strict` are the same stops: an unobserved payTo, an invalid payTo, a host mismatch, or an unknown paid URL blocks. `strict` is passed as that policy table because `PaymentGuard` preset names are `warn`, `carefulBuyer`, and `dry-run-only`. |
| `fail_mode` | Fail-open. | `"open"` or `"closed"`. When the free preflight cannot be reached, closed stops the payment on the client hook and open allows it. A missing decision is not turned into a pass while closed. |
| `token` | Nothing extra is sent. | Passed as `remote_policy` when `parse_remote_policy` is present. botsrated 0.2.1 does not accept `remote_policy`; 0.3.0 does. A configured token without that normalizer raises and is not dropped. |

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
