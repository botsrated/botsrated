# @botsrated/x402-preflight

A pre-payment check for x402 clients. Before your agent signs a payment, the guard asks
[BotsRated](https://botsrated.com) what it has measured about the seller. It uses the free
`GET /v1/preflight` route and blocks the payment if the payTo being paid was never seen for that host.

BotsRated is in beta. It covers about 4,800 x402 seller hosts on Base, taken from the CDP Bazaar,
Agentic.Market, 402index and x402-list. Each host gets an unpaid probe about every 1.8 h, and every
receipt is signed. Hosts outside that set are allowed by default.

**Status: prepared, not yet published to npm.**

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

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
await fetchWithPayment("https://seller.example/api"); // throws "Payment creation aborted: BotsRated pre-payment check blocked ..." on a block
```

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

## What is checked (defaults)

| Check | Default | Option |
|---|---|---|
| payTo differs from every payTo BotsRated saw for the host (same network) | **block** | `policy.payToMismatch: "warn" \| "allow"` |
| Same route quoted above the last price BotsRated observed | warn | `policy.priceAboveObserved: "block"` |
| Host not covered | allow | `policy.notCovered: "block"` |
| Data older than 24 h | allow | `policy.stale: "block"` |
| Recent valid-402 rate below a threshold (≥ 3 probes) | off | `policy.minValid402Rate: 0.8` |
| BotsRated unreachable or slow (4 s timeout) | allow | `failOpen: false` |

Preflight answers are cached for 5 minutes per host (`cacheTtlMs`). `onDecision(decision, requirements)`
receives every decision, including warnings and receipt URLs.

## Opt-in paid lookups, with a budget

Paid routes are off by default. To turn them on, pass a budget and a fetch that can pay:

```ts
import { BotsRatedClient, createPrePaymentGuard } from "@botsrated/x402-preflight";

const botsrated = new BotsRatedClient({
  paid: { budgetUsd: 0.05, fetchWithPayment: wrapFetchWithPayment(fetch, client) },
});
const guard = createPrePaymentGuard({ client: botsrated, paidCheckAtOrAboveUsd: 0.25 });
client.onBeforePaymentCreation(guard.beforePaymentCreation);

await botsrated.check("seller.example");            // $0.001 (first 100/day free)
await botsrated.report("seller.example");           // $0.002 (first 10/day free)
await botsrated.best("web search", { sort: "price" }); // $0.01
```

- Free daily quota: BotsRated serves the first 100 `/v1/check` and 10 `/v1/report` calls per client
  per UTC day free (200 with `charged: false` and a `free_quota` block). The client asks unpaid
  first, so inside the quota nothing is paid and the budget is untouched; `check()`/`report()` work
  even without `paid` until the quota is used up (then they throw `paid_disabled`).
  `client.lastFreeQuota` shows the remaining quota.
- Otherwise the client reads the 402 quote unpaid first. It accepts only `exact` USDC on Base (`eip155:8453`)
  to BotsRated's payTo `0x7F936f42F46B6c4Cbd3242cF8A1759dfe829E349`, at or below the published price.
- The amount is reserved from the budget before paying and released if the call fails. BotsRated
  settles only on a 2xx response.
- When the guard is registered, it refuses any payment to botsrated.com that the client has not
  reserved.
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
