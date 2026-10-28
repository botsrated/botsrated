# google-adk-botsrated

## Default install

Pairs with [Google ADK](https://google.github.io/adk-docs/). Payment-client wrap and an optional before-tool callback. Not an agent runtime, and not an Agent, Runner, or session service. Not published. From a checkout: `pip install -e integrations/google-adk` (needs `botsrated` 0.2.1 or newer).

```python
from google_adk_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
```

Omit `preset` for advice only (`warn`). `carefulBuyer` and `strict` block an unobserved payTo only when you select them. Omit `fail_mode` to fail open. Free preflight is `https://botsrated.com` only. No custody and no payment signing.

## Before-tool callback and token

`botsrated_before_tool_callback(guard, ["pay_seller"])` is an ADK `before_tool_callback` for those opaque paid tools. On a block it returns only `botsrated_payment_reason` and does not run the tool. Other tools are unchanged. `botsrated_preflight(url)` is the free preflight and does not attach a guard.

`token`, or `BOTSRATED_TOKEN` when `token` is omitted, is passed as `remote_policy={"token", "fail_mode"}` only when `PaymentGuard` accepts that keyword. A bare token string is never passed. On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info. A missing decision is not a pass. botsrated 0.2.1 does not accept `remote_policy`, so the token is not sent.

Tests: `pytest -m "not live"` in this directory.
