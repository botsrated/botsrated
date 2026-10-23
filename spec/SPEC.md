# BotsRated Receipt & Rating Format v0.2.1 (Draft)

| | |
|---|---|
| Status | Draft for comment (v0.2: adds the `mcp_probe` receipt for remote MCP servers, §3.4; v0.2.1: reference schedules, MCP retention and receipt URLs, §3.4 and §5; no format change). Not stable: fields may still change before 1.0 (see §11). |
| Date | 2026-10-23 |
| Editors | BotsRated (https://botsrated.com) |
| Reference implementation | https://botsrated.com (beta). Producer code: unpaid probe, canonical JSON, ids, signatures (`worker/src/probe.ts`); MCP probe (`worker/src/mcp.ts`, `prober/src/mcpcron.ts`); snapshot (`pipeline/score.py`); paid receipts (`pipeline/record_paid.py`) |
| Files | [`receipt.schema.json`](receipt.schema.json), [`examples/`](examples/), [`verify.mjs`](verify.mjs) |
| License | Text CC BY 4.0. Schema, examples and code MIT (§12) |

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as described in RFC 2119 and RFC 8174.

## 1. Purpose and scope

Buyers of x402 resources (agents, wallets, directories) need facts about a seller before they pay. Does the endpoint return a valid x402 challenge? Does the live price match the listing? Is the `payTo` stable? When someone actually paid, was the charge what was quoted, and did the service deliver? This spec defines a portable, verifiable record of those facts:

- a **receipt**: one signed observation of one x402 resource. It is either an **unpaid probe** (no payment header is sent) or a **paid test purchase** (a real x402 payment, settled on-chain);
- **host facts**: per-seller numbers derived only from receipts (the "rating");
- **freshness** rules, an optional **on-chain anchor** (EAS), and a **dispute and correction** process.

The format records observations, not opinions. It does not label sellers good or bad. Any producer (directory, agent, seller, auditor) can emit, sign and publish receipts in this format; BotsRated is one producer.

In scope: HTTP x402 resources (x402 v1 and v2), EVM networks, with USDC on Base (`eip155:8453`) as the reference case. From v0.2 also **remote MCP servers** (Streamable HTTP and the legacy HTTP+SSE transport): an unauthenticated handshake is recorded as an `mcp_probe` receipt (§3.4). Out of scope: payment execution (see the x402 core spec), identity registries (see ERC-8004), and how a buyer acts on the facts.

### 1.1 Relation to existing work
- **x402 core and extensions** ([coinbase/x402 `specs/`](https://github.com/coinbase/x402/tree/main/specs)). Receipts reuse x402 terms as defined there (`PaymentRequired`, `accepts`, `scheme`, `network` in CAIP-2, `amount`, `asset`, `payTo`) and do not redefine them.
- **x402 Offer and Receipt extension** (`specs/extensions/extension-offer-and-receipt.md`). That extension lets a *seller* sign its own offers and receipts. This format records what an *independent observer* saw. The two are complementary. When a seller provides signed artifacts, a producer SHOULD capture them verbatim in `evidence` (§3.3), as that extension's §9 anticipates ("lifted verbatim into external proof or attestation formats").
- **ERC-8004 (Trustless Agents)**. Its Reputation Registry stores one `int128` value plus tags per feedback, keyed to a registered `agentId`, with richer data off-chain behind `feedbackURI`/`feedbackHash`. A receipt can be that off-chain file, and §7.4 maps the fields. Most x402 sellers measured today have no `agentId`, so this format does not require one.
- **EAS (Ethereum Attestation Service)**. The optional on-chain anchor (§7) is an EAS schema on the Base predeploys.
- **W3C Verifiable Credentials 2.0 / Data Integrity**. v0.1 uses bare Ed25519 over canonical JSON (§4). A VC envelope is a non-normative option (§4.5), not a requirement.

## 2. Terms
- **Producer**: the party that makes the observation and signs the receipt.
- **Seller / host**: the x402 resource server, identified by the URL hostname.
- **Listing**: what a public directory (e.g. Coinbase CDP Bazaar) says about the resource: price, `payTo`, network.
- **Atomic amount**: an integer in the asset's smallest unit, as a decimal string (USDC: 6 decimals, so `"7000"` = $0.007).
- **Presentation fields**: fields an API adds when it serves a receipt (`receipt_url`, `tx_url`, `payment`, `signature`). They are not part of the receipt (§4.4).

## 3. Receipt objects

A receipt is a JSON object. `kind` selects the type. Unknown fields MUST be preserved and are covered by the id and signature like any other field. The normative schema is [`receipt.schema.json`](receipt.schema.json) (JSON Schema 2020-12). The tables below list the core fields.

### 3.1 Common fields
| Field | Type | Req. | Meaning |
|---|---|---|---|
| `kind` | string | yes | `unpaid_probe`, `paid_test_buy` or (v0.2) `mcp_probe` |
| `id` | string | yes | 20 lowercase hex characters, derived as in §4.2 |
| `ts` | string | yes | UTC start time, RFC 3339 with `Z` (seconds; paid receipts may carry milliseconds) |
| `host` | string | yes | Seller hostname |
| `url`, `method` | string | yes | Resource probed or bought; `GET` or `POST` |
| `sig` | object | see §4 | `{alg:"ed25519", key_id, sig_b64, signed?}` |
| `issuer` | string | no (new in v0.1) | Producer's HTTPS origin. Producers other than BotsRated SHOULD set it. BotsRated receipts issued so far do not carry it. |
| `spec` | string | no (new in v0.1) | e.g. `botsrated-receipt/0.1` |

### 3.2 Unpaid probe (`kind: "unpaid_probe"`)
One plain HTTP request to the resource, **with no payment header**. The reference prober sends `GET` first. If the answer is 400, 404, 405 or 415, it retries once with `POST {}`, and keeps the POST result only if that returns 402. Its timeout is 15 s, the body read is capped at 65,536 bytes, and its User-Agent names the prober and links to the dispute page.

| Field | Type | Meaning |
|---|---|---|
| `status` | int\|null | HTTP status; `null` if there was no response |
| `error` | string\|null | Transport error class (`Timeout`, `URLError`, …) |
| `latency_ms` | int\|null | Request start to end of the capped body read |
| `req_sha256` | hex | sha256 of `"<METHOD> <url>"`, plus `" {}"` for POST |
| `resp_sha256` | hex\|null | sha256 of the captured body bytes; `null` if empty |
| `total_header_bytes`, `payment_required_header_bytes` | int | Size of the response headers and of the `PAYMENT-REQUIRED` header |
| `valid_402` | bool | `status == 402` and a PaymentRequired parsed (v2 `PAYMENT-REQUIRED` header, base64 JSON, or a v1 JSON body) with a non-empty `accepts` list |
| `x402_version` | int\|null | 2 if the v2 header is present, else the body's `x402Version` |
| `live_amount`, `live_payTo`, `live_asset`, `live_network` | string | Terms of the chosen `accepts` entry: the first entry whose `network` matches the listing, else the first entry |
| `listed_amount`, `listed_payTo`, `network` | string\|null | The same terms as the directory listing states them (empty or `null` if unknown) |
| `prober_ua`, `prober`, `probe_version` | string | Who probed and with which implementation version. `probe_version` is absent on legacy receipts (§4.2). |
| `scope` | string | `primary` (the host's representative route) or `extra_route`. Reference implementation 0.3. |
| `checks` | object | Reference implementation 0.3: neutral 402 checks (`terms_consistent`, `terms_issues[]`, `base_usdc`, `payto_stable`, `price_matches_listing`, `payto_matches_listing`). See the methodology page. |

Real examples: [`examples/unpaid-probe.signed.json`](examples/unpaid-probe.signed.json) (cron prober, signed individually) and [`examples/unpaid-probe.legacy.json`](examples/unpaid-probe.legacy.json) (early box prober, covered by the signed snapshot). Published receipts observed on 2026-10-23 carry `probe_version` `0.2`. The 0.3 fields (`scope`, `checks`) exist in the reference code but did not yet appear in the published receipts checked for this draft.

### 3.3 Paid test purchase (`kind: "paid_test_buy"`)
A real x402 payment of the live quoted price, followed by a check of what was delivered.

| Field | Type | Meaning |
|---|---|---|
| `request`, `req_sha256` | any, hex | Input sent; sha256 of its canonical JSON |
| `network`, `asset`, `payTo` | string | Payment terms that were paid (CAIP-2, token contract, recipient) |
| `quoted_amount_atomic`, `quoted_source` | string | Live 402 quote and where it came from |
| `catalog_advisory_amount_atomic` | string\|null | Price the directory advertised, if different from the live quote |
| `paid_amount_atomic`, `paid_usd` | string, number | What was actually transferred on-chain |
| `charged_as_quoted` | bool | `paid_amount_atomic == quoted_amount_atomic` |
| `tx_hash`, `block`, `settled_at` | string, int, string | Settlement transaction on `network` |
| `payer` | string | Who paid and how (wallet type, connector) |
| `http_status`, `latency_ms`, `client_bracket_ms` | int\|null | Paid-request status and latency. When a client cannot see them, they are `null`, with `*_note` fields explaining why. They are never guessed. |
| `resp_sha256`, `resp_bytes` | hex, int | Hash and size of the delivered body. The body itself MAY stay private. |
| `delivered`, `non_empty`, `schema_valid`, `looks_correct` | bool\|null | Outcome checks. `looks_correct` comes from an independent check described in `check` (`null` = not yet checked) |
| `evidence` | object | Optional, new in v0.1. Seller-signed x402 artifacts copied verbatim: `{offer, receipt}` from `extensions["offer-receipt"]` |

A producer MUST NOT publish a paid receipt for a payment it cannot show on-chain. The reference buyer writes a receipt only after it has verified a transaction with status 1 that contains the USDC `Transfer(payer → payTo, amount)`. Real example: [`examples/paid-test-buy.json`](examples/paid-test-buy.json) (round 1, made before paid receipts were signed, so it has no `sig`; BotsRated paid receipts from 2026-10-23T15:00:00Z carry a `botsrated-prod-1` `sig`, §4.3).

### 3.4 MCP probe (`kind: "mcp_probe"`, new in v0.2)
One **unauthenticated** MCP handshake with a remote MCP server, as listed in a registry (reference: the Official MCP Registry, latest version of each entry). The producer sends exactly, in order: `initialize` (reference: `protocolVersion` `2025-06-18`, empty client capabilities), `notifications/initialized`, `tools/list` (first page only). With the legacy HTTP+SSE transport it first opens the event stream (`sse:connect`), takes the `endpoint` event (which MUST be on the same host) and posts the same three messages there.

A producer MUST NOT send any other method (in particular never `tools/call`, `resources/read` or `prompts/get`), MUST NOT send credentials (no `Authorization`, cookies or API-key headers, even if the listing declares them), and MUST only contact public `https` URLs on DNS names whose A/AAAA answers are public addresses, with at most 3 redirects, each re-checked. The reference prober uses a 12 s deadline, reads at most 64 KiB for `initialize` and 1 MiB for `tools/list`, and probes each endpoint about once a day.

| Field | Type | Meaning |
|---|---|---|
| `url`, `transport`, `method` | string | Endpoint as listed; `streamable-http` or `sse`; `POST` (initialize) or `GET` (SSE stream) |
| `server_id`, `listed_name` | string | Producer's endpoint id (first 20 hex of sha256 of the normalized URL); registry name (seller-supplied) |
| `status`, `error`, `latency_ms` | int\|null, string\|null, int\|null | HTTP status and round trip of `initialize` (SSE: of the stream); neutral error class (`Timeout`, `DNSError`, `TLSError`, `BlockedUrl`, `BlockedPrivateIp`, `NoInitializeResult`, `InitializeError`, `NoToolsListResult`, `ToolsListOverCap`, `NoEventStream`, …) |
| `reachable`, `tls` | bool, `ok`\|`failed`\|null | Any HTTP answer; certificate-verified HTTPS answer |
| `handshake_ok`, `protocol_version_requested`, `protocol_version`, `server_name`, `server_version`, `capabilities` | | `initialize` returned a JSON-RPC result with a `protocolVersion`; what was asked and answered |
| `auth_required`, `auth` | bool, object\|null | 401/403 on initialize, the stream or tools/list; `{status, at, scheme, resource_metadata, scope}` from `WWW-Authenticate` (OAuth protected-resource metadata URL if given). Nothing further is fetched. |
| `tools_listed`, `tool_count`, `tools_more_pages`, `tools_status`, `tools_latency_ms` | | `tools/list` answered with a `tools` array |
| `tool_names`, `tool_hashes` | string[] | Sorted names (first 200) and, aligned, first 12 hex of `sha256(canon({name, description, inputSchema, annotations}))` per tool |
| `tools_sha256`, `tools_changed` | hex\|null, bool\|null | sha256 of `canon` of all tools (sorted by name, same 4 fields); whether it differs from the producer's previous probe of the endpoint |
| `calls`, `redirects`, `req_sha256`, `resp_sha256`, `dns_public` | | What was sent; redirects followed; hashes of the initialize request body and response body; public-address check result (null = cached) |
| `state` | string | Derived and factual: `ok` (initialize and tools/list answered), `auth_required`, `handshake_failed` (HTTP answer without a valid MCP result), `unreachable` (no HTTP answer), `blocked` (URL guard) |

Real example: [`examples/mcp-probe.signed.json`](examples/mcp-probe.signed.json) (cron prober, 2026-10-23, verifies with `verify.mjs`). The live API serves these at `/receipt/<id>?mcp=<shard>&day=<YYYY-MM-DD>&s=<server_id>` and may add `receipt_url`/`signature` hints that are not part of the signed body. `s` (v0.2.1) selects the per-server storage row. Older links without `s` keep resolving, and the receipt they return verifies the same way: `s` is part of the URL only, never of the receipt.

States are observations from one vantage point, not judgements: `auth_required` is the expected answer of many production servers, and an endpoint can be reachable for authenticated clients while `unreachable` from the producer.

## 4. Canonical serialization, ids and signing

### 4.1 Canonical JSON
`canon(v)`: object keys are sorted (UTF-16 code-unit order), members with value `undefined` are dropped, `null` is kept, there is no whitespace, and scalars are serialized as by ECMAScript `JSON.stringify`. For data made only of strings, booleans, `null` and integers, this equals RFC 8785 (JCS). Producers SHOULD keep signed fields to those types; `paid_usd` is informative and is derived from `paid_amount_atomic`. Python equivalent: `json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)` (it matches JCS for ASCII keys and the value types listed).

### 4.2 Receipt id
| Receipt | Rule |
|---|---|
| `unpaid_probe` with `probe_version`, and `mcp_probe` (v0.2) | first 20 hex of `sha256(canon(receipt without id and sig))` |
| `paid_test_buy` | first 20 hex of `sha256("paid|" + tx_hash)` |
| legacy `unpaid_probe` (no `probe_version`; made before 2026-10-23 12:45 UTC by the box prober) | first 20 hex of `sha256(python json.dumps(receipt without id, sort_keys=True))`, with default separators `", "`/`": "` and ASCII escaping |

New producers MUST use the first rule for every kind they create, and MAY add a full-length `digest` field (open question Q2).

### 4.3 Signature
- Algorithm: Ed25519 (RFC 8032).
- Message: the UTF-8 bytes of `canon(receipt without sig)`. The `id` is included.
- `sig = {alg: "ed25519", key_id, sig_b64, signed}`. `sig_b64` is the 64-byte signature in standard padded base64. `signed` is human-readable text only.
- Key set: the producer publishes `{keys: [{key_id, alg, public_key_b64, signs, status?, valid_from?, valid_until?, sha256_fingerprint?}]}` over HTTPS, with each `public_key_b64` the raw 32-byte key and `sha256_fingerprint` the sha256 of those 32 bytes. BotsRated's is `https://botsrated.com/.well-known/botsrated-key` ([example](examples/keys.json)):
  - `botsrated-prod-1` (active from 2026-10-23T15:00:00Z, valid until 2027-10-23T00:00:00Z) signs dataset snapshots and paid test-buy receipts. Fingerprint `ac58fa77b9f6a26805efb65d331d6d77da3dfbdbbe981cc7510692852a50e74a`.
  - `botsrated-prober-1` (active from 2026-10-23T12:00:00Z) signs cron probe receipts (`unpaid_probe` and, from v0.2, `mcp_probe`), daily aggregates and archive manifests.
  - `botsrated-staging-1` is **retired** since 2026-10-23T15:00:00Z. It signs nothing new, but stays listed so snapshots generated before that time still verify.
- Validity window: a signature by a key is valid only for an object whose own timestamp (`ts` for receipts, `generated_at` for snapshots, aggregates and manifests) lies in `[valid_from, valid_until)`. A missing bound is open.
- Snapshot signature: a producer MAY also sign a dataset snapshot. The snapshot is the exact bytes of `dataset.json` (itself `canon(dataset)`), and the signature is published as `dataset.sig.json` `{key_id, alg, public_key_b64, sha256, signature_b64, generated_at}` ([example](examples/dataset.sig.json)). A receipt without `sig` is valid only if a signed snapshot lists its `id` in that host's `receipt_ids` or `paid_receipt_ids`.
- Gap in v0.1: snapshots list ids, not hashes. For unpaid probes the id is a content hash, so content stays bound. For paid receipts the id binds only `tx_hash`. **From v0.1 on, producers MUST sign every new paid receipt individually.** BotsRated's paid receipts made before 2026-10-23T15:00:00Z (the five public ones) are unsigned and are not changed. Their content is bound only through their EAS `receiptSha256` on the Base Sepolia pilot (§7). Paid receipts made from then on carry `sig` with `botsrated-prod-1`, computed exactly as for probes (§4.3 message, same `sig` object). Rotating a key adds a new `key_id`. Old keys MUST stay in the key set, marked retired, so that old receipts still verify.

### 4.4 Verification (normative)
1. Remove presentation fields (`receipt_url`, `tx_url`, `payment`, `signature`). If the response wraps the receipt as `{receipt: …}`, unwrap it.
2. Recompute `id` (§4.2). It MUST match.
3. If `sig` is present: resolve `key_id` in the issuer's key set, verify Ed25519 over `canon(receipt without sig)`, and check that `ts` lies inside the key's validity window (if the key set gives one).
   Otherwise: fetch `dataset.json` and `dataset.sig.json`, check that sha256 equals `sha256`, verify the signature with the key-set key (not only the key embedded in the sig file), check that `generated_at` lies inside that key's validity window, and check that `id` is listed for `host`.
4. Paid receipts: fetch the transaction receipt for `tx_hash` on `network`. It MUST have status 1 and a `Transfer` log from `asset` to `payTo` of `paid_amount_atomic`.
5. Signature validity is not issuer authority. Decide whether you trust the issuer and its key set (as in the x402 offer-receipt extension §4.5.1).

`node verify.mjs <file|url> [--rpc https://mainnet.base.org]` runs steps 1–4 with no dependencies. All three receipt examples pass. The paid example also passes the on-chain check (block 52971774).

### 4.5 Optional VC envelope (non-normative)
A producer MAY wrap a receipt as `credentialSubject` of a W3C VC 2.0 with a Data Integrity proof (`eddsa-jcs-2022`, which also uses Ed25519 and JCS). The plain receipt and its `sig` stay authoritative in v0.1 (Q5).

## 5. Ratings: host facts derived from receipts

Host facts are a pure function of the receipts. Each number MUST be reproducible from the receipts it cites (`receipt_ids`, `paid_receipt_ids`). v0.1 defines **no composite score**. `index` MUST be `null` until a host has **at least 3 paid test purchases on at least 3 distinct UTC days**, and `index_label` says why. The composite formula is open (Q1).

| Fact | Definition |
|---|---|
| `probes`, `reachable_count`, `valid_402_count`, `free_200_count` | Count of unpaid probes; with `status != null`; with `valid_402`; with `status == 200` |
| `recent_window` | The last 20 primary-route unpaid probes: `probes`, `valid_402`, `valid_402_rate` = k/n, and `wilson_lower_bound_95` = Wilson score lower bound with z = 1.96 (0 when n = 0) |
| `latency_p50_ms`, `latency_p90_ms` | Nearest rank over probes with a response: `sorted[min(n-1, floor(p·(n-1) + 0.5))]` (ties round half **up**, never half to even). The snapshot uses all receipts; the live API uses the recent window. All BotsRated producers (TS live store and daily aggregates, Python snapshot) use this rule since 2026-10-23 (snapshot `methodology_version` 0.2.1). |
| `price_differs_from_listing_count`, `payto_differs_from_listing_count` | Valid-402 probes where `live_amount != listed_amount` or `live_payTo != listed_payTo` (case-insensitive), with both sides known |
| `distinct_payto_seen`, `last_quoted_amount_atomic`, `x402_version` | From valid-402 probes |
| `paid_tests`, `paid_test_days`, `paid_total_usd`, `last_paid_test` | Count, distinct UTC days, sum and latest time of published paid receipts |
| `first_pass_success_rate` | Share of paid tests with `delivered ∧ non_empty ∧ schema_valid ∧ looks_correct` |
| `charged_as_quoted_rate`, `schema_valid_rate` | Shares of paid tests |
| `charged_on_failure_count` | Paid tests with `delivered == false` (the payment had settled) |

Rates are rounded to 3 decimals and are `null` when there is no data. Methodology summary (full text: https://botsrated.com/methodology):
- Hosts come from public lists (CDP Bazaar, Agentic.Market, 402index, x402-list). One representative route per host (its most-called listed route) is probed on a rolling schedule.
- Buys are made from a capped wallet ($1.50 per buy, $2 per day, $20 per month), at the live quoted price, with an independent correctness check.
- The producer never rates itself. Its own purchases are kept private.
- Some price differences are legitimate (for example, input-dependent pricing), so the counts are facts, not verdicts.

Real example: [`examples/dataset-host-entry.json`](examples/dataset-host-entry.json).

**MCP server facts (v0.2).** Per endpoint, from its `mcp_probe` receipts only: `probes`, `ok_count`, `reachable_count`, `auth_required_count`, `last_state`, `protocol_version`, `server_info`, `tls`, `auth`, `tool_count`, `tools_sha256`, `tools_changed_at`, `tools_changes_seen`, `latency_p50_ms`/`latency_p90_ms` (same nearest-rank rule, over the last 20 probes that got an MCP answer: `ok` or `auth_required`), and `recent_window = {probes, ok, ok_rate, wilson_lower_bound_95, states}` over the last 20 probes. No composite score and no paid outcomes are defined for MCP servers. Selection (e.g. `/v1/best` `mcp_results`) MUST only consider endpoints whose last `ok` probe is within 48 h; matching on tool names and descriptions uses the producer's copy of the last `tools/list` answer (seller-supplied text).

## 6. Freshness and staleness
- Every host fact set carries `freshness = {last_probe_at, age_seconds, stale, stale_after_seconds, probe_schedule, served_at}`.
- `stale` is `true` when there is no probe or `age_seconds > 86400`. Consumers SHOULD NOT treat stale facts as current, and SHOULD re-probe or re-query instead.
- Responses also state `served_at`, `data.last_probe_run_at` and `data.signed_snapshot_generated_at`, so a consumer can tell the live store from the snapshot.
- Selection features (such as BotsRated `/v1/best`) MUST only consider hosts with a valid 402 within the last 48 h.
- Reference schedule (v0.2.1): every host is probed about every 1.8 h (161 shards, 3 every 2 min; was about 5.4 h). A host with no valid 402 in 7 days, over at least 6 probes, is marked `probe: inactive` and probed about daily. A host missing from every source list for 3 days in a row is marked `listing: delisted`. That is a fact about the lists, not about the seller.
- Reference MCP schedule (v0.2): each remote MCP endpoint is probed about once a day (one of 480 daily shards every 3 minutes). An endpoint with no MCP answer (`ok` or `auth_required`) for 7 days, over at least 3 probes, is probed about every 4 days.
- Priority tier (v0.2.1): an endpoint whose host was looked up through the producer's API (preflight, check or report) in the last 7 days, or is also a covered x402 seller, is probed about every 6 hours, oldest first, under a per-run cap. Facts show it as `priority_tier = {reason, since, probe_every_hours}`. The tier changes only how often an endpoint is probed, never how its facts are computed.
- MCP retention (v0.2.1): `mcp_probe` receipts stay in the live store for 30 days, or 14 days while the store is above 3.5 GB (`receipts_kept_days` in coverage). No daily archive yet.
- Retention: raw signed receipts stay live for 7 days. After that, each UTC day is archived byte for byte (gzip NDJSON, with a sha256 per part and a signed manifest), and a signed `daily_aggregate` is kept per host. Receipt URLs keep resolving from the archive. Receipts are never edited (§9).

Real example: [`examples/preflight-response.json`](examples/preflight-response.json).

## 7. Optional on-chain anchoring (EAS)

### 7.1 Schema
```
string host,string kind,string receiptId,uint16 httpStatus,bool valid402,uint64 quotedAtomic,uint64 paidAtomic,uint32 latencyMs,bytes32 paymentTx,uint64 measuredAt,bytes32 receiptSha256,bytes32 datasetSha256
```
- Schema UID `0x41998a3dae10feb68ad41f38af408d184d344bc37f8b16309954d985871400cc`: revocable, no resolver, registered on **Base Sepolia** (pilot, testnet only).
- EAS `0x4200…0021` and SchemaRegistry `0x4200…0020` (the OP-stack predeploys, also on Base mainnet).
- An EAS schema UID is derived from the schema string, resolver and revocable flag, so registering the same schema on Base mainnet should give the same UID. Confirm this when it is registered.

### 7.2 Field mapping
| Field | Value |
|---|---|
| `recipient` | Seller `payTo` (`live_payTo` for probes, `payTo` for buys), so explorers group records per seller |
| `kind` | `probe` or `paid_buy` |
| `httpStatus` | Status. `0` = not exposed (connector buys). |
| `quotedAtomic` / `paidAtomic` | `live_amount` / `quoted_amount_atomic`, and `paid_amount_atomic` (0 for probes) |
| `latencyMs` | `0` = not measured. Upper-bound brackets are never published as latency. |
| `paymentTx` | `tx_hash`, or `0x00…00` for probes |
| `measuredAt` | Unix seconds of `ts` |
| `receiptSha256` | `sha256(canon(receipt))` of the stored receipt, including `sig` if present and excluding presentation fields |
| `datasetSha256` | sha256 of the signed snapshot that lists the receipt |

### 7.3 Rules
- Anchoring is optional. The off-chain receipt is the source of truth.
- Attest only receipts that are already published. Nothing held under §9 may be anchored before it is published.
- A correction revokes the old attestation and issues a new one with `refUID` set to the old UID.
- Verify (`pipeline/onchain/verify.mjs`) as follows:
  1. `getAttestation(uid)`: check the schema, the attester, and that it is not revoked.
  2. Decode the data and recompute every field from the receipt.
  3. Check `receiptSha256`, and check `datasetSha256` against the signed snapshot.
  4. Check that `recipient` equals the seller's `payTo`.
- Pilot status: 10 attestations (5 buys, 5 probes) on Base Sepolia, attester `0xb36DF4EA64b5d8c40A4Dd8ED0182EaB8A8867Dd6`. All 10 passed the verify script on 2026-10-23. Example: [`examples/eas-attestations.json`](examples/eas-attestations.json).

### 7.4 ERC-8004 mapping (non-normative)
When a seller has an ERC-8004 `agentId`, a producer MAY also call `giveFeedback`, using the receipt as the off-chain file:

| Argument | Value |
|---|---|
| `feedbackURI` | the receipt URL |
| `feedbackHash` | `keccak256` of the served receipt bytes |
| `endpoint` | `url` |
| `tag1`, `value` | the measured value with ERC-8004's example tags, e.g. `reachable` (1/0), `successRate`, `responseTime` (ms) |
| `proofOfPayment` | `{toAddress: payTo, txHash: tx_hash, chainId}` in the file, for paid receipts |

The producer MUST NOT post a composite score that §5 does not define.

## 8. Publishing and verifying receipts (sellers and third parties)

**Third-party producers**
1. Emit receipts per §3–4, set `issuer`, and sign every receipt.
2. Publish the key set at a stable HTTPS URL.
3. Serve each receipt at a stable URL, and serve batches as NDJSON (one receipt per line, byte for byte) with a sha256.
4. Optionally, anchor receipts with the §7 schema from your own attester address. The attester identifies the producer, and anyone may use the schema.

**Sellers**
- Verify any receipt about your host with §4.4. Receipts are free to read at `GET /receipt/{id}?host=&day=` and `GET /v1/preflight?url=`.
- Reply to or dispute a receipt (§9).
- To make observations stronger, return x402 Offer and Receipt extension artifacts. Producers then embed them in `evidence`, which binds the seller's own signed terms to the observation.
- Receipts a seller makes about itself are welcome, but they are not independent observations. Aggregators SHOULD keep them apart from third-party receipts.

**Aggregators and directories**
- Cite the receipt ids behind every number you show.
- Keep facts from different producers apart, or weight them by producer.
- Show `stale`.

## 9. Disputes and corrections
- **Channel.** `POST https://botsrated.com/v1/dispute` with JSON `{host, statement, receipt_id?, contact?}`. It is free and returns `202 {dispute_id}`. Disputes are stored for 90 days.
- **Re-test.** The producer re-tests within 48 h and publishes the seller's reply next to the data.
- **72-hour notice.** A failing or doubtful paid result (not delivered, empty, failed check, or `looks_correct` not yet `true`) MUST be held privately (`status_flag: pending_notice`) and re-tested first. The seller MUST be notified and given **72 hours** to respond before the result is published. The hold MUST NOT be published or anchored on-chain while it lasts.
- **Corrections.** A signed receipt is never edited or deleted.
  - A confirmed error is fixed by a new signed object that references the original `id`.
  - The fix is listed in the public corrections log (https://botsrated.com/disputes), and any anchor is revoked (§7.3).
  - The corrections log currently contains no entries.
- **Opt-out.** A seller can opt out of probing by sending a dispute whose statement is "opt out".

## 10. Security and privacy considerations
- Probes never send a payment header and cannot cause a charge. The reference prober also stays within a request budget.
- Producers MUST NOT publish response bodies of paid calls by default; hashes are enough. Request inputs SHOULD avoid personal data.
- A producer can only attest to what it observed from its own vantage point (region, time). Timeouts can be local.
- Sybil producers are possible. Weight facts by producer (as ERC-8004's security notes also advise for reviewers).

## 11. Versioning
- Spec versions are `MAJOR.MINOR`, plus an optional `.PATCH` for editorial or reference-schedule changes that change no receipt field, id rule or signature rule. 0.x drafts may break. From 1.0, adding optional fields is a MINOR change. Renaming or removing a field, changing its meaning, or changing §4 is a MAJOR change.
- Receipts are immutable. Verifiers MUST verify a receipt under the rules in force when it was issued, using `probe_version` and the legacy rule in §4.2. Producers MAY set `spec`.
- Producer implementation (`probe_version`) and methodology (`methodology_version` in snapshots) are versioned separately from this spec.
- Changes: 0.2.1 (2026-10-23, draft): reference x402 schedule about 1.8 h, MCP priority tier about every 6 h, MCP retention 30 days (14 above 3.5 GB), `&s=<server_id>` in MCP receipt URLs (older links still resolve and verify). No format change: receipts keep `spec: botsrated-receipt/0.2`. 0.2 (2026-10-23, draft) adds the `mcp_probe` receipt (§3.4), its id rule (§4.2), the prober key covering it (§4.3) and MCP server facts (§5). Nothing in 0.1 changed. 0.1 (2026-10-23) is the first draft. It documents the format in production and adds `issuer`, `spec`, `evidence`, and the MUST to sign paid receipts. Same day: key validity windows and `status` in the key set (§4.3), BotsRated key rotation `botsrated-staging-1` → `botsrated-prod-1`, Q6 resolved.

## 12. License
This specification text is licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). `receipt.schema.json`, `verify.mjs` and the files in `examples/` are licensed under MIT, like the rest of this repository. The examples are real BotsRated receipts and public on-chain data from 2026-10-23.

## Open design questions
- Q1. Composite index formula. How should paid outcomes and probe reliability be weighted, and how should time decay? Should the index exist at all, or should only facts be published?
- Q2. Should receipts carry a full 64-hex `digest`, and should snapshots list `sha256` per receipt instead of only ids? Snapshots listing only ids leaves the content of paid receipts unbound (§4.3).
- Q3. Key discovery. Keep `/.well-known/botsrated-key`, adopt a neutral well-known name, or use `did:web` with `kid` DID URLs as the x402 offer-receipt extension does?
- Q4. Should this become an x402 extension that sellers advertise (for example, one declaring the observers they accept and a contact for notices), or stay a standalone format?
- Q5. Should the signature be JWS, a VC Data Integrity proof (`eddsa-jcs-2022`), or plain `sig`? And should paid receipts also allow EIP-712 so that EVM-native verifiers can use them?
- ~~Q6. Percentile rounding.~~ Resolved 2026-10-23: `floor(p·(n-1) + 0.5)` everywhere (§5). The Python snapshot used `round()` (half to even) until `methodology_version` 0.2.1, so on even-sized samples its p50 could be one rank lower than the TS value (15 of 4,821 hosts differed in the last 0.2 snapshot). Older snapshots stay as signed.
- Q7. Which channel should carry the 72-hour notice? Options: a directory listing contact, `security.txt`, or a contact field in a future x402 extension.
- Q8. Should all paid receipts be anchored on mainnet, or only on request? The cost is about $0.0074 per record, per BotsRated's read-only mainnet estimate.
