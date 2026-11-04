# google-adk-botsrated

## One-click attach

> Coding agents: the stack-by-stack attach recipe is [`llms-install.md` → When scaffolding x402 pay](https://github.com/botsrated/botsrated/blob/main/llms-install.md#when-scaffolding-x402-pay-coding-agents) (also a [Cursor rule](https://github.com/botsrated/botsrated/blob/main/.cursor/rules/botsrated-guard-attach.mdc) and an [agent skill](https://github.com/botsrated/botsrated/blob/main/docs/agent-skills/botsrated-guard-attach/SKILL.md)). The default path these attaches follow is [`docs/guard/default-middleware.md`](https://github.com/botsrated/botsrated/blob/main/docs/guard/default-middleware.md).

Free. No key for local attach. Pairs with the host runtime. Not a second runtime. Published on PyPI. Paid checks are not required to attach.

```bash
pip install google-adk-botsrated
```

```python
from google_adk_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)  # omit preset = advice; omit fail_mode = open
```

Core JS, Python, and curl paste (curl does not attach): [`docs/guard/copy-paste-attach.md`](../../docs/guard/copy-paste-attach.md).

Chip halt (`strictModeHalt()` / `haltOn`) is not this attach. Omit `haltOn` and it stays off. Sample chips: `payTo changed`, `probe failed`. Measured chips, not grades. Not `policies.strict`. Not a closed `fail_mode`. `failOpen` stays true.

[`docs/guard/halt-policy.md`](../../docs/guard/halt-policy.md) · [`docs/guard/examples/strict-mode-halt.md`](../../docs/guard/examples/strict-mode-halt.md) · [`integrations/x402-client/examples/strict-mode-halt.ts`](../x402-client/examples/strict-mode-halt.ts)

Preflight and the guard surface signed receipt links (`receipt_url`). When org ledger is enabled, paid checks write there by default. No custody. Facts, not grades.

Attach is pair-with. Free. No key for local attach. Not a second runtime.

Live docs: [botsrated.com/docs/guard#google-adk](https://botsrated.com/docs/guard#google-adk).

## Default install

Free. No key for local attach. Pairs with [Google ADK](https://google.github.io/adk-docs/). Payment-client wrap and an optional before-tool callback. Not an agent runtime, and not an Agent, Runner, or session service. The guard is not a runtime. Published: `pip install google-adk-botsrated` (PyPI 0.1.1; dependency `botsrated>=0.3.1,<0.4`). Installing does not attach a guard. Paid checks are not required to attach. Optional `BOTSRATED_TOKEN` for Desk remote policy (omit `token` and the guard reads the env).

```python
# Free. No key for local attach. Not a runtime.
# Optional BOTSRATED_TOKEN for Desk remote policy.
from google_adk_botsrated import attach_payment_guard
# Omit preset = advice. Omit fail_mode = open.
guard = attach_payment_guard(x402_client)
```

It does not sign a payment and does not hold funds.

## Install in 3 steps

1. Free. No key for local attach. Install: `pip install google-adk-botsrated` (PyPI 0.1.1, includes `attach_payment_guard`). Depends on `botsrated>=0.3.1,<0.4`. Paid checks are not required to attach.
2. Attach to your x402 client. Installing does not attach a guard:
```python
from google_adk_botsrated import attach_payment_guard
guard = attach_payment_guard(x402_client)
```
3. Omit `preset` for advice only. Pick `preset="carefulBuyer"` only when you want it (same stops as `policies.strict`; stops an unobserved payTo). Omit `fail_mode` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Omit `fail_mode` and the guard stays open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Nothing defaults you to closed.

Google ADK hook for [BotsRated](https://botsrated.com). Use it as a pre-payment check before
an agent pays an x402 seller. Google ADK stays the agent runtime. This package is not an Agent, Runner, or session service.

**Status: published on PyPI: [`google-adk-botsrated`](https://pypi.org/project/google-adk-botsrated/) 0.1.1** (this release; includes `attach_payment_guard`).
Depends on [`botsrated`](https://pypi.org/project/botsrated/) `>=0.3.1,<0.4` (source:
[`integrations/python-core`](https://github.com/botsrated/botsrated/tree/main/integrations/python-core)).
PyPI 0.1.1 matches that pin. Omit `token` and `attach_payment_guard` reads `BOTSRATED_TOKEN`.

```bash
pip install google-adk-botsrated
```

Contributors in a checkout of this repository can install this tree with `pip install -e integrations/google-adk`. The published install is `pip install google-adk-botsrated`.

## Before-tool callback and token

`botsrated_before_tool_callback(guard, ["pay_seller"])` is an ADK `before_tool_callback` for those opaque paid tools. On a block it returns only `botsrated_payment_reason` and does not run the tool. Other tools are unchanged. `botsrated_preflight(url)` is the free preflight and does not attach a guard.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On botsrated 0.3.0 and later it is sent only as `remote_policy={"token", "fail_mode"}`, never as a bare string. A configured token on a core without `parse_remote_policy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Tests: `pytest -m "not live"` in this directory.
