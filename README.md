# BotsRated (beta): MCP server

**Signed checks of paid AI services, before your agent pays.**

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
| `preflight` | free, unlimited | Latest stored unpaid probe for an x402 seller (host or URL): status, valid 402, quoted vs listed price, payTo vs listing, timestamp |
| `find` | free (uses 1 of the 100 free daily checks) | Top matching x402 sellers and remote MCP servers for a need (`q`, e.g. `weather`), each with a one-line factual reason and its page URL. Same filters as `best`, without the full ranking. HTTP: `GET https://botsrated.com/v1/find?q=` |
| `coverage` | free | How many x402 sellers and MCP servers are covered, from which sources, and when the last probe ran |
| `sample` | free | A real sample of a paid answer (`check`, `report` or `best`) for a fixed example |
| `history` | free | Signed daily aggregates for one host, newest first |
| `check` | $0.001 (x402, USDC on Base); first 100/day free | Measured facts and the last 5 receipts for one host. Paid at `GET https://botsrated.com/v1/check?host=` |
| `report` | $0.002 (x402); first 10/day free | Full receipt history for one host. Paid at `GET https://botsrated.com/v1/report/{host}` |
| `best` | $0.01 (x402) | Top 3 measured providers for a task (`sort=reliability\|price\|latency`). Paid at `GET https://botsrated.com/v1/best?task=` |

The paid tools return the x402 URL to call. Any x402 client can pay them, for example `@x402/fetch` or the Coinbase Agentic Wallet. All three paid routes are also listed in the Coinbase x402 Bazaar.

Free daily quota: the first 100 checks and 10 reports per client (IP address; IPv6 per /48) per UTC day are answered without payment; after that the normal x402 402 applies. No accounts, prepaid balances or stored credit. The badge is free and earned, never sold. Details: https://botsrated.com/pricing

## Free HTTP endpoints and pages

| | |
|---|---|
| `GET https://botsrated.com/v1/find?q=<need>` | Top matches for a need with a reason (uses 1 free daily check, shared with `/v1/check`) |
| `GET https://botsrated.com/v1/pulse` | Live totals (cached 60 s): services watched, working in the last 24 h, down or failed in 7 days, checks run in 7 days. Never names a seller |
| `GET https://botsrated.com/v1/savings-rates` | Measured rates (offline, payTo changes, price vs listing) with sample size, dates and source |
| https://botsrated.com/sellers | Browse and filter every covered seller and MCP server |
| `https://botsrated.com/s/<host>` | One page per seller or MCP server: status, 30-day chart, price, payTo, test purchases, receipts, alternatives |
| https://botsrated.com/savings | What we check for, with the rates we measured |
| https://botsrated.com/leaderboard | Data table of the top 300 covered x402 sellers |

## Plans (seller alerts and data plans)

One x402 USDC payment on Base buys one 30-day period. There is no balance, no auto-renewal and no refund held; cancelling stops delivery. The dataset stays free.

| Plan | Price per 30 days | What you get |
|---|---|---|
| `alerts-free` | free | 1 host; one signed webhook digest per UTC day when its facts change |
| `alerts-10` | $9 | Up to 10 hosts; a signed webhook within one probe cycle of a change (payTo, quoted price, valid 402, listing, freshness) |
| `alerts-50` | $29 | Up to 50 hosts; same events |
| `data-starter` | $49 | Bearer token for `/v1/check`, `/v1/report`, `/v1/best` without per-call payment (60 requests/min) |
| `data-pro` | $199 | Same, 600 requests/min |
| custom | from $499/month | Volume, SLA or bulk delivery: botsrated@gmail.com |

Subscribe with `POST https://botsrated.com/v1/alerts/subscribe` (free) or `POST https://botsrated.com/v1/subscribe/{plan}` (x402). The body and the webhook are checked before any 402. The webhook must answer the verification POST with the challenge; it must be https on a public DNS name, and redirects are not followed. Alerts are webhooks only, never email, signed with Ed25519 (`botsrated-prober-1`, see below) over `{"m":"<timestamp>.<raw body>"}`. Manage a subscription with `GET /v1/subscription` and `POST /v1/subscription/{cancel,update}` plus `Authorization: Bearer <token>`. Full details: https://botsrated.com/v1/plans

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

## Changelog
See [CHANGELOG.md](CHANGELOG.md).

## Security
Report security issues privately: see [SECURITY.md](SECURITY.md) (botsrated@gmail.com, subject "Security"). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).

## Methodology, disputes
- Methodology: https://botsrated.com/methodology
- Sellers can reply or dispute for free: https://botsrated.com/disputes (`POST /v1/dispute`)
- Dataset signature: https://botsrated.com/dataset.sig.json. Key set: https://botsrated.com/.well-known/botsrated-key
- Receipt format v0.2.1 (draft; `mcp_probe` receipts for remote MCP servers; v0.2.1 updates reference schedules and MCP retention) and verifier: [`spec/SPEC.md`](spec/SPEC.md), `node spec/verify.mjs <receipt.json|url>`

## Signing keys (Ed25519)
Raw 32-byte public keys, base64. Fingerprint = sha256 of the raw key bytes. A signature is valid for an object whose own timestamp
(`ts`, or `generated_at` for snapshots) lies in `[valid from, valid until)`. The live key set at `/.well-known/botsrated-key` is authoritative; this table is an out-of-band copy to compare against.

| key_id | Status | Valid from (UTC) | Valid until (UTC) | Signs | Public key | sha256 fingerprint |
|---|---|---|---|---|---|---|
| `botsrated-prod-1` | active | 2026-10-23T15:00:00Z | 2027-10-23T00:00:00Z | dataset snapshots, paid test-buy receipts | `oTK25Dq3wU2+apPYddiv4T+8is2s3hL1k6ozjMAbEWQ=` | `ac58fa77b9f6a26805efb65d331d6d77da3dfbdbbe981cc7510692852a50e74a` |
| `botsrated-prober-1` | active | 2026-10-23T12:00:00Z | (none) | cron probe receipts, daily aggregates, archive manifests | `G5aD8mz2rkbpLPQuEC2t50AaJpMjGcflTXuRmeJETsE=` | `805e75f8795ff38c4805653962ba75991fc8bdcaef3f80441e0775e405a3a628` |
| `botsrated-staging-1` | retired (verify only) | 2026-10-22T00:00:00Z | 2026-10-23T15:00:00Z | dataset snapshots generated before 2026-10-23T15:00:00Z | `OfGrLtyJYCC1K9jjhvq0Zduwgqq68DvzR1StOo5ZpO0=` | `71db9690ef765ce6b923d63fc71e1a65474e87ee1073532eafb9099b1e6f0288` |

Beta. Payments are USDC on Base mainnet.
