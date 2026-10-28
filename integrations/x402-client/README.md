# @botsrated/x402-preflight

## Install in 3 steps

1. Install: `npm install @botsrated/x402-preflight` (npm 0.3.0).
2. Attach to your x402 client:
```ts
import { createPaymentGuard } from "@botsrated/x402-preflight/payment-guard";
const guard = createPaymentGuard({ preset: "carefulBuyer" });
guard.install(client);
```
3. Pick `preset` (omit it, or call `createPaymentGuard()`, for advice only; `carefulBuyer` / `strict` stop an unobserved payTo). Omit `failMode` inside `remotePolicy` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Wrap the paying fetch with `guard.wrapFetch` so the guard knows the paid URL.

`BOTSRATED_TOKEN` is optional. Framework attaches read it when `token` is omitted and send it only as `remotePolicy` on `@botsrated/x402-preflight` 0.3.0 and later, never as a bare string. A configured token on a core without `normalizeRemotePolicy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk). Nothing defaults you to closed.

The BotsRated **payment guard** for x402 clients, plus a simpler pre-payment check.

- **Before your agent signs**, it looks up facts [BotsRated](https://botsrated.com) measured about the seller's host
  and compares them with the payment request on your machine.
- **While the payment is built**, it adds an x402 `payment-identifier` retry key, only when the seller advertises
  that extension.
- **After**, it keeps a local record (never the signature) and can read the blockchain, read-only, to see whether
  the payment settled once.

It lowers the chance of paying the wrong address or paying twice; it can't rule either out.

**Status: published on npm as [`@botsrated/x402-preflight` 0.3.0](https://www.npmjs.com/package/@botsrated/x402-preflight)** (adds `remotePolicy`).

**What this does and doesn't do.** This package checks facts BotsRated measured about a seller before your agent signs, adds a retry key to the payment request, and reads the blockchain to see whether a payment already settled. It can't promise that a payment is right, that a seller will deliver, or that you'll never pay twice: a retry key only stops a second charge if the seller supports the x402 `payment-identifier` extension, and on-chain reads can be late or fail. You choose the rules that stop a payment, and you remain responsible for what your agent pays. Provided under the MIT license, "as is", without warranty.

**Hosted checks.** By default (`hosted: true`) this package calls BotsRated's preflight (`https://botsrated.com/v1/preflight`; free, no key, rate limits) and sends it **only the seller's host name** (never the path, query, wallet, amount, nonce, payment header or request body). Those calls are covered by the BotsRated Terms (https://botsrated.com/terms) and Privacy Policy (https://botsrated.com/privacy), not by the MIT license. `hosted: false` turns hosted checks off: nothing is then sent to botsrated.com, and only the local checks, the retry key and the on-chain check (which goes only to the RPCs you set) run.

## Install

```bash
npm install @botsrated/x402-preflight @x402/core @x402/evm @x402/fetch
```

The package has no runtime dependencies. `@x402/*` are yours; the guard only uses the hook and extension points
of the x402 client you pass in.

## Payment Guard: Pick A Preset

You set the thresholds. The guard compares the payment with facts BotsRated measured and, when the preflight included
one, a receipt link.

Pick a named preset. The zero-config call (`createPaymentGuard()`) is `warn`: advice only, it never stops a payment.
Dry-run is optional: it logs `wouldBlock` and still never stops a payment.

| Name | How to select it | What you get |
|---|---|---|
| `warn` | `createPaymentGuard()` or `{ preset: "warn" }` or `{ policy: policies.warn }` | Advice only. The default. |
| `carefulBuyer` | `{ preset: "carefulBuyer" }` or `{ policy: policies.carefulBuyer }` | Same rule effects as `policies.strict`. Stops when the payTo wasn't observed, is invalid, the host mismatches, or the paid URL is unknown. |
| `strict` | `{ policy: policies.strict }` | The same stops as `carefulBuyer`. |
| `dry-run-only` | `dryRunOnly(...)`, `{ preset: "dry-run-only" }`, or `presets["dry-run-only"]` | Logs `wouldBlock` and never stops a payment. No retry key. `preset: "dry-run-only"` and `dryRunOnly()` force dry-run. |

```ts
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createPaymentGuard, dryRunOnly, policies } from "@botsrated/x402-preflight/payment-guard";

const client = new x402Client();
registerExactEvmScheme(client, { signer });

// Install one of these. `guard` stops payments; `looking` only logs.
// 1. Pick a named preset. This one stops the four cases above.
const guard = createPaymentGuard({
  preset: "carefulBuyer",
  onDecision: (d) => console.log(d.message, d.facts),
});

// 2. Or look first: log wouldBlock for those same stops, and never stop a payment.
const looking = dryRunOnly({ policy: policies.carefulBuyer, onDecision: (d) => console.log(d.wouldBlock, d.message) });

looking.install(client); // before/after/response hooks (+ the retry-key extension when not in dry-run)
const paidFetch = looking.wrapFetch(wrapFetchWithPayment(fetch, client)); // tells the guard which URL is being paid
await paidFetch("https://seller.example/api");
```

Import from `@botsrated/x402-preflight/payment-guard` (or `/onchain`) for the guard only: those entry points load
no signing code. The package root also exports `BotsRatedClient`, which can sign BotsRated's own paid lookups.

Always wrap the paying fetch with `guard.wrapFetch`. Without it the guard only knows the host the seller's 402
*claims* (`resource.url`), so it reports `paid_url_unknown` (a warning under `policies.warn`; `policies.carefulBuyer`
and `policies.strict` stop the payment).

`policies.carefulBuyer` is `policies.strict` (one rule table, two names). A price above the last observed amount
still warns. An uncovered host and a stale probe stay informational. To stop payments on your own mix, pass a
policy yourself: `{ ...policies.carefulBuyer, priceAboveObserved: "block" }`.

A stopped payment throws `Payment creation aborted:` with text like:

> Payment stopped by your payment policy (rule: payToMismatch). Fact: the payTo in this payment request is not among the payTo addresses BotsRated's probes recorded for seller.example on eip155:8453. Receipt: https://botsrated.com/receipt/<id>. This is a measurement, not a finding about the seller. Dispute: https://botsrated.com/disputes

### Rules And Defaults

| Rule (`policy.…`) | Reason code | `policies.warn` (default) | `policies.carefulBuyer` / `policies.strict` |
|---|---|---|---|
| `payToMismatch`: the payTo is not among the payTos BotsRated's probes recorded for the host | `payto_not_observed` | warn | **block** |
| `payToInvalid`: the payTo is not a 20-byte hex address | `payto_invalid` | warn | **block** |
| `resourceHostMismatch`: the 402's `resource.url` names another host than the URL being paid (checked locally) | `resource_host_mismatch` | warn | **block** |
| `paidUrlUnknown`: the URL being paid is unknown (no `guard.wrapFetch`), so the only host is the 402's own claim | `paid_url_unknown` | warn | **block** |
| `priceAboveObserved`: same route, amount above the last amount BotsRated recorded (compared locally) | `price_above_observed` | warn | warn |
| `notCovered`: BotsRated has no probe record for the host | `not_covered` | info | info |
| `stale`: BotsRated's latest probe is older than 24 h | `data_stale` | info | info |
| BotsRated unreachable (3 s timeout) | `botsrated_unreachable` | info (`failOpen: true`) | info unless `failOpen: false` |
| After payment: the seller did not report a settled payment | `payment_state_unknown` | warn | warn |

Each rule takes `"allow"`, `"warn"` or `"block"`, e.g. `policy: { ...policies.warn, payToMismatch: "block" }`.
A custom policy is laid over `policies.warn`, or over the preset's table when you pass `preset`, so `paidUrlUnknown`
stays at that table's effect unless you set it: add `paidUrlUnknown: "block"` (as `policies.carefulBuyer` /
`policies.strict` do) if an unknown paid URL should stop the payment.
Every decision carries `reasons` (code, effect, rule, fact), `facts`, `policyRule`, `disputeUrl` and a `message`.
Reason texts state facts only; seller text is never echoed except a parsed host name.

### Facts Bundle

`decision.facts` is the bundle the guard compared. It is measurements plus a receipt link.

| Field | What it is |
|---|---|
| `covered` | Whether BotsRated has a probe record for the host |
| `host` | Host that was looked up (only the host name was sent) |
| `knownPayTos` | payTo addresses BotsRated's probes recorded |
| `listingPayTo` | payTo from a directory listing, when present. A listing is not a probe observation |
| `observedNetwork` | Network the probes recorded |
| `observedAmount` | Last amount recorded on the probed route, in atomic units |
| `stale` | True when the latest probe is older than 24 hours |
| `receiptUrl` | `https://botsrated.com/receipt/...` when the preflight included a receipt on botsrated.com |

`reasons` lists each fact (`code`, `effect` of `info`, `warn` or `block`, `rule`, `fact`). `disputeUrl` is
https://botsrated.com/disputes. `wouldBlock` is true when a rule's effect is `block`, including in dry-run, where
`action` stays `allow`.

The hosted preflight body is larger (see the MCP facts bundle in the repository README). The guard keeps this
smaller local bundle and does not add a summary number, because the response has none.

### Options

| Option | Default | Meaning |
|---|---|---|
| `preset` | omitted (behaves as `warn`) | `warn`, `carefulBuyer`, or `dry-run-only`. `dry-run-only` forces dry-run |
| `policy` | `policies.warn` | Which facts warn and which stop a payment. Laid over the preset's rule table |
| `dryRun` | `false` | Log decisions, stop nothing, add no retry key. Forced on for preset `dry-run-only` |
| `hosted` | `true` | `false`: nothing is sent to botsrated.com |
| `failOpen` | `true` | `false`: stop the payment when BotsRated can't be reached or the guard errors |
| `retryKey` | `true` | Add a `payment-identifier` id where the seller advertises it |
| `onchain` | default RPCs | RPC settings for `paymentState` (`rpcs`, `extraRpc`, `marginSeconds`, `expiryTag`, `confirmTag`), or `false` |
| `timeoutMs` / `cacheTtlMs` | 3000 ms / 5 min | Hosted lookup timeout and per-host cache |
| `preflight` | hosted call | Your own lookup `(host) => …`, e.g. to share a `BotsRatedClient` cache |
| `onDecision` | none | Receives every decision (errors in it are ignored) |
| `remotePolicy` | unset | Private policy check. See below. Unset: local presets only |

### Fail-Open Or Fail-Closed

- **Fail-open (default):** if botsrated.com is down or slow, or the guard itself hits an error, the payment goes
  ahead and the decision says `botsrated_unreachable` (or `hook_error`). Our outage never stops your agent, but
  during an outage you get no seller facts.
- **Fail-closed (`failOpen: false`):** the same cases stop the payment. Use it only if an unchecked payment is worse
  for you than a missed call.
- Local checks (`resource_host_mismatch`, `payto_invalid`) and the on-chain check never depend on botsrated.com.

### Remote Policy

Optional. Set `remotePolicy` to ask your private policy on BotsRated before a payment. The guard merges that answer with the local rules. A remote block stops the payment. A remote pass does not clear a local block. `createPrePaymentGuard({ remotePolicy })` uses the same check.

This is the path that makes `BOTSRATED_TOKEN` work in framework attaches. The token is optional. The guard defaults to advice-only with no key, so anyone can install it as a default. The client enforces. BotsRated holds no funds, signs nothing, and has no escrow.

```ts
const guard = createPaymentGuard({
  preset: "carefulBuyer",
  remotePolicy: { token: "<bearer>", failMode: "open" }, // omit failMode for open; "closed" is opt-in
});
```

`failMode` is yours: `"open"` or `"closed"` (`fail_mode` is accepted as an alias). Omit it and the check stays open. Nothing defaults you to closed. `"closed"` stops the payment when BotsRated or your policy cannot answer. The guard `POST`s `/v1/policy/check` with the seller host and the quote (`payTo`, `amount`, `asset`, `network`). On HTTP 503, HTTP 404, or `"decision": null`, it applies `failMode` (`open`: an info reason, payment continues unless a local rule stops it; `closed`: the payment stops). A missing decision is never a pass. A remote pass never clears a local block. Server fields are kept when the server sends them. The last `policy_version` is remembered (`remotePolicyVersion()`). The policy decision is not signed. Leave `remotePolicy` unset and local presets behave as before.

`BOTSRATED_TOKEN` is optional. Framework attaches read it when `token` is omitted and send it only as `remotePolicy` on `@botsrated/x402-preflight` 0.3.0 and later. A configured token on a core without `normalizeRemotePolicy` raises and is not dropped. Get a token in [Desk](https://botsrated.com/desk).

### What The Guard Sends, And To Whom

- **botsrated.com (preflight):** `GET /v1/preflight?url=<host name>` with `User-Agent: botsrated-x402-preflight/<version>`.
  Never the path, query, wallet, amount, nonce, tx hash, payment header or request body. No install id. Covered by
  the [Terms](https://botsrated.com/terms) and [Privacy Policy](https://botsrated.com/privacy). Turn it off with
  `hosted: false`.
- **botsrated.com (only when `remotePolicy` is set):** `POST /v1/policy/check` with the host, the quote
  (`payTo`, `amount`, `asset`, `network`) and your bearer token. Not the path, query, payer wallet, nonce or a
  payment header. The decision is not signed. `hosted: false` does not turn this off.
- **Base RPCs (only when you call `paymentState`; nothing calls them automatically):** JSON-RPC reads that include
  the payer address and the payment's nonce, sent straight from your machine to the RPCs, never to BotsRated.
  See the privacy note under "Did It Settle Once?".
- No feature flags or auto-update: behavior changes only with a new package version, or with `remotePolicy` when you set it.

### Retry Key (`payment-identifier`)

If the seller's 402 advertises the x402 `payment-identifier` extension, the guard adds a random id
(`pay_` + 128 random bits) through x402's extension mechanism. Nothing else in the payload changes, and the
seller's 402 is never modified. Ids are never reused across sellers, payTo addresses or routes. Inside
`guard.operation(key, fn)` a retry of the same logical operation (same payTo, host and path) reuses the id, so a
seller that honors the extension can answer a retry from its cache (or refuse a different payload with 409)
instead of charging again.

A retry key only stops a second charge if the seller supports it. In BotsRated's own probes on Oct 24, 2026,
about 2.2% of seller hosts (81 of 3,739 in our probe database) advertised `payment-identifier` in their 402, and 6
of them required it.
Elsewhere the guard adds nothing.

### Did It Settle Once? (Read-Only)

```ts
const rec = guard.records().at(-1);          // payTo, amount, nonce, validBefore, host; never the signature
const state = await guard.paymentState(rec); // reads the chain; never pays, signs or retries
```

There are three answers only:

- `settled`: two RPCs on different hosts (or two of three, see below) show the EIP-3009 authorization used at Base's default confirmation tag,
  the chain id is 8453, and the transaction receipt has `AuthorizationUsed(from, nonce)` and
  `Transfer(from, payTo, amount)` emitted by the pinned USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- `unknown` (`payment_state_unknown`) with `waitUntil`: not settled yet, the RPCs disagree or failed, the blocks
  they read are not yet past `validBefore` plus the margin (`chain_not_past_expiry`), or the record can't be
  checked. **Do not sign a new payment for that purchase before `waitUntil`** (the signed authorization stays
  valid until its `validBefore`, plus a margin of at least 30 s).
- `expired_unsettled`: `validBefore` plus the margin has passed on the clock **and** in the chain: both RPCs show
  the authorization unused at a block (Base's default confirmation tag) whose timestamp is at or after `validBefore`
  plus the margin. USDC accepts an authorization in any block before `validBefore`, so "unused" only counts in a
  later block. With the default 60 s margin this is usually 1 to 3 minutes after expiry. Only then is a fresh
  payment free of a double-charge risk from the first one.

Settings (`onchain: { ... }`): `marginSeconds` (default 60, minimum 30) is the extra wait after `validBefore`.
It is clamped, not rejected: a value below 30 (including negative values and `-Infinity`) is raised to 30, a value
above 86,400 (1 day, including `Infinity`) is lowered to 1 day, and `NaN` or a non-number uses 60.
`expiryTag: "finalized"` waits for a finalized block past expiry instead (more conservative, usually 20+ minutes).

The guard never retries on `unknown`. botsrated.com is never asked; a tx hash the seller reports is only a hint
that is checked on chain.

**Default RPCs** (two operators; both must answer and agree):

| RPC | Operator |
|---|---|
| `https://mainnet.base.org` | Coinbase (Base public endpoint; rate-limited, not for production load) |
| `https://base-rpc.publicnode.com` | Allnodes (PublicNode) |

```ts
createPaymentGuard({ onchain: { rpcs: ["https://your-rpc-1", "https://your-rpc-2"] } });
// Optional third RPC of your own: then 2 of the 3 must answer and agree, and any RPC that sees the
// authorization used rules out expired_unsettled.
createPaymentGuard({ onchain: { extraRpc: "https://your-own-rpc" } });
```

At most 3 RPCs in total (`rpcs` plus `extraRpc`): more is a configuration error (`RangeError`), thrown when the
guard is created and by `checkPaymentState`, before any RPC is called.

**Privacy of on-chain checks.** Each `paymentState()` call sends the payer address, the payment's nonce and your IP
address to every RPC it uses. With the defaults those are Coinbase (`mainnet.base.org`) and Allnodes
(`base-rpc.publicnode.com`); anyone holding the nonce can match it to the on-chain transaction and the seller.
Treat both operators as logging. Pass your own RPCs (`rpcs`, `extraRpc`) if that matters to you. BotsRated never
receives these reads.

### What The Guard Can't Do (By Design)

- It never signs, never sends or resends a payment, never builds a payment header and never imports a signer.
- Every hook is wrapped so its return value is discarded. The after-payment and response hooks always resolve to
  `undefined`, so they can never ask x402 to "recover" (which would sign a fresh payment). The pre-payment hook can
  only return `{ abort: true, reason }`. The payment-creation-failure hook is never registered.
- These limits are enforced by tests in CI: `test/c1-no-repay.test.ts` (fuzzed hook contexts, a grep of the guard's
  source and `dist/` for signing, payment-header and retry code, and a real `@x402/fetch` run where the seller fails
  after payment and exactly one payload is created).
- **Other hooks can still pay again.** If your own code or another library registers an `onPaymentResponse` or
  `onPaymentCreationFailure` hook on the same x402 client that returns `{ recovered: true }`, x402 signs and sends
  a fresh payment. The guard can't stop that, because it happens outside this package. Don't return `recovered`
  from your own hooks unless a new payment is what you want.
- MCP paid tools (`@x402/mcp`) get the pre-payment check only (`mcpPaymentApprover` below).

## The Pre-Payment Guard (`createPrePaymentGuard`)

The older, simpler guard (pre-payment check only). Since 0.2.0 it also sends only the host name and is
advice-only on payTo by default; pass `policy: strictGuardPolicy` (or `{ payToMismatch: "block" }`) to stop
those payments as before. Since 0.2.0 `strictGuardPolicy` also sets `requireRequestUrl: true`, so it stops a payment
whose real request URL is unknown; use `guard.wrapFetch` or `guard.forRequest(url)` with it.

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

## Use With `@x402/mcp`

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

## What Is Checked (Defaults)

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

## Opt-In Paid BotsRated Lookups, With A Budget

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

await botsrated.check("seller.example");            // $0.001 (first 25 per client IP per UTC day free)
await botsrated.report("seller.example");           // $0.002 (first 3 per client IP per UTC day free)
await botsrated.best("web search", { sort: "price" }); // $0.01
```

- With `x402Client` (since 0.1.2, recommended), the client validates the 402, rebuilds it from the
  allowlisted fields only (scheme, network, asset, amount, payTo, maxTimeoutSeconds, EIP-3009 `name`/`version`,
  resource url/description/mimeType; never `extensions`), signs that copy with `createPaymentPayload` and sends
  `PAYMENT-SIGNATURE` itself (no redirects). The signer never sees the raw 402. If signing fails, nothing can
  settle and the reservation is released (`payment_not_created`). The older
  `fetchWithPayment: wrapFetchWithPayment(fetch, client)` still works, but it re-reads the 402 itself, so
  register the guard on the same `x402Client` so that re-served 402 is checked again before signing.
- Free daily quota (`FREE_DAILY_QUOTA`): BotsRated serves the first 25 `/v1/check` and 3 `/v1/report` calls per client IP
  per UTC day free (200 with `charged: false` and a `free_quota` block). The client asks unpaid
  first, so inside the quota nothing is paid and the budget is untouched; `check()`/`report()` work
  even without `paid` until the quota is used up (then they throw `paid_disabled`).
  `client.lastFreeQuota` shows the remaining quota. `/v1/best` has no free quota. Preflight stays free, no key, rate limits.
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
  one. A seller can send a reply about a measurement at https://botsrated.com/disputes.
- Security reports: [SECURITY.md](https://github.com/botsrated/botsrated/blob/main/SECURITY.md).
- Terms: https://botsrated.com/terms. Privacy: https://botsrated.com/privacy.
- License: MIT.

BotsRated is independent and is not affiliated with or endorsed by Coinbase, the x402 Foundation or any seller. "x402" is used only to describe compatibility.
