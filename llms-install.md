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
3. Verify it works: call the tool `preflight` with `{"url": "blockrun.ai"}`. It is free and returns the latest stored probe.
4. The `check`, `report` and `best` tools are paid per call with x402 (USDC on Base). They return the HTTPS URL to pay. Pay it only if the user has an x402 wallet and has approved the spend.
