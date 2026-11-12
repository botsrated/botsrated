# llama-index-tools-botsrated

## One-click attach

> Coding agents: the stack-by-stack attach recipe is [`llms-install.md` → When scaffolding x402 pay](https://github.com/botsrated/botsrated/blob/main/llms-install.md#when-scaffolding-x402-pay-coding-agents) (also a [Cursor rule](https://github.com/botsrated/botsrated/blob/main/.cursor/rules/botsrated-guard-attach.mdc) and an [agent skill](https://github.com/botsrated/botsrated/blob/main/docs/agent-skills/botsrated-guard-attach/SKILL.md)). The default path these attaches follow is [`docs/guard/default-middleware.md`](https://github.com/botsrated/botsrated/blob/main/docs/guard/default-middleware.md).

Free. No key for local attach. Pairs with LlamaIndex. Not a second runtime. Published on PyPI. Paid checks are not required to attach.

```bash
pip install llama-index-tools-botsrated
```

```python
from llama_index.tools.botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)  # omit preset = advice; omit fail_mode = open
```

This package does not read `BOTSRATED_TOKEN`. Pass `token=` when you use Desk policy. Local attach does not need a token.

Core JS, Python, and curl paste (curl does not attach): [`docs/guard/copy-paste-attach.md`](../../docs/guard/copy-paste-attach.md).

Chip halt (`strictModeHalt()` / `haltOn`) is not this attach. Omit `haltOn` and it stays off. Sample chips: `payTo changed`, `probe failed`. Measured chips, not grades. Not `policies.strict`. Not a closed `fail_mode`. `failOpen` stays true.

[`docs/guard/halt-policy.md`](../../docs/guard/halt-policy.md) · [`docs/guard/examples/strict-mode-halt.md`](../../docs/guard/examples/strict-mode-halt.md) · [`integrations/x402-client/examples/strict-mode-halt.ts`](../x402-client/examples/strict-mode-halt.ts)

Preflight and the guard surface signed receipt links (`receipt_url`). When org ledger is enabled, paid checks write there by default. No custody. Facts, not grades.

Attach is pair-with. Free. No key for local attach. Not a second runtime.

Live docs: [botsrated.com/docs/guard#llamaindex](https://botsrated.com/docs/guard#llamaindex).

## Install in 3 steps

1. Free. No key for local attach. Install: `pip install llama-index-tools-botsrated` (PyPI 0.1.6, includes `attach_payment_guard`). It depends on `botsrated>=0.3.1,<0.4`. Paid checks are not required to attach.
2. Attach to your x402 client. Installing does not attach a guard:
```python
from llama_index.tools.botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)
```
3. Omit `preset` for advice only. Pick `preset="carefulBuyer"` only when you want it (same stops as `policies.strict`; stops an unobserved payTo). Omit `fail_mode` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block.

`token` is optional. This package does not read `BOTSRATED_TOKEN`. Pass `token=` when you use Desk policy. Local attach does not need a token. On botsrated 0.3.0 and later the value is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Omit `fail_mode` and the guard stays open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Nothing defaults you to closed.

A LlamaIndex tool spec for [BotsRated](https://botsrated.com). Use it as a pre-payment check
before an agent pays an x402 seller.

**Status: published on PyPI: [`llama-index-tools-botsrated`](https://pypi.org/project/llama-index-tools-botsrated/) 0.1.6** (this release; includes `attach_payment_guard`).
It depends on [`botsrated`](https://pypi.org/project/botsrated/) `>=0.3.1,<0.4`. This package does not read `BOTSRATED_TOKEN`; pass `token=` when you use Desk policy.
LlamaIndex no longer accepts new integration packages in its monorepo, so this package is published on its own.

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
# ["preflight", "paid_check"]: paid_check costs $0.01 (first 25 per client IP per UTC day free, charged: false) and stops at the budget
```

## Default install

Pairs with LlamaIndex. The guard is not a runtime. Free. No key for local attach. `pip install llama-index-tools-botsrated` (needs `botsrated>=0.3.1,<0.4`). Preflight and the guard are free, no key, rate limits, at `https://botsrated.com`. No sign, no custody, no holding funds. `BotsRatedToolSpec()` does not attach a guard.

```python
from llama_index.tools.botsrated import BotsRatedToolSpec, attach_payment_guard

tools = BotsRatedToolSpec().to_tool_list()  # free preflight only; no guard
guard = attach_payment_guard(x402_client, preset="carefulBuyer", fail_mode="open")
```

Omit `preset` for advice only (`warn`). `carefulBuyer` blocks an unobserved payTo only when selected (same stops as `policies.strict`). Omit `fail_mode` to stay open. Pass `token=` for Desk policy; this package does not read `BOTSRATED_TOKEN`. `token` is sent as `remote_policy` on botsrated 0.3.0 and later. A configured token without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

`preflight(url, pay_to=None, network=None, amount=None)` returns the latest probe. When `pay_to` is given,
it also returns `decision.action` (`allow` or `block`) and the reasons.

Tests: `pytest tests`.
