# llama-index-tools-botsrated

A LlamaIndex tool spec for [BotsRated](https://botsrated.com) (beta). Use it as a pre-payment check
before an agent pays an x402 seller.

**Status: prepared, not yet published to PyPI.** It depends on the `botsrated` package (`../python-core`,
also unpublished). LlamaIndex no longer accepts new integration packages in its monorepo, so this
package is meant to be published on its own.

```python
from llama_index.tools.botsrated import BotsRatedToolSpec

tools = BotsRatedToolSpec().to_tool_list()      # ["preflight"] (free)

from botsrated import BotsRatedClient
tools = BotsRatedToolSpec(BotsRatedClient(budget_usd="0.02", paying_get=session.get)).to_tool_list()
# ["preflight", "paid_check"]: paid_check costs $0.001 (first 100/day free, charged: false) and stops at the budget
```

`preflight(url, pay_to=None, network=None, amount=None)` returns the latest probe. When `pay_to` is given,
it also returns `decision.action` (`allow` or `block`) and the reasons.

Tests: `pytest tests`.
