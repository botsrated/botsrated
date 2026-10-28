# crewai-botsrated

## Install in 3 steps

1. Install. `crewai-botsrated` is publishing soon (not on PyPI yet). From a checkout: `pip install -e integrations/crewai` (pulls `botsrated>=0.3.0,<0.4`).
2. Attach to your x402 client:
```python
from crewai_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
```
3. Pick `preset` (`warn` advice only is the default; `carefulBuyer` / `strict` stop an unobserved payTo) and `fail_mode` (`"open"` default, or `"closed"`).

## Default install

Pairs with [CrewAI](https://docs.crewai.com/en/learn/tool-hooks). Payment-client wrap and an optional before-pay tool hook. Not a crew, process, flow, or agent loop. Not published. From a checkout: `pip install -e integrations/crewai` (needs `botsrated>=0.3.0,<0.4`).

```python
from crewai_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
```

Omit `preset` for advice only (`warn`). `carefulBuyer` and `strict` block an unobserved payTo only when you select them. Omit `fail_mode` to fail open. Free preflight is `https://botsrated.com` only. No custody and no payment signing.

## Before-pay hook and token

`register_botsrated_pre_tool_hook(guard, paid_tools={"pay_seller"})` registers CrewAI `PRE_TOOL_CALL` (`@on(InterceptionPoint.PRE_TOOL_CALL)`). On a block it raises `HookAborted(reason=..., source="botsrated")` and does not run that tool. Older CrewAI uses `@before_tool_call` and returns `False`. Tools that are not named are left alone. `botsrated_preflight(url)` is the free preflight and does not attach a guard.

`token`, or `BOTSRATED_TOKEN` when `token` is omitted, is passed as `remote_policy={"token", "fail_mode"}` (botsrated>=0.3.0,<0.4 has `parse_remote_policy`). A bare token string is never passed. On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info. A missing decision is not a pass. botsrated 0.2.1 does not accept `remote_policy`; 0.3.0 does. A configured token without `parse_remote_policy` raises and is not dropped.

Tests: `pytest -m "not live"` in this directory. They do not kick off a crew.
