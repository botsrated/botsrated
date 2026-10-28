# pydantic-ai-botsrated

## Default install

Pairs with [Pydantic AI](https://pydantic.dev/docs/ai/core-concepts/hooks/). Payment-client wrap and an optional before-pay Hooks capability for any app that already pays with an x402 client. Not an agent or graph runtime. Not published. From a checkout: `pip install -e integrations/pydantic-ai` (needs `botsrated` 0.2.1 or newer).

```python
from pydantic_ai_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
```

Omit `preset` for advice only (`warn`). `carefulBuyer` and `strict` block an unobserved payTo only when you select them. Omit `fail_mode` to fail open. Free preflight is `https://botsrated.com` only. No custody and no payment signing.

## Before-pay hooks and token

`botsrated_payment_hooks(guard, paid_tools={"pay_seller"})` returns a Pydantic AI `Hooks` capability (`pip install -e "integrations/pydantic-ai[hooks]"`, `pydantic-ai-slim` 2.x, checked against 2.63.0). Pass it as `Agent(..., capabilities=[hooks])`. It registers `before_tool_execute` for those named paid tools only. On a block it raises `ToolFailed` so the model sees a terminal failure and the tool does not run. When that exception is absent it raises `SkipToolExecution`. It does not raise `ModelRetry`. Tools that are not named are left alone. `botsrated_preflight(url)` is the free preflight and does not attach a guard.

`token`, or `BOTSRATED_TOKEN` when `token` is omitted, is passed as `remote_policy={"token", "fail_mode"}` only when `PaymentGuard` accepts that keyword. A bare token string is never passed. On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info. A missing decision is not a pass. A remote pass does not clear a local block. botsrated 0.2.1 does not accept `remote_policy`, so the token is not sent.

Tests: `pytest -m "not live"` in this directory. They do not run an agent or call a model.
