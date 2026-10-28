# crewai-botsrated

## Install in 3 steps

1. Install. Not on the registry yet. From a checkout, in a clean virtualenv: `pip install -e integrations/crewai` (pulls `botsrated>=0.3.0,<0.4`).
2. Attach to your x402 client. Installing does not attach a guard:
```python
from crewai_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)
```
3. Omit `preset` for advice only (`carefulBuyer` / `strict` stop an unobserved payTo when you pass them). Omit `fail_mode` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Omit `fail_mode` and the guard stays open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Nothing defaults you to closed.

## Default install

Pairs with [CrewAI](https://docs.crewai.com/en/learn/tool-hooks). Payment-client wrap and an optional before-pay tool hook. Not a crew, process, flow, or agent loop. Not on the registry yet.

```python
from crewai_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)
```

Omit `preset` for advice only (`warn`). `carefulBuyer` and `strict` block an unobserved payTo only when you select them. Omit `fail_mode` to stay open. Free preflight is `https://botsrated.com` only. No custody and no payment signing.

## Before-pay hook and token

`register_botsrated_pre_tool_hook(guard, paid_tools={"pay_seller"})` registers CrewAI `PRE_TOOL_CALL` (`@on(InterceptionPoint.PRE_TOOL_CALL)`). On a block it raises `HookAborted(reason=..., source="botsrated")` and does not run that tool. Older CrewAI uses `@before_tool_call` and returns `False`. Tools that are not named are left alone. `botsrated_preflight(url)` is the free preflight and does not attach a guard.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Tests: `pytest -m "not live"` in this directory. They do not kick off a crew.
