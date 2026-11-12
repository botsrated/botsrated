// Shared receipt checks for the CLI, the receipt page, and verifyResultJson.
// No Node imports: browsers and Workers can load this file.
// Canonical JSON (SPEC section 4.1): keys sorted, no whitespace, JSON.stringify scalars.
export const canon = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;

// Legacy ids (box prober, no probe_version): Python json.dumps(sort_keys=True) with default separators and ASCII escaping.
const ascii = (s) => JSON.stringify(s).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
export const pyDumps = (v) => v === null ? "null" : typeof v === "string" ? ascii(v) : typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(pyDumps).join(", ")}]` : `{${Object.keys(v).sort().map((k) => `${ascii(k)}: ${pyDumps(v[k])}`).join(", ")}}`;

export function unwrapReceipt(raw) {
  if (raw && typeof raw === "object" && raw.receipt && typeof raw.receipt === "object") return raw.receipt;
  return raw;
}

// receipt_url, tx_url, and signature are API hints. payment is an API hint when it is a string or null.
// An object payment is part of the signed body (mcp_probe).
export function stripPresentation(receipt) {
  const r = { ...receipt };
  delete r.receipt_url;
  delete r.tx_url;
  delete r.signature;
  const signedPayment = r.payment !== null && typeof r.payment === "object" && !Array.isArray(r.payment);
  if (!signedPayment) delete r.payment;
  return r;
}

const ID_RE = /^[0-9a-f]{20}$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DAY_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const FIELD_RE = /^[A-Za-z0-9_.*]{1,80}$/;

function withheldMark(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const listed = Array.isArray(obj.withheld_fields) ? obj.withheld_fields.filter((name) => typeof name === "string" && name.trim()) : [];
  const fields = listed.filter((name) => FIELD_RE.test(name));
  const note = typeof obj.withheld_note === "string" && obj.withheld_note.trim() ? obj.withheld_note.trim() : "";
  if (!listed.length && !note) return null;
  return { fields };
}

// withheld_fields / withheld_note mark a served copy that omits signed fields.
// They are not presentation fields. Do not report that copy as signature invalid.
export function redactedCopy(raw) {
  if (!raw || typeof raw !== "object") return null;
  const inner = unwrapReceipt(raw);
  const mark = withheldMark(inner) || (inner !== raw ? withheldMark(raw) : null);
  if (!mark) return null;
  const r = inner && typeof inner === "object" && !Array.isArray(inner) ? inner : {};
  return {
    fields: mark.fields,
    id: typeof r.id === "string" ? r.id : null,
    host: typeof r.host === "string" ? r.host : null,
    ts: typeof r.ts === "string" ? r.ts : null,
    kind: typeof r.kind === "string" ? r.kind : null,
    key_id: r.sig && typeof r.sig.key_id === "string" ? r.sig.key_id : null,
  };
}

export function storedRecordVerifyUrl(info) {
  const src = info && typeof info === "object" ? info : {};
  const q = [];
  if (typeof src.id === "string" && ID_RE.test(src.id)) q.push("id=" + src.id);
  if (typeof src.host === "string" && HOST_RE.test(src.host)) q.push("host=" + src.host);
  const fromTs = typeof src.ts === "string" ? src.ts.slice(0, 10) : "";
  const day = typeof src.day === "string" && DAY_RE.test(src.day) ? src.day : (DAY_RE.test(fromTs) ? fromTs : "");
  if (day) q.push("day=" + day);
  return "https://botsrated.com/v1/verify" + (q.length ? "?" + q.join("&") : "");
}

function bytesOf(message, enc) {
  if (typeof message === "string") return enc.encode(message);
  return message;
}

export function webcryptoDeps() {
  const enc = new TextEncoder();
  const b64ToBytes = (b64) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return {
    async sha256(data) {
      const bytes = typeof data === "string" ? enc.encode(data) : data;
      return hex(await crypto.subtle.digest("SHA-256", bytes));
    },
    async ed25519(publicKeyB64, message, sigB64) {
      const key = await crypto.subtle.importKey("raw", b64ToBytes(publicKeyB64), { name: "Ed25519" }, false, ["verify"]);
      return crypto.subtle.verify({ name: "Ed25519" }, key, b64ToBytes(sigB64), bytesOf(message, enc));
    },
  };
}

function statusOf(ok, errors) {
  if (errors.includes("key_unknown")) return "key unknown";
  return ok ? "signature valid" : "signature invalid";
}

// deps: { sha256(string|bytes) -> hex, ed25519(pubB64, message, sigB64) -> bool, loadSnapshot()? -> { bytes, sig } }
export async function verifyReceipt(raw, keyset, deps) {
  const lines = [];
  const errors = [];
  let ok = true;
  const say = (pass, msg, code) => {
    lines.push(`${pass ? "PASS" : "FAIL"}  ${msg}`);
    if (!pass) {
      ok = false;
      if (code && !errors.includes(code)) errors.push(code);
    }
  };
  const sha256 = (b) => deps.sha256(b);
  const redacted = redactedCopy(raw);
  if (redacted) {
    const url = storedRecordVerifyUrl(redacted);
    const listed = redacted.fields.length ? " (" + redacted.fields.join(", ") + ")" : "";
    lines.push("INFO  redacted copy" + listed + ": withheld fields are not in this JSON. This copy is not offline-verifiable.");
    lines.push("INFO  The signature covers the stored record. Check that record with GET " + url);
    return {
      ok: false, valid: false, offline_verifiable: false, status: "redacted copy", lines, errors: ["redacted_copy"],
      id: redacted.id, key_id: redacted.key_id, kind: redacted.kind, ts: redacted.ts, host: redacted.host,
    };
  }
  const r = stripPresentation(unwrapReceipt(raw));
  const { id, sig, ...body } = r;
  let rule = r.kind === "paid_test_buy" ? "sha256('paid|'+tx_hash)" : r.probe_version ? "sha256(canonical JSON)" : "legacy rule";
  let want = r.kind === "paid_test_buy" ? (await sha256("paid|" + r.tx_hash)).slice(0, 20)
    : r.probe_version ? (await sha256(canon(body))).slice(0, 20) : (await sha256(pyDumps(body))).slice(0, 20);
  // SPEC 4.2: on fast-tier unpaid probes made before the prober fix, `tier` and `confirms` were
  // added after the id was computed. The id then covers the rest; the signature still covers every field.
  if (want !== id && r.kind === "unpaid_probe" && r.probe_version && (body.tier !== undefined || body.confirms !== undefined)) {
    const { tier, confirms, ...early } = body;
    const alt = (await sha256(canon(early))).slice(0, 20);
    if (alt === id) {
      want = alt;
      rule = "sha256(canonical JSON without tier and confirms), fast-tier rule";
    }
  }
  say(want === id, `id ${id} (${rule})`, "id_mismatch");
  lines.push(`INFO  receipt sha256 (canonical JSON, compare with EAS receiptSha256): 0x${await sha256(canon(r))}`);

  const list = (keyset && keyset.keys) || [];
  const keys = Object.fromEntries(list.map((k) => [k.key_id, k.public_key_b64]));
  const kmeta = Object.fromEntries(list.map((k) => [k.key_id, k]));
  const inWindow = (kid, ts) => {
    const k = kmeta[kid];
    if (!k) return false;
    const t = Date.parse(ts);
    const windowOk = (!k.valid_from || t >= Date.parse(k.valid_from)) && (!k.valid_until || t < Date.parse(k.valid_until));
    say(windowOk, `key ${kid} (${k.status || "active"}) valid for ${ts}` + (k.valid_from || k.valid_until ? ` [${k.valid_from || "-"}, ${k.valid_until || "-"})` : ""), "key_window");
    return windowOk;
  };

  const keyId = sig?.key_id || null;
  if (sig) {
    const msg = canon({ ...r, sig: undefined });
    const known = !!keys[sig.key_id];
    const sigOk = known ? await deps.ed25519(keys[sig.key_id], msg, sig.sig_b64) : false;
    say(known && sigOk, `ed25519 receipt signature, key ${sig.key_id}`, known ? "signature_mismatch" : "key_unknown");
    inWindow(sig.key_id, r.ts || r.generated_at);
  } else if (deps.loadSnapshot) {
    const snap = await deps.loadSnapshot();
    const ds = snap.bytes;
    const ss = snap.sig;
    say(await sha256(ds) === ss.sha256, `snapshot sha256 ${ss.sha256.slice(0, 16)}…`, "snapshot_sha256");
    const known = !!keys[ss.key_id];
    const sigOk = known ? keys[ss.key_id] === ss.public_key_b64 && await deps.ed25519(keys[ss.key_id], ds, ss.signature_b64) : false;
    say(sigOk, `snapshot ed25519 signature, key ${ss.key_id}, generated ${ss.generated_at}`, known ? "snapshot_signature" : "key_unknown");
    inWindow(ss.key_id, ss.generated_at);
    const text = new TextDecoder().decode(ds);
    const h = JSON.parse(text).hosts.find((x) => x.host === r.host);
    say(!!h && [...(h.receipt_ids || []), ...(h.paid_receipt_ids || [])].includes(id), `id listed in the signed snapshot entry for ${r.host}`, "snapshot_listing");
    if (r.kind === "paid_test_buy") lines.push("WARN  v0.1 snapshots list paid ids only; the id binds tx_hash, not the other fields. Compare the sha256 above with an EAS receiptSha256 if one exists.");
  } else {
    say(false, "no per-receipt signature", "no_signature");
  }

  return {
    ok, valid: ok, status: statusOf(ok, errors), lines, errors,
    id, key_id: keyId, kind: r.kind || null, ts: r.ts || null, host: r.host || null,
  };
}
