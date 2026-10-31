# Changelog

All notable changes to the packages in this repository. Each package has its own version; git tags are named
`<package>-v<version>` and each tag has a GitHub release.

## Unreleased

- Docs: Agent-builds-agent Guard attach recipe in `llms-install.md` (section “When scaffolding x402 pay (coding agents)”), with the same words in `.cursor/rules/botsrated-guard-attach.mdc` and `docs/agent-skills/botsrated-guard-attach/SKILL.md`. OpenAI Agents, LangGraph, and Llama Stack stay `pip install` of the PyPI 0.1.1 packages. LangChain, LlamaIndex, and Microsoft Agent Framework stay PyPI 0.1.4. `@botsrated/ai-sdk` stays npm 0.1.3 (registry README may still say publishing soon). Google ADK and CrewAI (`google-adk-botsrated`, `crewai-botsrated`, PyPI 0.1.0) stay out of that primary list because their PyPI long_descriptions still say the packages are not on PyPI. No package version bump.
- Docs-truth 0.1.1: `botsrated-openai-agents`, `langgraph-botsrated`, and `llama-stack-botsrated` bump 0.1.0 → 0.1.1 so a republish refreshes the PyPI long_description. Install lines lead with `pip install <package>` and `attach_payment_guard`. Depends on `botsrated>=0.3.1,<0.4`. No guard behavior change. Google ADK, CrewAI, and pydantic-ai stay off PyPI. Publish is separate.
- Payment guard (`botsrated` and `@botsrated/x402-preflight`): hosted preflight and `POST /v1/policy/check` keep a 3 s default and clamp `timeout` / `timeoutMs` to 10 s. HTTP 503, HTTP 429, and a transport timeout read `Retry-After` (else 5 s, at most 60 s) and open an in-process circuit so later hosted lookups in that process skip until the wait ends. Those cases stay `botsrated_unreachable` / `remote_policy_unavailable` on the fail-open path. They are not a pass. The lookup still sends only the host name and does not fetch the seller. No package version bump; publish is separate.
- Docs: public install lines for `botsrated-openai-agents` name PyPI 0.1.0 (`pip install botsrated-openai-agents`, `attach_payment_guard`). Depends on `botsrated>=0.3.1,<0.4`. No package version bump in that pass. Google ADK, CrewAI, and pydantic-ai stay off PyPI.
- Docs: public plans copy lists alerts-free at $0 (1 seller, daily digest) and Pro at the standing prices ($19 / month by card, or alerts-50 at $29 / 30 days USDC, up to 50 sellers or tools on the same slots). Paid BotPulse is retired; the free feed stays. No package version bump.
- `langchain-botsrated` and `botsrated-openai-agents`: omit `token` and `attach_payment_guard` reads `BOTSRATED_TOKEN` (explicit `token` wins; empty means unset), matching the other wedges. All Python wedges pin `botsrated>=0.3.1,<0.4`. Not in `langchain-botsrated` 0.1.4 on PyPI. (#36)
- Maintenance: `@botsrated/x402-preflight` dev dependencies `@x402/core`, `@x402/evm`, `@x402/fetch` 2.28.0 -> 2.29.0, which moves them to zod 4.6.6+ and clears GHSA-mrhx-c7xc-m3w5 (high, zod < 4.6.6) from the dev tree. Test-only; the published package has no runtime dependencies. `npm audit` 0. No package version bump.
- Receipt check: `spec/verify.mjs` keeps an object `payment` (signed on `mcp_probe`) and still drops string `payment` hints. `spec/receipt-page.mjs` is the browser page for that same check (`signature valid` / `signature invalid` / `key unknown`). The pasted CLI URL is single-quoted and built only from a 20-hex id plus allowlisted `host`, `mcp`, `day`, and `s`. `verify.mjs` needs `verify-core.mjs` and `verify-node.mjs` beside it. The page is not on the live host until Pages returns it. `GET /v1/verify` is not mounted; `verifyResultJson` is the same result for a later free route. No package version bump.
- Docs: public install and status lines for `@botsrated/ai-sdk` name npm 0.1.3 (0.1.4 is not published). `langchain-botsrated` 0.1.4 copy names the published dependency `botsrated>=0.3.0,<0.4`.
- This release is README and version strings only (no guard behavior change): `botsrated` 0.3.1, `@botsrated/x402-preflight` 0.3.1, `@botsrated/ai-sdk` 0.1.3, `langchain-botsrated` 0.1.4, `llama-index-tools-botsrated` 0.1.4, `agent-framework-botsrated` 0.1.4. Each package Status line names that version. Pins stay `botsrated>=0.3.0,<0.4` and `@botsrated/x402-preflight` `^0.3.0`. Unpublished wedges stay not published.
- Docs: install lines for `langchain-botsrated`, `llama-index-tools-botsrated`, and `agent-framework-botsrated` name PyPI 0.1.3, which includes `attach_payment_guard`. No package version bump.
- Docs: registry install lines, shared `BOTSRATED_TOKEN` / `fail_mode` copy, and MAF no-preset `pay_to_invalid="block"` parity. No package version bump. Lockfiles were already on `@botsrated/x402-preflight` 0.3.0.
- `pydantic-ai-botsrated` (`integrations/pydantic-ai`, not published): `attach_payment_guard(x402_client, preset=..., fail_mode=..., token=...)` registers `PaymentGuard` on the caller's x402 client. Pairs with Pydantic AI; it is not an agent or graph runtime. Omit `preset` for advice only; `carefulBuyer` and `strict` block an unobserved payTo only when selected. `fail_mode` is `"open"` or `"closed"` (omit for fail-open). On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info; a missing decision is not a pass. A remote block stops the payment. A remote pass does not clear a local block. `token` / `BOTSRATED_TOKEN` is passed as `remote_policy={"token", "fail_mode"}` (botsrated>=0.3.0,<0.4 has `parse_remote_policy`); a bare token string is never passed. `botsrated_payment_hooks(guard, paid_tools={...})` returns a Pydantic AI `Hooks` capability (`pydantic-ai-slim` 2.x extra) that registers `before_tool_execute(tools=[...])` for named paid tools only. On a block it raises `ToolFailed` (or `SkipToolExecution` when `ToolFailed` is absent) and does not run the tool. It does not raise `ModelRetry`. Checked against the public types in pydantic-ai-slim 2.63.0. `botsrated_preflight` is free and does not attach a guard. The guard calls free preflight at https://botsrated.com. It does not sign payments or hold funds.
- `@botsrated/mastra` (`integrations/mastra`, not published): `attachPaymentGuard(x402Client, { preset?, failMode?, token? })` (alias `attach_payment_guard`) registers `createPaymentGuard` on the caller's x402 client. Pairs with Mastra. It is not an agent, workflow, or tool runtime. Omit `preset` for advice only; `carefulBuyer` and `strict` block an unobserved payTo only when selected. `failMode` is `"open"` or `"closed"` (omit for fail-open). On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info; a missing decision is not a pass. A remote block stops the payment. A remote pass does not clear a local block. `token` / `BOTSRATED_TOKEN` is passed as `remotePolicy: { token, failMode }` (`@botsrated/x402-preflight` `^0.3.0` exports `normalizeRemotePolicy`); a bare token string is never passed. `botsratedBeforeToolCall(guard, { paidTools, next? })` returns Mastra `ToolHooks` for named paid tools. On a block it returns `{ proceed: false, output: { blocked: true, reason } }` and the tool does not run. An unreadable payment context blocks. `botsratedPreflight` is free and does not attach a guard. The guard calls free preflight at https://botsrated.com. It does not sign payments or hold funds.
- `@botsrated/ai-sdk` (`integrations/vercel-ai-sdk`; 0.1.3 published on npm 2026-10-28): `attachPaymentGuard(x402Client, { preset?, failMode?, token? })` (alias `attach_payment_guard`) registers `createPaymentGuard` on the caller's x402 client. Pairs with the Vercel AI SDK. It is not a generation runtime. Omit `preset` for advice only; `carefulBuyer` and `strict` block an unobserved payTo only when selected. `failMode` is `"open"` or `"closed"` (omit for fail-open). On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info; a missing decision is not a pass. A remote block stops the payment. A remote pass does not clear a local block. `token` / `BOTSRATED_TOKEN` is passed as `remotePolicy: { token, failMode }` (`@botsrated/x402-preflight` `^0.3.0` exports `normalizeRemotePolicy`); a bare token string is never passed. A tool-level `needsApproval` helper is deferred: pinned AI SDK 7 deprecates it (a boolean asks the user; it does not deny). `botsratedPreflight`, `botsratedCheck`, and `botsratedTools` stay optional and do not attach a guard. The free preflight tool still reports `decision.action` `block` for an unobserved payTo (`payToMismatch: "block"`), because x402-preflight 0.2 defaults that rule to warn. No custody and no payment signing.
- `agent-framework-botsrated` (`integrations/microsoft-agent-framework`; 0.1.3 published on PyPI 2026-10-28): `attach_payment_guard(x402_client, preset=..., fail_mode=..., token=...)` registers `PaymentGuard` on the caller's x402 client. Pairs with Microsoft Agent Framework; it is not an agent or workflow runtime. Omit `preset` for advice only; `carefulBuyer` and `strict` block an unobserved payTo only when selected. `fail_mode` is `"open"` or `"closed"` (omit for fail-open). On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info; a missing decision is not a pass. A remote block stops the payment. A remote pass does not clear a local block. `token` / `BOTSRATED_TOKEN` is passed as `remote_policy={"token", "fail_mode"}` (botsrated>=0.3.0,<0.4 has `parse_remote_policy`); a bare token string is never passed. `BotsRatedPaymentMiddleware` accepts that same guard, or `preset` / `fail_mode` / `token`, and checks only named payment tools. On a block it raises `BotsRatedPaymentBlocked` when `on_block="raise"`, otherwise it returns the blocked result and does not run the tool. With no guard and no preset, fail_mode, or token, the middleware keeps its existing free-preflight guard and still blocks an unobserved payTo. Setting `fail_mode` or `token` without a `preset` keeps that payTo block and blocks an invalid payTo (`pay_to_invalid="block"`); it does not switch the default to advice-only, and `fail_mode` still defaults to open. `botsrated_check_payment_tool` is free and does not attach a guard. The guard calls free preflight at https://botsrated.com. It does not sign payments or hold funds.
- `llama-stack-botsrated` (`integrations/llama-stack`, not published): `attach_payment_guard(x402_client, preset=..., fail_mode=..., token=...)` registers `PaymentGuard` on the caller's x402 client. Pairs with Llama Stack as a payment-client wrap. Llama Stack stays the runtime, the distribution, and the inference server. A secondary before-tool hook is deferred: Llama Stack public docs have no stable user-facing before-tool API, and this package does not invent one. Omit `preset` for advice only; `carefulBuyer` and `strict` block an unobserved payTo only when selected. `fail_mode` is `"open"` or `"closed"` (omit for fail-open). On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info; a missing decision is not a pass. A remote block stops the payment. A remote pass does not clear a local block. `token` / `BOTSRATED_TOKEN` is passed as `remote_policy={"token", "fail_mode"}` (botsrated>=0.3.0,<0.4 has `parse_remote_policy`); a bare token string is never passed. `botsrated_preflight` is free, calls https://botsrated.com only, and does not attach a guard. No custody and no payment signing.
- `crewai-botsrated` (`integrations/crewai`, not published): `attach_payment_guard(x402_client, preset=..., fail_mode=..., token=...)` registers `PaymentGuard` on the caller's x402 client. Pairs with CrewAI; it is not a crew runtime. Omit `preset` for advice only; `carefulBuyer` and `strict` block an unobserved payTo only when selected. `fail_mode` is `"open"` or `"closed"` (omit for fail-open). On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info; a missing decision is not a pass. `token` / `BOTSRATED_TOKEN` is passed as `remote_policy={"token", "fail_mode"}` (botsrated>=0.3.0,<0.4 has `parse_remote_policy`); a bare token string is never passed. `register_botsrated_pre_tool_hook(guard, paid_tools={...})` registers CrewAI `PRE_TOOL_CALL` (`@on(InterceptionPoint.PRE_TOOL_CALL)`; legacy `@before_tool_call` when that API is absent) for named paid tools only. On a block it raises `HookAborted(reason=..., source="botsrated")` (legacy returns `False`) and does not run the tool. `botsrated_preflight` is free and does not attach a guard. The guard calls free preflight at https://botsrated.com. It does not sign payments or hold funds.
- `google-adk-botsrated` (`integrations/google-adk`, not published): `attach_payment_guard(x402_client, preset=..., fail_mode=..., token=...)` registers `PaymentGuard` on the caller's x402 client. Pairs with Google ADK; it is not an agent runtime. Omit `preset` for advice only; `carefulBuyer` and `strict` block an unobserved payTo only when selected. `fail_mode` is `"open"` or `"closed"` (omit for fail-open). On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info; a missing decision is not a pass. `token` / `BOTSRATED_TOKEN` is passed as `remote_policy={"token", "fail_mode"}` (botsrated>=0.3.0,<0.4 has `parse_remote_policy`); a bare token string is never passed. `botsrated_before_tool_callback` is an ADK `before_tool_callback` for named opaque paid tools and, on a block, returns only `botsrated_payment_reason` so the tool does not run. `botsrated_preflight` is free and does not attach a guard. The guard calls free preflight at https://botsrated.com. It does not sign payments or hold funds.
- `langgraph-botsrated` (`integrations/langgraph`, not published): `attach_payment_guard(x402_client, preset=..., fail_mode=..., token=...)` registers `PaymentGuard` on the caller's x402 client. Pairs with LangGraph; it is not a graph runtime. Omit `preset` for advice only; `carefulBuyer` and `strict` block an unobserved payTo only when selected. `fail_mode` is `"open"` or `"closed"` (omit for fail-open). On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info; a missing decision is not a pass. `token` / `BOTSRATED_TOKEN` is passed as `remote_policy={"token", "fail_mode"}` (botsrated>=0.3.0,<0.4 has `parse_remote_policy`); a bare token string is never passed. `botsrated_payment_middleware` runs that same guard before an opaque pay node and, on a block, returns only `botsrated_payment_reason`. `botsrated_preflight` is free and does not attach a guard. The guard calls free preflight at https://botsrated.com. It does not sign payments or hold funds.
- `botsrated-openai-agents` (`integrations/openai-agents`, not published): `attach_payment_guard(x402_client, preset=..., fail_mode=..., token=...)` registers `PaymentGuard` on the caller's x402 client. Pairs with the OpenAI Agents SDK; it does not replace `Agent` or `Runner`. Omit `preset` for advice only; `carefulBuyer` and `strict` block an unobserved payTo only when selected. `fail_mode` is `"open"` or `"closed"` (omit for fail-open). `token` / `BOTSRATED_TOKEN` is passed as `remote_policy` / `remotePolicy` (botsrated>=0.3.0,<0.4 has `parse_remote_policy`); `botsrated_preflight_tools()` returns free preflight tools and does not attach a guard. The guard calls free preflight at https://botsrated.com. It does not sign payments or hold funds.
- `langchain-botsrated` and `llama-index-tools-botsrated` (0.1.3 published on PyPI 2026-10-28), and `botsrated-openai-agents` (not published): with `remote_policy` in `PaymentGuard`, `attach_payment_guard(token=...)` passes `{"token": token, "fail_mode": fail_mode or "open"}`, not the bare token.
- `llama-index-tools-botsrated` (0.1.3 published on PyPI 2026-10-28): `attach_payment_guard(x402_client, preset=..., token=..., fail_mode=...)` registers `PaymentGuard` on an x402 client. `BotsRatedToolSpec()` stays free preflight only and does not attach a guard. Omit `preset` for advice only; `fail_mode` is `"open"` or `"closed"` and is omitted by default (fail-open). `token` is passed as `remote_policy` / `remotePolicy` only when `parse_remote_policy` is present; a configured token on an install without it raises and is not dropped.
- `langchain-botsrated` (0.1.3 published on PyPI 2026-10-28): `attach_payment_guard(x402_client, preset=..., token=..., fail_mode=...)` registers `PaymentGuard` on an x402 client. `botsrated_tools()` stays free preflight only and does not attach a guard. Omit `preset` for advice only; `fail_mode` is `"open"` or `"closed"` and is omitted by default (fail-open). `token` is passed as `remote_policy` / `remotePolicy` only when `parse_remote_policy` is present; a configured token on an install without it raises and is not dropped.
- Published on the registries: `@botsrated/ai-sdk` 0.1.3, `langchain-botsrated` 0.1.3, `llama-index-tools-botsrated` 0.1.3, and `agent-framework-botsrated` 0.1.3. `attach_payment_guard` is in those 0.1.3 releases. Other wedges stay off the registries. Dependency range is `botsrated>=0.3.0,<0.4` and `@botsrated/x402-preflight` `^0.3.0`.
- A configured `token` / `BOTSRATED_TOKEN` on an install with no `parse_remote_policy` (Python) or `normalizeRemotePolicy` (TypeScript) raises. The token is not dropped.
- Public copy: preflight is described as free, no key, rate limits (it stays free), including client tool text. Free daily quota wording is 25 checks and 3 reports per client IP per UTC day. BotPulse is named as a separate digest and alerts product. No package version bump.
- Payment guard 0.2.1 is on npm (`@botsrated/x402-preflight`, 2026-10-27) and PyPI (`botsrated`, 2026-10-27). Named presets are under 0.2.1 below. `0.2.0` is also on both registries (2026-10-25).
- Public docs and `FREE_DAILY_QUOTA`: 25 checks and 3 reports per client IP per UTC day. Prices unchanged ($0.001 check, $0.002 report, $0.01 best). Preflight stays free, no key, rate limits. The payment guard still asks unpaid first and does not enforce the quota itself. No package version bump.

- Dev tooling (no package release): vitest 3.2 -> 4.1.12 in `integrations/x402-client` and `integrations/vercel-ai-sdk`
  (GHSA-5gmw-xhrv-c9v3 tinypool, GHSA-82fw-gwwq-j7x9 / GHSA-qxg6-89mg-rqv8 vitest; test-only, not in the published
  packages); viem dev dependency 2.57.11.
- Release drafts, after Security's review of PR #4 (F-1, F-2, F-4):
  - The approval summary's "changes since the last release" now starts at the commit of the last version actually
    published on the registry (npm `gitHead`, or its provenance commit; for PyPI the tag of PyPI's latest version),
    not the newest `<package>-v*` tag, which anyone with Write could plant. Tags whose version isn't on the
    registry, or that don't point at the registry's commit, are shown as a WARNING; if the base can't be
    determined, the summary says so loudly and starts at the first commit. New self-test
    `integrations/release-tools/test-release-summary.sh` (fake npm and PyPI, no network).
  - Commit subjects, authors and file names in the summary are HTML-escaped inside `<pre>` blocks, so they can't
    render Markdown or break out of the block with ``` or `</pre>`.
  - `docs/drafts/README.md` describes the separate `botsrated-bot` account and the main ruleset now in place.
- Release drafts, after Security's review of the phone gate:
  - Before approval, the run's Summary shows "What you are approving": who started it, the commit, a compare link
    and commit list since the last `<package>-v*` tag (or the first commit), and the sha256 of every file to be
    published. The publish job re-checks those checksums (new `integrations/release-tools/release-summary.sh`).
  - npm dry runs no longer use the `npm-publish` environment (no approval, no id-token, no `--provenance`).
  - `docs/drafts/README.md` no longer overstates 2FA: it's checked at sign-in, and an API approval with a token
    needs none. The setup is described for both a shared and a separate bot account, with admin bypass and the
    "Allow GitHub Actions to create and approve pull requests" setting.
- Release drafts: the release gate no longer needs signed tags. A run is a manual `workflow_dispatch` from main
  whose `version` input must match the package manifest. Everything is built from the run's exact commit, and
  publishing waits for the required reviewer's approval in the `npm-publish` / `pypi-publish` environment. After a successful
  publish, CI creates the `<package>-v<version>` tag itself. `verify-tag.sh` stays as an optional check. See
  `docs/drafts/README.md`.
- Release drafts (no package release; `docs/drafts/`, not installed): tag signatures are verified only against
  pinned keys (fresh GNUPGHOME, fingerprint allowlist `integrations/release-tools/signers.txt`, self-test
  `test-verify-tag.sh`); the published npm tarball is built with `npm ci --ignore-scripts` and must match the tested
  build byte for byte; the npm CLI is installed only from a checksum-verified tarball.
- Repo: SECURITY.md, CONTRIBUTING.md, issue and pull request
  templates, this changelog.

## 0.3.1 (both packages)

`botsrated` 0.3.1 on PyPI and `@botsrated/x402-preflight` 0.3.1 on npm. README Status and install lines name 0.3.1. User-Agent version strings match the package version. No guard behavior change.

## 0.3.0 (both packages) - 2026-10-28

Published 2026-10-28: `botsrated` 0.3.0 on PyPI, `@botsrated/x402-preflight` 0.3.0 on npm.

- Payment guard (Python `botsrated` and `@botsrated/x402-preflight`): optional `remote_policy` / `remotePolicy` calls `POST /v1/policy/check` with the seller host and quote before paying, and merges that answer with local rules (a remote block stops the payment). On HTTP 503, 404, or `decision: null`, the customer `fail_mode` / `failMode` applies (`open` records an info reason; `closed` stops the payment). A missing decision is not turned into a pass. `decided_by` and `not_a_botsrated_rating` are kept when the server sends them. The last `policy_version` is remembered. The policy decision is not signed. Unset, local presets are unchanged. Same option on `PrePaymentGuard` / `createPrePaymentGuard`.
- Framework attaches that check for `remote_policy` / `remotePolicy` now send `BOTSRATED_TOKEN`.

## 0.2.1 (both packages; published)

`@botsrated/x402-preflight` 0.2.1 and `botsrated` 0.2.1 add named payment-guard presets on top of the 0.2.0
guard. Published on npm and PyPI on 2026-10-27.

Added (both):
- `policies.carefulBuyer` / `POLICIES["carefulBuyer"]`: alias of `strict`. Stops a payment when the payTo wasn't
  observed, is invalid, the 402 names another host, or the URL being paid is unknown. A price above the last observed
  amount still warns. An uncovered or stale host stays informational.
- `presets["dry-run-only"]` / `PRESETS["dry-run-only"]` and `dryRunOnly()` / `dry_run_only()`: dry-run advice. Logs
  `wouldBlock` / `would_block` and never stops a payment. `preset: "dry-run-only"` / `preset="dry-run-only"` forces
  dry-run. No new rule axis.
- Docs: pick a named preset, optionally dry-run. Decisions and `preflight` return facts and receipt links. No score
  and no grade. The zero-config default stays `policies.warn` / `POLICIES["warn"]`.

## 0.2.0 (both packages; published)

`@botsrated/x402-preflight` 0.2.0 and `botsrated` 0.2.0 add the **payment guard** and change existing decision
logic. Published on npm and PyPI on 2026-10-25. Read the items marked **Decision logic** before upgrading.

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

### 0.1.4
- This release. README Status names 0.1.4 and includes `attach_payment_guard`. Requires `botsrated>=0.3.0,<0.4`. No guard behavior change from 0.1.3.

### 0.1.3
- Published on PyPI on 2026-10-28. Requires `botsrated>=0.3.0,<0.4`. The earlier draft pin `botsrated>=0.1.6,<0.3` is not this release's pin.
- Keeps blocking a payTo BotsRated's probes never recorded, with any supported botsrated version: the package now
  passes `GuardPolicy(pay_to_mismatch="block")` explicitly, because botsrated 0.2 made that advice-only by default.
  The reason code is `payto_not_observed` with botsrated 0.2 (`payto_mismatch` with 0.1.x).

### 0.1.2
- Depends on `botsrated>=0.1.5,<0.2`. Docstrings point to `x402_client=`.

### 0.1.1
- Depends on `botsrated>=0.1.4` (paid lookups sign only a rebuilt quote).

### 0.1.0
- First release: preflight and check tools.

## llama-index-tools-botsrated (PyPI)

### 0.1.4
- This release. README Status names 0.1.4 and includes `attach_payment_guard`. Requires `botsrated>=0.3.0,<0.4`. No guard behavior change from 0.1.3.

### 0.1.3
- Published on PyPI on 2026-10-28. Requires `botsrated>=0.3.0,<0.4`. The earlier draft pin `botsrated>=0.1.6,<0.3` is not this release's pin.
- Keeps blocking a payTo BotsRated's probes never recorded, with any supported botsrated version: the package now
  passes `GuardPolicy(pay_to_mismatch="block")` explicitly, because botsrated 0.2 made that advice-only by default.
  The reason code is `payto_not_observed` with botsrated 0.2 (`payto_mismatch` with 0.1.x).
- `attach_payment_guard(x402_client, preset=..., token=..., fail_mode=...)` registers `PaymentGuard` on the
  caller's x402 client. `BotsRatedToolSpec()` does not attach a guard.

### 0.1.2
- Depends on `botsrated>=0.1.5,<0.2`. Docstrings point to `x402_client=`.

### 0.1.1
- Depends on `botsrated>=0.1.4` (paid lookups sign only a rebuilt quote).

### 0.1.0
- First release: `BotsRatedToolSpec`.

## agent-framework-botsrated (PyPI)

### 0.1.4
- This release. README Status names 0.1.4 and includes the middleware, the check tool, and `attach_payment_guard`. Requires `botsrated>=0.3.0,<0.4`. No guard behavior change from 0.1.3.

### 0.1.3
- Published on PyPI on 2026-10-28. Requires `botsrated>=0.3.0,<0.4`. The earlier draft pin `botsrated>=0.1.6,<0.3` is not this release's pin.
- Keeps blocking a payTo BotsRated's probes never recorded, with any supported botsrated version: the package now
  passes `GuardPolicy(pay_to_mismatch="block")` explicitly, because botsrated 0.2 made that advice-only by default.
  The reason code is `payto_not_observed` with botsrated 0.2 (`payto_mismatch` with 0.1.x).

### 0.1.2
- `__version__` comes from the installed package metadata.

### 0.1.1
- Depends on `botsrated>=0.1.5,<0.2`. The middleware's amount check accepts ASCII digits only.

### 0.1.0
- First release: `BotsRatedPaymentMiddleware` (a `FunctionMiddleware` pre-payment check), a check tool and the
  hosted MCP server helper.

## botsrated-openai-agents (PyPI)

### 0.1.1
- README long_description refresh. Status names 0.1.1 and `pip install botsrated-openai-agents` with `attach_payment_guard`. Depends on `botsrated>=0.3.1,<0.4`. No guard behavior change from 0.1.0. PyPI 0.1.0 still carried the pre-publish "not on PyPI" description.

### 0.1.0
- First published release. `attach_payment_guard` on the caller's x402 client. Pairs with the OpenAI Agents SDK; does not replace `Agent` or `Runner`.

## langgraph-botsrated (PyPI)

### 0.1.1
- README long_description refresh. Status names 0.1.1 and `pip install langgraph-botsrated` with `attach_payment_guard`. Depends on `botsrated>=0.3.1,<0.4`. No guard behavior change from 0.1.0. PyPI 0.1.0 still said the package was not on PyPI.

### 0.1.0
- First published release. Payment-client wrap plus an optional pre-pay node helper. Not a graph runtime.

## llama-stack-botsrated (PyPI)

### 0.1.1
- README long_description refresh. Status names 0.1.1 and `pip install llama-stack-botsrated` with `attach_payment_guard`. Depends on `botsrated>=0.3.1,<0.4`. No guard behavior change from 0.1.0. PyPI 0.1.0 still said the package was not on PyPI. Payment-client wrap only; a before-tool hook stays deferred.

### 0.1.0
- First published release. Payment-client wrap. Llama Stack stays the runtime, the distribution, and the inference server.

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

### 0.1.4
- Not published on npm (waits the npm trusted publisher). README Status names the live package, 0.1.3, which includes `attachPaymentGuard`. Depends on `@botsrated/x402-preflight` `^0.3.0`. No guard behavior change from 0.1.3.

### 0.1.3
- Published on npm on 2026-10-28. `attachPaymentGuard` registers `createPaymentGuard` on the caller's x402 client. Depends on `@botsrated/x402-preflight` `^0.3.0`. Omit `preset` for advice only. Omit `failMode` to stay open. `token` / `BOTSRATED_TOKEN` is sent as `remotePolicy`. A configured token without `normalizeRemotePolicy` raises and is not dropped. The policy decision is not signed.

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
