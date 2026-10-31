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
  assert.match(html, /id="status">signature invalid/);
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
