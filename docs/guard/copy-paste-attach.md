# Copy-paste attach

Three pastes for the core Guard path. TypeScript and Python attach on the x402 client you already have. Curl reads the same free preflight facts and can save a policy. Curl does not attach.

The path is [`default-middleware.md`](default-middleware.md): hook → measured seller facts → your policy pass / fail receipt → Desk / alerts handoff. Guard pairs with that client. It does not replace the host runtime. Free. No key for local attach. Facts, chips, and signed receipt links. Not a rating. Guard does not hold funds.

Defaults stay as shipped: omit `preset` for advice only; omit `failMode` / `fail_mode` to stay open. `failOpen` and `fail_open` still default to true. `fail_mode: "closed"` on a policy does not set `failOpen` to false ([`fail-mode.md`](fail-mode.md)).

Framework packages stay in [`llms-install.md`](../../llms-install.md#when-scaffolding-x402-pay-coding-agents). This page is the core paste.

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

`payingFetch` is the fetch that already pays, for example `wrapFetchWithPayment(fetch, x402Client)` from `@x402/fetch`. `wrapFetch` tells the guard the URL being paid. Without it the guard only has the host the seller's 402 claims. `createPaymentGuard()` is advice only (`policies.warn`). It does not stop a payment. Pass `preset` only when you want `carefulBuyer`, `strict`, or `dry-run-only`.

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

`session.get` / `http.get` is the paying call you already use. `wrap_get` or `wrap_async_get` tells the guard the URL being paid. `PaymentGuard()` is advice only. It does not stop a payment.

## curl — preflight facts and optional policy save

Curl does not attach Guard. There is no attach API on this path. These calls read the same free preflight facts and signed receipt link the guard reads, and optionally save a Desk policy the guard can check later.

Free preflight (no key, rate limits). `url` is the seller host name:

```bash
curl -sS "https://botsrated.com/v1/preflight?url=blockrun.ai"
```

The body is measurements: `found`, `host`, the latest unpaid probe (`status`, `valid_402`, `latency_ms`, `live_amount`, `live_payTo`, `live_network`), `freshness`, the directory `listing`, and `latest_probe.receipt_url` for the signed receipt. The request sends only the host name.

Optional policy save. Same command as the core package READMEs. Skip it until you have a bearer. With no saved policy, a remote check answers `404 no_policy_saved` and your `fail_mode` applies. The token needs `policy-write`:

```bash
curl -X PUT https://botsrated.com/v1/policy -H "Authorization: Bearer $BOTSRATED_TOKEN" -H "Content-Type: application/json" -d '{"preset":"none","fail_mode":"open"}'
```

`fail_mode` in that body is `open` or `closed`. Omit `fail_mode` on the client to stay open. Saving a policy does not attach Guard and does not change `failOpen`.

## What this page does not change

No package version, no default, no live route. `failOpen` stays true.
