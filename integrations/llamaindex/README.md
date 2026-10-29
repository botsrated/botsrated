# llama-index-tools-botsrated

## Install in 3 steps

1. Install: `pip install llama-index-tools-botsrated` (PyPI 0.1.4, includes `attach_payment_guard`). It depends on `botsrated>=0.3.0,<0.4`.
2. Attach to your x402 client. Installing does not attach a guard:
```python
from llama_index.tools.botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)
```
3. Omit `preset` for advice only (`carefulBuyer` / `strict` stop an unobserved payTo when you pass them). Omit `fail_mode` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Omit `fail_mode` and the guard stays open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Nothing defaults you to closed.

A LlamaIndex tool spec for [BotsRated](https://botsrated.com). Use it as a pre-payment check
before an agent pays an x402 seller.

**Status: published on PyPI: [`llama-index-tools-botsrated`](https://pypi.org/project/llama-index-tools-botsrated/) 0.1.4** (this release; includes `attach_payment_guard`).
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

Omit `preset` for advice only (`warn`). `carefulBuyer` and `strict` block an unobserved payTo only when selected. Omit `fail_mode` to stay open. `token` is sent as `remote_policy` on botsrated 0.3.0 and later. A configured token without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

`preflight(url, pay_to=None, network=None, amount=None)` returns the latest probe. When `pay_to` is given,
it also returns `decision.action` (`allow` or `block`) and the reasons.

Tests: `pytest tests`.
