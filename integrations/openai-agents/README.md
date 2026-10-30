# botsrated-openai-agents

## One-click attach

Free. No key for local attach. Pairs with the host runtime. Not a second runtime. Published on PyPI. Paid checks are not required to attach.

```bash
pip install botsrated-openai-agents
```

```python
from botsrated_openai_agents import attach_payment_guard
guard = attach_payment_guard(x402_client)  # omit preset = advice; omit fail_mode = open
```

Preflight and the guard surface signed receipt links (`receipt_url`). When org ledger is enabled, paid checks write there by default. No custody. Facts, not grades.

Attach is pair-with. Free. No key for local attach. Not a second runtime.

Live docs: [botsrated.com/docs/guard#openai-agents](https://botsrated.com/docs/guard#openai-agents).

## Default install

Free. No key for local attach. Pairs with the [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/). Payment-client hook only: it does not replace `Agent` or `Runner`. The guard is not a runtime. Published: `pip install botsrated-openai-agents` (PyPI 0.1.0; dependency `botsrated>=0.3.1,<0.4`). Installing does not attach a guard. Paid checks are not required to attach. Optional `BOTSRATED_TOKEN` for Desk remote policy (omit `token` and the guard reads the env).

```python
# Free. No key for local attach. Not a runtime.
# Optional BOTSRATED_TOKEN for Desk remote policy.
from botsrated_openai_agents import attach_payment_guard
# Omit preset = advice. Omit fail_mode = open.
guard = attach_payment_guard(x402_client)
```

## Install in 3 steps

1. Free. No key for local attach. Install: `pip install botsrated-openai-agents` (PyPI 0.1.0, includes `attach_payment_guard`). Depends on `botsrated>=0.3.1,<0.4`. Paid checks are not required to attach.
2. Attach to your x402 client. Installing does not attach a guard:
```python
from botsrated_openai_agents import attach_payment_guard
guard = attach_payment_guard(x402_client)
```
3. Omit `preset` for advice only (`carefulBuyer` / `strict` stop an unobserved payTo when you pass them). Omit `fail_mode` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Omit `fail_mode` and the guard stays open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Nothing defaults you to closed.

OpenAI Agents SDK hook for [BotsRated](https://botsrated.com). Use it as a pre-payment check before
an agent pays an x402 seller. You keep the SDK's `Agent` and `Runner`.

**Status: published on PyPI: [`botsrated-openai-agents`](https://pypi.org/project/botsrated-openai-agents/) 0.1.0** (this release; includes `attach_payment_guard`).
Depends on [`botsrated`](https://pypi.org/project/botsrated/) `>=0.3.1,<0.4` (source:
[`integrations/python-core`](https://github.com/botsrated/botsrated/tree/main/integrations/python-core)).
PyPI 0.1.0 matches that pin. Omit `token` and `attach_payment_guard` reads `BOTSRATED_TOKEN`.

```bash
pip install botsrated-openai-agents
```

Contributors in a checkout of this repository can install this tree with `pip install -e integrations/openai-agents`. The published install is `pip install botsrated-openai-agents`.

## Opt-in payment guard

`pip install botsrated-openai-agents` does not attach a guard. Call `attach_payment_guard` yourself (depends on `botsrated>=0.3.1,<0.4`). Preflight and the guard are free, no key, rate limits, at `https://botsrated.com`. `botsrated_preflight_tools()` is unchanged: free preflight only.

```python
from botsrated_openai_agents import attach_payment_guard, botsrated_preflight_tools

free = botsrated_preflight_tools()  # free preflight only; no guard attached
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
# token=... is remote_policy on botsrated 0.3.0+ (see the token paragraph above)
```

`preset` is yours: `warn` (advice only; the default when you omit it), `carefulBuyer`, or `strict` (same stops
as `carefulBuyer`). `fail_mode` is `"open"` or `"closed"`; omit it and the guard stays open. The guard
reports measurements and receipt links. It does not sign a payment and does not hold funds.

`x402_client` is your x402 client. `token` is sent as `remote_policy` on botsrated 0.3.0 and later. A configured token without `parse_remote_policy` raises and is not dropped.

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
