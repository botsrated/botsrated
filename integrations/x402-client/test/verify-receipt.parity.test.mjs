import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyReceipt as coreVerify, webcryptoDeps } from "../../../spec/verify-core.mjs";
import { nodeDeps } from "../../../spec/verify-node.mjs";
import { RECEIPT_CHECK_CLAIM, RECEIPT_CHECK_STATUSES, verifyReceipt } from "../verify-receipt.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const keys = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/keys.json"), "utf8"));
const STATUSES = new Set(["signature valid", "signature invalid", "key unknown", "not offline-verifiable"]);

const signed = [
  ["spec/examples/unpaid-probe.signed.json", "ac16e0eeff1e0d9ffcfc"],
  ["spec/examples/mcp-probe.signed.json", "7850687e1f25d3d38c23"],
  ["spec/examples/mcp-probe.payment.json", "534359eaf4a00dcf0261"],
];

function load(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

const BANNED = /\b(verified|trusted|scam|grade|ranking)\b|\bsafe\b/i;

test("package export packs the offline verifier", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(here, "../package.json"), "utf8"));
  assert.equal(pkg.version, "0.3.1");
  assert.equal(pkg.exports["./verify-receipt"].import, "./verify-receipt.mjs");
  assert.equal(pkg.exports["./verify-receipt"].types, "./verify-receipt.d.ts");
  for (const file of ["verify-receipt.mjs", "verify-receipt.d.ts", "vendor/verify-core.mjs", "vendor/verify-node.mjs"]) {
    assert.equal(pkg.files.includes(file), true, file);
  }
  assert.equal(RECEIPT_CHECK_CLAIM, "this record only");
  assert.deepEqual([...RECEIPT_CHECK_STATUSES], ["signature valid", "signature invalid", "key unknown", "not offline-verifiable"]);
  const source = fs.readFileSync(path.join(here, "../verify-receipt.mjs"), "utf8");
  assert.match(source, /from "\.\/vendor\/verify-core\.mjs"/);
  assert.match(source, /from "\.\/vendor\/verify-node\.mjs"/);
  assert.equal(source.includes("../../spec/"), false);
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(BANNED.test(source), false);
  const types = fs.readFileSync(path.join(here, "../verify-receipt.d.ts"), "utf8");
  assert.equal(BANNED.test(types), false);
  for (const name of ["verify-core.mjs", "verify-node.mjs"]) {
    const packed = fs.readFileSync(path.join(here, "../vendor", name));
    const spec = fs.readFileSync(path.join(root, "spec", name));
    assert.equal(packed.equals(spec), true, `vendor/${name} must stay a byte copy of spec/${name}`);
    assert.equal(createHash("sha256").update(packed).digest("hex"), createHash("sha256").update(spec).digest("hex"));
    assert.equal(/\bfetch\s*\(/.test(packed.toString("utf8")), false);
  }
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

test("withheld markers are not offline-verifiable", async () => {
  const raw = load("spec/examples/unpaid-probe.signed.json");
  delete raw.listed_amount;
  delete raw.listed_payTo;
  raw.withheld_fields = ["listed_amount", "listed_payTo", "checks.*listing*"];
  raw.withheld_note = "listing fields withheld";
  const wrapped = { receipt: raw };
  const viaPkg = await verifyReceipt(wrapped, keys);
  const viaCore = await coreVerify(structuredClone(wrapped), keys, nodeDeps());
  assert.deepEqual(viaPkg, viaCore);
  assert.equal(viaPkg.valid, false);
  assert.equal(viaPkg.offline_verifiable, false);
  assert.equal(viaPkg.status, "not offline-verifiable");
  assert.equal(STATUSES.has(viaPkg.status), true);
  assert.equal(viaPkg.lines.some((line) => line.startsWith("FAIL")), false);
  assert.equal(viaPkg.status === "signature invalid", false);
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

test("a packed install resolves verifyReceipt with no monorepo path", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "x402-verify-pack-"));
  try {
    const out = spawnSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tmp], {
      cwd: path.join(here, ".."),
      encoding: "utf8",
    });
    assert.equal(out.status, 0, out.stderr || out.stdout);
    const meta = JSON.parse(out.stdout.slice(out.stdout.indexOf("[")))[0];
    const paths = meta.files.map((file) => file.path);
    for (const rel of [
      "verify-receipt.mjs",
      "verify-receipt.d.ts",
      "vendor/verify-core.mjs",
      "vendor/verify-node.mjs",
    ]) {
      assert.equal(paths.includes(rel), true, `${rel} in ${paths.join(", ")}`);
    }
    assert.equal(paths.some((rel) => rel.includes("../") || /(^|\/)spec\//.test(rel)), false);

    const extract = path.join(tmp, "extract");
    fs.mkdirSync(extract);
    const unpacked = spawnSync("tar", ["-xzf", path.join(tmp, meta.filename), "-C", extract], { encoding: "utf8" });
    assert.equal(unpacked.status, 0, unpacked.stderr || unpacked.stdout);

    const packedCore = fs.readFileSync(path.join(extract, "package/vendor/verify-core.mjs"));
    const packedNode = fs.readFileSync(path.join(extract, "package/vendor/verify-node.mjs"));
    assert.deepEqual(packedCore, fs.readFileSync(path.join(root, "spec/verify-core.mjs")));
    assert.deepEqual(packedNode, fs.readFileSync(path.join(root, "spec/verify-node.mjs")));
    const packedEntry = fs.readFileSync(path.join(extract, "package/verify-receipt.mjs"), "utf8");
    assert.equal(packedEntry.includes("../../spec/"), false);

    const app = path.join(tmp, "app");
    fs.mkdirSync(path.join(app, "node_modules", "@botsrated"), { recursive: true });
    fs.symlinkSync(path.join(extract, "package"), path.join(app, "node_modules", "@botsrated", "x402-preflight"));
    fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ private: true, type: "module" }));
    fs.writeFileSync(path.join(app, "run.mjs"), [
      'import { verifyReceipt, RECEIPT_CHECK_CLAIM } from "@botsrated/x402-preflight/verify-receipt";',
      'import fs from "node:fs";',
      "const raw = JSON.parse(fs.readFileSync(process.argv[2], \"utf8\"));",
      "const keyset = JSON.parse(fs.readFileSync(process.argv[3], \"utf8\"));",
      "const result = await verifyReceipt(raw, keyset);",
      "process.stdout.write(JSON.stringify({",
      '  url: import.meta.resolve("@botsrated/x402-preflight/verify-receipt"),',
      "  status: result.status,",
      "  valid: result.valid,",
      "  id: result.id,",
      "  claim: RECEIPT_CHECK_CLAIM,",
      "}));",
      "",
    ].join("\n"));

    const ran = spawnSync(process.execPath, [
      path.join(app, "run.mjs"),
      path.join(root, "spec/examples/unpaid-probe.signed.json"),
      path.join(root, "spec/examples/keys.json"),
    ], { cwd: app, encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr || ran.stdout);
    const body = JSON.parse(ran.stdout);
    assert.equal(body.status, "signature valid");
    assert.equal(body.valid, true);
    assert.equal(body.id, "ac16e0eeff1e0d9ffcfc");
    assert.equal(body.claim, "this record only");
    const resolved = fileURLToPath(body.url);
    assert.equal(
      fs.realpathSync(resolved),
      fs.realpathSync(path.join(extract, "package/verify-receipt.mjs")),
    );
    assert.equal(resolved.includes(`${path.sep}spec${path.sep}verify-core.mjs`), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
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
