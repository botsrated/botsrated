# pydantic-ai-botsrated

## One-click attach

Free. No key for local attach. Pairs with the host runtime. Not a second runtime. Paid checks are not required to attach.

```bash
pip install "botsrated[x402]"
```

```python
from botsrated import PaymentGuard
guard = PaymentGuard(preset="carefulBuyer")  # omit preset = warn only, never stops a payment
guard.install(x402_client)                   # the x402 client your agent already pays with
```

The pair-with package is not on PyPI yet: `pip install -e integrations/pydantic-ai`, then `attach_payment_guard` from `pydantic_ai_botsrated`.

Preflight and the guard surface signed receipt links (`receipt_url`). When org ledger is enabled, paid checks write there by default. No custody. Facts, not grades.

Live docs: [botsrated.com/docs/guard#pydantic-ai](https://botsrated.com/docs/guard#pydantic-ai).

## Install in 3 steps

1. Free. No key for local attach. Install the guard that works today: `pip install "botsrated[x402]"`, then `PaymentGuard` on the x402 client your agent already pays with (one-click above). The pair-with package is not on PyPI yet. From a checkout, in a clean virtualenv: `pip install -e integrations/pydantic-ai` (pulls `botsrated>=0.3.0,<0.4`).
2. On the pair-with package, attach to your x402 client. Installing does not attach a guard:
```python
from pydantic_ai_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)
```
3. Omit `preset` for advice only (`carefulBuyer` / `strict` stop an unobserved payTo when you pass them). Omit `fail_mode` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Omit `fail_mode` and the guard stays open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Nothing defaults you to closed.

## Default install

Pairs with [Pydantic AI](https://pydantic.dev/docs/ai/core-concepts/hooks/). Payment-client wrap and an optional before-pay Hooks capability for any app that already pays with an x402 client. Not an agent or graph runtime. Free. No key for local attach. Today: `pip install "botsrated[x402]"` and `PaymentGuard`. The pair-with package is not on PyPI yet: `pip install -e integrations/pydantic-ai`.

Pair-with package (not on PyPI yet):

```python
from pydantic_ai_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)
```

Omit `preset` for advice only (`warn`). `carefulBuyer` and `strict` block an unobserved payTo only when you select them. Omit `fail_mode` to stay open. Free preflight is `https://botsrated.com` only. No custody and no payment signing.

## Before-pay hooks and token

`botsrated_payment_hooks(guard, paid_tools={"pay_seller"})` returns a Pydantic AI `Hooks` capability (`pip install -e "integrations/pydantic-ai[hooks]"`, `pydantic-ai-slim` 2.x, checked against 2.63.0). Pass it as `Agent(..., capabilities=[hooks])`. It registers `before_tool_execute` for those named paid tools only. On a block it raises `ToolFailed` so the model sees a terminal failure and the tool does not run. When that exception is absent it raises `SkipToolExecution`. It does not raise `ModelRetry`. Tools that are not named are left alone. `botsrated_preflight(url)` is the free preflight and does not attach a guard.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Tests: `pytest -m "not live"` in this directory. They do not run an agent or call a model.
