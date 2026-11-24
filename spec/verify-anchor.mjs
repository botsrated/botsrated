// Daily anchor check for one BotsRated record (rules botsrated-anchor-1).
// No Node imports: browsers, Workers and Node 20+ can load this file.
// What a pass shows: the record's hash is a leaf of that UTC day's Merkle tree, the tree rebuilds to the
// published merkle_root, and sha256 of {v, day, leaf_count, merkle_root, prev_anchor} equals the anchor.
// It does not show that the record's contents are correct.
import { canon, unwrapReceipt } from "./verify-core.mjs";

const hexToBytes = (h) => { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };
const bytesToHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const cat = (...arrs) => { const n = arrs.reduce((a, x) => a + x.length, 0); const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };

// deps.sha256Bytes(Uint8Array) -> Uint8Array(32)
export async function merkleRoot(leafHexes, deps) {
  const H = deps.sha256Bytes;
  const leaves = leafHexes.map(hexToBytes);
  if (!leaves.length) return bytesToHex(await H(new Uint8Array(0)));
  const rec = async (a, b) => {
    const n = b - a;
    if (n === 1) return H(cat(new Uint8Array([0]), leaves[a]));
    let k = 1; while (k * 2 < n) k *= 2; // largest power of two smaller than n (RFC 6962 section 2.1)
    return H(cat(new Uint8Array([1]), await rec(a, a + k), await rec(a + k, b)));
  };
  return bytesToHex(await rec(0, leaves.length));
}

// The stored record is what was hashed. Served copies add hints, so try the forms a served copy can map to.
export function leafCandidates(raw) {
  const full = unwrapReceipt(raw);
  if (!full || typeof full !== "object") return [];
  const out = [];
  const add = (label, obj) => { const t = canon(obj); if (!out.some((c) => c.text === t)) out.push({ label, text: t }); };
  const strip = (keep) => { const r = { ...full }; for (const k of ["receipt_url", "signature", "tx_url", "payment"]) if (!keep.includes(k)) delete r[k]; if (keep.includes("payment") === false && full.payment && typeof full.payment === "object" && !Array.isArray(full.payment)) r.payment = full.payment; return r; };
  add("stored record (served hints removed)", strip([]));
  add("stored record (with tx_url)", strip(["tx_url"]));
  add("as pasted", full);
  return out;
}

export function dayOf(raw) {
  const r = unwrapReceipt(raw) || {};
  if (r.signed_late === true && typeof r.published_day === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.published_day)) return r.published_day; // signed late: anchored on the day it was signed
  const ts = typeof r.ts === "string" ? r.ts : typeof r.generated_at === "string" ? r.generated_at : "";
  const d = new Date(ts);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

export const BULK_KINDS = new Set(["unpaid_probe", "mcp_probe"]);

// fetchJson(path) -> parsed JSON (path like "/v1/anchor/2026-11-23"). publicCopy(day) -> day JSON from github or null.
export async function checkAnchor(raw, deps) {
  const lines = []; let ok = true;
  const say = (pass, msg) => { lines.push(`${pass ? "PASS" : "FAIL"}  ${msg}`); if (!pass) ok = false; };
  const r = unwrapReceipt(raw) || {};
  const day = dayOf(raw);
  if (!day) { say(false, "no ts on the record, so no anchor day"); return { ok, lines, day: null }; }
  if (day < "2026-11-12") {
    lines.push(`INFO  ${day} is before 2026-11-12. Records stored before then are in the one-time genesis root (about 390 chunks), too big for a browser check. Use verify.py in github.com/botsrated/anchors.`);
    return { ok: null, lines, day, status: "genesis" };
  }
  if (BULK_KINDS.has(r.kind)) {
    lines.push(`INFO  ${r.kind} records are anchored in bulk: the day's leaf is the signed archive manifest, which lists the sha256 of every archive part. To check one probe, download its part from /archive, find the record, and compare the part's sha256 with the manifest.`);
  }
  let doc, leavesDoc;
  try { doc = await deps.fetchJson(`/v1/anchor/${day}`); leavesDoc = await deps.fetchJson(`/v1/anchor/${day}/leaves`); }
  catch (e) { say(false, `could not load the anchor for ${day} (${e && e.message || e})`); return { ok, lines, day }; }
  if (doc.status !== "final") lines.push(`WARN  anchor for ${day} is ${doc.status || "not final"}; it can still change until it is final`);
  const leaves = Array.isArray(leavesDoc.leaves) ? leavesDoc.leaves : [];
  const root = await merkleRoot(leaves.map((l) => l.h), deps);
  say(root === doc.merkle_root && root === leavesDoc.merkle_root, `leaves rebuild to merkle_root ${String(doc.merkle_root).slice(0, 16)}…`);
  const head = { v: doc.v, day, leaf_count: leaves.length, merkle_root: root, prev_anchor: doc.prev_anchor ?? null };
  const anchor = bytesToHex(await deps.sha256Bytes(new TextEncoder().encode(canon(head))));
  say(anchor === doc.anchor, `anchor ${String(doc.anchor).slice(0, 16)}… = sha256(head)`);
  if (!BULK_KINDS.has(r.kind)) {
    const set = new Map(leaves.map((l) => [l.h, l]));
    let hit = null;
    for (const c of leafCandidates(raw)) {
      const h = bytesToHex(await deps.sha256Bytes(new TextEncoder().encode(c.text)));
      if (set.has(h)) { hit = { ...c, h, leaf: set.get(h) }; break; }
    }
    say(!!hit, hit ? `record hash ${hit.h.slice(0, 16)}… is a leaf of ${day} (source ${hit.leaf.s}; matched the ${hit.label})` : `record hash not found among the leaves of ${day}`);
  }
  if (deps.publicCopy) {
    try {
      const pub = await deps.publicCopy(day);
      if (pub && pub.skipped) lines.push("INFO  the anchor above was read from the public GitHub copy itself");
      else if (pub) say(pub.anchor === doc.anchor && pub.merkle_root === doc.merkle_root, `public GitHub copy (github.com/botsrated/anchors days/${day}.json) has the same anchor`);
      else lines.push(`INFO  public GitHub copy for ${day} not found yet (the copy job runs every 3 hours)`);
    } catch { lines.push("INFO  could not reach the public GitHub copy from this browser"); }
  }
  lines.push(`INFO  Bitcoin timestamp: proofs/${day}.head.json.ots in github.com/botsrated/anchors (check with the ots client)`);
  return { ok, lines, day, anchor: doc.anchor, merkle_root: doc.merkle_root };
}
