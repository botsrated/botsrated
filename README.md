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
- Dataset signature: https://botsrated.com/dataset.sig.json. Key set: https://botsrated.com/.well-known/botsrated-key
- Receipt format and verifier: [`spec/SPEC.md`](spec/SPEC.md), `node spec/verify.mjs <receipt.json|url>`

## Signing keys (Ed25519)
Raw 32-byte public keys, base64. Fingerprint = sha256 of the raw key bytes. A signature is valid for an object whose own timestamp
(`ts`, or `generated_at` for snapshots) lies in `[valid from, valid until)`. The live key set at `/.well-known/botsrated-key` is authoritative; this table is an out-of-band copy to compare against.

| key_id | Status | Valid from (UTC) | Valid until (UTC) | Signs | Public key | sha256 fingerprint |
|---|---|---|---|---|---|---|
| `botsrated-prod-1` | active | 2026-10-23T15:00:00Z | 2027-10-23T00:00:00Z | dataset snapshots, paid test-buy receipts | `oTK25Dq3wU2+apPYddiv4T+8is2s3hL1k6ozjMAbEWQ=` | `ac58fa77b9f6a26805efb65d331d6d77da3dfbdbbe981cc7510692852a50e74a` |
| `botsrated-prober-1` | active | 2026-10-23T12:00:00Z | (none) | cron probe receipts, daily aggregates, archive manifests | `G5aD8mz2rkbpLPQuEC2t50AaJpMjGcflTXuRmeJETsE=` | `805e75f8795ff38c4805653962ba75991fc8bdcaef3f80441e0775e405a3a628` |
| `botsrated-staging-1` | retired (verify only) | 2026-10-22T00:00:00Z | 2026-10-23T15:00:00Z | dataset snapshots generated before 2026-10-23T15:00:00Z | `OfGrLtyJYCC1K9jjhvq0Zduwgqq68DvzR1StOo5ZpO0=` | `71db9690ef765ce6b923d63fc71e1a65474e87ee1073532eafb9099b1e6f0288` |

Beta. Payments are USDC on Base mainnet.
