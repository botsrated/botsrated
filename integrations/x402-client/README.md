# @botsrated/x402-preflight

A pre-payment check for x402 clients. Before your agent signs a payment, the guard asks
[BotsRated](https://botsrated.com) what it has measured about the seller. It uses the free
`GET /v1/preflight` route and blocks the payment if the payTo being paid was never seen for that host.

BotsRated is in beta. It covers about 4,800 x402 seller hosts on Base, taken from the CDP Bazaar,
Agentic.Market, 402index and x402-list. Each host gets an unpaid probe about every 1.8 h, and every
receipt is signed. Hosts outside that set are allowed by default.

**Status: published on npm as [`@botsrated/x402-preflight`](https://www.npmjs.com/package/@botsrated/x402-preflight) (0.1.4).**

## Install

```bash
npm install @botsrated/x402-preflight @x402/core @x402/evm @x402/fetch
```

## Use with `@x402/fetch` / `@x402/core`

```ts
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createPrePaymentGuard } from "@botsrated/x402-preflight";

const client = new x402Client();
registerExactEvmScheme(client, { signer });

const guard = createPrePaymentGuard(); // free preflight only
client.onBeforePaymentCreation(guard.beforePaymentCreation);

// wrapFetch tells the guard which URL is actually being paid (since 0.1.3)
const fetchWithPayment = guard.wrapFetch(wrapFetchWithPayment(fetch, client));
await fetchWithPayment("https://seller.example/api"); // throws "Payment creation aborted: BotsRated pre-payment check blocked ..." on a block
```

The 402's `resource.url` is chosen by the seller, so on its own it only says which host the seller *claims* to
be. When the guard knows the request URL (`guard.wrapFetch(...)`, `payingRequest(url, fn)`, `guard.forRequest(url)`,
or `guard.decide(resourceUrl, req, requestUrl)`), it looks up that URL's host and blocks the payment with
`resource_url_mismatch` if `resource.url` names a different host, even with `failOpen: true`. Without a request URL
the host is still read from `resource.url` (as before 0.1.3); set `policy.requireRequestUrl: true` to block those
payments instead. Hosts are compared after punycode and trailing-dot normalization. The wrapper only sees the URL
you called, not where redirects ended, so a `resource.url` that differs only by a leading `www.` (an apex <-> www
redirect) is accepted (since 0.1.4); any other host is blocked. Concurrent requests are kept apart with
`AsyncLocalStorage` where the runtime exposes it (Node 20.16+ / 22.3+). Elsewhere the URL is known only while exactly
one paid request is in flight; with several, the guard falls back to `resource.url`, or blocks with
`policy.requireRequestUrl: true` (since 0.1.4).

## Use with `@x402/mcp`

```ts
import { createx402MCPClient } from "@x402/mcp";
import { createPrePaymentGuard, mcpPaymentApprover } from "@botsrated/x402-preflight";

const guard = createPrePaymentGuard();
const mcp = createx402MCPClient({
  name: "my-agent", version: "1.0.0", schemes, autoPayment: true,
  onPaymentRequested: mcpPaymentApprover(guard, "https://seller.example/mcp"),
});
```

`mcpPaymentApprover` looks up the MCP server URL you pass, and since 0.1.3 refuses a payment whose http(s)
`resource.url` names a different host (apex/www twins excepted). Since 0.1.4 it takes options:

```ts
mcpPaymentApprover(guard, "https://seller.example/mcp", {
  allowResourceHosts: ["api.seller.example"], // exact hosts the 402 resource.url may also name
  resourceUrlMismatch: "block",              // default; "warn" approves on the server's facts and reports a warning
  onDecision: (d) => console.log(d.reasons),
});
```

## What is checked (defaults)

| Check | Default | Option |
|---|---|---|
| payTo differs from every payTo BotsRated's own probes saw for the host (same network); the seller's listing alone never confirms one | **block** | `policy.payToMismatch: "warn" \| "allow"` |
| Same route quoted above the last price BotsRated observed | warn | `policy.priceAboveObserved: "block"` |
| Host not covered | allow | `policy.notCovered: "block"` |
| Data older than 24 h | allow | `policy.stale: "block"` |
| Recent valid-402 rate below a threshold (≥ 3 probes) | off | `policy.minValid402Rate: 0.8` |
| BotsRated unreachable or slow (4 s timeout) | allow | `failOpen: false` |

Preflight answers are cached for 5 minutes per host (`cacheTtlMs`). `onDecision(decision, requirements)`
receives every decision, including warnings and receipt URLs.

## Opt-in paid lookups, with a budget

Paid routes are off by default. To turn them on, pass a budget and your `x402Client` (with your signer
registered):

```ts
import { BotsRatedClient, createPrePaymentGuard } from "@botsrated/x402-preflight";

const botsrated = new BotsRatedClient({
  paid: { budgetUsd: 0.05, x402Client: client }, // signs only the validated, rebuilt quote
});
const guard = createPrePaymentGuard({ client: botsrated, paidCheckAtOrAboveUsd: 0.25 });
client.onBeforePaymentCreation(guard.beforePaymentCreation);

await botsrated.check("seller.example");            // $0.001 (first 100/day free)
await botsrated.report("seller.example");           // $0.002 (first 10/day free)
await botsrated.best("web search", { sort: "price" }); // $0.01
```

- With `x402Client` (since 0.1.2, recommended), the client validates the 402, rebuilds it from the
  allowlisted fields only (scheme, network, asset, amount, payTo, maxTimeoutSeconds, EIP-3009 `name`/`version`,
  resource url/description/mimeType; never `extensions`), signs that copy with `createPaymentPayload` and sends
  `PAYMENT-SIGNATURE` itself (no redirects). The signer never sees the raw 402. If signing fails, nothing can
  settle and the reservation is released (`payment_not_created`). The older
  `fetchWithPayment: wrapFetchWithPayment(fetch, client)` still works, but it re-reads the 402 itself, so
  register the guard on the same `x402Client` so that re-served 402 is checked again before signing.
- Free daily quota: BotsRated serves the first 100 `/v1/check` and 10 `/v1/report` calls per client
  per UTC day free (200 with `charged: false` and a `free_quota` block). The client asks unpaid
  first, so inside the quota nothing is paid and the budget is untouched; `check()`/`report()` work
  even without `paid` until the quota is used up (then they throw `paid_disabled`).
  `client.lastFreeQuota` shows the remaining quota.
- Otherwise the client reads the 402 quote unpaid first. It accepts it only if **every** option is `exact` USDC on Base (`eip155:8453`)
  to BotsRated's payTo `0x7F936f42F46B6c4Cbd3242cF8A1759dfe829E349`, at or below the published price.
- Only a one-shot EIP-3009 payment is accepted: an option whose `extra` holds anything beyond the token's
  `name`/`version` (e.g. `assetTransferMethod: "permit2"`), a `maxTimeoutSeconds` above 600, or payment
  extensions in the 402 (e.g. `erc20ApprovalGasSponsoring`; only the discovery-only `bazaar` key is tolerated)
  is refused with `terms_rejected` before anything is paid.
- The amount is reserved from the budget before paying. If the paid call fails or throws it stays counted
  (the payment may already have settled), so the budget is a hard ceiling.
- When the guard is registered, it refuses any payment to botsrated.com that the client has not
  reserved or that carries payment extensions, and strips extensions before the scheme signs.
- `paidCheckAtOrAboveUsd` runs a check only for seller payments at or above that amount: free within
  the daily quota, then a $0.001 paid check if the client is paid-enabled (skipped otherwise).
  If the budget is used up, the guard falls back to the free preflight.

## Test

```bash
npm install && npm test          # unit tests + real @x402/core/@x402/evm hook test (throwaway key, nothing sent)
npm run build && node scripts/smoke-free.mjs   # live, free routes only
```

## Notes

- The guard reports facts that BotsRated measured. It does not endorse any seller. Seller-supplied
  text in responses is untrusted data (see `untrusted_seller_text` in every response).
- License: MIT.
