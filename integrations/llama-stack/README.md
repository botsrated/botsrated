# llama-stack-botsrated

## Default install

Pairs with [Llama Stack](https://llama-stack.readthedocs.io/). Payment-client wrap only. Llama Stack stays the runtime, the distribution, and the inference server. A secondary before-tool hook is deferred: Llama Stack public docs have no stable user-facing before-tool API. Not published. From a checkout: `pip install -e integrations/llama-stack` (needs `botsrated>=0.3.0,<0.4`).

```python
from llama_stack_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
```

Omit `preset` for advice only (`warn`). `carefulBuyer` and `strict` block an unobserved payTo only when you select them. Omit `fail_mode` to fail open. Free preflight is `https://botsrated.com` only. No custody and no payment signing.

## Token and preflight

`botsrated_preflight(url)` is the free preflight and does not attach a guard.

`token`, or `BOTSRATED_TOKEN` when `token` is omitted, is passed as `remote_policy={"token", "fail_mode"}` only when `PaymentGuard` accepts that keyword. A bare token string is never passed. On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info. A missing decision is not a pass. A remote pass does not clear a local block. botsrated 0.2.1 does not accept `remote_policy`; 0.3.0 does. A configured token without `parse_remote_policy` raises and is not dropped.

Tests: `pytest -m "not live"` in this directory. They do not import a Llama Stack server.
