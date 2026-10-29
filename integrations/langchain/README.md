# langchain-botsrated

## Install in 3 steps

1. Install: `pip install langchain-botsrated` (PyPI 0.1.4, includes `attach_payment_guard`). It depends on `botsrated>=0.3.0,<0.4`.
2. Attach to your x402 client. Installing does not attach a guard:
```python
from langchain_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)
```
3. Omit `preset` for advice only (`carefulBuyer` / `strict` stop an unobserved payTo when you pass them). Omit `fail_mode` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Omit `fail_mode` and the guard stays open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Nothing defaults you to closed.

LangChain tools for [BotsRated](https://botsrated.com). Use them as a pre-payment check before
an agent pays an x402 seller.

**Status: published on PyPI: [`langchain-botsrated`](https://pypi.org/project/langchain-botsrated/) 0.1.4** (this release; includes `attach_payment_guard`).
It depends on the [`botsrated`](https://pypi.org/project/botsrated/) package (source:
[`integrations/python-core`](https://github.com/botsrated/botsrated/tree/main/integrations/python-core)).

```bash
pip install langchain-botsrated
```

| Tool | Cost | Notes |
|---|---|---|
| `botsrated_preflight` | free | Latest unpaid probe of the seller. With `pay_to` (+ `network`, `amount`) it returns `decision.action` `allow` or `block` and the reasons. A payTo that BotsRated never saw for the host is blocked, with any supported botsrated version (reason `payto_not_observed`; `payto_mismatch` with botsrated 0.1.x). |
| `botsrated_paid_check` | $0.001 USDC on Base (first 25 per client IP per UTC day free) | Only added when the client has a budget. Free-quota answers report `charged: false` and do not touch the budget. |

```python
from botsrated import BotsRatedClient
from langchain_botsrated import botsrated_tools

tools = botsrated_tools()            # free preflight only

# Opt-in paid check, max $0.02 total. x402_client is an x402.x402ClientSync with your signer registered;
# it only ever signs a copy of BotsRated's quote rebuilt from allowlisted fields (no Permit2, no extensions).
tools = botsrated_tools(BotsRatedClient(budget_usd="0.02", x402_client=x402_client))
```

## Opt-in payment guard

`pip install langchain-botsrated` does not attach a guard. Call `attach_payment_guard` yourself (needs `botsrated>=0.3.0,<0.4`). Preflight and the guard are free, no key, rate limits, at `https://botsrated.com`. A paid check
is $0.001 and stays opt-in on the tool. `botsrated_tools()` is unchanged: free preflight only.

```python
from langchain_botsrated import attach_payment_guard, botsrated_tools

tools = botsrated_tools()  # free preflight only; no guard attached
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
# token=... is remote_policy on botsrated 0.3.0+ (see the token paragraph above)
```

`preset` is yours: `warn` (advice only; the default when you omit it), `carefulBuyer`, or `strict` (same stops
as `carefulBuyer`). `fail_mode` is `"open"` or `"closed"`; omit it and the guard stays open. The guard
reports measurements and receipt links. It does not sign a payment and does not hold funds.

`x402_client` is your x402 client. `token` is sent as `remote_policy` on botsrated 0.3.0 and later. A configured token without `parse_remote_policy` raises and is not dropped.

Tests: `pytest tests/unit_tests` runs the tool tests and LangChain's `ToolsUnitTests`.
