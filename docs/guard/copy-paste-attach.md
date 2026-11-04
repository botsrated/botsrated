# Copy-paste attach

Three pastes. TypeScript and Python attach on the x402 client you already have. Curl reads the free preflight and can save a policy. Curl does not attach.

Path: [`default-middleware.md`](default-middleware.md) — hook → measured seller facts → your policy pass / fail receipt → Desk / alerts handoff.

Guard pairs with that client. It does not replace the host runtime. Free. No key for local attach. Facts, chips, and signed receipt links. Not a rating. Guard does not hold funds.

Omit `preset` for advice only. Omit `failMode` / `fail_mode` to stay open. `failOpen` stays true. Constructor presets are `warn`, `carefulBuyer`, and `dry-run-only`. `strict` is `policies.strict` (Python: `POLICIES["strict"]`), not a preset. `fail_mode: "closed"` on a policy does not set `failOpen` to false ([`fail-mode.md`](fail-mode.md)).

Framework packages: [`llms-install.md`](../../llms-install.md#when-scaffolding-x402-pay-coding-agents). This page is the core paste.

## TypeScript / JS — `createPaymentGuard` + `wrapFetch`

```bash
npm install @botsrated/x402-preflight
```

```ts
import { createPaymentGuard } from "@botsrated/x402-preflight/payment-guard";

// omit preset = advice only; omit failMode = open. failOpen stays true.
const guard = createPaymentGuard();
guard.install(x402Client);
const paidFetch = guard.wrapFetch(payingFetch);
```

`payingFetch` already pays, for example `wrapFetchWithPayment(fetch, x402Client)` from `@x402/fetch`. `wrapFetch` passes the paid URL. Without it the guard only has the host on the seller's 402. `createPaymentGuard()` is advice only (`policies.warn`). It does not stop a payment. Pass `preset` only for `carefulBuyer` or `dry-run-only`.

## Python — `PaymentGuard` + `guard.install`

```bash
pip install "botsrated[x402]"
```

```python
from botsrated import PaymentGuard

# omit preset = advice only; omit fail_mode = open. fail_open stays true.
guard = PaymentGuard()
guard.install(x402_client)
paid_get = guard.wrap_get(session.get)  # or guard.wrap_async_get(http.get)
```

`session.get` / `http.get` is the paying call. `wrap_get` or `wrap_async_get` passes the paid URL. `PaymentGuard()` is advice only. It does not stop a payment.

## curl — preflight facts and optional policy save

Curl does not attach. There is no attach API on this path.

Free preflight (no key). `url` is the seller host name. The request sends only that name.

```bash
curl -sS "https://botsrated.com/v1/preflight?url=blockrun.ai"
```

Body: `found`, `host`, latest unpaid probe (`status`, `valid_402`, `latency_ms`, `live_amount`, `live_payTo`, `live_network`), `freshness`, directory `listing`, `latest_probe.receipt_url` (signed receipt).

Optional policy save. Bearer needs `policy-write`. No saved policy → `404 no_policy_saved` and your client `fail_mode` applies. Saving does not attach and does not change `failOpen`.

Omit `preset` and `fail_mode` on the client. In this body they are optional policy JSON only (a server pack id and a mode), not constructor arguments. Pack default is `none`. `fail_mode` here is `open` or `closed`. Same save as the core READMEs:

```bash
curl -X PUT https://botsrated.com/v1/policy -H "Authorization: Bearer $BOTSRATED_TOKEN" -H "Content-Type: application/json" -d '{"preset":"none","fail_mode":"open"}'
```

## What this page does not change

No package version, no default, no live route. `failOpen` stays true.
