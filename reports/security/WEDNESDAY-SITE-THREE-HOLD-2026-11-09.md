# Wednesday site three — HOLD, not tipped

Shipping blocker: this run has no replacement security-review arrangement. Anton Clark is the final security authority. Do not merge, tip, or deploy until he reviews. The private receipts-mvp tree is not in this repo. Pages script content for `pages-worker--22168739-production` is not downloadable here (settings GET succeeds; content GET is 404 or 405). Live production deployment is `77ad7284` (2026-11-05). Nothing in this change was deployed. No D1 write. No schema change. No payment, auth, or receipt-signing change.

Wishlist returns 1–4 and Solana phases 0–5 are not in this public tree or in the open pull requests checked on 2026-11-09. They are not implemented here. Draft site packs on other branches (home strip, Desk Guard strip, market facts, board) are untouched.

## 1. Browser 404

Live check, 2026-11-09: `GET /this-page-does-not-exist-audit` with `Accept: text/html` returns HTTP 404 `application/json` (`error.code` `not_found`). The same JSON is returned for `Accept: application/json` and for `GET /v1/no-such-route`.

`worker/src/browser_not_found.ts` leaves that JSON builder in place. `notFoundFor` returns HTML only for GET/HEAD when the client prefers `text/html` and the path is not `/v1`, `/mcp`, `/.well-known`, `/api`, or `*.json`. `?format=json` stays JSON. Status stays 404. The page links Home, Guard (`/tools/payment-guard`), and Desk. The path is escaped. The query string is not shown. CSP is `default-src 'none'` with inline style only and no script. Authorization is not read.

## 2. Home primary action

Live home on desktop and at 390px shows Attach Guard free and Open Desk as the same outline button, with Get change alerts quieter. The headline ends on "One desk.", the strip's only action is Desk, and the next section says "Start with Desk."

`mountHomePrimaryCta` replaces that exact live hero string with one filled Open Desk button, an outline Attach Guard free button, and the same quiet alerts link. It returns `replaced: false` when the live string is absent, and then changes nothing. It does not rename Desk Guard and does not add bot-versus-human copy. A local render of the saved live homepage through this function shows the filled primary on a 1280px viewport and a full-width stack at 390px. That render is not the live site.

## 3. Funnel counts

`visits_daily` already stores page, referrer, total, and a small `cta` kind. `human` and `bot` there are request totals split by browser type, not distinct people. `callers_week` already has an `internal` channel. There is no side-by-side count of entry, a finished useful check, and a paid settlement.

`worker/src/funnel_measure.ts` adds kind `funnel` on the existing primary key `(day, kind, key)`. Key is `entry|useful_check|paid` plus `outside|crawler|internal`. The historical `human` column stores the request count. `bot` stays 0. `summarizeFunnel` labels them `request counts, not unique people` and does not divide them. A useful check is HTTP 200 on `/v1/check`, `/v1/preflight`, `/v1/find`, or `/v1/report/` with no `error` and no `degraded`. A paid row is a 2xx the caller already marks charged. One response is paid or a useful check, not both. Internal is an existing internal mark, a match against `INTERNAL_CALLER_TOKEN`, or the published prober User-Agent (`BotsRated-probe/`, `BotsRated-mcp-probe/`, `botsrated-prober`). That match is not an authorization decision. The User-Agent is not stored. Known crawler names are crawlers. A customer agent User-Agent such as `python-requests` or `my-agent-bot` stays outside. The upsert SQL is not executed.

## Tests

`node --experimental-strip-types --test worker/test/*.ts` — 57 passed, including the new 404, hero, and funnel tests and the existing worker tests.

## Still needs a person

- Anton reviews before any mount or tip.
- Mount `notFoundFor` at the private JSON 404, and mount the hero only when `replaced` is true.
- Call the funnel note once per HTML page response and once per finished check or charged 2xx. Do not run it until a writer is explicitly allowed. Do not add a public route for the counts.
- Re-check the prober User-Agent strings against a current receipt before relying on the internal bucket.
