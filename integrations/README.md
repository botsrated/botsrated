# BotsRated integrations (pre-payment checks for x402 buyers)

These are small client packages that check an x402 seller with BotsRated before an agent pays it. The free
preflight runs by default. The `/v1/check` ($0.001 USDC on Base after 100 free per day) is opt-in and stays within a budget
the user sets.

**Status: the Python packages are published on PyPI (0.1.0):
[`botsrated`](https://pypi.org/project/botsrated/) (0.1.2),
[`langchain-botsrated`](https://pypi.org/project/langchain-botsrated/),
[`llama-index-tools-botsrated`](https://pypi.org/project/llama-index-tools-botsrated/).
The npm packages are published on npm (0.1.0):
[`@botsrated/x402-preflight`](https://www.npmjs.com/package/@botsrated/x402-preflight),
[`@botsrated/ai-sdk`](https://www.npmjs.com/package/@botsrated/ai-sdk).**

| Directory | Package | For |
|---|---|---|
| `x402-client/` | `@botsrated/x402-preflight` (npm) | `@x402/core` `onBeforePaymentCreation` guard, `@x402/mcp` `onPaymentRequested` approver, client |
| `vercel-ai-sdk/` | `@botsrated/ai-sdk` (npm) | Vercel AI SDK `tool()`s |
| `python-core/` | `botsrated` (PyPI) | client + guard + Python `x402` `on_before_payment_creation` hook |
| `langchain/` | `langchain-botsrated` (PyPI) | LangChain tools |
| `llamaindex/` | `llama-index-tools-botsrated` (PyPI) | LlamaIndex `BotsRatedToolSpec` |
| `strands/` | guide (uses `botsrated` + the hosted MCP server) | Strands Agents: MCP tools and a pre-payment `@tool` |
| `haystack/` | guide (uses `botsrated` + the hosted MCP server via `mcp-haystack`) | Haystack Agents: `MCPToolset` and a pre-payment `@tool`, with live tests |
| `fixtures/` | | real BotsRated responses used by the tests |

Upstream proposals:

- Coinbase AgentKit action provider: https://github.com/coinbase/agentkit/pull/1593
- CrewAI tools: https://github.com/crewAIInc/crewAI/pull/8464

Default guard policy:

- A payTo that BotsRated hasn't seen on the same network is blocked.
- A price above the observed price is flagged as a warning.
- An uncovered host or stale data is allowed.
- If BotsRated can't be reached, the guard allows the payment (fails open).

Results are measurements, not endorsements. API spec: [`spec/SPEC.md`](../spec/SPEC.md).
