// Browser entry for the courthouse booth. Imports ./verify-core.mjs (byte copy of ../verify-core.mjs).
// Paste a receipt link or JSON. Status is signature valid, signature invalid, or key unknown.
// A link is fetched only after it is rebuilt to https://botsrated.com/receipt/<20 hex> plus host, mcp, day, and s.
// Keys come from https://botsrated.com/.well-known/botsrated-key.
// A matching signature checks this record only. It is not a rating of the seller.
// The Attach Guard link stays hidden unless the page search has soft=1.
import { verifyReceipt, webcryptoDeps } from "./verify-core.mjs";

export const KEYS_URL = "https://botsrated.com/.well-known/botsrated-key";
export const DATASET_URL = "https://botsrated.com/dataset.json";
export const DATASET_SIG_URL = "https://botsrated.com/dataset.sig.json";

const RECEIPT_ID = /^[0-9a-f]{20}$/;
const HOST_Q = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const MCP_Q = /^[0-9]{1,6}$/;
const DAY_Q = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const S_Q = /^[0-9a-f]{20}$/;
const BOOTH_URL = /^https:\/\/botsrated\.com\/receipt\/[0-9a-f]{20}(?:\?(?:host|mcp|day|s)=[a-z0-9.-]+(?:&(?:host|mcp|day|s)=[a-z0-9.-]+)*)?$/i;

const FETCH_INIT = { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" };

export function signatureStatus(result, cryptoOk) {
  if (!cryptoOk || !result) return "signature invalid";
  if (result.status === "signature valid" || result.status === "signature invalid" || result.status === "key unknown") return result.status;
  return "signature invalid";
}

export function softGuardOn(search) {
  const raw = String(search ?? "");
  const q = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw.replace(/^\?/, "");
  const hash = q.indexOf("#");
  return new URLSearchParams(hash >= 0 ? q.slice(0, hash) : q).get("soft") === "1";
}

function emptyFields() {
  return { id: "", kind: "", ts: "", host: "", key_id: "" };
}

function fieldsOf(raw) {
  const r = raw && typeof raw === "object" && raw.receipt && typeof raw.receipt === "object" ? raw.receipt : raw;
  if (!r || typeof r !== "object") return emptyFields();
  return {
    id: typeof r.id === "string" ? r.id : "",
    kind: typeof r.kind === "string" ? r.kind : "",
    ts: typeof r.ts === "string" ? r.ts : "",
    host: typeof r.host === "string" ? r.host : "",
    key_id: r.sig && typeof r.sig.key_id === "string" ? r.sig.key_id : "",
  };
}

// Same allowlists as receiptCliUrl. The returned string is the only URL the booth fetches.
export function receiptBoothUrl(input) {
  let url;
  try { url = new URL(String(input).trim()); }
  catch { return ""; }
  if (url.protocol !== "https:" || url.hostname !== "botsrated.com" || url.username || url.password || url.port) return "";
  const m = /^\/receipt\/([0-9a-f]{20})$/i.exec(url.pathname);
  if (!m) return "";
  const id = m[1].toLowerCase();
  if (!RECEIPT_ID.test(id)) return "";
  const parts = [];
  const host = url.searchParams.get("host");
  const mcp = url.searchParams.get("mcp");
  const day = url.searchParams.get("day");
  const s = url.searchParams.get("s");
  if (host && HOST_Q.test(host)) parts.push("host=" + host);
  if (mcp && MCP_Q.test(mcp)) parts.push("mcp=" + mcp);
  if (day && DAY_Q.test(day)) parts.push("day=" + day);
  if (s && S_Q.test(s)) parts.push("s=" + s);
  const qs = parts.join("&");
  const out = "https://botsrated.com/receipt/" + id + (qs ? "?" + qs : "");
  return BOOTH_URL.test(out) ? out : "";
}

export function parseBoothInput(text) {
  let s = String(text ?? "").replace(/^\uFEFF/, "").trim();
  if (s.length >= 2 && ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')))) s = s.slice(1, -1).trim();
  if (!s) return { kind: "empty" };
  if (s.startsWith("{")) {
    try {
      const value = JSON.parse(s);
      if (value && typeof value === "object" && !Array.isArray(value)) return { kind: "json", value };
    } catch { /* fall through */ }
    return { kind: "bad" };
  }
  const url = receiptBoothUrl(s);
  return url ? { kind: "url", url } : { kind: "bad" };
}

export async function ed25519WebCryptoAvailable() {
  const subtle = globalThis.crypto && crypto.subtle;
  if (!subtle || typeof subtle.importKey !== "function" || typeof subtle.verify !== "function" || typeof subtle.digest !== "function") return false;
  try {
    const raw = new Uint8Array(32);
    raw[0] = 1;
    await subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    return true;
  } catch {
    return false;
  }
}

async function readOk(res) {
  if (!res || !res.ok) throw new Error(String(res && res.status));
  return res;
}

export async function checkBooth(text, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cryptoOk = Object.prototype.hasOwnProperty.call(options, "cryptoOk") ? !!options.cryptoOk : await ed25519WebCryptoAvailable();
  if (!cryptoOk) return { status: "signature invalid", fields: emptyFields() };
  const parsed = parseBoothInput(text);
  if (parsed.kind !== "json" && parsed.kind !== "url") return { status: "signature invalid", fields: emptyFields() };
  let keyset;
  try {
    keyset = await (await readOk(await fetchImpl(KEYS_URL, FETCH_INIT))).json();
  } catch {
    return { status: "key unknown", fields: parsed.kind === "json" ? fieldsOf(parsed.value) : emptyFields() };
  }
  let raw = parsed.kind === "json" ? parsed.value : null;
  if (parsed.kind === "url") {
    try { raw = await (await readOk(await fetchImpl(parsed.url, FETCH_INIT))).json(); }
    catch { return { status: "signature invalid", fields: emptyFields() }; }
  }
  const base = options.deps || webcryptoDeps();
  const deps = {
    sha256: base.sha256.bind(base),
    ed25519: base.ed25519.bind(base),
    loadSnapshot: async () => {
      const [bytesRes, sigRes] = await Promise.all([
        readOk(await fetchImpl(DATASET_URL, FETCH_INIT)),
        readOk(await fetchImpl(DATASET_SIG_URL, FETCH_INIT)),
      ]);
      return { bytes: new Uint8Array(await bytesRes.arrayBuffer()), sig: await sigRes.json() };
    },
  };
  try {
    const result = await verifyReceipt(raw, keyset, deps);
    return { status: signatureStatus(result, true), fields: fieldsOf(raw) };
  } catch {
    return { status: "signature invalid", fields: fieldsOf(raw) };
  }
}

function fillBooth(doc, out) {
  const status = doc.getElementById("status");
  if (status) status.textContent = out.status;
  const fields = out.fields || emptyFields();
  const map = { "f-id": fields.id, "f-kind": fields.kind, "f-ts": fields.ts, "f-host": fields.host, "f-key": fields.key_id };
  for (const [id, value] of Object.entries(map)) {
    const el = doc.getElementById(id);
    if (el) el.textContent = value || "";
  }
}

export function mountBooth(doc, search, check = checkBooth) {
  const cta = doc.getElementById("soft-guard");
  if (cta) cta.hidden = !softGuardOn(search);
  const btn = doc.getElementById("check-btn");
  const paste = doc.getElementById("paste");
  if (!btn || !paste) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try { fillBooth(doc, await check(paste.value)); }
    catch { fillBooth(doc, { status: "signature invalid", fields: emptyFields() }); }
    finally { btn.disabled = false; }
  });
}

if (typeof document !== "undefined") mountBooth(document, location.search);
