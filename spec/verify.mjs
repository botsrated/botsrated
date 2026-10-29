#!/usr/bin/env node
// Verify a BotsRated receipt. Node >= 18, no dependencies. MIT.
// Usage: node verify.mjs <receipt.json | receipt URL> [--keys <file|url>] [--dataset <file|url> --sig <file|url>] [--rpc <Base RPC url>]
// From a checkout of this directory (verify.mjs, verify-core.mjs, and verify-node.mjs together):
//   node spec/verify.mjs '<receipt_url>'
// verify.mjs alone does not run. The receipt page one-liner downloads those three files from the same ref (main).
// Checks: (1) receipt id, (2) per-receipt ed25519 signature, or, for unsigned receipts, the signed snapshot that lists the id,
// (3) optional: for paid test-buys, the on-chain USDC Transfer(payer -> payTo, paid amount) in the tx receipt.
// Presentation fields receipt_url, tx_url, and signature are removed. payment is removed only when it is not an object
// (string hints on unpaid probes). An object payment is signed (mcp_probe) and stays.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripPresentation, unwrapReceipt, verifyReceipt } from "./verify-core.mjs";
import { nodeDeps } from "./verify-node.mjs";

function invokedAsCli() {
  const arg = process.argv[1];
  if (!arg || arg === "-") return true;
  try { return import.meta.url === pathToFileURL(path.resolve(arg)).href; }
  catch { return false; }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const src = args[0];
  if (!src || src.startsWith("--")) { console.error("usage: node verify.mjs <receipt.json|url> [--keys] [--dataset --sig] [--rpc]"); process.exit(2); }
  const B = "https://botsrated.com";
  const load = async (s, raw = false) => {
    const buf = /^https?:/.test(s) ? Buffer.from(await (await fetch(s)).arrayBuffer()) : fs.readFileSync(s);
    return raw ? buf : JSON.parse(buf);
  };
  const parsed = await load(src);
  const keyset = await load(opt("--keys", `${B}/.well-known/botsrated-key`));
  const deps = nodeDeps();
  deps.loadSnapshot = async () => ({
    bytes: await load(opt("--dataset", `${B}/dataset.json`), true),
    sig: await load(opt("--sig", `${B}/dataset.sig.json`)),
  });
  const result = await verifyReceipt(parsed, keyset, deps);
  for (const line of result.lines) console.log(line);

  let ok = result.ok;
  const rpc = opt("--rpc");
  const r = stripPresentation(unwrapReceipt(parsed));
  if (rpc && r.kind === "paid_test_buy") {
    const res = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [r.tx_hash] }) })).json();
    const rc = res.result;
    const T = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const log = rc?.logs?.find((l) => l.address.toLowerCase() === r.asset.toLowerCase() && l.topics[0] === T && l.topics[2]?.slice(26).toLowerCase() === r.payTo.slice(2).toLowerCase());
    const pass = rc?.status === "0x1" && !!log && BigInt(log.data) === BigInt(r.paid_amount_atomic);
    console.log(`${pass ? "PASS" : "FAIL"}  tx ${r.tx_hash.slice(0, 12)}… status 1, ${r.asset.slice(0, 8)}… Transfer to payTo of ${r.paid_amount_atomic} atomic` + (rc ? ` (block ${parseInt(rc.blockNumber, 16)})` : ""));
    if (!pass) ok = false;
  }
  console.log(ok ? "\nVALID" : "\nINVALID");
  process.exit(ok ? 0 : 1);
}

if (invokedAsCli()) main();
