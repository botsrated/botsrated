# Installing the BotsRated MCP server (for AI agents such as Cline)

BotsRated is a **remote** MCP server. Do not clone, build, or run anything.

1. Add this entry to the MCP settings file (for Cline: `cline_mcp_settings.json`):
```json
{
  "mcpServers": {
    "botsrated": {
      "type": "streamableHttp",
      "url": "https://botsrated.com/mcp",
      "disabled": false,
      "autoApprove": ["preflight"]
    }
  }
}
```
2. No API key or environment variables are needed.
3. Verify it works: call the tool `preflight` with `{"url": "blockrun.ai"}`. It is free, no key, rate limits. You get a facts bundle: `found`, `host`, the latest unpaid probe (`status`, `valid_402`, `latency_ms`, `live_amount`, `live_payTo`, `live_network`), `freshness`, the directory `listing`, and `latest_probe.receipt_url` for the signed receipt. There is no score and no grade. You decide what to do with the facts.
4. The `check`, `report` and `best` tools are paid per call with x402 (USDC on Base: $0.001, $0.002, $0.01). An unpaid call returns an x402 v2 PaymentRequired tool error (`isError`, `structuredContent` with `accepts`) and charges nothing; an x402-aware MCP client (e.g. `@x402/mcp`) retries with the payment in `_meta["x402/payment"]`. Pay only if the user has an x402 wallet and has approved the spend. Over plain HTTP the first 25 checks and 3 reports per client IP per UTC day are free (`/v1/best` has no free quota).

## Framework payment hooks

These register a check on the x402 client the app already uses. They are not a second runtime.

- [LangChain](integrations/langchain/README.md) (`langchain-botsrated`)
- [LangGraph](integrations/langgraph/README.md) (`langgraph-botsrated`, not published): `attach_payment_guard` on your x402 client, plus an optional pre-pay node helper. Pairs with LangGraph. Not an orchestration framework.
- [Google ADK](integrations/google-adk/README.md) (`google-adk-botsrated`, not published): `attach_payment_guard` on your x402 client, plus an optional `before_tool_callback` for opaque paid tools. Pairs with Google ADK. Not an agent runtime.
- [CrewAI](integrations/crewai/README.md) (`crewai-botsrated`, not published): `attach_payment_guard` on your x402 client, plus an optional `PRE_TOOL_CALL` hook for named paid tools. Pairs with CrewAI. Not a crew runtime.
- [Llama Stack](integrations/llama-stack/README.md) (`llama-stack-botsrated`, not published): `attach_payment_guard` on your x402 client. Payment-client wrap only. A before-tool hook is deferred. Llama Stack stays the runtime.
- [Vercel AI SDK](integrations/vercel-ai-sdk/README.md) (`@botsrated/ai-sdk`, guard not published): `attachPaymentGuard` on your x402 client. Payment-client wrap only. A tool-level approval helper is deferred. The Vercel AI SDK stays the runtime.
- [Microsoft Agent Framework](integrations/microsoft-agent-framework/README.md) (`agent-framework-botsrated`; guard path not published): `attach_payment_guard` on your x402 client, plus the existing function middleware for named payment tools. Pairs with Microsoft Agent Framework. Not an agent or workflow runtime.
- [Pydantic AI](integrations/pydantic-ai/README.md) (`pydantic-ai-botsrated`, not published): `attach_payment_guard` on your x402 client, plus an optional `Hooks` capability for named paid tools. Pairs with Pydantic AI. Not an agent or graph runtime.
- [Mastra](integrations/mastra/README.md) (`@botsrated/mastra`, not published): `attachPaymentGuard` on your x402 client, plus an optional `hooks.beforeToolCall` for named paid tools. Pairs with Mastra. Not an agent, workflow, or tool runtime.

## Optional: your policy on BotsRated

This is what makes `BOTSRATED_TOKEN` work in framework attaches. The token is optional; with none, the guard stays advice-only. The client enforces. BotsRated holds no funds, signs nothing, and has no escrow.
TS: `createPaymentGuard({ preset: "carefulBuyer", remotePolicy: { token: process.env.BOTSRATED_TOKEN!, failMode: "open" } })`
Py: `PaymentGuard(preset="carefulBuyer", remote_policy={"token": os.environ["BOTSRATED_TOKEN"], "fail_mode": "open"})`
On HTTP 503, 404, or `decision: null`, `open` records info and `closed` stops the payment. A missing decision is not a pass.
