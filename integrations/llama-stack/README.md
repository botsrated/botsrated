# llama-stack-botsrated

## One-click attach

Pairs with the host runtime. Not a second runtime. Free. No key for local attach. Not on the registry yet — install from a checkout.

```bash
pip install -e integrations/llama-stack
```

```python
from llama_stack_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)  # omit preset = advice; omit fail_mode = open
```

Preflight and the guard surface signed receipt links (`receipt_url`). When org ledger is enabled, paid checks write there by default. No custody. Facts, not grades.

## Default install

Pairs with [Llama Stack](https://llama-stack.readthedocs.io/). Payment-client wrap only. Llama Stack stays the runtime, the distribution, and the inference server. A secondary before-tool hook is deferred. Not on the registry yet: `pip install -e integrations/llama-stack` (`botsrated>=0.3.1,<0.4`).

```python
# Free. No key for local attach. Not a runtime.
# Optional BOTSRATED_TOKEN for Desk remote policy.
from llama_stack_botsrated import attach_payment_guard
# Omit preset = advice. Omit fail_mode = open.
guard = attach_payment_guard(x402_client)
```

It does not sign a payment and does not hold funds.

## Install in 3 steps

1. Install. Not on the registry yet. From a checkout, in a clean virtualenv: `pip install -e integrations/llama-stack` (pulls `botsrated>=0.3.1,<0.4`).
2. Attach to your x402 client. Installing does not attach a guard:
```python
from llama_stack_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)
```
3. Omit `preset` for advice only (`carefulBuyer` / `strict` stop an unobserved payTo when you pass them). Omit `fail_mode` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Omit `fail_mode` and the guard stays open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Nothing defaults you to closed.

## Token and preflight

`botsrated_preflight(url)` is the free preflight and does not attach a guard.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Tests: `pytest -m "not live"` in this directory. They do not import a Llama Stack server.
