# Default middleware path (canon)

Default path for Guard on an agent that pays over x402 or MCP. Stack READMEs, the coding-agent recipe in [`llms-install.md`](../../llms-install.md#when-scaffolding-x402-pay-coding-agents), the Cursor rule, the agent skill, and the site Guard docs point here. If a copy drifts, this page and `llms-install.md` win.

Guard pairs with the x402 client your agent already pays with. It does not replace the host runtime. Free. No key for local attach. Facts, chips, and signed receipt links. Not a rating. Guard does not hold funds. Rails are x402 and MCP only.

## The path

```
1. hook  →  2. measured seller facts  →  3. your policy: pass / fail receipt  →  4. Desk / alerts handoff
```

### 1. Hook (attach before the first paid request)

Attach on the existing payment client. Installing a package does not attach.

| Where you pay | Hook |
|---|---|
| `@x402/core` / `@x402/fetch` client (TypeScript) | `createPaymentGuard().install(client)` for the free local guard. For your own policy, add `guardAttach({ policy })` and `client.onBeforePaymentCreation(attach.onBeforePaymentCreation)`. |
| `@x402/mcp` client | `createx402MCPClient({ policies: [attach.mcpPolicy], onPaymentRequested: attach.onPaymentRequested })` |
| A framework stack | The stack's `attach_*` call on the x402 client: `attach_payment_guard(x402_client)` (Python) or `attachPaymentGuard(x402Client)` (Vercel AI SDK). Per-stack install lines: [`llms-install.md` → Choose stack](../../llms-install.md#choose-stack--install--attach). |
| Any other Python x402 client | `PaymentGuard()` then `guard.install(x402_client)` from `botsrated[x402]` |

Omit `preset` for advice only (`warn`). Omit `fail_mode` / `failMode` to stay open. `failOpen` stays `true`. `fail_mode: "closed"` on a policy does not set `failOpen: false` ([`fail-mode.md`](fail-mode.md)).

The `@x402/core` SDK `$1` spend cap runs before `policies` and before `onBeforePaymentCreation`. A quote above it can throw before a verdict is recorded. Do not pass a spend-control override. Details: [`guard-check.md`](guard-check.md#attach-and-the-sdk-1-default).

### 2. Measured seller facts

The hook compares the signed payment requirement with facts already measured for the seller host. Free `preflight` (`GET https://botsrated.com/v1/preflight` or the `preflight` MCP tool) returns `found`, `host`, the latest unpaid probe (`status`, `valid_402`, `latency_ms`, `live_amount`, `live_payTo`, `live_network`), `freshness`, the directory `listing`, and `latest_probe.receipt_url` (signed receipt). Hosted checks send only the seller host name. Wallets, routers, and MCP clients check that receipt offline with `verifyReceipt` from `@botsrated/x402-preflight/verify-receipt` (status `signature valid`, `signature invalid`, or `key unknown`). A match is this record only. The call does not fetch.

On a policy receipt those facts are the caller-supplied `measured` block (`pay_to_unchanged`, `valid_402`, `as_of`, `last_checked`, `expires_at`, `evidence_url`) and the fixed chips: `live`, `402 ok`, `payTo changed`, `probe failed`, `no data yet`. The receipt does not probe. No measurement means `no data yet`.

### 3. Your policy: pass / fail receipt

Your policy decides. Shape: [`policy-receipt-v1`](policy-receipt-v1.md) (`botsrated-guard-policy-receipt/1`):

- `verdict`: `pass`, `fail`, or `null`. `null` means no decision and is never a pass.
- `rule_hit`: `none`, `amount`, `pay_to`, `network`, `resource_host`, `unevaluable`. Rule order: `amount`, `pay_to`, `network`, `resource_host`.
- `fail_mode`: `open` or `closed`. A `fail` stops the payment. `verdict: null` stops it only when `fail_mode` is `closed`.
- `your_policy: true`, `not_a_botsrated_rating: true`, `policy_id`, `policy_version`, `org_id`, `team_id`, `agent_id`.

Inputs: `amount`, `payTo`, `network`, and the `resource.url` host from the signed requirement. Seller text (`description`, `mimeType`, `extra`) does not change the verdict. `mcpPolicy` sees amount, payTo, and network only; the host rule runs in `onBeforePaymentCreation` and `onPaymentRequested`. TypeScript: `attach.lastVerdict()` is the last evaluation.

Framework stacks use `remote_policy` / `remotePolicy` and an optional `BOTSRATED_TOKEN` (step 4). That remote decision is not signed.

### 4. Desk / alerts handoff

- **Policy in Desk (optional).** `BOTSRATED_TOKEN` is optional and only for Desk remote policy. Save a policy first ([Desk → Policy](https://botsrated.com/desk/policy) or `PUT /v1/policy`). None saved → `404 no_policy_saved` and your `fail_mode` applies. LangChain, Microsoft Agent Framework, Google ADK, and CrewAI read `BOTSRATED_TOKEN` when `token` is omitted. `llama-index-tools-botsrated` 0.1.5 does not; pass `token=` on that package.
- **Alerts on seller facts.** `POST https://botsrated.com/v1/alerts/subscribe` for changes to payTo, quoted price, valid 402, listing, or freshness. Plans: [README → Plans](../../README.md#plans-seller-alerts-and-data-plans).
- **Router check (dark).** `POST /v1/guard/check` and the `guard_check` MCP tool return the same receipt fields, and stay off unless `FEATURE_GUARD_CHECK` is the exact string `true` ([`guard-check.md`](guard-check.md)).

The client enforces. BotsRated holds no funds, signs no payment, and has no escrow.

## What this page does not change

No package version, no default, no live route. `failOpen` stays `true`. The SDK `$1` cap stays in the SDK.

How outside Guard attaches are counted: [`llms-install.md` → How we count outside attaches](../../llms-install.md#how-we-count-outside-attaches).
