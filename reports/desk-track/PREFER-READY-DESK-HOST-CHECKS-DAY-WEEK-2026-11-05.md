# Prefer READY — Desk per-host daily + weekly outside Guard checks (Design LOCK b26d31c6) — 2026-11-05

Digests→LA. Absolute No-Grade. Soft CTA tip tip `b7005222` want `2f698f049fd88b8d32787d124a18a14c` Soft CTA walls HOLD Soft CTA fp `ebf26695` Soft CTA greps `0`. **Soft CTA Prefer KEEP tip HOLD APPLY** — no tip, no merge, no deploy from this pack.

## Verdict: Prefer READY (day source LIVE) — patch written, tip HOLD

Supersedes Prefer HOLD whole `ccd4b826c81ed1090310349137f1e143` body `9de2fc1027a612493e6c5c8f0e8afc51` (day source was missing). Tip-B callers_day_host is LIVE (tip `b7005222`, outside_count.ts `2523b0ea5676661419200e47586b4ea9`). This pack wires Design LOCK day+week Exact copy on the Desk map fact only. It does not change `outside_count.ts`, `pricing.ts`, the Soft CTA recipe, or the Pack 1 chip call-site.

## Pins

| Pin | Value |
|---|---|
| Design LOCK body / whole | `b26d31c60d92c4f5029fce61f5eb557f` / `004adcb8b9798f24d4ff6e0755f10f30` (recomputed on the uploaded LOCK) |
| Legal CLEAR-with-notes | `d97469ab32a9e82b16f0dce932b906f2` |
| Supersedes | Prefer HOLD `ccd4b826` / body `9de2fc10`; week-only Design body `ba26a862` (week-only UI stays the base this patch edits) |
| Tip-B LIVE leave-off | `3aa78b57cb7674f51e23591eec74d717` |
| Guard Prefer READY / patch / MATCH OWN | `801e8ef5` / `0ace8203` / `07786be9` (already tipped; not this pack) |
| Soft CTA tip / want / fp | `b7005222` / `2f698f049fd88b8d32787d124a18a14c` / `ebf26695dfaccfcea740027fc1d2b7b0` |
| Patch | `b7c669ab9063d3160d67d1e943d418f7` — `worker/patches/desk-host-checks-day-week.patch` |
| LIVE base (unchanged by Tip-B) | desk.ts `647401fd29a932eceb2f456ece30326a` · desk_host_checks.ts `749e48f2c58de291a893dc653d391452` · site.ts `c2f2c98e81812a2fb4732f2935429ec6` · unit `036369f8c5c5fe025b3de1a8064991b8` |
| outside_count.ts | `2523b0ea5676661419200e47586b4ea9` — not in this patch |
| Post-apply desk_host_checks.ts | `613101a666b6d5cd3b0ffb970ad643c5` |
| Post-apply unit | `68268ecc105fdf368411f474da8712e6` |
| Post-apply desk.ts / site.ts | not measured on this VM (tip files not mounted). See Apply. |

## What ships (Desk map fact only)

Exact Design LOCK HTML. Each window is `SUM(n)` for that host, `channel='guard'`, outside only. Gate per window: `qa_clean === true && Number.isInteger(N) && N > 0`, else that clause is omitted. Both windows fail → no fact line. Never `Checked 0 times`. Absolute No-Grade. `DESK_HOST_CHECKS_QA_CLEAN` stays `false` until DC CLEAR.

| Windows | Fact |
|---|---|
| day and week | `Checked <b>N</b> times today · <b>M</b> times this week` with `data-n-day` and `data-n-week` |
| day only | `Checked <b>N</b> times today` with `data-n-day` |
| week only | `Checked <b>M</b> times this week` with `data-n-week` |
| title, every variant | `Outside Guard checks for this host today and this ISO week (UTC). Our own tests excluded. A count, not a rating.` |
| footnote, once | `Outside Guard checks · <a href="/llms-install.md#how-we-count-outside-attaches">How we count</a> · A count, not a rating` |

CSS: `.desk-host-checks[data-n="0"],.desk-host-checks:not([data-n]){display:none}` is replaced by `.desk-host-checks:not([data-n-day]):not([data-n-week]){display:none}`. The other Pack B rules stay.

## Data path

1. `desk.ts` stays the only importer of `outside_count`. No raw `SELECT` on `callers_day_host` or `callers_week_host` in `desk.ts`.
2. `deskPreviewStampHostChecks` still runs inside `deskPreview`. One attach reads both windows: `outsideGuardHostChecksDaySql(day)` and `outsideGuardHostChecksSql(week)` → `{sql, binds}` → `prepare.bind(...binds).all()`. `void outsideGuardHostChecks` and `void outsideGuardHostChecksDay` stay for the Map fixture form.
3. **N6, per window:** each read is in try/catch; on error `return []` (omit that window; the other window still renders). Fail-soft for the Desk map.
4. `utcDay(now)` is `now.toISOString().slice(0, 10)` (`YYYY-MM-DD`, UTC). `isoWeekUtc` is unchanged (`YYYY-Www`). The 15-minute memo keys on `(day, week)`, so a UTC day rollover inside the same ISO week drops the memo.
5. Own-host exclude stays Desk-side after the helper: `DESK_OWN_HOSTS` = botsrated.com, www.botsrated.com, botpulse.botsrated.com. Applied to day rows and week rows.
6. Map row call: `deskHostChecksHtml(x.checks_day, x.checks_week)`. Week-only Exact string when day N is omitted. Pack 1 `${outsideCallersChipHtml()}` stays ×1, outside `#desk-guard`.

## Day key (verified as far as this VM can)

- Tip-B named the LIVE day source: `callers_day_host`, read only through `outsideGuardHostChecksDaySql` / `outsideGuardHostChecksDay`. This pack does not invent a table and does not edit `outside_count.ts` or `pricing.ts`.
- Production Pages canonical deployment is `b7005222` (`receiptscore-beta-q7`). The Pages worker script body is not downloadable here (GET script content HTTP 404; settings and version 315 exist).
- `botsrated-data` (`7030caac-bf71-482a-9c43-bd6a8b69c8be`) has `callers_week_host` and does **not** yet have `callers_day_host` in `sqlite_master`. That matches Tip-B: migrate-0.26 was not remote-executed; the writer uses lazy `CREATE TABLE IF NOT EXISTS`. No day rows to sample.
- UTC calendar-day text already stored on that database (`probes_day.day`) is `YYYY-MM-DD` (`2026-10-29`, `2026-10-30`, `2026-10-31`). Those rows are not the count source. `utcDay` uses the same UTC date form. Security should confirm the Guard writer’s `callers_day_host.day` bind is this string before tip. A mismatch omits the day clause (N6 / gate), it does not invent a count.

## Legal lower bound

`SUM(n)` is a lower bound, not attested-exact. The writer coalesces in-isolate and drops pending on flush failure; isolate eviction before a flush loses pending `n`. Publish only DC-attested integers, or keep the Exact “Checked N times” line only with DC sign-off that a lower-bound reading is honest. Same stance as `14e1c72a` / `d97469ab`. This leave-off does not claim attested-exact.

## Surfaces

In: Desk map host row (`deskResultHtml`) and the section footnote under that table. The week-only LIVE hunk has no second host-detail template; this pack does not add one. Out: `/s/:host`, embeds, receipts, seller JSON, home Soft CTA, Market, digests. Not inside `#desk-guard` / Attach Guard free / Soft CTA.

## Soft CTA

Recipe lines are not in the diff. Added lines: `free_quota` / `?soft=` / `quota` / `429` = 0 (case-insensitive). Recipe tokens `DESK_FREE`, `da-free-card`, `POLLERS_NUDGE`, `da-pollers-nudge`, `poller_nudge`, `DESK_MAP_FREE`, `DESK_MAP_PRO`, `STICKY_FREE` = 0 on added lines. fp `ebf26695` before = after by construction. Not re-hashed on tip `desk.ts` here (file not mounted). Alerts-50 sticky untouched. No new Soft CTA tile.

## Apply

```
patch -p1 --fuzz=0 --no-backup-if-mismatch < worker/patches/desk-host-checks-day-week.patch
```

Measured here: base `desk_host_checks.ts` md5 `749e48f2` and unit `036369f8` (bytes recovered from the applied week-only patch `34250c7e`, which is the LIVE post-image). `desk.ts` / `site.ts` hunks are `-U0` against the contiguous post-`34250c7e` regions (import + `deskPreviewStampHostChecks`, the `deskResultHtml` table line, the one CSS rule). Dry-run `--fuzz=0` rc 0 on that tree and on the regions with the carrier gap removed (line offset only). 0 `.rej`. `node --experimental-strip-types test/desk_host_checks_unit.ts` → `desk_host_checks_unit ok` (both / day-only / week-only / both-fail, memo `(day, week)`, own-host exclude on day rows).

Full-file post-apply md5 of tip `desk.ts` and `site.ts` needs the tip tree. Re-run the dry-apply on a tree whose four LIVE pins match before tip.

## Tip gate

Soft CTA Prefer KEEP tip HOLD until Security MATCH on this patch + DC CLEAR outside >0 per published window (or a documented allowlist) + Lead Soft CTA Prefer KEEP tip. `qa_clean` stays false. No tip from this pack.

## Blockers

| Owner | Blocker |
|---|---|
| Security | MATCH on patch `b7c669ab`: helper-only SQL, N6 `return []`, smoke-exclude still inside `outside_count`, day key `YYYY-MM-DD` matches the writer. Re-dry-apply on the tip tree and record post-apply desk.ts / site.ts md5. |
| DC | CLEAR outside >0 per window. Confirm own-host list. Attest `SUM(n)` or accept the lower-bound reading. `DESK_HOST_CHECKS_QA_CLEAN` stays false until then. |
| This pack | No tip, no merge, no deploy. |

Leave-off: `reports/desk-track/PREFER-READY-DESK-HOST-CHECKS-DAY-WEEK-2026-11-05.md`.

---

## md5

Body (everything above the `---` line, excl. its leading blank line): `66c7229c4c180c5421220a4d13c3d0d1`
