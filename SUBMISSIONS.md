# Submission copy

Draft text for catalog listings. Nothing in this file is submitted to an external catalog.

Checked 2026-10-27. Prices below are the ones already documented in this repository. Host counts are omitted here so a listing does not freeze a number that changes.

## Quota and payment

Free daily quota: **25 checks and 3 reports per client IP per UTC day**. After that, `check` is $0.001 and `report` is $0.002 (x402, USDC on Base). `best` is $0.01 and has no free quota. `/v1/find` spends one check from the same daily quota.

`preflight` and PaymentGuard hosted lookups stay **free, no key, rate limits**. They are not part of the 25/3 quota.

BotsRated measures paid AI-agent services with signed receipts. BotPulse is a separate digest and alerts product; these measurements do not claim coverage of every delivery outcome.

Results are measurements and signed receipts. Do not describe a seller as safe, trusted, verified, a scam, or risky.

A seller can send a reply about a measurement at https://botsrated.com/disputes. A measurement is a signed record, not a finding about the seller.

## MCP listing paragraph

BotsRated measures paid AI-agent services with signed receipts. The remote MCP server is `https://botsrated.com/mcp` (Streamable HTTP, no auth). Free tools: `preflight` (free, no key, rate limits), `find` (uses 1 of 25 free checks per client IP per UTC day), `coverage`, `sample`, and `history`. Paid tools `check` ($0.001, first 25 per client IP per UTC day free), `report` ($0.002, first 3 per client IP per UTC day free), and `best` ($0.01, no free quota) return an x402 payment request (USDC on Base). BotPulse is a separate digest and alerts product; these measurements do not claim coverage of every delivery outcome.

## Hermes

No Hermes draft was in this repository (no file, and no open pull request from this project whose title or body names Hermes). The MCP listing paragraph above is the corrected draft if a Hermes listing is prepared later. Do not submit it from this change.

The paragraph replaces any older Hermes (or other catalog) text that says the MCP server's paid `check` is "the first 100 a day free", that preflight is "free and unlimited" with no rate limit, or that the server is in beta.

## Open listings outside this repository

These pull requests are not edited here. Where they still say "first 100" free checks, the replacement clause is: "first 25 checks and 3 reports per client IP per UTC day are free; preflight stays free, no key, rate limits."

- https://github.com/toolsdk-ai/toolsdk-mcp-registry/pull/1034 says "first 100 a day free" for `check`.
- https://github.com/vercel/ai/pull/23894 says "first 100 per day free" and names `@botsrated/ai-sdk` 0.1.1. The published npm package is 0.1.3. The in-repo draft is `integrations/vercel-ai-sdk/TOOLS_REGISTRY_ENTRY.ts`.
- https://github.com/x402-foundation/x402/pull/3913 says "first 100/day free".

`@botsrated/ai-sdk` is 0.1.3 on npm. `langchain-botsrated`, `llama-index-tools-botsrated`, and `agent-framework-botsrated` are 0.1.4 in this release. `botsrated` and `@botsrated/x402-preflight` are 0.3.1 in this release. Do not tell a listing to install 0.1.1 of a framework package. Unpublished wedges (mastra, pydantic-ai, crewai, and the others marked not published) stay off the registries.
