import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prefersHtml, quoteShellArg, receiptCliUrl, renderReceiptPage, signatureStatus, verifyResultJson } from "./receipt-page.mjs";
import { ed25519WebCryptoAvailable } from "./verify-browser.mjs";
import { verifyReceipt, webcryptoDeps } from "./verify-core.mjs";
import { nodeDeps } from "./verify-node.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keys = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/keys.json"), "utf8"));

function cli(args) {
  return spawnSync(process.execPath, [path.join(root, "spec/verify.mjs"), ...args], { cwd: root, encoding: "utf8" });
}

const signed = [
  ["spec/examples/unpaid-probe.signed.json", "ac16e0eeff1e0d9ffcfc"],
  ["spec/examples/mcp-probe.signed.json", "7850687e1f25d3d38c23"],
  ["spec/examples/mcp-probe.payment.json", "534359eaf4a00dcf0261"],
];

for (const [file, id] of signed) {
  test(`CLI PASS ${file}`, () => {
    const ran = cli([file, "--keys", "spec/examples/keys.json"]);
    assert.equal(ran.status, 0, ran.stderr || ran.stdout);
    assert.match(ran.stdout, new RegExp(`PASS  id ${id}`));
    assert.match(ran.stdout, /PASS  ed25519 receipt signature, key botsrated-prober-1/);
    assert.match(ran.stdout, /\nVALID\n$/);
  });

  test(`library matches CLI ${file}`, async () => {
    const raw = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    const nodeResult = await verifyReceipt(raw, keys, nodeDeps());
    const ran = cli([file, "--keys", "spec/examples/keys.json"]);
    assert.equal(nodeResult.valid, ran.status === 0);
    assert.equal(nodeResult.status, "signature valid");
    assert.equal(verifyResultJson(nodeResult).valid, true);
    assert.equal(verifyResultJson(nodeResult).id, id);
    assert.equal(verifyResultJson(nodeResult).key_id, "botsrated-prober-1");
    assert.deepEqual(verifyResultJson(nodeResult).errors, []);
    let subtle = null;
    try {
      const probe = webcryptoDeps();
      await probe.sha256("ok");
      const pub = keys.keys.find((k) => k.key_id === "botsrated-prober-1").public_key_b64;
      await probe.ed25519(pub, "no", Buffer.from(new Uint8Array(64)).toString("base64"));
      subtle = probe;
    } catch { subtle = null; }
    if (subtle) {
      const web = await verifyReceipt(raw, keys, webcryptoDeps());
      assert.equal(web.valid, nodeResult.valid);
      assert.equal(web.status, nodeResult.status);
      assert.deepEqual(web.errors, nodeResult.errors);
    }
  });
}

test("string payment hint is presentation; object payment stays signed", async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/unpaid-probe.signed.json"), "utf8"));
  const wrapped = {
    receipt: {
      ...raw,
      receipt_url: "https://botsrated.com/receipt/ac16e0eeff1e0d9ffcfc?host=api.exa.ai&day=2026-10-23",
      tx_url: null,
      payment: "none (unpaid probe; no payment header was sent)",
      signature: "ed25519 per-receipt signature (key botsrated-prober-1; see /.well-known/botsrated-key)",
    },
  };
  const result = await verifyReceipt(wrapped, keys, nodeDeps());
  assert.equal(result.status, "signature valid");
  const broken = { receipt: { ...wrapped.receipt, payment: { v: "not-signed" } } };
  const bad = await verifyReceipt(broken, keys, nodeDeps());
  assert.equal(bad.valid, false);
  assert.equal(bad.status, "signature invalid");
});

test("unknown key_id", async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/unpaid-probe.signed.json"), "utf8"));
  raw.sig = { ...raw.sig, key_id: "missing-key" };
  const result = await verifyReceipt(raw, keys, nodeDeps());
  assert.equal(result.status, "key unknown");
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("key_unknown"));
  assert.deepEqual(verifyResultJson(result).errors.includes("key_unknown"), true);
});

test("Accept negotiation keeps JSON for API clients", () => {
  assert.equal(prefersHtml(""), false);
  assert.equal(prefersHtml("*/*"), false);
  assert.equal(prefersHtml("application/json"), false);
  assert.equal(prefersHtml("application/json, text/html;q=0.9"), false);
  assert.equal(prefersHtml("text/html"), true);
  assert.equal(prefersHtml("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), true);
});

test("HTML panel shows receipt fields, MCP query, and CLI", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/mcp-probe.payment.json"), "utf8"));
  const pageUrl = raw.receipt.receipt_url;
  const html = renderReceiptPage(raw, { pageUrl });
  assert.match(html, /id="status">checking signature\u2026<\/h1>/);
  assert.equal(html.includes("stays signature invalid"), false);
  assert.ok(html.includes('<p class="note">Checks /.well-known/botsrated-key with the same rules as spec/verify.mjs. A match covers this record only \u2014 not a seller rating. If this browser can\u2019t run the check, status stays checking signature\u2026</p>'));
  assert.match(html, /Verify signature/);
  assert.match(html, new RegExp(raw.receipt.id));
  assert.match(html, /mcp_probe/);
  assert.match(html, new RegExp(raw.receipt.ts));
  assert.match(html, new RegExp(raw.receipt.host.replace(".", "\\.")));
  assert.match(html, /botsrated-prober-1/);
  assert.match(html, /mcp=53/);
  assert.match(html, /day=2026-10-28/);
  assert.match(html, /s=5fc2f595bd0bec49ef95/);
  assert.match(html, /node spec\/verify\.mjs/);
  assert.match(html, /Map many hosts free in Desk/);
  assert.match(html, /\/v1\/preflight\?url=/);
  assert.match(html, /\/spec\/verify-browser\.mjs/);
  assert.doesNotMatch(html, /signature valid/);
  for (const word of ["verified", "trusted", "scam", "grade"]) {
    assert.equal(new RegExp(`\\b${word}\\b`, "i").test(html), false, word);
  }
  assert.equal(/\bsafe\b/i.test(html), false);
});

function decodeHtml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function preText(html, id) {
  const m = html.match(new RegExp(`id="${id}">([\\s\\S]*?)</pre>`));
  assert.ok(m, id);
  return decodeHtml(m[1]);
}

test("CLI paste drops shell metacharacters in id and query", () => {
  const evilUrl = "https://evil.example/receipt/$(id)?host=$(id)&mcp=`id`&day=$(date)&s=$(id)&extra=$(id)";
  const bad = renderReceiptPage({
    receipt: { id: "$(id)", kind: "mcp_probe", host: "$(id)", ts: "2026-10-28T00:00:00Z", sig: { key_id: "k" } },
  }, { pageUrl: evilUrl });
  const badCli = preText(bad, "cli");
  const badOne = preText(bad, "cli-oneliner");
  assert.equal(badCli, "node spec/verify.mjs");
  assert.equal(receiptCliUrl("$(id)", evilUrl, "$(id)"), "");
  assert.equal(quoteShellArg("https://botsrated.com/receipt/$(id)"), "");
  for (const text of [badCli, badOne]) {
    assert.doesNotMatch(text, /\$\(id\)/);
    assert.doesNotMatch(text, /\$\(date\)/);
    assert.doesNotMatch(text, /`/);
    assert.doesNotMatch(text, /evil\.example/);
  }

  const id = "534359eaf4a00dcf0261";
  const html = renderReceiptPage({
    receipt: { id, kind: "mcp_probe", host: "mcp.offendersearch.app", ts: "2026-10-28T02:39:48Z", sig: { key_id: "botsrated-prober-1" } },
  }, { pageUrl: "https://evil.example/receipt/" + id + "?mcp=$(id)&day=2026-10-28&s=5fc2f595bd0bec49ef95&host=`id`" });
  const cli = preText(html, "cli");
  const one = preText(html, "cli-oneliner");
  assert.match(cli, /^node spec\/verify\.mjs 'https:\/\/botsrated\.com\/receipt\/534359eaf4a00dcf0261\?host=mcp\.offendersearch\.app&day=2026-10-28&s=5fc2f595bd0bec49ef95'$/);
  assert.doesNotMatch(cli, /"/);
  assert.doesNotMatch(cli, /\$\(/);
  assert.doesNotMatch(cli, /`/);
  assert.match(one, /verify-core\.mjs/);
  assert.match(one, /verify-node\.mjs/);
  assert.match(one, /ref=main/);
  assert.match(one, / 'https:\/\/botsrated\.com\/receipt\/534359eaf4a00dcf0261\?host=mcp\.offendersearch\.app&day=2026-10-28&s=5fc2f595bd0bec49ef95'$/);
  const arg = cli.slice("node spec/verify.mjs ".length);
  const ran = spawnSync("bash", ["--noprofile", "--norc", "-c", "id(){ printf PWNED; }; printf %s " + arg], { encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout.includes("PWNED"), false);
  assert.equal(ran.stdout.includes("$("), false);
  assert.equal(ran.stdout.includes("`"), false);
  assert.match(ran.stdout, /^https:\/\/botsrated\.com\/receipt\/534359eaf4a00dcf0261\?/);
});

test("missing WebCrypto is not a pass", async () => {
  assert.equal(signatureStatus({ status: "signature valid" }, false), "signature invalid");
  assert.equal(signatureStatus(null, true), "signature invalid");
  assert.equal(signatureStatus({ status: "signature valid" }, true), "signature valid");
  assert.equal(signatureStatus({ status: "key unknown" }, true), "key unknown");
  const cryptoOk = await ed25519WebCryptoAvailable();
  if (cryptoOk) assert.equal(signatureStatus({ status: "signature valid" }, cryptoOk), "signature valid");
});

test("preflight fixture still carries a receipt link", () => {
  const found = JSON.parse(fs.readFileSync(path.join(root, "integrations/fixtures/preflight-found.json"), "utf8"));
  assert.match(found.latest_probe.receipt_url, /^https:\/\/botsrated\.com\/receipt\/[0-9a-f]{20}\?host=[^&]+&day=\d{4}-\d{2}-\d{2}$/);
  const missing = JSON.parse(fs.readFileSync(path.join(root, "integrations/fixtures/preflight-not-covered.json"), "utf8"));
  assert.equal(missing.latest_probe, undefined);
  assert.equal(missing.error.code, "host_not_covered");
});

test("banned words stay out of the verify UI sources", () => {
  const files = ["spec/verify-core.mjs", "spec/verify-node.mjs", "spec/verify.mjs", "spec/verify-browser.mjs", "spec/receipt-page.mjs"];
  const banned = /\b(verified|trusted|scam|grade)\b|\bsafe\b/i;
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(banned.test(text), false, file);
  }
});

test("CLI usage and files copied side by side still PASS", () => {
  const usage = cli([]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: node verify\.mjs/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "botsrated-verify-"));
  try {
    for (const name of ["verify.mjs", "verify-core.mjs", "verify-node.mjs"]) {
      fs.copyFileSync(path.join(root, "spec", name), path.join(dir, name));
    }
    const ran = spawnSync(process.execPath, [path.join(dir, "verify.mjs"), path.join(root, "spec/examples/mcp-probe.payment.json"), "--keys", path.join(root, "spec/examples/keys.json")], { encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr || ran.stdout);
    assert.match(ran.stdout, /\nVALID\n$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
