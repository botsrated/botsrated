# BotsRated integrations (pre-payment checks for x402 buyers)

These are small client packages that check an x402 seller with BotsRated before an agent pays it. The free
preflight runs by default. The `/v1/check` ($0.001 USDC on Base after 25 free per UTC day) is opt-in and stays within a budget
the user sets.

**Status: published.** PyPI: [`botsrated`](https://pypi.org/project/botsrated/) (0.2.1),
[`langchain-botsrated`](https://pypi.org/project/langchain-botsrated/) (0.1.2),
[`llama-index-tools-botsrated`](https://pypi.org/project/llama-index-tools-botsrated/) (0.1.2),
[`agent-framework-botsrated`](https://pypi.org/project/agent-framework-botsrated/) (0.1.2).
npm: [`@botsrated/x402-preflight`](https://www.npmjs.com/package/@botsrated/x402-preflight) (0.2.1),
[`@botsrated/ai-sdk`](https://www.npmjs.com/package/@botsrated/ai-sdk) (0.1.2).
Checked against the registries on 2026-10-27. Production publishes use Trusted Publishing (OIDC) only.

Paid BotsRated lookups sign only a one-shot EIP-3009 USDC payment rebuilt from allowlisted quote fields
(`x402_client=` in Python, `paid: { x402Client }` in TypeScript). A quote asking for Permit2
(`extra.assetTransferMethod`), carrying payment extensions (e.g. `erc20ApprovalGasSponsoring`) or a
`maxTimeoutSeconds` above 600 is refused before anything is signed.

| Directory | Package | For |
|---|---|---|
| `x402-client/` | `@botsrated/x402-preflight` (npm) | payment guard (x402 hooks + `payment-identifier` retry key + read-only on-chain state), `@x402/core` `onBeforePaymentCreation` guard, `@x402/mcp` `onPaymentRequested` approver, client |
| `vercel-ai-sdk/` | `@botsrated/ai-sdk` (npm) | Vercel AI SDK `tool()`s |
| `python-core/` | `botsrated` (PyPI) | payment guard, client + guard + Python `x402` `on_before_payment_creation` hook |
| `langchain/` | `langchain-botsrated` (PyPI) | LangChain tools |
| [`langgraph/`](langgraph/) | `langgraph-botsrated` (not published) | LangGraph: `attach_payment_guard` on the caller's x402 client, plus an optional pre-pay node helper. Pairs with LangGraph; not a graph runtime. Omit `preset` for advice only |
| `llamaindex/` | `llama-index-tools-botsrated` (PyPI) | LlamaIndex `BotsRatedToolSpec` |
| `strands/` | guide (uses `botsrated` + the hosted MCP server) | Strands Agents: MCP tools and a pre-payment `@tool` |
| `haystack/` | guide (uses `botsrated` + the hosted MCP server via `mcp-haystack`) | Haystack Agents: `MCPToolset` and a pre-payment `@tool`, with live tests |
| `microsoft-agent-framework/` | `agent-framework-botsrated` (PyPI) | Microsoft Agent Framework (Python): `FunctionMiddleware` that checks a payment tool's payTo before it runs, a check tool, and the hosted MCP server |
| `fixtures/` | | real BotsRated responses used by the tests |

Upstream proposals:

- Coinbase AgentKit action provider: https://github.com/coinbase/agentkit/pull/1593
- CrewAI tools: https://github.com/crewAIInc/crewAI/pull/8464

Default guard policy:

- A payTo that BotsRated hasn't seen on the same network is blocked.
- A price above the observed price is flagged as a warning.
- An uncovered host or stale data is allowed.
- If BotsRated can't be reached, the guard allows the payment (fails open).

[`langgraph/`](langgraph/) follows the same `attach_payment_guard` rules as LangChain ([PR #14](https://github.com/botsrated/botsrated/pull/14)): omitting `preset` is advice only, and an unobserved payTo is blocked only when the caller selects `carefulBuyer` or `strict`.

Results are measurements, not endorsements. API spec: [`spec/SPEC.md`](../spec/SPEC.md).
