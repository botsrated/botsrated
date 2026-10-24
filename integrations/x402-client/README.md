# @botsrated/x402-preflight

The BotsRated **payment guard** for x402 clients, plus a simpler pre-payment check.

- **Before your agent signs**, it looks up facts [BotsRated](https://botsrated.com) measured about the seller's host
  and compares them with the payment request on your machine.
- **While the payment is built**, it adds an x402 `payment-identifier` retry key, only when the seller advertises
  that extension.
- **After**, it keeps a local record (never the signature) and can read the blockchain, read-only, to see whether
  the payment settled once.

It reduces the chance of paying the wrong address or paying twice. It does not prevent either, and it guarantees
nothing.

**Status: 0.2.0 is not released yet. The latest version on npm is
[`@botsrated/x402-preflight` 0.1.4](https://www.npmjs.com/package/@botsrated/x402-preflight), which does not
include the payment guard.**

**What this does and doesn't do.** This package checks facts BotsRated measured about a seller before your agent signs, adds a retry key to the payment request, and reads the blockchain to see whether a payment already settled. It can't guarantee that a payment is safe, that a seller will deliver, or that you'll never pay twice: a retry key only stops a second charge if the seller supports the x402 `payment-identifier` extension, and on-chain reads can be late or fail. You choose the rules that stop a payment, and you remain responsible for what your agent pays. Provided under the MIT licence, "as is", without warranty.

**Hosted checks.** By default this package calls BotsRated's free API (`https://botsrated.com/v1/preflight`). Those calls are covered by the BotsRated Terms (https://botsrated.com/terms) and Privacy Policy (https://botsrated.com/privacy), not by the MIT licence. You can turn hosted checks off with `hosted: false` (only local retry-key and on-chain checks then run).

## Install

```bash
npm install @botsrated/x402-preflight @x402/core @x402/evm @x402/fetch
```

The package has no runtime dependencies. `@x402/*` are yours; the guard only uses the hook and extension points
of the x402 client you pass in.

## Payment guard: start with dry-run

```ts
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createPaymentGuard } from "@botsrated/x402-preflight/payment-guard";

const client = new x402Client();
registerExactEvmScheme(client, { signer });

// Recommended first setting: log what the guard sees, change nothing.
const guard = createPaymentGuard({ dryRun: true, onDecision: (d) => console.log(d.message) });
guard.install(client); // before/after/response hooks (+ the retry-key extension when not in dry-run)

const paidFetch = guard.wrapFetch(wrapFetchWithPayment(fetch, client)); // tells the guard which URL is being paid
await paidFetch("https://seller.example/api");
```

When the log looks right, drop `dryRun`. The zero-config setting (`createPaymentGuard()`) is advice only: it
reports facts and never stops a payment. To stop payments, choose a policy yourself:

```ts
import { createPaymentGuard, policies } from "@botsrated/x402-preflight/payment-guard";

const guard = createPaymentGuard({ policy: policies.strict }); // your choice
```

A stopped payment throws `Payment creation aborted:` with text like:

> Payment stopped by your payment policy (rule: payToMismatch). Fact: the payTo in this payment request is not among the payTo addresses BotsRated's probes recorded for seller.example on eip155:8453. Receipt: https://botsrated.com/receipt/…. This is a measurement, not a finding about the seller. Dispute: https://botsrated.com/disputes

### Rules and defaults

| Rule (`policy.…`) | Reason code | `policies.warn` (default) | `policies.strict` |
|---|---|---|---|
| `payToMismatch`: the payTo is not among the payTos BotsRated's probes recorded for the host | `payto_not_observed` | warn | **block** |
| `payToInvalid`: the payTo is not a 20-byte hex address | `payto_invalid` | warn | **block** |
| `resourceHostMismatch`: the 402's `resource.url` names another host than the URL being paid (checked locally) | `resource_host_mismatch` | warn | **block** |
| `priceAboveObserved`: same route, amount above the last amount BotsRated recorded (compared locally) | `price_above_observed` | warn | warn |
| `notCovered`: BotsRated has no probe record for the host | `not_covered` | info | info |
| `stale`: BotsRated's latest probe is older than 24 h | `data_stale` | info | info |
| BotsRated unreachable (1.5 s timeout) | `botsrated_unreachable` | info (`failOpen: true`) | info unless `failOpen: false` |
| After payment: the seller did not report a settled payment | `payment_state_unknown` | warn | warn |

Each rule takes `"allow"`, `"warn"` or `"block"`, e.g. `policy: { ...policies.warn, payToMismatch: "block" }`.
Every decision carries `reasons` (code, effect, rule, fact), `facts`, `policyRule`, `disputeUrl` and a `message`.
Reason texts state facts only; seller text is never echoed except a parsed host name.

### Options

| Option | Default | Meaning |
|---|---|---|
| `policy` | `policies.warn` | Which facts warn and which stop a payment |
| `dryRun` | `false` | Log decisions, stop nothing, add no retry key. Recommended first setting |
| `hosted` | `true` | `false`: nothing is sent to botsrated.com |
| `failOpen` | `true` | `false`: stop the payment when BotsRated can't be reached or the guard errors |
| `retryKey` | `true` | Add a `payment-identifier` id where the seller advertises it |
| `onchain` | default RPCs | RPC settings for `paymentState`, or `false` |
| `timeoutMs` / `cacheTtlMs` | 1500 ms / 5 min | Hosted lookup timeout and per-host cache |
| `preflight` | hosted call | Your own lookup `(host) => …`, e.g. to share a `BotsRatedClient` cache |
| `onDecision` | none | Receives every decision (errors in it are ignored) |

### Fail-open or fail-closed

- **Fail-open (default):** if botsrated.com is down or slow, or the guard itself hits an error, the payment goes
  ahead and the decision says `botsrated_unreachable` (or `hook_error`). Our outage never stops your agent, but
  during an outage you get no seller facts.
- **Fail-closed (`failOpen: false`):** the same cases stop the payment. Use it only if an unchecked payment is worse
  for you than a missed call.
- Local checks (`resource_host_mismatch`, `payto_invalid`) and the on-chain check never depend on botsrated.com.

### What the guard sends, and to whom

- **botsrated.com:** `GET /v1/preflight?url=<host name>` with `User-Agent: botsrated-x402-preflight/<version>`.
  Never the path, query, wallet, amount, nonce, tx hash, payment header or request body. No install id. Covered by
  the [Terms](https://botsrated.com/terms) and [Privacy Policy](https://botsrated.com/privacy). Turn it off with
  `hosted: false`.
- **Base RPCs (only when you call `paymentState`):** JSON-RPC reads that include the payer address and nonce; the
  RPC operator also sees your IP. Use your own RPCs if that matters.
- No remote configuration, feature flags or auto-update: behaviour changes only with a new package version.

### Retry key (`payment-identifier`)

If the seller's 402 advertises the x402 `payment-identifier` extension, the guard adds a random id
(`pay_` + 128 random bits) through x402's extension mechanism. Nothing else in the payload changes, and the
seller's 402 is never modified. Ids are never reused across sellers, payTo addresses or routes. Inside
`guard.operation(key, fn)` a retry of the same logical operation (same payTo, host and path) reuses the id, so a
seller that honours the extension can answer a retry from its cache (or refuse a different payload with 409)
instead of charging again.

A retry key only stops a second charge if the seller supports it. In BotsRated's own probes on Oct 24, 2026,
81 of 3,739 seller hosts (2.2%) advertised `payment-identifier` in their 402, and 6 of them required it.
Elsewhere the guard adds nothing.

### Did it settle once? (read-only)

```ts
const rec = guard.records().at(-1);          // payTo, amount, nonce, validBefore, host; never the signature
const state = await guard.paymentState(rec); // reads the chain; never pays, signs or retries
```

There are three answers only:

- `settled`: two RPCs on different hosts both show the EIP-3009 authorization used at Base's `safe` block tag,
  the chain id is 8453, and the transaction receipt has `AuthorizationUsed(from, nonce)` and
  `Transfer(from, payTo, amount)` emitted by the pinned USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- `unknown` (`payment_state_unknown`) with `waitUntil`: not settled yet, the RPCs disagree or failed, or the
  record can't be checked. **Do not sign a new payment for that purchase before `waitUntil`** (the signed
  authorization stays valid until its `validBefore`, plus a margin of at least 30 s).
- `expired_unsettled`: `validBefore` plus the margin has passed and both RPCs show it unused at the `finalized`
  tag. Only then is a fresh payment free of a double-charge risk from the first one.

The guard never retries on `unknown`. botsrated.com is never asked; a tx hash the seller reports is only a hint
that is verified on chain.

**Default RPCs** (two operators; please confirm or replace):

| RPC | Operator |
|---|---|
| `https://mainnet.base.org` | Coinbase (Base public endpoint; rate-limited, not for production load) |
| `https://base-rpc.publicnode.com` | Allnodes (PublicNode) |

```ts
createPaymentGuard({ onchain: { rpcs: ["https://your-rpc-1", "https://your-rpc-2"], confirmTag: "finalized" } });
```

### What the guard can't do (by design)

- It never signs, never sends or resends a payment, never builds a payment header and never imports a signer.
- Every hook is wrapped so its return value is discarded. The after-payment and response hooks always resolve to
  `undefined`, so they can never ask x402 to "recover" (which would sign a fresh payment). The pre-payment hook can
  only return `{ abort: true, reason }`. The payment-creation-failure hook is never registered.
- These limits are enforced by tests in CI: `test/c1-no-repay.test.ts` (fuzzed hook contexts, a grep of the guard's
  source and `dist/` for signing, payment-header and retry code, and a real `@x402/fetch` run where the seller fails
  after payment and exactly one payload is created).
- MCP paid tools (`@x402/mcp`) get the pre-payment check only (`mcpPaymentApprover` below).

## The pre-payment guard (`createPrePaymentGuard`)

The older, simpler guard (pre-payment check only). Since 0.2.0 it also sends only the host name and is
advice-only on payTo by default; pass `policy: strictGuardPolicy` (or `{ payToMismatch: "block" }`) to stop
those payments as before.

```ts
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createPrePaymentGuard, strictGuardPolicy } from "@botsrated/x402-preflight";

const client = new x402Client();
registerExactEvmScheme(client, { signer });

const guard = createPrePaymentGuard({ policy: strictGuardPolicy }); // free preflight only; the policy is your choice
client.onBeforePaymentCreation(guard.beforePaymentCreation);

// wrapFetch tells the guard which URL is actually being paid (since 0.1.3)
const fetchWithPayment = guard.wrapFetch(wrapFetchWithPayment(fetch, client));
await fetchWithPayment("https://seller.example/api"); // throws "Payment creation aborted: Payment stopped by your payment policy ..." when your policy stops it
```

The 402's `resource.url` is chosen by the seller, so on its own it only says which host the seller *claims* to
be. When the guard knows the request URL (`guard.wrapFetch(...)`, `payingRequest(url, fn)`, `guard.forRequest(url)`,
or `guard.decide(resourceUrl, req, requestUrl)`), it looks up that URL's host and blocks the payment with
`resource_url_mismatch` (a local check; nothing is sent) if `resource.url` names a different host, even with `failOpen: true`. Without a request URL
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
| payTo not among the payTos BotsRated's own probes recorded for the host (same network), or not an address; the seller's listing alone never confirms one | warn (was **block** before 0.2.0) | `policy.payToMismatch: "block"` or `strictGuardPolicy` |
| Same route quoted above the last price BotsRated observed | warn | `policy.priceAboveObserved: "block"` |
| Host not covered | allow | `policy.notCovered: "block"` |
| Data older than 24 h | allow | `policy.stale: "block"` |
| Recent valid-402 rate below a threshold (≥ 3 probes) | off | `policy.minValid402Rate: 0.8` |
| BotsRated unreachable or slow (4 s timeout) | allow | `failOpen: false` |

Only the host name is sent to BotsRated. Preflight answers are cached for 5 minutes per host (`cacheTtlMs`). `onDecision(decision, requirements)`
receives every decision, including warnings and receipt URLs.

## Opt-in paid BotsRated lookups, with a budget

This is the only part of the package that signs anything: with `paid` set, `BotsRatedClient` asks **your**
`x402Client` to sign BotsRated's own quote for a paid lookup you requested. The payment guard
(`createPaymentGuard`, `@botsrated/x402-preflight/payment-guard`) never does.

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
  `name`/`version` (e.g. `assetTransferMethod: "permit2"`), a missing `maxTimeoutSeconds` or one above 600 (missing is refused since 0.2.0), or payment
  extensions in the 402 (e.g. `erc20ApprovalGasSponsoring`; only `bazaar` and `payment-identifier` are tolerated,
  and extensions are never copied into what is signed)
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
npm install && npm test          # unit, C1, privacy and wording tests + real @x402/core/@x402/fetch runs (throwaway key, nothing sent)
npm run build && node scripts/smoke-free.mjs   # live, free routes only
```

## Notes

- The guard reports facts BotsRated measured. It does not rate or endorse any seller, and it is not a finding about
  one. Sellers can dispute a measurement at https://botsrated.com/disputes.
- Security reports: [SECURITY.md](https://github.com/botsrated/botsrated/blob/main/SECURITY.md).
- Terms: https://botsrated.com/terms. Privacy: https://botsrated.com/privacy.
- License: MIT.

BotsRated is independent and is not affiliated with or endorsed by Coinbase, the x402 Foundation or any seller. "x402" is used only to describe compatibility.
