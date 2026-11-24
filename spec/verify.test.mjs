import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkBooth, DATASET_SIG_URL, DATASET_URL, KEYS_URL, mountBooth, parseBoothInput, receiptBoothUrl, signatureStatus as boothStatus, softGuardOn } from "./courthouse/verify-booth.mjs";
import { prefersHtml, quoteShellArg, receiptCliUrl, renderReceiptPage, signatureStatus, verifyResultJson } from "./receipt-page.mjs";
import { ed25519WebCryptoAvailable } from "./verify-browser.mjs";
import { canon, jcs, hasNonIntegerNumber, verifyReceipt, webcryptoDeps } from "./verify-core.mjs";
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

test("a key_id that names an Object.prototype property is an unknown key, not a crash", async () => {
  for (const kid of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    const r = await verifyReceipt({ id: "x", kind: "unpaid_probe", probe_version: 1, ts: "2026-11-01T00:00:00Z", host: "a.example", sig: { key_id: kid, sig_b64: "AAAA" } }, keys, nodeDeps());
    assert.equal(r.valid, false, kid);
    assert.equal(r.status, "key unknown", kid);
    assert.ok(r.errors.includes("key_unknown"), kid);
  }
});

test("a malformed signature or key list is a failed check, not a crash", async () => {
  const listed = keys.keys[0].key_id;
  const receipt = (sig) => ({ id: "x", kind: "unpaid_probe", probe_version: 1, ts: "2026-11-01T00:00:00Z", host: "a.example", sig });
  const notBase64 = await verifyReceipt(receipt({ key_id: listed, sig_b64: "!!! not base64 !!!" }), keys, nodeDeps());
  assert.equal(notBase64.valid, false);
  assert.ok(notBase64.errors.includes("signature_mismatch"));
  const noList = await verifyReceipt(receipt({ key_id: listed, sig_b64: "AAAA" }), { keys: "not a list" }, nodeDeps());
  assert.equal(noList.status, "key unknown");
  const junk = await verifyReceipt(receipt({ key_id: listed, sig_b64: "AAAA" }), { keys: [null, 5, { key_id: 7 }, { key_id: listed }] }, nodeDeps());
  assert.equal(junk.status, "key unknown");
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
  assert.equal(signatureStatus({ status: "redacted copy" }, false), "redacted copy");
  assert.equal(boothStatus({ status: "redacted copy" }, false), "redacted copy");
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
  const files = [
    "spec/verify-core.mjs", "spec/verify-node.mjs", "spec/verify.mjs", "spec/verify-browser.mjs", "spec/receipt-page.mjs",
    "spec/courthouse/index.html", "spec/courthouse/verify-booth.mjs", "spec/courthouse/verify-core.mjs", "spec/courthouse/README.md",
  ];
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

function jsonResponse(body, status = 200) {
  const raw = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return JSON.parse(raw); },
    async arrayBuffer() { return new TextEncoder().encode(raw).buffer; },
  };
}

function fakeDoc() {
  const els = {};
  for (const id of ["soft-guard", "check-btn", "paste", "status", "f-id", "f-kind", "f-ts", "f-host", "f-key"]) {
    els[id] = { hidden: false, textContent: "", disabled: false, value: "", listeners: {} };
    els[id].addEventListener = (type, fn) => { els[id].listeners[type] = fn; };
  }
  return { getElementById: (id) => els[id] || null, els };
}

test("courthouse verify-core matches spec/verify-core.mjs and verify-booth imports it", async () => {
  const booth = await import("./courthouse/verify-booth.mjs");
  assert.equal(typeof booth.receiptBoothUrl, "function");
  assert.equal(typeof booth.checkBooth, "function");
  const copy = fs.readFileSync(path.join(root, "spec/courthouse/verify-core.mjs"));
  const parent = fs.readFileSync(path.join(root, "spec/verify-core.mjs"));
  assert.equal(copy.equals(parent), true);
  assert.equal(createHash("sha256").update(copy).digest("hex"), createHash("sha256").update(parent).digest("hex"));
  const src = fs.readFileSync(path.join(root, "spec/courthouse/verify-booth.mjs"), "utf8");
  assert.match(src, /from "\.\/verify-core\.mjs"/);
  assert.doesNotMatch(src, /receipt-page|verify-node|from "node:|localStorage|sessionStorage|indexedDB/);
});

test("courthouse link allowlist matches receiptCliUrl and drops other query keys", () => {
  const id = "ac16e0eeff1e0d9ffcfc";
  const queries = [
    "",
    "?host=api.exa.ai",
    "?host=api.exa.ai&day=2026-10-23",
    "?mcp=53&day=2026-10-28&s=5fc2f595bd0bec49ef95",
    "?host=mcp.offendersearch.app&mcp=53&day=2026-10-28&s=5fc2f595bd0bec49ef95",
  ];
  for (const q of queries) {
    const built = receiptCliUrl(id, q, "");
    assert.equal(receiptBoothUrl(built), built);
    assert.equal(parseBoothInput("'" + built + "'").url, built);
  }
  const messy = "https://botsrated.com/receipt/" + id + "?day=2026-10-23&host=api.exa.ai&next=https://evil.example&token=sekret";
  assert.equal(receiptBoothUrl(messy), "https://botsrated.com/receipt/" + id + "?host=api.exa.ai&day=2026-10-23");
  assert.equal(receiptBoothUrl("https://botsrated.com/receipt/" + id + "?host=$(id)&day=2026-10-23"), "https://botsrated.com/receipt/" + id + "?day=2026-10-23");
  for (const bad of [
    "https://evil.example/receipt/" + id,
    "http://botsrated.com/receipt/" + id,
    "https://user:pw@botsrated.com/receipt/" + id,
    "https://botsrated.com/receipt/" + id + "/extra",
    "javascript:alert(1)",
    "https://botsrated.com.evil/receipt/" + id,
  ]) {
    assert.equal(receiptBoothUrl(bad), "", bad);
  }
});

test("courthouse booth reuses signed receipt vectors", async () => {
  for (const [file, id] of signed) {
    const raw = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (url === KEYS_URL) return jsonResponse(keys);
      throw new Error("unexpected " + url);
    };
    const out = await checkBooth(JSON.stringify(raw), { fetchImpl, cryptoOk: true, deps: nodeDeps() });
    assert.equal(out.status, "signature valid", file);
    assert.equal(out.fields.id, id);
    assert.equal(out.fields.key_id, "botsrated-prober-1");
    assert.deepEqual(calls, [KEYS_URL]);
    const nodeResult = await verifyReceipt(raw, keys, nodeDeps());
    assert.equal(out.status, nodeResult.status);
  }
  const raw = JSON.parse(fs.readFileSync(path.join(root, signed[0][0]), "utf8"));
  const unknown = { ...raw, sig: { ...raw.sig, key_id: "missing-key" } };
  const missing = await checkBooth(JSON.stringify(unknown), {
    fetchImpl: async (url) => url === KEYS_URL ? jsonResponse(keys) : jsonResponse({}),
    cryptoOk: true,
    deps: nodeDeps(),
  });
  assert.equal(missing.status, "key unknown");
  const tampered = { ...raw, host: "not-the-signed-host.example" };
  const badSig = await checkBooth(JSON.stringify(tampered), {
    fetchImpl: async (url) => url === KEYS_URL ? jsonResponse(keys) : jsonResponse({}),
    cryptoOk: true,
    deps: nodeDeps(),
  });
  assert.equal(badSig.status, "signature invalid");
  let subtle = null;
  try {
    const probe = webcryptoDeps();
    await probe.sha256("ok");
    const pub = keys.keys.find((k) => k.key_id === "botsrated-prober-1").public_key_b64;
    await probe.ed25519(pub, "no", Buffer.from(new Uint8Array(64)).toString("base64"));
    subtle = probe;
  } catch { subtle = null; }
  if (subtle) {
    const web = await checkBooth(JSON.stringify(raw), {
      fetchImpl: async (url) => url === KEYS_URL ? jsonResponse(keys) : jsonResponse({}),
      cryptoOk: true,
    });
    assert.equal(web.status, "signature valid");
  }
});

test("courthouse booth fetches only an allowlisted receipt link", async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/unpaid-probe.signed.json"), "utf8"));
  const id = raw.id;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (url === KEYS_URL) return jsonResponse(keys);
    if (url === "https://botsrated.com/receipt/" + id + "?host=api.exa.ai&day=2026-10-23") return jsonResponse(raw);
    throw new Error("unexpected " + url);
  };
  const pasted = "https://botsrated.com/receipt/" + id + "?host=api.exa.ai&day=2026-10-23&extra=1";
  const out = await checkBooth(pasted, { fetchImpl, cryptoOk: true, deps: nodeDeps() });
  assert.equal(out.status, "signature valid");
  assert.deepEqual(calls, [KEYS_URL, "https://botsrated.com/receipt/" + id + "?host=api.exa.ai&day=2026-10-23"]);
  const evilCalls = [];
  const evil = await checkBooth("https://evil.example/receipt/" + id + "?host=$(id)", {
    fetchImpl: async (url) => { evilCalls.push(String(url)); return jsonResponse(keys); },
    cryptoOk: true,
    deps: nodeDeps(),
  });
  assert.equal(evil.status, "signature invalid");
  assert.deepEqual(evilCalls, []);
  const noCrypto = await checkBooth(JSON.stringify(raw), {
    fetchImpl: async (url) => { evilCalls.push(String(url)); return jsonResponse(keys); },
    cryptoOk: false,
    deps: nodeDeps(),
  });
  assert.equal(noCrypto.status, "signature invalid");
  assert.deepEqual(evilCalls, []);
  const keyDown = await checkBooth(pasted, {
    fetchImpl: async () => { throw new Error("offline"); },
    cryptoOk: true,
    deps: nodeDeps(),
  });
  assert.equal(keyDown.status, "key unknown");
});

test("withheld receipt is a redacted copy and the full example stays VALID", async () => {
  const file = "spec/examples/unpaid-probe.withheld.json";
  const raw = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const result = await verifyReceipt(raw, keys, nodeDeps());
  assert.equal(result.status, "redacted copy");
  assert.equal(result.valid, false);
  assert.equal(result.ok, false);
  assert.equal(result.offline_verifiable, false);
  assert.deepEqual(result.errors, ["redacted_copy"]);
  assert.equal(result.id, "ac16e0eeff1e0d9ffcfc");
  const text = result.lines.join("\n");
  assert.equal(result.lines.some((line) => line.startsWith("FAIL")), false);
  assert.equal(text.includes("signature invalid"), false);
  assert.match(text, /not offline-verifiable/);
  assert.match(text, /GET https:\/\/botsrated\.com\/v1\/verify\?id=ac16e0eeff1e0d9ffcfc&host=api\.exa\.ai&day=2026-10-23/);
  const body = verifyResultJson(result);
  assert.equal(body.valid, false);
  assert.equal(body.status, "redacted copy");
  assert.equal(body.offline_verifiable, false);
  assert.deepEqual(body.errors, ["redacted_copy"]);
  const ran = cli([file, "--keys", "spec/examples/keys.json"]);
  assert.equal(ran.status, 3, ran.stderr || ran.stdout);
  assert.match(ran.stdout, /\nREDACTED\n$/);
  assert.doesNotMatch(ran.stdout, /INVALID/);
  assert.doesNotMatch(ran.stdout, /FAIL/);
  assert.doesNotMatch(ran.stdout, /signature invalid/);
  const fullRan = cli(["spec/examples/unpaid-probe.signed.json", "--keys", "spec/examples/keys.json"]);
  assert.equal(fullRan.status, 0, fullRan.stderr || fullRan.stdout);
  assert.match(fullRan.stdout, /\nVALID\n$/);

  const full = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/unpaid-probe.signed.json"), "utf8"));
  const marked = await verifyReceipt({ ...full, withheld_fields: ["listed_amount"], withheld_note: "withheld" }, keys, nodeDeps());
  assert.equal(marked.status, "redacted copy");
  assert.equal(marked.valid, false);
  const wrappedOnly = { withheld_fields: ["listed_amount"], withheld_note: "withheld", receipt: full };
  const outer = await verifyReceipt(wrappedOnly, keys, nodeDeps());
  assert.equal(outer.status, "redacted copy");
  const tampered = { ...full };
  delete tampered.listed_amount;
  delete tampered.listed_payTo;
  const bad = await verifyReceipt(tampered, keys, nodeDeps());
  assert.equal(bad.status, "signature invalid");
  assert.equal(bad.errors.includes("redacted_copy"), false);

  const pageUrl = "https://botsrated.com/receipt/ac16e0eeff1e0d9ffcfc?host=api.exa.ai&day=2026-10-23";
  const html = renderReceiptPage(raw, { pageUrl });
  assert.match(html, /id="status">redacted copy</);
  assert.doesNotMatch(html, /node spec\/verify\.mjs/);
  assert.doesNotMatch(html, /verify-core\.mjs/);
  assert.doesNotMatch(html, /signature invalid/);
  assert.doesNotMatch(html, /checking signature/);
  assert.match(html, /not offline-verifiable/);
  assert.match(html, /Stored record: GET https:\/\/botsrated\.com\/v1\/verify\?id=ac16e0eeff1e0d9ffcfc&amp;host=api\.exa\.ai&amp;day=2026-10-23/);
  assert.match(html, /Map many hosts free in Desk/);
  assert.doesNotMatch(html, /id="verify-btn"/);
  for (const word of ["verified", "trusted", "scam", "grade"]) {
    assert.equal(new RegExp(`\\b${word}\\b`, "i").test(html), false, word);
  }
  assert.equal(/\bsafe\b/i.test(html), false);
  const evil = renderReceiptPage({
    receipt: {
      id: "ac16e0eeff1e0d9ffcfc",
      host: "$(id)",
      ts: "2026-10-23T00:00:00Z",
      withheld_fields: ["listed_amount"],
      withheld_note: "withheld",
      sig: { key_id: "k" },
    },
  }, { pageUrl: "https://evil.example/receipt/ac16e0eeff1e0d9ffcfc?host=$(id)" });
  const evilCli = preText(evil, "cli");
  const evilOne = preText(evil, "cli-oneliner");
  assert.doesNotMatch(evilCli, /\$\(id\)/);
  assert.doesNotMatch(evilOne, /\$\(id\)/);
  assert.doesNotMatch(evilCli + "\n" + evilOne, /node spec\/verify/);
  assert.match(evil, /redacted copy/);
  assert.equal(evilOne, "Stored record: GET https://botsrated.com/v1/verify?id=ac16e0eeff1e0d9ffcfc&day=2026-10-23");
});

test("courthouse withheld paste is a redacted copy", async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/unpaid-probe.withheld.json"), "utf8"));
  const url = "https://botsrated.com/receipt/ac16e0eeff1e0d9ffcfc?host=api.exa.ai&day=2026-10-23";
  const noFetch = [];
  const pasted = await checkBooth(JSON.stringify(raw), {
    fetchImpl: async (target) => { noFetch.push(String(target)); throw new Error("no fetch"); },
    cryptoOk: false,
  });
  assert.equal(pasted.status, "redacted copy");
  assert.equal(pasted.fields.id, "ac16e0eeff1e0d9ffcfc");
  assert.deepEqual(noFetch, []);
  const calls = [];
  const fetched = await checkBooth(url, {
    fetchImpl: async (target) => {
      calls.push(String(target));
      if (target === KEYS_URL) return jsonResponse(keys);
      if (target === url) return jsonResponse(raw);
      throw new Error("unexpected " + target);
    },
    cryptoOk: true,
    deps: nodeDeps(),
  });
  assert.equal(fetched.status, "redacted copy");
  assert.deepEqual(calls, [KEYS_URL, url]);
  const peeked = [];
  const noCrypto = await checkBooth(url, {
    fetchImpl: async (target) => {
      peeked.push(String(target));
      if (target === url) return jsonResponse(raw);
      throw new Error("unexpected " + target);
    },
    cryptoOk: false,
  });
  assert.equal(noCrypto.status, "redacted copy");
  assert.deepEqual(peeked, [url]);
  assert.equal(softGuardOn("?soft=1"), true);
  assert.equal(softGuardOn(""), false);
});

test("courthouse unsigned receipt asks for the snapshot and the page keeps Soft Guard off", async () => {
  const legacy = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/unpaid-probe.legacy.json"), "utf8"));
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (url === KEYS_URL) return jsonResponse(keys);
    if (url === DATASET_URL) return jsonResponse({});
    if (url === DATASET_SIG_URL) return jsonResponse({ sha256: "00", key_id: "botsrated-prober-1", public_key_b64: keys.keys[0].public_key_b64, signature_b64: "AA==", generated_at: "2026-10-23T12:00:00Z" });
    throw new Error("unexpected " + url);
  };
  const out = await checkBooth(JSON.stringify(legacy), { fetchImpl, cryptoOk: true, deps: nodeDeps() });
  assert.equal(["signature valid", "signature invalid", "key unknown"].includes(out.status), true);
  assert.equal(calls.includes(DATASET_URL), true);
  assert.equal(calls.includes(DATASET_SIG_URL), true);
  assert.equal(boothStatus({ status: "signature valid" }, false), signatureStatus({ status: "signature valid" }, false));
  assert.equal(boothStatus({ status: "key unknown" }, true), "key unknown");
  assert.equal(softGuardOn(""), false);
  assert.equal(softGuardOn("?soft=1"), true);
  assert.equal(softGuardOn("?soft=0"), false);
  assert.equal(softGuardOn("https://127.0.0.1:8765/?soft=1#paste"), true);
  const doc = fakeDoc();
  mountBooth(doc, "");
  assert.equal(doc.els["soft-guard"].hidden, true);
  mountBooth(doc, "?soft=1");
  assert.equal(doc.els["soft-guard"].hidden, false);
  doc.els.paste.value = JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, signed[0][0]), "utf8")));
  const clicked = [];
  const live = fakeDoc();
  live.els.paste.value = doc.els.paste.value;
  mountBooth(live, "", (text) => checkBooth(text, {
    fetchImpl: async (url) => {
      clicked.push(String(url));
      if (url === KEYS_URL) return jsonResponse(keys);
      throw new Error("unexpected " + url);
    },
    cryptoOk: true,
    deps: nodeDeps(),
  }));
  await live.els["check-btn"].listeners.click();
  assert.equal(live.els.status.textContent, "signature valid");
  assert.equal(live.els["soft-guard"].hidden, true);
  assert.deepEqual(clicked, [KEYS_URL]);
  const html = fs.readFileSync(path.join(root, "spec/courthouse/index.html"), "utf8");
  assert.match(html, /id="status">signature invalid/);
  assert.match(html, /id="soft-guard" hidden/);
  assert.match(html, /A matching signature checks this record only\. It is not a rating of the seller\./);
  assert.match(html, /src="\.\/verify-booth\.mjs"/);
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB/);
  assert.equal(/\b(safe|trusted|verified|scam|risky|ranking)\b/i.test(html), false);
  const readme = fs.readFileSync(path.join(root, "spec/courthouse/README.md"), "utf8");
  assert.match(readme, /file:\/\//);
  assert.match(readme, /Claim ceiling/);
  assert.match(readme, /no share store/);
  assert.equal(/\b(safe|trusted|verified|scam|risky|ranking)\b/i.test(readme), false);
  const boothSrc = fs.readFileSync(path.join(root, "spec/courthouse/verify-booth.mjs"), "utf8");
  assert.equal(/\b(safe|trusted|verified|scam|risky|ranking)\b/i.test(boothSrc), false);
});

test("fast-tier receipt: id without tier and confirms passes, signature still covers them", async () => {
  const file = "spec/examples/unpaid-probe.fast-tier.json";
  const ran = cli([file, "--keys", "spec/examples/keys.json"]);
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  assert.match(ran.stdout, /PASS  id b56e905c2a1db40627ac \(sha256\(canonical JSON without tier and confirms\), fast-tier rule\)/);
  assert.match(ran.stdout, /\nVALID\n$/);
  const raw = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  for (const change of [(r) => { r.tier = "fast_s"; }, (r) => { r.confirms.ts = "2026-11-10T00:00:00Z"; }, (r) => { delete r.confirms; }, (r) => { r.status = 200; }]) {
    const t = JSON.parse(JSON.stringify(raw));
    change(t);
    const res = await verifyReceipt(t, keys, nodeDeps());
    assert.equal(res.valid, false);
  }
});

test("fast-tier fallback does not apply without tier or confirms", async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/unpaid-probe.fast-tier.json"), "utf8"));
  const { tier, confirms, ...rest } = raw;
  const res = await verifyReceipt(rest, keys, nodeDeps());
  assert.equal(res.valid, false);
});


function b64(buf) {
  return Buffer.from(buf).toString("base64");
}

async function ephemeralEd25519() {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return {
    public_key_b64: b64(raw),
    async sign(message) {
      const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
      return b64(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, bytes));
    },
  };
}

test("jcs matches canon for strings, booleans, null and integers, and rejects floats", () => {
  const samples = [null, true, false, 0, 1, -3, "ok", "", { b: 1, a: "x" }, [1, "a", false, null], { nest: { z: 2, a: [0] } }];
  for (const v of samples) {
    const out = jcs(v);
    assert.equal(out.error, undefined, JSON.stringify(v));
    assert.equal(out.text, canon(v));
  }
  assert.equal(jcs(0.007).error, "non-integer number");
  assert.equal(hasNonIntegerNumber({ paid_usd: 0.007 }), true);
  assert.equal(hasNonIntegerNumber({ paid_amount_atomic: "7000", block: 123 }), false);
});

test("v2 paid receipt verifies; v1 examples still pass; floats and unknown versions fail", async () => {
  const signer = await ephemeralEd25519();
  const kid = "botsrated-test-paid-2";
  const keyset = {
    as_of: "2026-11-18T16:26:00Z",
    keys: [{
      key_id: kid,
      alg: "ed25519",
      public_key_b64: signer.public_key_b64,
      status: "active",
      valid_from: "2026-11-18T16:26:00Z",
      valid_until: null,
    }],
  };
  const unsigned = {
    kind: "paid_test_buy",
    record_version: 2,
    ts: "2026-11-18T16:30:00Z",
    host: "self-test.invalid",
    url: "https://self-test.invalid/pay",
    method: "GET",
    network: "eip155:8453",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    payTo: "0x0000000000000000000000000000000000000001",
    quoted_amount_atomic: "7000",
    paid_amount_atomic: "7000",
    charged_as_quoted: true,
    tx_hash: "0x" + "11".repeat(32),
    delivered: true,
    non_empty: true,
    schema_valid: true,
    looks_correct: true,
    round: "signer-self-test",
  };
  const id = (await nodeDeps().sha256(jcs(unsigned).text)).slice(0, 20);
  const withId = { ...unsigned, id };
  const sig_b64 = await signer.sign(jcs(withId).text);
  const signed = { ...withId, sig: { alg: "ed25519", key_id: kid, sig_b64, signed: "RFC 8785 JCS of this receipt without the sig field" } };

  const good = await verifyReceipt(signed, keyset, nodeDeps());
  assert.equal(good.ok, true, good.lines.join("\n"));
  assert.equal(good.status, "signature valid");
  assert.match(good.lines.join("\n"), /PASS  id .*sha256\(RFC 8785 JCS\)/);
  assert.match(good.lines.join("\n"), /INFO  signed by BotsRated key botsrated-test-paid-2/);
  assert.match(good.lines.join("\n"), /INFO  key list as of 2026-11-18T16:26:00Z/);

  const withFloat = { ...signed, paid_usd: 0.007 };
  const badFloat = await verifyReceipt(withFloat, keyset, nodeDeps());
  assert.equal(badFloat.ok, false);
  assert.ok(badFloat.errors.includes("v2_float") || badFloat.errors.includes("v2_float_field"));

  const unknown = await verifyReceipt({ ...signed, record_version: 3 }, keyset, nodeDeps());
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.includes("unknown_record_version"));

  const revokedSet = {
    keys: [{ ...keyset.keys[0], status: "revoked" }],
  };
  const revoked = await verifyReceipt(signed, revokedSet, nodeDeps());
  assert.equal(revoked.ok, false);
  assert.ok(revoked.errors.includes("key_revoked"));

  // Existing signed v1 examples still pass, and must not grow a v2 error.
  for (const file of ["spec/examples/unpaid-probe.signed.json", "spec/examples/mcp-probe.signed.json", "spec/examples/mcp-probe.payment.json"]) {
    const raw = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    const res = await verifyReceipt(raw, keys, nodeDeps());
    assert.equal(res.ok, true, file + "\n" + res.lines.join("\n"));
    assert.equal(res.errors.includes("unknown_record_version"), false);
    assert.equal(res.errors.includes("v2_float"), false);
  }
});

const retried = [
  ["spec/examples/unpaid-probe.retried.json", "b96e2e4cb9816e6fe3d5", "sha256\\(canonical JSON without first_attempt\\), re-check rule"],
  ["spec/examples/unpaid-probe.retried.fast-tier.json", "7dc8004966734718de11", "sha256\\(canonical JSON without first_attempt, tier and confirms\\), re-check and fast-tier rule"],
];

for (const [file, id, rule] of retried) {
  test(`re-checked receipt: id without first_attempt passes, signature still covers it (${file})`, async () => {
    const ran = cli([file, "--keys", "spec/examples/keys.json"]);
    assert.equal(ran.status, 0, ran.stderr || ran.stdout);
    assert.match(ran.stdout, new RegExp(`PASS  id ${id} \\(${rule}\\)`));
    assert.match(ran.stdout, /PASS  ed25519 receipt signature, key botsrated-prober-1/);
    assert.match(ran.stdout, /\nVALID\n$/);
    const raw = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    const ok = await verifyReceipt(raw, keys, nodeDeps());
    assert.equal(ok.valid, true);
    assert.deepEqual(ok.errors, []);
  });

  test(`re-checked receipt: a tampered first_attempt fails (${file})`, async () => {
    const raw = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    const changes = [
      (r) => { r.first_attempt.error = null; },
      (r) => { r.first_attempt.ts = "2026-11-01T00:00:00Z"; },
      (r) => { r.first_attempt.latency_ms = 1; },
      (r) => { r.first_attempt.extra = true; },
      (r) => { delete r.first_attempt; },
      (r) => { r.first_attempt = "timeout"; },
      (r) => { r.status = 402; },
    ];
    for (const change of changes) {
      const t = JSON.parse(JSON.stringify(raw));
      change(t);
      const res = await verifyReceipt(t, keys, nodeDeps());
      assert.equal(res.valid, false, `tampered copy passed: ${change}`);
      assert.ok(res.errors.includes("signature_mismatch") || res.errors.includes("id_mismatch"), res.errors.join(","));
    }
  });

  test(`re-check rule needs a per-receipt signature (${file})`, async () => {
    const raw = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    const { sig, ...unsigned } = raw;
    const res = await verifyReceipt(unsigned, keys, nodeDeps());
    assert.equal(res.valid, false);
    assert.ok(res.errors.includes("id_mismatch"), res.errors.join(","));
  });
}

test("re-check rule does not let a first_attempt be added to a receipt signed without one", async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/unpaid-probe.signed.json"), "utf8"));
  raw.first_attempt = { ts: raw.ts, error: "Timeout", latency_ms: 15000, note: "timeout or network error, re-checked once before counting" };
  const res = await verifyReceipt(raw, keys, nodeDeps());
  assert.equal(res.valid, false);
  assert.ok(res.errors.includes("signature_mismatch"), res.errors.join(","));
});

// Optional bulk check against a local NDJSON file of re-checked receipts (one signed receipt per line), e.g. a
// restore-drill export. The file is not in this repo. Set BOTSRATED_RETRIED_RECEIPTS=/path/to/file.ndjson to run it.
const bulkFile = process.env.BOTSRATED_RETRIED_RECEIPTS;
test("bulk: every re-checked receipt in BOTSRATED_RETRIED_RECEIPTS verifies, and a tampered first_attempt fails", { skip: !bulkFile && "set BOTSRATED_RETRIED_RECEIPTS to run" }, async () => {
  const lines = fs.readFileSync(bulkFile, "utf8").split("\n").filter(Boolean);
  assert.ok(lines.length > 0);
  const prober = JSON.parse(fs.readFileSync(path.join(root, "spec/examples/keys.json"), "utf8"));
  let checked = 0;
  for (const line of lines) {
    const raw = JSON.parse(line);
    assert.ok(raw.first_attempt && typeof raw.first_attempt === "object", `line without first_attempt: ${raw.id}`);
    const res = await verifyReceipt(raw, prober, nodeDeps());
    assert.equal(res.valid, true, `${raw.id}: ${res.errors.join(",")}`);
    assert.match(res.lines.find((l) => l.includes(`id ${raw.id}`)), /re-check/);
    const t = JSON.parse(line);
    t.first_attempt.error = "tampered";
    const bad = await verifyReceipt(t, prober, nodeDeps());
    assert.equal(bad.valid, false, `tampered ${raw.id} passed`);
    checked++;
  }
  assert.equal(checked, lines.length);
});
