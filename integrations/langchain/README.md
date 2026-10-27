# langchain-botsrated

LangChain tools for [BotsRated](https://botsrated.com). Use them as a pre-payment check before
an agent pays an x402 seller.

**Status: published on PyPI: [`langchain-botsrated`](https://pypi.org/project/langchain-botsrated/) 0.1.2.**
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

To guard every payment that an x402 client makes (not just when the model calls a tool), register
`botsrated.PrePaymentGuard(policy=botsrated.GuardPolicy(pay_to_mismatch="block")).x402_hook` with
`x402Client.on_before_payment_creation`; without that policy, botsrated 0.2's guard only warns about an unobserved payTo.
See [`botsrated`](https://pypi.org/project/botsrated/).

Tests: `pytest tests/unit_tests` runs the tool tests and LangChain's `ToolsUnitTests`.
