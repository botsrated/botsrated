# Changelog

All notable changes to the packages in this repository. Each package has its own version; git tags are named
`<package>-v<version>` and each tag has a GitHub release.

## Unreleased

- `@botsrated/x402-preflight`: `mcpPaymentApprover` throws `invalid_host` when an `allowResourceHosts` entry contains
  `*` (wildcards were never supported; such an entry used to be compared as a literal host and never matched).
- `botsrated` (Python): `host_of` reads backslashes as forward slashes before parsing, as WHATWG URL parsers do, so it
  returns the same host as the TypeScript `hostOf` for inputs such as `https://evil.example\@good.example`.
- Repo: SECURITY.md, CONTRIBUTING.md, issue and pull request
  templates, this changelog.

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
