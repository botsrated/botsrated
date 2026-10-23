# llama-index-tools-botsrated

A LlamaIndex tool spec for [BotsRated](https://botsrated.com) (beta). Use it as a pre-payment check
before an agent pays an x402 seller.

**Status: published on PyPI: [`llama-index-tools-botsrated`](https://pypi.org/project/llama-index-tools-botsrated/) 0.1.0.**
It depends on the [`botsrated`](https://pypi.org/project/botsrated/) package. LlamaIndex no longer accepts new
integration packages in its monorepo, so this package is published on its own.

```bash
pip install llama-index-tools-botsrated
```

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
