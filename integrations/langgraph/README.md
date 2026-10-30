# langgraph-botsrated

## One-click attach

Free. No key for local attach. Pairs with the host runtime. Not a second runtime. Published on PyPI. Paid checks are not required to attach.

```bash
pip install langgraph-botsrated
```

```python
from langgraph_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)  # omit preset = advice; omit fail_mode = open
```

Preflight and the guard surface signed receipt links (`receipt_url`). When org ledger is enabled, paid checks write there by default. No custody. Facts, not grades.

Attach is pair-with. Free. No key for local attach. Not a second runtime.

Live docs: [botsrated.com/docs/guard#langgraph](https://botsrated.com/docs/guard#langgraph).

## Default install

Free. No key for local attach. Pairs with [LangGraph](https://docs.langchain.com/oss/python/langgraph). Payment-client wrap and an optional pre-pay node helper. Not an orchestration framework, and not a StateGraph, checkpoint store, or agent loop. The guard is not a runtime. Published: `pip install langgraph-botsrated` (PyPI 0.1.1; dependency `botsrated>=0.3.1,<0.4`). Installing does not attach a guard. Paid checks are not required to attach. Optional `BOTSRATED_TOKEN` for Desk remote policy (omit `token` and the guard reads the env).

```python
# Free. No key for local attach. Not a runtime.
# Optional BOTSRATED_TOKEN for Desk remote policy.
from langgraph_botsrated import attach_payment_guard
# Omit preset = advice. Omit fail_mode = open.
guard = attach_payment_guard(x402_client)
```

It does not sign a payment and does not hold funds.

## Install in 3 steps

1. Free. No key for local attach. Install: `pip install langgraph-botsrated` (PyPI 0.1.1, includes `attach_payment_guard`). Depends on `botsrated>=0.3.1,<0.4`. Paid checks are not required to attach.
2. Attach to your x402 client. Installing does not attach a guard:
```python
from langgraph_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)
```
3. Omit `preset` for advice only (`carefulBuyer` / `strict` stop an unobserved payTo when you pass them). Omit `fail_mode` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Omit `fail_mode` and the guard stays open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Nothing defaults you to closed.

LangGraph hook for [BotsRated](https://botsrated.com). Use it as a pre-payment check before
an agent pays an x402 seller. LangGraph stays the graph.

**Status: published on PyPI: [`langgraph-botsrated`](https://pypi.org/project/langgraph-botsrated/) 0.1.1** (this release; includes `attach_payment_guard`).
Depends on [`botsrated`](https://pypi.org/project/botsrated/) `>=0.3.1,<0.4` (source:
[`integrations/python-core`](https://github.com/botsrated/botsrated/tree/main/integrations/python-core)).
PyPI 0.1.1 matches that pin. Omit `token` and `attach_payment_guard` reads `BOTSRATED_TOKEN`.

```bash
pip install langgraph-botsrated
```

Contributors in a checkout of this repository can install this tree with `pip install -e integrations/langgraph`. The published install is `pip install langgraph-botsrated`.

## Opt-in payment guard

`pip install langgraph-botsrated` does not attach a guard. Call `attach_payment_guard` yourself (depends on `botsrated>=0.3.1,<0.4`). Preflight and the guard are free, no key, rate limits, at `https://botsrated.com`. `botsrated_preflight(url)` is unchanged: free preflight only.

```python
from langgraph_botsrated import attach_payment_guard, botsrated_preflight

guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
# token=... is remote_policy on botsrated 0.3.0+ (see the token paragraph above)
```

`preset` is yours: `warn` (advice only; the default when you omit it), `carefulBuyer`, or `strict` (same stops
as `carefulBuyer`). `fail_mode` is `"open"` or `"closed"`; omit it and the guard stays open. The guard
reports measurements and receipt links. It does not sign a payment and does not hold funds.

`x402_client` is your x402 client. `token` is sent as `remote_policy` on botsrated 0.3.0 and later. A configured token without `parse_remote_policy` raises and is not dropped.

## Pre-pay node and token

`botsrated_payment_middleware(guard, pay_node, context=read_payment)` runs that same guard before an opaque pay node. On a block it does not call the node and returns only `botsrated_payment_reason`. `botsrated_preflight(url)` is the free preflight and does not attach a guard.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Tests: `pytest -m "not live"` in this directory.
