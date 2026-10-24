# Changelog

All notable changes to the packages in this repository. Each package has its own version; git tags are named
`<package>-v<version>` and each tag has a GitHub release.

## Unreleased

- Dev tooling (no package release): vitest 3.2 -> 4.1.12 in `integrations/x402-client` and `integrations/vercel-ai-sdk`
  (GHSA-5gmw-xhrv-c9v3 tinypool, GHSA-82fw-gwwq-j7x9 / GHSA-qxg6-89mg-rqv8 vitest; test-only, not in the published
  packages); viem dev dependency 2.57.11.
- Release drafts (no package release; `docs/drafts/`, not installed): tag signatures are verified only against
  pinned keys (fresh GNUPGHOME, fingerprint allowlist `integrations/release-tools/signers.txt`, self-test
  `test-verify-tag.sh`); the published npm tarball is built with `npm ci --ignore-scripts` and must match the tested
  build byte for byte; the npm CLI is installed only from a checksum-verified tarball.
- Repo: SECURITY.md, CONTRIBUTING.md, issue and pull request
  templates, this changelog.

## 0.2.0 (both packages; prepared, not released)

`@botsrated/x402-preflight` 0.2.0 and `botsrated` 0.2.0 add the **payment guard** and change existing decision
logic. Read the items marked **Decision logic** before upgrading.

Why: agents that resend a payment after an ambiguous error can pay twice (AgentKit
[#1547](https://github.com/coinbase/agentkit/issues/1547) measured it; [#1483](https://github.com/coinbase/agentkit/issues/1483)
describes a possible case from a code read; LangChain [#40688](https://github.com/langchain-ai/langchain/issues/40688)
shows a tool retried three times). The guard lowers that risk; it can't rule it out.

Added (both):
- Payment guard (`createPaymentGuard` / `PaymentGuard`), advice-only by default (`policies.warn` /
  `POLICIES["warn"]`); payments are stopped only by a policy you choose (`policies.strict`). `dryRun` / `dry_run` is
  the recommended first setting. `hosted: false` / `hosted=False` sends nothing to botsrated.com.
- `payment-identifier` retry key (`pay_` + 128 random bits), added through x402's extension mechanism only when the
  seller's 402 advertises the extension (about 2.2%: 81 of 3,739 seller hosts in our probe database, Oct 24, 2026;
  6 required it). Never reused across sellers, payTo addresses or routes.
- Read-only on-chain payment state with three answers: `settled` (two RPCs on different hosts, `safe` tag, chain id
  8453, pinned USDC, exact receipt), `unknown` (`payment_state_unknown`, never retried) and `expired_unsettled`
  (only when the block read on both RPCs, `safe` by default, has a timestamp at or after `validBefore` + margin;
  otherwise `unknown` with reason `chain_not_past_expiry`). Settings: `marginSeconds` / `margin_seconds` (default
  60, minimum 30), `expiryTag` / `expiry_tag` (`"safe"` or `"finalized"`). The state is read at the exact block
  number whose timestamp was checked. Default RPCs: `https://mainnet.base.org`, `https://base-rpc.publicnode.com`
  (configurable; both must agree). Optional third RPC of your own (`extraRpc` / `extra_rpc`, or three `rpcs`):
  2 of 3 must answer and agree, and any RPC reporting the authorization used rules out `expired_unsettled`.
- Payment guard rule `paidUrlUnknown` / `paid_url_unknown` (reason `paid_url_unknown`): warn by default, **block** in
  `policies.strict` / `POLICIES["strict"]`, when the URL being paid is unknown (no `wrapFetch` / `guard.request`).
  The "payment to BotsRated" note applies only when the real request host is botsrated.com, never because of the
  402's own `resource.url`.
- CI tests that the guard can't sign, send or resend a payment (`test/c1-no-repay.test.ts`,
  `tests/test_c1_no_repay.py`), never sends a path or query, and never uses judgment words in its messages. The source scan also forbids dynamic module loaders
  (`createRequire`, `require(`, `getBuiltinModule` other than the one `node:async_hooks` call).
- Every decision has a `disputeUrl` / `dispute_url` (https://botsrated.com/disputes); messages state facts only.
- `User-Agent: botsrated-x402-preflight/<version>` / `botsrated-python/<version>`.
- READMEs: hosted lookups stay on by default and send only the seller's host name (`hosted: false` / `hosted=False`
  turns them off); a privacy note on on-chain checks (the RPC operators, Coinbase for `mainnet.base.org` and Allnodes
  for `base-rpc.publicnode.com`, see the payer address, nonce and IP; bring your own RPCs); a warning that another
  hook returning `recovered` (yours or another library's) makes x402 pay again.

Changed:
- **Decision logic:** the legacy `strictGuardPolicy` / `STRICT_GUARD_POLICY` now also sets `requireRequestUrl` /
  `require_request_url`, so it stops a payment whose real request URL is unknown (`no_request_url`). Use
  `guard.wrapFetch` / `guard.forRequest(url)` (TS) or `wrap_get` / `x402_hook_for(url)` (Python) with it.
- On-chain checks: more than 3 RPCs (`rpcs` plus `extraRpc` / `extra_rpc`) is now a configuration error
  (`RangeError` / `ValueError`) when the guard is created or `checkPaymentState` / `check_payment_state` runs, instead
  of the extra RPCs being dropped silently.
- On-chain checks: `marginSeconds` / `margin_seconds` is clamped to 30 s .. 1 day; infinity no longer raises in
  Python (`OverflowError`) or falls back to 60 in TS; NaN or a non-number uses 60. A Python string margin such as
  `"90"` now uses 60, as in TS.
- Docs: custom policies leave `paidUrlUnknown` / `paid_url_unknown` at warn unless set.
- Payment guard: the default hosted lookup timeout is 3 s (`timeoutMs: 3000` / `timeout=3.0`); it was 1.5 s in
  the 0.2.0 drafts. A slow or unreachable BotsRated still fails open.
- **Decision logic:** the pre-payment guard's default for a payTo BotsRated's probes did not record is now **warn**
  (was block). Use `strictGuardPolicy` / `STRICT_GUARD_POLICY` (or `payToMismatch: "block"`) to keep the old
  behavior.
- **Decision logic:** reason codes renamed to fact-only names: `payto_not_observed`, `payto_invalid`,
  `network_not_observed`, `data_stale`, `botsrated_unreachable`, `hook_error`, `invalid_resource_url`.
- **Decision logic:** a malformed `resource.url` or an internal error no longer throws; it follows `failOpen` /
  `fail_open` (`invalid_resource_url`, `hook_error`).
- **Decision logic:** BotsRated's own paid quotes without `maxTimeoutSeconds` are now refused (`terms_rejected`); the
  `payment-identifier` extension on them is tolerated (never signed).
- Preflight requests send only the host name (`?url=<host>`), never the path or query.
- Seller-supplied text in errors and decisions is stripped of control characters and capped; payment headers are
  capped at 16 KB.
- `@botsrated/x402-preflight`: zero runtime dependencies, requires Node 20+, new subpath exports
  `./payment-guard` and `./onchain`; `dist/` is built on `npm test` and `npm pack`.
- `botsrated`: dependency ranges have upper bounds (`httpx>=0.27,<1`, `x402[httpx,evm]>=2.25,<3`).
- `botsrated`: `import botsrated` and `from botsrated import PaymentGuard` no longer load `botsrated.client` (the
  signing client); `BotsRatedClient` and the legacy guard load on first use. Public names are unchanged.
- `@botsrated/x402-preflight`: `_resetChainCache` (a test helper) is no longer exported from `./onchain` or the
  package root.
- `best()` without paid lookups no longer mentions a free daily quota (`/v1/best` has none); the Python message names
  `x402_client`.
- When no BotsRated lookup happened, the decision message says no seller facts were checked.
- `@botsrated/x402-preflight`: `mcpPaymentApprover` throws `invalid_host` when an `allowResourceHosts` entry contains
  `*` (wildcards were never supported; such an entry used to be compared as a literal host and never matched).
- `botsrated` (Python): `host_of` reads backslashes as forward slashes before parsing, as WHATWG URL parsers do, so it
  returns the same host as the TypeScript `hostOf` for inputs such as `https://evil.example\@good.example`.

## botsrated (PyPI)

### 0.1.6
- Host checks normalize IDNA (punycode), case and trailing dots.
- The request-URL check tolerates an apex <-> www redirect (`example.com` vs `www.example.com`); any other host is
  still blocked.

### 0.1.5
- The pre-payment guard can take the URL actually being requested and paid (`guard.wrap_get`, `paying_request`,
  `x402_hook_for`, or `decide(..., request_url=...)`). It looks up that host and blocks with `resource_url_mismatch`
  (even when failing open) if the seller's 402 `resource.url` names another host.
  `GuardPolicy(require_request_url=True)` blocks hook payments with no known request URL.
- Payment amounts must be ASCII digits (`[0-9]+`).
- Ships `py.typed`. Fixed a mypy error in the paid call.

### 0.1.4
- Paid BotsRated lookups sign only a quote rebuilt from allowlisted fields (one EIP-3009 USDC payment on Base to
  BotsRated's payTo at the published price).

### 0.1.3
- Paid BotsRated calls refuse Permit2 / approval quotes and payment extensions.

### 0.1.2
- A paid attempt never refunds the budget, even when the answer came from the free quota.

### 0.1.1
- Fail closed on paid-route quotes; failed paid calls stay counted against the budget; a listing's payTo never
  counts as confirmation.

### 0.1.0
- First release: free preflight, paid check / report / best through any x402 client, pre-payment guard.

## langchain-botsrated (PyPI)

### 0.1.2
- Depends on `botsrated>=0.1.5,<0.2`. Docstrings point to `x402_client=`.

### 0.1.1
- Depends on `botsrated>=0.1.4` (paid lookups sign only a rebuilt quote).

### 0.1.0
- First release: preflight and check tools.

## llama-index-tools-botsrated (PyPI)

### 0.1.2
- Depends on `botsrated>=0.1.5,<0.2`. Docstrings point to `x402_client=`.

### 0.1.1
- Depends on `botsrated>=0.1.4` (paid lookups sign only a rebuilt quote).

### 0.1.0
- First release: `BotsRatedToolSpec`.

## agent-framework-botsrated (PyPI)

### 0.1.2
- `__version__` comes from the installed package metadata.

### 0.1.1
- Depends on `botsrated>=0.1.5,<0.2`. The middleware's amount check accepts ASCII digits only.

### 0.1.0
- First release: `BotsRatedPaymentMiddleware` (a `FunctionMiddleware` pre-payment check), a check tool and the
  hosted MCP server helper.

## @botsrated/x402-preflight (npm)

### 0.1.4
- `mcpPaymentApprover(guard, serverUrl, { allowResourceHosts, resourceUrlMismatch: "block" | "warn", onDecision })`,
  strict by default.
- `resource.url` is parsed with `new URL(url.trim())` and a protocol check, so `"  https://evil"` or `"https:evil"`
  cannot skip the host comparison.
- Without AsyncLocalStorage, `currentRequestUrl()` is undefined while more than one paid request is in flight
  (blocked with `requireRequestUrl`).
- `hostOf` drops trailing dots and parses `https:host`. The request-URL check tolerates an apex <-> www redirect.

### 0.1.3
- The guard can take the URL being requested and paid (`guard.wrapFetch`, `payingRequest`, `guard.forRequest`) and
  blocks with `resource_url_mismatch` if the 402 `resource.url` names another host. `policy.requireRequestUrl`.
  `mcpPaymentApprover` looks up the server URL and refuses a `resource.url` on another host.

### 0.1.2
- Paid lookups sign only a quote rebuilt from allowlisted fields.

### 0.1.1
- Paid BotsRated calls refuse Permit2 / approval quotes and payment extensions.

### 0.1.0
- First release: `createPrePaymentGuard` for `@x402/fetch` / `@x402/core`, `mcpPaymentApprover` for `@x402/mcp`,
  and a client.

## @botsrated/ai-sdk (npm)

### 0.1.2
- `botsratedTools()` is typed as `ToolSet`. Paid lookups go through `@botsrated/x402-preflight` 0.1.2 or later.

### 0.1.1
- Examples use `stepCountIs` (AI SDK 5/6/7).

### 0.1.0
- First release: Vercel AI SDK tools for preflight and check.

## Receipt Format (spec/)

- v0.2.1 (draft): updated probe schedules and MCP receipt retention.
- v0.2 (draft): `mcp_probe` receipts for remote MCP servers.
- v0.1 (draft): first version, with published signing keys.
