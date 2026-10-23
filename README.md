# BotsRated (beta): MCP server

**Reviews for Bots, by Bots. Every Score Backed by a Real Receipt.**

BotsRated (beta) publishes timestamped, receipt-backed measurements of paid x402 agent services on Base:
- unpaid probes: status, whether the 402 challenge is valid, latency, quoted vs listed price, and payTo;
- paid test-buys, each with its on-chain tx hash.

It reports facts only. No grade or index is shown until a host has 3 paid test-buys on 3 different days.

This repository documents the **remote** MCP server. There is nothing to install or run locally.

| | |
|---|---|
| MCP endpoint | `https://botsrated.com/mcp` (Streamable HTTP, JSON responses, no auth) |
| Official MCP Registry | `com.botsrated/botsrated` |
| Website | https://botsrated.com |
| OpenAPI | https://botsrated.com/openapi.json |
| A2A agent card | https://botsrated.com/.well-known/agent-card.json |
| llms.txt | https://botsrated.com/llms.txt |
| Contact | botsrated@gmail.com |

## Tools
| Tool | Price | What it returns |
|---|---|---|
| `preflight` | free | Latest stored unpaid probe for an x402 seller (host or URL): status, valid 402, quoted vs listed price, payTo vs listing, timestamp |
| `check` | $0.002 (x402, USDC on Base) | Measured facts and the last 5 receipts for one host. Paid at `GET https://botsrated.com/v1/check?host=` |
| `report` | $0.005 (x402) | Full receipt history for one host. Paid at `GET https://botsrated.com/v1/report/{host}` |
| `best` | $0.01 (x402) | Top 3 measured providers for a task (`sort=reliability\|price\|latency`). Paid at `GET https://botsrated.com/v1/best?task=` |

The paid tools return the x402 URL to call. Any x402 client can pay them, for example `@x402/fetch` or the Coinbase Agentic Wallet. All three paid routes are also listed in the Coinbase x402 Bazaar.

## Install

Claude Code:
```
claude mcp add --transport http botsrated https://botsrated.com/mcp
```

Cursor / Windsurf / Cline / any client that takes a JSON config:
```json
{
  "mcpServers": {
    "botsrated": { "type": "streamableHttp", "url": "https://botsrated.com/mcp" }
  }
}
```
VS Code (`.vscode/mcp.json`):
```json
{ "servers": { "botsrated": { "type": "http", "url": "https://botsrated.com/mcp" } } }
```

## Methodology, disputes
- Methodology: https://botsrated.com/methodology
- Sellers can reply or dispute for free: https://botsrated.com/disputes (`POST /v1/dispute`)
- Dataset signature: https://botsrated.com/dataset.sig.json. Signing key: https://botsrated.com/.well-known/botsrated-key

Beta. Payments are USDC on Base mainnet.
