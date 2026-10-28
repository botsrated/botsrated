# botsrated (Python)

## Install in 3 steps

1. Install: `pip install "botsrated[x402]"` (PyPI 0.3.0).
2. Attach to your x402 client:
```python
from botsrated import PaymentGuard
guard = PaymentGuard(preset="carefulBuyer")
guard.install(client)
```
3. Pick `preset` (`warn` advice only is the default; `carefulBuyer` / `strict` stop an unobserved payTo). Wrap the paying call with `guard.wrap_get` / `guard.wrap_async_get` so the guard knows the paid URL.

The BotsRated **payment guard** for x402 clients, plus a simpler pre-payment check.

- **Before your agent signs**, it looks up facts [BotsRated](https://botsrated.com) measured about the seller's host
  and compares them with the payment request on your machine.
- **While the payment is built**, it adds an x402 `payment-identifier` retry key, only when the seller advertises
  that extension.
- **After**, it keeps a local record (never the signature) and can read the blockchain, read-only, to see whether
  the payment settled once.

It lowers the chance of paying the wrong address or paying twice; it can't rule either out.

**Status: published on PyPI as [`botsrated` 0.3.0](https://pypi.org/project/botsrated/)** (adds `remote_policy`).

**What this does and doesn't do.** This package checks facts BotsRated measured about a seller before your agent signs, adds a retry key to the payment request, and reads the blockchain to see whether a payment already settled. It can't promise that a payment is right, that a seller will deliver, or that you'll never pay twice: a retry key only stops a second charge if the seller supports the x402 `payment-identifier` extension, and on-chain reads can be late or fail. You choose the rules that stop a payment, and you remain responsible for what your agent pays. Provided under the MIT license, "as is", without warranty.

**Hosted checks.** By default (`hosted=True`) this package calls BotsRated's preflight (`https://botsrated.com/v1/preflight`; free, no key, rate limits) and sends it **only the seller's host name** (never the path, query, wallet, amount, nonce, payment header or request body). Those calls are covered by the BotsRated Terms (https://botsrated.com/terms) and Privacy Policy (https://botsrated.com/privacy), not by the MIT license. `hosted=False` turns hosted checks off: nothing is then sent to botsrated.com, and only the local checks, the retry key and the on-chain check (which goes only to the RPCs you set) run.

## Install

```bash
pip install "botsrated[x402]"
```

Runtime dependencies: `httpx>=0.27,<1` (and, with the `x402` extra, `x402[httpx,evm]>=2.25,<3`). The guard only
uses the hook and extension points of the x402 client you pass in.

## Payment Guard: Pick A Preset

You set the thresholds. The guard compares the payment with facts BotsRated measured and, when the preflight included
one, a receipt link. It does not return a score or a grade.

Pick a named preset. The zero-config call (`PaymentGuard()`) is `warn`: advice only, it never stops a payment.
Dry-run is optional: it logs `would_block` and still never stops a payment.

| Name | How to select it | What you get |
|---|---|---|
| `warn` | `PaymentGuard()` or `preset="warn"` or `policy=POLICIES["warn"]` | Advice only. The default. |
| `carefulBuyer` | `preset="carefulBuyer"` or `policy=POLICIES["carefulBuyer"]` | Same rule effects as `POLICIES["strict"]`. Stops when the payTo wasn't observed, is invalid, the host mismatches, or the paid URL is unknown. |
| `strict` | `policy=POLICIES["strict"]` | The same stops as `carefulBuyer`. |
| `dry-run-only` | `dry_run_only(...)`, `preset="dry-run-only"`, or `PaymentGuard(**PRESETS["dry-run-only"])` | Logs `would_block` and never stops a payment. No retry key. `preset="dry-run-only"` and `dry_run_only()` force dry-run. |

```python
import httpx
from x402 import x402Client
from x402.http.clients.httpx import x402AsyncTransport
from x402.mechanisms.evm import EthAccountSigner
from x402.mechanisms.evm.exact import ExactEvmScheme
from botsrated import POLICIES, PaymentGuard, dry_run_only

client = x402Client()
client.register("eip155:*", ExactEvmScheme(signer=EthAccountSigner(account)))

# Install one of these. `guard` stops payments; `looking` only logs.
# 1. Pick a named preset. This one stops the four cases above.
guard = PaymentGuard(preset="carefulBuyer", on_decision=lambda d: print(d.message, d.facts))

# 2. Or look first: log would_block for those same stops, and never stop a payment.
looking = dry_run_only(policy=POLICIES["carefulBuyer"], on_decision=lambda d: print(d.would_block, d.message))

looking.install(client)  # before/after/response hooks (+ the retry-key extension when not in dry-run)
http = httpx.AsyncClient(transport=x402AsyncTransport(client, httpx.AsyncHTTPTransport()))
paid_get = looking.wrap_async_get(http.get)  # tells the guard which URL is being paid
await paid_get("https://seller.example/api")
```

`x402ClientSync` works too (`guard.install(sync_client)`, then `guard.wrap_get(session.get)` or
`with guard.request(url): ...`).

Importing the guard (`from botsrated import PaymentGuard` or `from botsrated.payment_guard import PaymentGuard`)
does not load the signing client: `BotsRatedClient`, which can sign BotsRated's own paid lookups, loads only when
you use it.

Always tell the guard the URL being paid (`wrap_async_get`, `wrap_get` or `with guard.request(url):`). Without it
the guard only knows the host the seller's 402 *claims* (`resource.url`), so it reports `paid_url_unknown` (a
warning by default; `POLICIES["carefulBuyer"]` and `POLICIES["strict"]` stop the payment).

`POLICIES["carefulBuyer"]` is `POLICIES["strict"]` (one rule table, two names). A price above the last observed
amount still warns. An uncovered host and a stale probe stay informational. To stop payments on your own mix,
pass a policy yourself: `dataclasses.replace(POLICIES["carefulBuyer"], price_above_observed="block")`. An explicit
`policy=` replaces the preset's rule table.

A stopped payment raises the x402 abort error with text like:

> Payment stopped by your payment policy (rule: payToMismatch). Fact: the payTo in this payment request is not among the payTo addresses BotsRated's probes recorded for seller.example on eip155:8453. Receipt: https://botsrated.com/receipt/<id>. This is a measurement, not a finding about the seller. Dispute: https://botsrated.com/disputes

### Rules And Defaults

| Rule (`PaymentGuardPolicy(...)`) | Reason code | `POLICIES["warn"]` (default) | `POLICIES["carefulBuyer"]` / `POLICIES["strict"]` |
|---|---|---|---|
| `pay_to_mismatch`: the payTo is not among the payTos BotsRated's probes recorded for the host | `payto_not_observed` | warn | **block** |
| `pay_to_invalid`: the payTo is not a 20-byte hex address | `payto_invalid` | warn | **block** |
| `resource_host_mismatch`: the 402's `resource.url` names another host than the URL being paid (checked locally) | `resource_host_mismatch` | warn | **block** |
| `paid_url_unknown`: the URL being paid is unknown (no `wrap_get` / `guard.request(url)`), so the only host is the 402's own claim | `paid_url_unknown` | warn | **block** |
| `price_above_observed`: same route, amount above the last amount BotsRated recorded (compared locally) | `price_above_observed` | warn | warn |
| `not_covered`: BotsRated has no probe record for the host | `not_covered` | info | info |
| `stale`: BotsRated's latest probe is older than 24 h | `data_stale` | info | info |
| BotsRated unreachable (3 s timeout) | `botsrated_unreachable` | info (`fail_open=True`) | info unless `fail_open=False` |
| After payment: the seller did not report a settled payment | `payment_state_unknown` | warn | warn |

Each rule takes `"allow"`, `"warn"` or `"block"`, e.g.
`dataclasses.replace(POLICIES["warn"], pay_to_mismatch="block")`. A custom `PaymentGuardPolicy(...)` leaves
`paid_url_unknown` at `"warn"` unless you set it: add `paid_url_unknown="block"` (as `POLICIES["carefulBuyer"]` /
`POLICIES["strict"]` do) if an unknown paid URL should stop the payment. Every decision carries `reasons` (code, effect,
rule, fact), `facts`, `policy_rule`, `dispute_url` and a `message`. Reason texts state facts only; seller text is
never echoed except a parsed host name.

### Facts Bundle

`decision.facts` is the bundle the guard compared. It is measurements plus a receipt link. It has no score and no grade.

| Field | What it is |
|---|---|
| `covered` | Whether BotsRated has a probe record for the host |
| `host` | Host that was looked up (only the host name was sent) |
| `known_pay_tos` | payTo addresses BotsRated's probes recorded |
| `listing_pay_to` | payTo from a directory listing, when present. A listing is not a probe observation |
| `observed_network` | Network the probes recorded |
| `observed_amount` | Last amount recorded on the probed route, in atomic units |
| `stale` | True when the latest probe is older than 24 hours |
| `receipt_url` | `https://botsrated.com/receipt/...` when the preflight included a receipt on botsrated.com |

`reasons` lists each fact (`code`, `effect` of `info`, `warn` or `block`, `rule`, `fact`). `dispute_url` is
https://botsrated.com/disputes. `would_block` is true when a rule's effect is `block`, including in dry-run, where
`action` stays `allow`.

The hosted preflight body is larger (see the MCP facts bundle in the repository README). The guard keeps this
smaller local bundle and does not copy a score out of it, because the response has none.

### Options

| Option | Default | Meaning |
|---|---|---|
| `preset` | omitted (behaves as `warn`) | `warn`, `carefulBuyer`, or `dry-run-only`. `dry-run-only` forces dry-run |
| `policy` | `POLICIES["warn"]` | Which facts warn and which stop a payment. Replaces the preset's rule table when set |
| `dry_run` | `False` | Log decisions, stop nothing, add no retry key. Forced on for preset `dry-run-only` |
| `hosted` | `True` | `False`: nothing is sent to botsrated.com |
| `fail_open` | `True` | `False`: stop the payment when BotsRated can't be reached or the guard errors |
| `retry_key` | `True` | Add a `payment-identifier` id where the seller advertises it |
| `onchain` | default RPCs | RPC settings for `payment_state` (`rpcs`, `extra_rpc`, `margin_seconds`, `expiry_tag`, `confirm_tag`), or `False` |
| `timeout` / `cache_ttl` | 3 s / 5 min | Hosted lookup timeout and per-host cache |
| `preflight` | hosted call | Your own lookup `(host) -> (found, body)` |
| `on_decision` | none | Receives every decision (errors in it are ignored) |
| `remote_policy` | unset | Private policy check. See below. Unset: local presets only |

### Fail-Open Or Fail-Closed

- **Fail-open (default):** if botsrated.com is down or slow, or the guard itself hits an error, the payment goes
  ahead and the decision says `botsrated_unreachable` (or `hook_error`). Our outage never stops your agent, but
  during an outage you get no seller facts.
- **Fail-closed (`fail_open=False`):** the same cases stop the payment. Use it only if an unchecked payment is worse
  for you than a missed call.
- Local checks (`resource_host_mismatch`, `payto_invalid`) and the on-chain check never depend on botsrated.com.

### Remote Policy

Optional. Set `remote_policy` to ask your private policy on BotsRated before a payment. The guard merges that answer with the local rules. A remote block stops the payment. A remote pass does not clear a local block. `PrePaymentGuard(..., remote_policy=...)` uses the same check.

This is the path that makes `BOTSRATED_TOKEN` work in framework attaches. The token is optional. The guard defaults to advice-only with no key, so anyone can install it as a default. The client enforces. BotsRated holds no funds, signs nothing, and has no escrow.

```python
guard = PaymentGuard(
    preset="carefulBuyer",
    remote_policy={"token": "<bearer>", "fail_mode": "closed"},  # base_url defaults to https://botsrated.com
)
```

`fail_mode` is yours: `open` or `closed`. The guard `POST`s `/v1/policy/check` with the seller host and the quote (`payTo`, `amount`, `asset`, `network`). On HTTP 503, HTTP 404, or `"decision": null`, it applies `fail_mode` (`open`: an info reason, payment continues unless a local rule stops it; `closed`: the payment stops). It does not turn a missing decision into a pass. `decided_by` and `not_a_botsrated_rating` are kept when the server sends them. The last `policy_version` is remembered on the guard. The policy decision is not signed. Leave `remote_policy` unset and local presets behave as before.

### What The Guard Sends, And To Whom

- **botsrated.com (preflight):** `GET /v1/preflight?url=<host name>` with `User-Agent: botsrated-python/<version>`.
  Never the path, query, wallet, amount, nonce, tx hash, payment header or request body. No install id. Covered by
  the [Terms](https://botsrated.com/terms) and [Privacy Policy](https://botsrated.com/privacy). Turn it off with
  `hosted=False`.
- **botsrated.com (only when `remote_policy` is set):** `POST /v1/policy/check` with the host, the quote
  (`payTo`, `amount`, `asset`, `network`) and your bearer token. Not the path, query, payer wallet, nonce or a
  payment header. The decision is not signed. `hosted=False` does not turn this off.
- **Base RPCs (only when you call `payment_state`; nothing calls them automatically):** JSON-RPC reads that include
  the payer address and the payment's nonce, sent straight from your machine to the RPCs, never to BotsRated.
  See the privacy note under "Did It Settle Once?".
- No feature flags or auto-update: behavior changes only with a new package version, or with `remote_policy` when you set it.

### Retry Key (`payment-identifier`)

If the seller's 402 advertises the x402 `payment-identifier` extension, the guard adds a random id
(`pay_` + 128 random bits) through x402's extension mechanism. Nothing else in the payload changes, and the
seller's 402 is never modified. Ids are never reused across sellers, payTo addresses or routes. Inside
`with guard.operation(key):` a retry of the same logical operation (same payTo, host and path) reuses the id, so a
seller that honors the extension can answer a retry from its cache (or refuse a different payload with 409)
instead of charging again.

A retry key only stops a second charge if the seller supports it. In BotsRated's own probes on Oct 24, 2026,
about 2.2% of seller hosts (81 of 3,739 in our probe database) advertised `payment-identifier` in their 402, and 6
of them required it.
Elsewhere the guard adds nothing.

### Did It Settle Once? (Read-Only)

```python
rec = guard.records()[-1]              # pay_to, amount, nonce, valid_before, host; never the signature
state = guard.payment_state(rec)       # or: await guard.apayment_state(rec). Reads the chain; never pays, signs or retries
```

There are three answers only:

- `settled`: two RPCs on different hosts (or two of three, see below) show the EIP-3009 authorization used at Base's `safe` block tag,
  the chain id is 8453, and the transaction receipt has `AuthorizationUsed(from, nonce)` and
  `Transfer(from, payTo, amount)` emitted by the pinned USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- `unknown` (`payment_state_unknown`) with `wait_until`: not settled yet, the RPCs disagree or failed, the blocks
  they read are not yet past `validBefore` plus the margin (`chain_not_past_expiry`), or the record can't be
  checked. **Do not sign a new payment for that purchase before `wait_until`** (the signed authorization stays
  valid until its `validBefore`, plus a margin of at least 30 s).
- `expired_unsettled`: `validBefore` plus the margin has passed on the clock **and** in the chain: both RPCs show
  the authorization unused at a block (Base's `safe` tag by default) whose timestamp is at or after `validBefore`
  plus the margin. USDC accepts an authorization in any block before `validBefore`, so "unused" only counts in a
  later block. With the default 60 s margin this is usually 1 to 3 minutes after expiry. Only then is a fresh
  payment free of a double-charge risk from the first one.

Settings (`onchain={...}`): `margin_seconds` (default 60, minimum 30) is the extra wait after `validBefore`.
It is clamped, not rejected: a value below 30 (including negative values and `-inf`) is raised to 30, a value above
86,400 (1 day, including `inf`) is lowered to 1 day, and NaN or a non-number uses 60.
`expiry_tag="finalized"` waits for a finalized block past expiry instead (more conservative, usually 20+ minutes).

The guard never retries on `unknown`. botsrated.com is never asked; a tx hash the seller reports is only a hint
that is verified on chain.

**Default RPCs** (two operators; both must answer and agree):

| RPC | Operator |
|---|---|
| `https://mainnet.base.org` | Coinbase (Base public endpoint; rate-limited, not for production load) |
| `https://base-rpc.publicnode.com` | Allnodes (PublicNode) |

```python
PaymentGuard(onchain={"rpcs": ["https://your-rpc-1", "https://your-rpc-2"]})
# Optional third RPC of your own: then 2 of the 3 must answer and agree, and any RPC that sees the
# authorization used rules out expired_unsettled.
PaymentGuard(onchain={"extra_rpc": "https://your-own-rpc"})
```

At most 3 RPCs in total (`rpcs` plus `extra_rpc`): more is a configuration error (`ValueError`), raised when the
guard is created and by `check_payment_state`, before any RPC is called.

**Privacy of on-chain checks.** Each `payment_state()` call sends the payer address, the payment's nonce and your
IP address to every RPC it uses. With the defaults those are Coinbase (`mainnet.base.org`) and Allnodes
(`base-rpc.publicnode.com`); anyone holding the nonce can match it to the on-chain transaction and the seller.
Treat both operators as logging. Pass your own RPCs (`rpcs`, `extra_rpc`) if that matters to you. BotsRated never
receives these reads.

### What The Guard Can't Do (By Design)

- It never signs, never sends or resends a payment, never builds a payment header and never imports a signer.
- Every hook is wrapped so its return value is discarded. The after-payment and response hooks always return
  `None`, so they can never ask x402 to "recover" (which would sign a fresh payment). The pre-payment hook can only
  return an `AbortResult`. The payment-creation-failure hook is never registered.
- These limits are enforced by tests in CI: `tests/test_c1_no_repay.py` (fuzzed hook contexts, a grep of the
  guard's source and built wheel for signing, payment-header and retry code, an import allow-list, and a real
  x402 httpx run where the seller fails after payment and exactly one payload is created).
- **Other hooks can still pay again.** If your own code or another library registers an `on_payment_response` or
  `on_payment_creation_failure` hook on the same x402 client that returns a result with `recovered=True`, x402
  signs and sends a fresh payment. The guard can't stop that, because it happens outside this package. Don't
  return `recovered` from your own hooks unless a new payment is what you want.

## The Pre-Payment Guard (`PrePaymentGuard`)

The older, simpler guard (pre-payment check only). Since 0.2.0 it also sends only the host name and is
advice-only on payTo by default; pass `policy=STRICT_GUARD_POLICY` (or `GuardPolicy(pay_to_mismatch="block")`) to
stop those payments as before. Since 0.2.0 `STRICT_GUARD_POLICY` also sets `require_request_url=True`, so it stops a
payment whose real request URL is unknown; use `wrap_get` or `x402_hook_for(url)` with it.

```python
from x402 import x402ClientSync
from x402.mechanisms.evm import EthAccountSigner
from x402.mechanisms.evm.exact import ExactEvmScheme
from x402.http.clients import x402_requests
from botsrated import STRICT_GUARD_POLICY, PrePaymentGuard

client = x402ClientSync()
client.register("eip155:*", ExactEvmScheme(signer=EthAccountSigner(account)))
guard = PrePaymentGuard(policy=STRICT_GUARD_POLICY)  # the policy is your choice
client.on_before_payment_creation(guard.x402_hook)

# Tell the guard which URL is actually being paid (since 0.1.5):
session = x402_requests(client)
paid_get = guard.wrap_get(session.get)       # or: with paying_request(url): session.get(url)
paid_get("https://seller.example/api")
```

The 402's `resource.url` is chosen by the seller, so on its own it only says which host the seller
*claims* to be. When the guard knows the request URL (`guard.wrap_get(...)`, `guard.wrap_async_get(...)`,
`with paying_request(url):`, `guard.x402_hook_for(url)`, or `guard.decide(..., request_url=url)`), it looks
up that URL's host and blocks the payment with `resource_url_mismatch` if `resource.url` names a different
host. That block applies even with `fail_open=True`. Hosts are compared after IDNA (punycode) and trailing-dot
normalization. The wrappers only see the URL you called, not where redirects ended, so a `resource.url` that
differs only by a leading `www.` (an apex <-> www redirect) is accepted (since 0.1.6); any other host is blocked. Without a request URL the host is still read from
`resource.url` (as before 0.1.5); set `GuardPolicy(require_request_url=True)` to block those payments instead.

Defaults:
- A payTo that differs from every payTo BotsRated's own probes saw for the host, on the same network, is a
  **warning** (`payto_not_observed`; it was a block before 0.2.0). The seller's directory listing alone never
  confirms a payTo: with no probe observation, a listing match is noted with `payto_listing_only` and a listing
  mismatch follows the same rule.
- A price above the last observed price on the same route is a warning.
- A host that is not covered is allowed.
- Data older than 24 h is allowed (`data_stale`).
- If BotsRated cannot be reached (4 s timeout), the payment is allowed (`fail_open`, `botsrated_unreachable`).
- The minimum valid-402 rate is off.

Change these with `GuardPolicy(...)`. Preflight answers are cached for 5 minutes per host.

## Opt-In Paid Lookups With A Budget

```python
from botsrated import BotsRatedClient, PrePaymentGuard

botsrated = BotsRatedClient(budget_usd="0.05", x402_client=client)   # signs only the validated quote
guard = PrePaymentGuard(botsrated, paid_check_at_or_above_usd=0.25)
client.on_before_payment_creation(guard.x402_hook)

botsrated.check("seller.example")     # $0.001 (first 25 per client IP per UTC day free)
botsrated.report("seller.example")    # $0.002 (first 3 per client IP per UTC day free)
botsrated.best("web search")          # $0.01
```

`x402_client=` (since 0.1.4) is the recommended mode: the client validates the 402, rebuilds it from
the allowlisted fields only (scheme, network, asset, amount, payTo, maxTimeoutSeconds, EIP-3009
`name`/`version`, resource url/description/mimeType; never `extensions`), signs that copy with
`client.create_payment_payload`, and sends `PAYMENT-SIGNATURE` itself. The signer never sees the raw
402. The older `paying_get=x402_requests(client).get` still works, but that session re-reads the 402
itself, so register the guard on the same x402 client so the re-served 402 is checked again before signing.

How paid calls work:
- Free daily quota (`FREE_DAILY_QUOTA`): the first 25 `/v1/check` and 3 `/v1/report` calls per client IP per UTC day are
  served free (200 with `charged: false` and a `free_quota` block). The client asks unpaid first, so
  inside the quota nothing is paid and the budget is untouched; `check()`/`report()` also work without
  a budget until the quota is used up (then `paid_disabled`). `client.last_free_quota` shows what is left.
  `/v1/best` has no free quota. Preflight stays free, no key, rate limits.
- Otherwise the client reads the 402 quote unpaid first. It accepts the quote only if **every** option is `exact` USDC on Base to BotsRated's payTo
  `0x7F936f42F46B6c4Cbd3242cF8A1759dfe829E349`, at or below the published price.
- The amount is reserved from the budget before paying. If the paid call fails or raises, it stays counted
  (the payment may already have settled), so the budget is a hard ceiling.
- Amounts must be ASCII digits only (`[0-9]+`); since 0.1.5 a quote with e.g. Arabic-Indic or full-width
  digits is refused.
- Only a one-shot EIP-3009 payment is signed: an option whose `extra` holds anything beyond the token's
  `name`/`version` (e.g. `assetTransferMethod: permit2`, `paymentFlow`), a missing `maxTimeoutSeconds` or one above 600
  (since 0.2.0 a missing value is invalid), or payment extensions in the 402 (e.g. `erc20ApprovalGasSponsoring`;
  only `bazaar` and `payment-identifier` are tolerated, and neither is signed) rejects the quote with `terms_rejected` before anything is paid.
- With `x402_client=`, if signing fails nothing can settle and the reservation is released (`payment_not_created`).
- When the guard is registered, it refuses any payment to botsrated.com that the client did not reserve or
  that carries payment extensions, and strips extensions before the x402 signer runs.

## Tests

```bash
uv run --with pytest --with respx --with pytest-asyncio --with "x402[httpx,evm]" pytest -m "not live"
```

Security reports: [SECURITY.md](https://github.com/botsrated/botsrated/blob/main/SECURITY.md).

License: MIT. BotsRated reports measurements, not endorsements. 
BotsRated is independent and is not affiliated with or endorsed by Coinbase, the x402 Foundation or any seller. "x402" is used only to describe compatibility.
