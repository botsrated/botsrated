import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyReceipt as coreVerify, webcryptoDeps } from "../../../spec/verify-core.mjs";
import { nodeDeps } from "../../../spec/verify-node.mjs";
import { RECEIPT_CHECK_CLAIM, RECEIPT_CHECK_STATUSES, verifyReceipt } from "../verify-receipt.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const keys = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/keys.json"), "utf8"));
const STATUSES = new Set(["signature valid", "signature invalid", "key unknown"]);

const signed = [
  ["spec/examples/unpaid-probe.signed.json", "ac16e0eeff1e0d9ffcfc"],
  ["spec/examples/mcp-probe.signed.json", "7850687e1f25d3d38c23"],
  ["spec/examples/mcp-probe.payment.json", "534359eaf4a00dcf0261"],
];

function load(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

test("package export is verifyReceipt from spec/verify-core.mjs", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(here, "../package.json"), "utf8"));
  assert.equal(pkg.version, "0.3.1");
  assert.equal(pkg.exports["./verify-receipt"].import, "./verify-receipt.mjs");
  assert.equal(pkg.exports["./verify-receipt"].types, "./verify-receipt.d.ts");
  assert.equal(RECEIPT_CHECK_CLAIM, "this record only");
  assert.deepEqual([...RECEIPT_CHECK_STATUSES], ["signature valid", "signature invalid", "key unknown"]);
  const source = fs.readFileSync(path.join(here, "../verify-receipt.mjs"), "utf8");
  assert.match(source, /spec\/verify-core\.mjs/);
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/\b(verified|trusted|scam|grade)\b|\bsafe\b/i.test(source), false);
  const types = fs.readFileSync(path.join(here, "../verify-receipt.d.ts"), "utf8");
  assert.equal(/\b(verified|trusted|scam|grade)\b|\bsafe\b/i.test(types), false);
});

for (const [file, id] of signed) {
  test(`parity ${file}`, async () => {
    const raw = load(file);
    const viaPkg = await verifyReceipt(raw, keys);
    const viaCore = await coreVerify(structuredClone(raw), keys, nodeDeps());
    assert.deepEqual(viaPkg, viaCore);
    assert.equal(viaPkg.valid, true);
    assert.equal(viaPkg.status, "signature valid");
    assert.equal(viaPkg.id, id);
    assert.equal(viaPkg.key_id, "botsrated-prober-1");
    assert.deepEqual(viaPkg.errors, []);
    assert.equal(STATUSES.has(viaPkg.status), true);
  });
}

test("string payment hint stays valid; an object payment is signature invalid", async () => {
  const raw = load("spec/examples/unpaid-probe.signed.json");
  const wrapped = {
    receipt: {
      ...raw,
      receipt_url: "https://botsrated.com/receipt/ac16e0eeff1e0d9ffcfc?host=api.exa.ai&day=2026-10-23",
      tx_url: null,
      payment: "none (unpaid probe; no payment header was sent)",
      signature: "ed25519 per-receipt signature (key botsrated-prober-1; see /.well-known/botsrated-key)",
    },
  };
  const result = await verifyReceipt(wrapped, keys);
  const core = await coreVerify(structuredClone(wrapped), keys, nodeDeps());
  assert.deepEqual(result, core);
  assert.equal(result.status, "signature valid");

  const broken = { receipt: { ...wrapped.receipt, payment: { v: "not-signed" } } };
  const bad = await verifyReceipt(broken, keys);
  const badCore = await coreVerify(structuredClone(broken), keys, nodeDeps());
  assert.deepEqual(bad, badCore);
  assert.equal(bad.valid, false);
  assert.equal(bad.status, "signature invalid");
});

test("unknown key_id is key unknown", async () => {
  const raw = load("spec/examples/unpaid-probe.signed.json");
  raw.sig = { ...raw.sig, key_id: "missing-key" };
  const result = await verifyReceipt(raw, keys);
  const core = await coreVerify(structuredClone(raw), keys, nodeDeps());
  assert.deepEqual(result, core);
  assert.equal(result.status, "key unknown");
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes("key_unknown"), true);
});

test("the check does not call fetch", async () => {
  const raw = load("spec/examples/mcp-probe.signed.json");
  const previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network");
  };
  try {
    const result = await verifyReceipt(raw, keys);
    assert.equal(result.status, "signature valid");
  } finally {
    globalThis.fetch = previous;
  }
});

test("webcrypto deps match when the runtime has Ed25519", async () => {
  const raw = load("spec/examples/unpaid-probe.signed.json");
  let subtle = null;
  try {
    const probe = webcryptoDeps();
    await probe.sha256("ok");
    const pub = keys.keys.find((k) => k.key_id === "botsrated-prober-1").public_key_b64;
    await probe.ed25519(pub, "no", Buffer.from(new Uint8Array(64)).toString("base64"));
    subtle = probe;
  } catch {
    subtle = null;
  }
  if (!subtle) return;
  const viaPkg = await verifyReceipt(raw, keys, webcryptoDeps());
  const viaCore = await coreVerify(structuredClone(raw), keys, webcryptoDeps());
  assert.equal(viaPkg.valid, viaCore.valid);
  assert.equal(viaPkg.status, viaCore.status);
  assert.deepEqual(viaPkg.errors, viaCore.errors);
  assert.equal(STATUSES.has(viaPkg.status), true);
});
