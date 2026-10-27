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
4. The `check`, `report` and `best` tools are paid per call with x402 (USDC on Base: $0.001, $0.002, $0.01). An unpaid call returns an x402 v2 PaymentRequired tool error and charges nothing; an x402-aware client retries with the payment in `_meta["x402/payment"]`. Pay only if the user has an x402 wallet and has approved the spend. Over plain HTTP the first 25 checks and 3 reports per client IP per UTC day are free (`/v1/best` has no free quota).
