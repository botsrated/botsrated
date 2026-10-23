# langchain-botsrated

LangChain tools for [BotsRated](https://botsrated.com) (beta). Use them as a pre-payment check before
an agent pays an x402 seller.

**Status: prepared, not yet published to PyPI.** It depends on the `botsrated` package (also unpublished),
which lives in `../python-core`.

| Tool | Cost | Notes |
|---|---|---|
| `botsrated_preflight` | free | Latest unpaid probe of the seller. With `pay_to` (+ `network`, `amount`) it returns `decision.action` `allow` or `block` and the reasons. By default, a payTo that BotsRated never saw for the host is blocked. |
| `botsrated_paid_check` | $0.001 USDC on Base (first 100/day free) | Only added when the client has a budget. Free-quota answers report `charged: false` and do not touch the budget. |

```python
from botsrated import BotsRatedClient
from langchain_botsrated import botsrated_tools

tools = botsrated_tools()            # free preflight only

# Opt-in paid check, max $0.02 total (session pays x402, e.g. x402.http.clients.x402_requests(x402_client))
tools = botsrated_tools(BotsRatedClient(budget_usd="0.02", paying_get=session.get))
```

To guard every payment that an x402 client makes (not just when the model calls a tool), register
`botsrated.PrePaymentGuard().x402_hook` with `x402Client.on_before_payment_creation`. See `../python-core`.

Tests: `pytest tests/unit_tests` runs the tool tests and LangChain's `ToolsUnitTests`.
