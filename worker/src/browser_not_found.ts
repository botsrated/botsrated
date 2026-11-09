// Browser 404 for unknown pages. Mount from the private worker at the
// existing JSON not-found return. Do not replace that JSON builder.
//
//   if (noRoute) return notFoundFor(request, () => jsonNotFound(request));
//
// GET/HEAD document navigations get HTML and status 404.
// /v1, /mcp, /.well-known, /api, *.json, and clients that ask for JSON
// keep the existing JSON body. This file does not read Authorization,
// does not set a cookie, and does not write D1.

const API_JSON = /^(?:\/v1(?:\/|$)|\/mcp(?:\/|$)|\/\.well-known\/|\/api(?:\/|$))/;

export const BROWSER_NOT_FOUND_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function wantsBrowserNotFound(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const url = new URL(request.url, "https://botsrated.com");
  if (API_JSON.test(url.pathname) || url.pathname.endsWith(".json")) return false;
  if (url.searchParams.get("format") === "json") return false;
  const accept = request.headers.get("accept");
  const htmlQ = mediaQ(accept, "text/html");
  const jsonQ = mediaQ(accept, "application/json");
  if (jsonQ !== null && (htmlQ === null || jsonQ >= htmlQ)) return false;
  if (htmlQ !== null) return true;
  return request.headers.get("sec-fetch-dest") === "document" && jsonQ === null;
}

export function notFoundFor(request: Request, jsonNotFound: () => Response): Response {
  if (!wantsBrowserNotFound(request)) return jsonNotFound();
  return browserNotFoundResponse(request);
}

export function browserNotFoundResponse(request: Request): Response {
  const url = new URL(request.url, "https://botsrated.com");
  const shown = displayPath(url.pathname);
  const body = request.method === "HEAD" ? null : page(shown);
  return new Response(body, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": BROWSER_NOT_FOUND_CSP,
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-robots-tag": "noindex",
    },
  });
}

function mediaQ(accept: string | null, type: string): number | null {
  if (!accept) return null;
  let found: number | null = null;
  for (const part of accept.split(",")) {
    const [raw, ...params] = part.split(";");
    const name = raw.trim().toLowerCase();
    if (name !== type) continue;
    let q = 1;
    for (const param of params) {
      const [k, v] = param.split("=");
      if (k?.trim().toLowerCase() === "q") {
        const n = Number(v);
        if (Number.isFinite(n)) q = Math.min(1, Math.max(0, n));
      }
    }
    if (found === null || q > found) found = q;
  }
  return found;
}

function displayPath(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  const clean = decoded.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
  return clean.startsWith("/") ? clean : "/";
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

function page(pathname: string): string {
  const shown = esc(pathname);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · BotsRated</title><meta name="robots" content="noindex"><style>
:root{--bw-bg:#000;--bw-fg:#fff;--bw-muted:#a3a3a3;--bw-line:#262626}
body{margin:0;background:var(--bw-bg);color:var(--bw-fg);font:16px/1.45 ui-sans-serif,system-ui,sans-serif}
a{color:inherit}
.wrap{max-width:40rem;margin:0 auto;padding:48px 20px 64px}
h1{font-size:clamp(28px,6vw,40px);letter-spacing:-.03em;line-height:1.1;margin:12px 0}
code{font:13px/1.4 ui-monospace,monospace}
.links{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0}
.links a{display:inline-flex;min-height:44px;align-items:center;justify-content:center;padding:0 16px;border:1px solid var(--bw-fg);border-radius:8px;text-decoration:none;font-weight:600}
.links a.primary{background:var(--bw-fg);color:var(--bw-bg)}
.quiet{color:var(--bw-muted)}
@media(max-width:720px){.links{flex-direction:column}.links a{width:100%}}
</style></head><body><main class="wrap"><p>botsrated.com</p><h1>Page not found</h1><p>Nothing is published at this address.</p><p>No page at <code>${shown}</code></p><nav class="links" aria-label="Recovery"><a class="primary" href="/">Home</a><a href="/tools/payment-guard">Guard</a><a href="/desk">Desk</a></nav><p class="quiet">API and other programmatic clients still get a JSON error for this address. Route list: <a href="/openapi.json">openapi.json</a> · <a href="/llms.txt">llms.txt</a></p></main></body></html>`;
}
