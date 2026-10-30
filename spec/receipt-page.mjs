// Sparse HTML for GET /receipt/:id, including ?mcp=&day=&s=.
// The live Pages worker is not in this repo. This page is not on the live host until that handler returns it.
// Keep JSON unless prefersHtml(accept). When it does, return this HTML and set
// Content-Security-Policy to RECEIPT_PAGE_CSP on the response (the meta tag repeats it).
// Serve verify-browser.mjs and verify-core.mjs at /spec/.
// The pasted CLI URL comes from receiptCliUrl (checked id + allowlisted host, mcp, day, s), not from request.url.
// GET /v1/verify is not mounted. verifyResultJson is the same verifyReceipt result for that later free route.

export const RECEIPT_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self' https://botsrated.com; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function qOf(parts, name) {
  const exact = parts.filter((p) => p.media === name);
  if (exact.length) return Math.max(...exact.map((p) => p.q));
  const major = name.split("/")[0] + "/*";
  const wild = parts.filter((p) => p.media === major);
  if (wild.length) return Math.max(...wild.map((p) => p.q));
  const star = parts.filter((p) => p.media === "*/*");
  if (star.length) return Math.max(...star.map((p) => p.q));
  return 0;
}

// Browsers send text/html ahead of star. curl and API clients send */* or application/json and stay on JSON.
export function prefersHtml(accept) {
  if (!accept) return false;
  const parts = String(accept).split(",").map((item) => {
    const [media, ...params] = item.trim().split(";").map((s) => s.trim().toLowerCase());
    let q = 1;
    for (const p of params) {
      const m = /^q=([0-9.]+)$/.exec(p);
      if (m) q = Number(m[1]);
    }
    return { media, q: Number.isFinite(q) ? q : 0 };
  }).filter((p) => p.media);
  return qOf(parts, "text/html") > qOf(parts, "application/json");
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function receiptOf(raw) {
  if (raw && typeof raw === "object" && raw.receipt && typeof raw.receipt === "object") return raw.receipt;
  return raw || {};
}

const RECEIPT_ID = /^[0-9a-f]{20}$/;
const HOST_Q = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const MCP_Q = /^[0-9]{1,6}$/;
const DAY_Q = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const S_Q = /^[0-9a-f]{20}$/;
const CLI_URL = /^https:\/\/botsrated\.com\/receipt\/[0-9a-f]{20}(?:\?(?:host|mcp|day|s)=[a-z0-9.-]+(?:&(?:host|mcp|day|s)=[a-z0-9.-]+)*)?$/i;

function readQuery(input) {
  const bag = {};
  if (input == null || input === "") return bag;
  if (typeof input === "object" && !Array.isArray(input)) {
    for (const key of ["host", "mcp", "day", "s"]) {
      if (input[key] != null) bag[key] = String(input[key]);
    }
    return bag;
  }
  let search = "";
  try {
    search = new URL(String(input), "https://botsrated.com").search;
  } catch {
    search = String(input);
  }
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of ["host", "mcp", "day", "s"]) {
    const value = params.get(key);
    if (value != null) bag[key] = value;
  }
  return bag;
}

function pickHost(receiptHost, queryHost) {
  if (typeof receiptHost === "string" && HOST_Q.test(receiptHost)) return receiptHost;
  if ((receiptHost == null || receiptHost === "") && typeof queryHost === "string" && HOST_Q.test(queryHost)) return queryHost;
  return "";
}

// CLI URL is only https://botsrated.com/receipt/<20 hex> plus host, mcp, day, and s when each value matches its allowlist.
// A raw page URL is never copied into the shell line. A bad id yields "".
export function receiptCliUrl(id, query, receiptHost) {
  if (typeof id !== "string" || !RECEIPT_ID.test(id)) return "";
  const q = readQuery(query);
  const parts = [];
  const host = pickHost(receiptHost, q.host);
  if (host) parts.push("host=" + host);
  if (typeof q.mcp === "string" && MCP_Q.test(q.mcp)) parts.push("mcp=" + q.mcp);
  if (typeof q.day === "string" && DAY_Q.test(q.day)) parts.push("day=" + q.day);
  if (typeof q.s === "string" && S_Q.test(q.s)) parts.push("s=" + q.s);
  const qs = parts.join("&");
  return "https://botsrated.com/receipt/" + id + (qs ? "?" + qs : "");
}

// Single quotes only. Refuse if a metacharacter is still present.
export function quoteShellArg(url) {
  if (typeof url !== "string" || !CLI_URL.test(url)) return "";
  // & separates allowlisted params and is inert inside the single quotes this returns.
  if (/['"`$\\\s;|<>()]/.test(url)) return "";
  return "'" + url + "'";
}

export function receiptShellCommands(id, query, receiptHost) {
  const quoted = quoteShellArg(receiptCliUrl(id, query, receiptHost));
  const cli = quoted ? "node spec/verify.mjs " + quoted : "node spec/verify.mjs";
  const tail = quoted ? " " + quoted : "";
  const oneLiner = "ref=main; d=$(mktemp -d) && base=\"https://raw.githubusercontent.com/botsrated/botsrated/$ref/spec\" && curl -fsSL -o \"$d/verify.mjs\" \"$base/verify.mjs\" && curl -fsSL -o \"$d/verify-core.mjs\" \"$base/verify-core.mjs\" && curl -fsSL -o \"$d/verify-node.mjs\" \"$base/verify-node.mjs\" && node \"$d/verify.mjs\"" + tail;
  return { cli, oneLiner };
}

// Missing WebCrypto is not a pass. Only the three check results are shown, and only when crypto ran.
export function signatureStatus(result, cryptoOk) {
  if (!cryptoOk || !result) return "signature invalid";
  if (result.status === "signature valid" || result.status === "signature invalid" || result.status === "key unknown") return result.status;
  return "signature invalid";
}

export function verifyResultJson(result) {
  return {
    valid: !!result.valid,
    id: result.id ?? null,
    key_id: result.key_id ?? null,
    errors: Array.isArray(result.errors) ? result.errors : [],
  };
}

export function renderReceiptPage(raw, { pageUrl = "", query, scriptSrc = "/spec/verify-browser.mjs" } = {}) {
  const r = receiptOf(raw);
  const id = r.id || "";
  const kind = r.kind || "";
  const ts = r.ts || "";
  const host = r.host || "";
  const keyId = (r.sig && r.sig.key_id) || "";
  const hostPath = host ? "/s/" + encodeURIComponent(host) : "/sellers";
  const preflight = host ? "/v1/preflight?url=" + encodeURIComponent(host) : "/v1/preflight";
  // pageUrl is not pasted. Only an allowlisted id and host/mcp/day/s are.
  const { cli, oneLiner } = receiptShellCommands(id, query != null ? query : pageUrl, host);
  const embedded = JSON.stringify(raw).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(RECEIPT_PAGE_CSP)}">
<title>Receipt ${esc(id)}</title>
<style>
  body { margin: 0; background: #fff; color: #1d1d1f; font: 15px/1.45 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 40rem; margin: 0 auto; padding: 48px 20px 64px; }
  .eyebrow { margin: 0; color: #6e6e73; font-size: 13px; }
  h1 { margin: 8px 0 20px; font-size: 28px; font-weight: 600; letter-spacing: -0.02em; }
  dl { display: grid; grid-template-columns: 6.5rem 1fr; gap: 8px 16px; margin: 0 0 24px; }
  dt { color: #6e6e73; }
  dd { margin: 0; }
  .mono, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  button { font: inherit; color: #fff; background: #1d1d1f; border: 0; border-radius: 8px; padding: 8px 14px; }
  .links, .desk { margin: 16px 0 0; }
  a { color: #06c; }
  h2 { margin: 28px 0 8px; font-size: 13px; font-weight: 600; color: #6e6e73; }
  pre { margin: 0 0 8px; padding: 12px; background: #f5f5f7; border-radius: 8px; overflow: auto; font-size: 12px; white-space: pre-wrap; }
  .note { color: #6e6e73; font-size: 13px; }
</style>
</head>
<body>
<main>
  <p class="eyebrow">BotsRated receipt</p>
  <h1 id="status">checking signature…</h1>
  <dl>
    <dt>id</dt><dd class="mono" id="f-id">${esc(id)}</dd>
    <dt>kind</dt><dd id="f-kind">${esc(kind)}</dd>
    <dt>ts</dt><dd id="f-ts">${esc(ts)}</dd>
    <dt>host</dt><dd id="f-host">${host ? `<a href="${esc(hostPath)}">${esc(host)}</a>` : ""}</dd>
    <dt>key_id</dt><dd class="mono" id="f-key">${esc(keyId)}</dd>
  </dl>
  <p><button type="button" id="verify-btn">Verify signature</button></p>
  <p class="links"><a href="${esc(preflight)}">Free preflight</a> · <a href="${esc(hostPath)}">Host page</a></p>
  <p class="desk"><a href="/desk">Map many hosts free in Desk →</a></p>
  <h2>CLI</h2>
  <pre id="cli">${esc(cli)}</pre>
  <pre id="cli-oneliner">${esc(oneLiner)}</pre>
  <p class="note">Checks /.well-known/botsrated-key with the same rules as spec/verify.mjs. A match covers this record only — not a seller rating. If this browser can’t run the check, status stays checking signature…</p>
</main>
<script type="application/json" id="receipt-data">${embedded}</script>
<script type="module" src="${esc(scriptSrc)}"></script>
</body>
</html>
`;
}
