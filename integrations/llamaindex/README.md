# llama-index-tools-botsrated

A LlamaIndex tool spec for [BotsRated](https://botsrated.com). Use it as a pre-payment check
before an agent pays an x402 seller.

**Status: published on PyPI: [`llama-index-tools-botsrated`](https://pypi.org/project/llama-index-tools-botsrated/) 0.1.2.**
It depends on the [`botsrated`](https://pypi.org/project/botsrated/) package. LlamaIndex no longer accepts new
integration packages in its monorepo, so this package is published on its own.

```bash
pip install llama-index-tools-botsrated
```

```python
from llama_index.tools.botsrated import BotsRatedToolSpec

tools = BotsRatedToolSpec().to_tool_list()      # ["preflight"] (free)

from botsrated import BotsRatedClient
# x402_client: an x402.x402ClientSync with your signer; it only signs BotsRated's quote rebuilt from
# allowlisted fields (no Permit2, no payment extensions).
tools = BotsRatedToolSpec(BotsRatedClient(budget_usd="0.02", x402_client=x402_client)).to_tool_list()
# ["preflight", "paid_check"]: paid_check costs $0.001 (first 25 per client IP per UTC day free, charged: false) and stops at the budget
```

## Default install

`pip install llama-index-tools-botsrated` (needs `botsrated>=0.3.0,<0.4`). Preflight and the guard are free, no key, rate limits, at `https://botsrated.com`. No sign, no custody, no holding funds. `BotsRatedToolSpec()` does not attach a guard.

```python
from llama_index.tools.botsrated import BotsRatedToolSpec, attach_payment_guard

tools = BotsRatedToolSpec().to_tool_list()  # free preflight only; no guard
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
```

Omit `preset` for advice only (`warn`). `carefulBuyer` and `strict` block an unobserved payTo only when selected. `fail_mode` is `"open"` or `"closed"`; omit it to stay fail-open. `token` is `remote_policy` only when `parse_remote_policy` is present. botsrated 0.2.1 does not accept `remote_policy`; 0.3.0 does. A configured token without that normalizer raises and is not dropped.

`preflight(url, pay_to=None, network=None, amount=None)` returns the latest probe. When `pay_to` is given,
it also returns `decision.action` (`allow` or `block`) and the reasons.

Tests: `pytest tests`.
