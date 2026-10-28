# langgraph-botsrated

## Install in 3 steps

1. Install. `langgraph-botsrated` is publishing soon (not on PyPI yet). From a checkout: `pip install -e integrations/langgraph` (pulls `botsrated>=0.3.0,<0.4`).
2. Attach to your x402 client:
```python
from langgraph_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
```
3. Pick `preset` (`warn` advice only is the default; `carefulBuyer` / `strict` stop an unobserved payTo) and `fail_mode` (`"open"` default, or `"closed"`).

## Default install

Pairs with [LangGraph](https://docs.langchain.com/oss/python/langgraph). Payment-client wrap and an optional pre-pay node helper. Not an orchestration framework, and not a StateGraph, checkpoint store, or agent loop. Not published. From a checkout: `pip install -e integrations/langgraph` (needs `botsrated>=0.3.0,<0.4`).

```python
from langgraph_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
```

Omit `preset` for advice only (`warn`). `carefulBuyer` and `strict` block an unobserved payTo only when you select them. Omit `fail_mode` to fail open. Free preflight is `https://botsrated.com` only. No custody and no payment signing.

## Pre-pay node and token

`botsrated_payment_middleware(guard, pay_node, context=read_payment)` runs that same guard before an opaque pay node. On a block it does not call the node and returns only `botsrated_payment_reason`. `botsrated_preflight(url)` is the free preflight and does not attach a guard.

`token`, or `BOTSRATED_TOKEN` when `token` is omitted, is passed as `remote_policy={"token", "fail_mode"}` (botsrated>=0.3.0,<0.4 has `parse_remote_policy`). A bare token string is never passed. botsrated 0.2.1 does not accept `remote_policy`; 0.3.0 does. A configured token without `parse_remote_policy` raises and is not dropped.

Tests: `pytest -m "not live"` in this directory.
