#!/usr/bin/env node
// Verify a BotsRated v0.1 receipt. Node >= 18, no dependencies. MIT.
// Usage: node verify.mjs <receipt.json | receipt URL> [--keys <file|url>] [--dataset <file|url> --sig <file|url>] [--rpc <Base RPC url>]
// Checks: (1) receipt id, (2) per-receipt ed25519 signature, or, for unsigned receipts, the signed snapshot that lists the id,
// (3) optional: for paid test-buys, the on-chain USDC Transfer(payer -> payTo, paid amount) in the tx receipt.
import crypto from "node:crypto";
import fs from "node:fs";

const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const src = args[0]; if (!src || src.startsWith("--")) { console.error("usage: node verify.mjs <receipt.json|url> [--keys] [--dataset --sig] [--rpc]"); process.exit(2); }
const B = "https://botsrated.com";
const load = async (s, raw = false) => { const buf = /^https?:/.test(s) ? Buffer.from(await (await fetch(s)).arrayBuffer()) : fs.readFileSync(s); return raw ? buf : JSON.parse(buf); };
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
// Canonical JSON (SPEC section 4.1): keys sorted, no whitespace, JSON.stringify scalars. Equal to RFC 8785 for integer/string/bool/null data.
const canon = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
// Legacy ids (box prober, no probe_version): Python json.dumps(sort_keys=True) with default separators and ASCII escaping.
const ascii = (s) => JSON.stringify(s).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const pyDumps = (v) => v === null ? "null" : typeof v === "string" ? ascii(v) : typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(pyDumps).join(", ")}]` : `{${Object.keys(v).sort().map((k) => `${ascii(k)}: ${pyDumps(v[k])}`).join(", ")}}`;
const edKey = (b64) => crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(b64, "base64")]), format: "der", type: "spki" });
const PRESENTATION = ["receipt_url", "tx_url", "payment", "signature"]; // added by APIs, never signed

let r = await load(src); if (r.receipt) r = r.receipt;
for (const k of PRESENTATION) delete r[k];
const { id, sig, ...body } = r; let ok = true;
const say = (pass, msg) => { console.log(`${pass ? "PASS" : "FAIL"}  ${msg}`); if (!pass) ok = false; };

// 1. id
const want = r.kind === "paid_test_buy" ? sha256("paid|" + r.tx_hash).slice(0, 20)
  : r.probe_version ? sha256(canon(body)).slice(0, 20) : sha256(pyDumps(body)).slice(0, 20);
say(want === id, `id ${id} (${r.kind === "paid_test_buy" ? "sha256('paid|'+tx_hash)" : r.probe_version ? "sha256(canonical JSON)" : "legacy rule"})`);
console.log(`INFO  receipt sha256 (canonical JSON, compare with EAS receiptSha256): 0x${sha256(canon(r))}`);

// 2. signature
const ks = await load(opt("--keys", `${B}/.well-known/botsrated-key`)); const keys = Object.fromEntries(ks.keys.map((k) => [k.key_id, k.public_key_b64]));
const kmeta = Object.fromEntries(ks.keys.map((k) => [k.key_id, k]));
// Key validity window (key set fields valid_from / valid_until, optional): the signed object's own timestamp must fall inside it.
// A retired key stays valid for objects dated before its valid_until, so old receipts and snapshots keep verifying.
const inWindow = (kid, ts) => { const k = kmeta[kid]; if (!k) return false; const t = Date.parse(ts);
  const ok = (!k.valid_from || t >= Date.parse(k.valid_from)) && (!k.valid_until || t < Date.parse(k.valid_until));
  say(ok, `key ${kid} (${k.status || "active"}) valid for ${ts}` + (k.valid_from || k.valid_until ? ` [${k.valid_from || "-"}, ${k.valid_until || "-"})` : "")); return ok; };
if (sig) {
  const msg = canon({ ...r, sig: undefined });
  say(!!keys[sig.key_id] && crypto.verify(null, Buffer.from(msg), edKey(keys[sig.key_id]), Buffer.from(sig.sig_b64, "base64")), `ed25519 receipt signature, key ${sig.key_id}`);
  inWindow(sig.key_id, r.ts || r.generated_at);
} else {
  const ds = await load(opt("--dataset", `${B}/dataset.json`), true); const ss = await load(opt("--sig", `${B}/dataset.sig.json`));
  say(sha256(ds) === ss.sha256, `snapshot sha256 ${ss.sha256.slice(0, 16)}…`);
  say(keys[ss.key_id] === ss.public_key_b64 && crypto.verify(null, ds, edKey(keys[ss.key_id]), Buffer.from(ss.signature_b64, "base64")), `snapshot ed25519 signature, key ${ss.key_id}, generated ${ss.generated_at}`);
  inWindow(ss.key_id, ss.generated_at);
  const h = JSON.parse(ds).hosts.find((x) => x.host === r.host);
  say(!!h && [...(h.receipt_ids || []), ...(h.paid_receipt_ids || [])].includes(id), `id listed in the signed snapshot entry for ${r.host}`);
  if (r.kind === "paid_test_buy") console.log("WARN  v0.1 snapshots list paid ids only; the id binds tx_hash, not the other fields. Compare the sha256 above with an EAS receiptSha256 if one exists.");
}

// 3. on-chain payment (paid test-buys, optional)
const rpc = opt("--rpc"); if (rpc && r.kind === "paid_test_buy") {
  const res = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [r.tx_hash] }) })).json();
  const rc = res.result; const T = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const log = rc?.logs?.find((l) => l.address.toLowerCase() === r.asset.toLowerCase() && l.topics[0] === T && l.topics[2]?.slice(26).toLowerCase() === r.payTo.slice(2).toLowerCase());
  say(rc?.status === "0x1" && !!log && BigInt(log.data) === BigInt(r.paid_amount_atomic), `tx ${r.tx_hash.slice(0, 12)}… status 1, ${r.asset.slice(0, 8)}… Transfer to payTo of ${r.paid_amount_atomic} atomic` + (rc ? ` (block ${parseInt(rc.blockNumber, 16)})` : ""));
}
console.log(ok ? "\nVALID" : "\nINVALID"); process.exit(ok ? 0 : 1);
