# Submission copy

Draft text for catalog listings. Nothing in this file is submitted to an external catalog.

Guard is 0.3.2: [`@botsrated/x402-preflight`](https://www.npmjs.com/package/@botsrated/x402-preflight) on npm (published 10 November 2026, 1:30 PM CT) and [`botsrated`](https://pypi.org/project/botsrated/) on PyPI (published 10 November 2026, 1:19 PM CT). Free tier: 25 checks + 3 reports per IP per UTC day. The 3 free reports apply to HTTP `GET /v1/report/{host}` only. MCP `report` and `best` are paid from the first call. `check` is $0.01 (the first 25 per client IP per UTC day are free on the MCP `check` tool and on HTTP `GET /v1/check`, one shared quota). `report` is $0.002. `best` is $0.01 and has no free quota. `/v1/find` spends one check from the same daily quota. `preflight` stays free, no key, rate limits.

BotsRated measures paid AI-agent services with signed receipts. Paid BotPulse plans are retired; the feed stays free. These measurements do not claim coverage of every delivery outcome.

Results are measurements and signed receipts. Do not describe a seller as safe, trusted, verified, a scam, or risky.

A seller can send a reply about a measurement at https://botsrated.com/disputes. A measurement is a signed record, not a finding about the seller.

## MCP listing paragraph

BotsRated measures paid AI-agent services with signed receipts. The remote MCP server is `https://botsrated.com/mcp` (Streamable HTTP, no auth). It lists 12 tools. Free tools: `preflight` (free, no key, rate limits), `check_mcp_setup`, `watch_free`, `what_changed`, `find` (uses 1 of 25 free checks per client IP per UTC day), `coverage`, `sample`, `seller_self_check`, and `seller_announce`. Paid tools: `check` ($0.01; first 25 per client IP per UTC day free, shared with HTTP `GET /v1/check`), `report` ($0.002; paid on MCP from the first call; the first 3 reports per UTC day are free only on HTTP `GET /v1/report/{host}`), and `best` ($0.01, no free quota). Paid tools return an x402 payment request (USDC on Base). Paid BotPulse plans are retired; the feed stays free. These measurements do not claim coverage of every delivery outcome.

## Open listings outside this repository

These pull requests are not edited here. They still describe an older free quota ("first 100" free checks). The current free tier is 25 checks + 3 reports per IP per UTC day, with the report quota limited to HTTP `GET /v1/report` as above.

- https://github.com/toolsdk-ai/toolsdk-mcp-registry/pull/1034
- https://github.com/vercel/ai/pull/23894
- https://github.com/x402-foundation/x402/pull/3913

Current published package versions: `@botsrated/ai-sdk` 0.1.3 on npm (the repo `package.json` is 0.1.4, which is not on npm). `langchain-botsrated`, `llama-index-tools-botsrated`, and `agent-framework-botsrated` are 0.1.5 on PyPI. `botsrated-openai-agents`, `langgraph-botsrated`, `llama-stack-botsrated`, `google-adk-botsrated`, and `crewai-botsrated` are 0.1.1 on PyPI. `botsrated` and `@botsrated/x402-preflight` are 0.3.2. `pydantic-ai-botsrated` and `@botsrated/mastra` are not on a registry.
