// Sparse HTML for GET /receipt/:id, including ?mcp=&day=&s=.
// The live Pages worker (receiptscore-beta-q7) is not in this repo. Its receipt handler
// should keep the JSON body for Accept that does not prefer text/html, and when
// prefersHtml(accept) return this HTML with RECEIPT_PAGE_CSP. Serve this directory's
// verify-browser.mjs and verify-core.mjs at /spec/ so the module script loads.
// GET /v1/verify is not mounted. verifyResultJson is the same verifyReceipt result
// for that later free route: one check, no second signature implementation.

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

export function verifyResultJson(result) {
  return {
    valid: !!result.valid,
    id: result.id ?? null,
    key_id: result.key_id ?? null,
    errors: Array.isArray(result.errors) ? result.errors : [],
  };
}

export function renderReceiptPage(raw, { pageUrl = "", scriptSrc = "/spec/verify-browser.mjs" } = {}) {
  const r = receiptOf(raw);
  const id = r.id || "";
  const kind = r.kind || "";
  const ts = r.ts || "";
  const host = r.host || "";
  const keyId = (r.sig && r.sig.key_id) || "";
  const hostPath = host ? "/s/" + encodeURIComponent(host) : "/sellers";
  const preflight = host ? "/v1/preflight?url=" + encodeURIComponent(host) : "/v1/preflight";
  const cliUrl = pageUrl || (id ? "https://botsrated.com/receipt/" + id : "");
  const cli = "node spec/verify.mjs " + JSON.stringify(cliUrl);
  const q = JSON.stringify(cliUrl);
  const oneLiner = "d=$(mktemp -d) && curl -fsSL -o \"$d/verify.mjs\" https://raw.githubusercontent.com/botsrated/botsrated/main/spec/verify.mjs && curl -fsSL -o \"$d/verify-core.mjs\" https://raw.githubusercontent.com/botsrated/botsrated/main/spec/verify-core.mjs && curl -fsSL -o \"$d/verify-node.mjs\" https://raw.githubusercontent.com/botsrated/botsrated/main/spec/verify-node.mjs && node \"$d/verify.mjs\" " + q;
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
  <h1 id="status">Checking signature…</h1>
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
  <p class="note">Checks the public key at /.well-known/botsrated-key. Same canonical JSON and Ed25519 rules as spec/verify.mjs.</p>
</main>
<script type="application/json" id="receipt-data">${embedded}</script>
<script type="module" src="${esc(scriptSrc)}"></script>
</body>
</html>
`;
}
