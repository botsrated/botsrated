# Prefer READY — Desk per-host outside Guard checks (Design LOCK ba26a862)

Digests→LA. Absolute No-Grade. Soft CTA Prefer KEEP tip HOLD APPLY. HOLD tip / HOLD APPLY until DC CLEAR unpaid outside >0 and re-MATCH. Do not partial-apply. No tip, no deploy, no merge.

EXPECT_TIP **6360c8c0** (from **36699bae**). WANT **c72e1e43**. Smoke-exclude LIVE leave-off **2e7581cb**.

## Pins

| Pin | Value |
|---|---|
| Soft CTA tip / want | **6360c8c0** / **c72e1e43** |
| Prior tip | **36699bae** |
| Soft CTA fp | **ebf26695dfaccfcea740027fc1d2b7b0** (77 recipe lines, before = after) |
| Smoke-exclude leave-off | **2e7581cb** |
| Design LOCK body | **ba26a8626ca47a8de232b8f5505db453** |
| Design LOCK whole | **4a8360302fa1ddbf13f8739245da1f77** · `reports/design/desk-host-check-count-2026-11-04/LOCKED-DESK-HOST-CHECK-COUNT-2026-11-04.md` |
| Legal Design-copy | CLEAR-with-notes **14e1c72a** |
| Legal B gate | **4487ca62** |
| Patch | `worker/patches/desk-host-checks.patch` |
| Patch md5 | `4f4a0e792ef9c1cebb234f2718537fe5` |
| Edge read TTL | **900000** ms (15 minutes) |
| outside_count import | keeps exit **53** |

## Re-measure on 6360c8c0

The Pages worker content API does not return `pages-worker--22168739-production`, so desk.ts, tools.ts, and site.ts were not re-hashed from the deployment bundle. Rendered pages are byte-identical to 36699bae:

| Page | md5 |
|---|---|
| `/` | `2d32d6da9d60a7ca5ee39afd1c471240` |
| `/desk` | `58eecd5c715cdd7253625f429e1d3ca0` |
| `/tools/payment-guard` | `02e2c0778c47d613fce5fc3105b18dbd` |

The payment-guard chip is still `Guard checks this week: 2`. Hunks stay on those unchanged template lines: desk import at the Pack1 `outsideCallersChipHtml` import, the `desk_store` import, the map host row, and the site CSS line before `.bw-stats b`. tools.ts has no hunk. The 36699bae-era source pins `0922547f` / `4608ab48` / `9b2c3d26` were not re-derived from 6360c8c0.

## What ships (Desk map only)

Exact Design LOCK HTML/CSS. Fact unit = `SUM(n)` this ISO week UTC from `callers_week_host` where `channel='guard'`. Smoke caller keys whose prefix is `d626e00d` (and any later prefix in `GUARD_SMOKE_K_PREFIXES`) are excluded before the sum. Own hosts excluded from the published map: `botsrated.com`, `www.botsrated.com`, `botpulse.botsrated.com`. Gate: `qa_clean === true && Number.isInteger(N) && N > 0`, else omit. `DESK_HOST_CHECKS_QA_CLEAN` stays **false**. No invent, no backfill, no "Checked 0 times".

A read-only count at pack time saw one `callers_week_host` row with `channel='guard'`: week `2026-W45`, host `blockrun.ai`, `n=1`, key prefix `d626e00d`. That row is the smoke caller. After the exclusion the publishable host set is empty. `callers_week` for `2026-W45` / `channel='guard'` has three keys; dropping `d626e00d` leaves two, which is the Pack1 published N. `outsideCallersChipHtml` is untouched.

Importing `outside_count` keeps exit 53. This patch does not import it and does not call `process.exit`.

### Refresh

The Desk SUM read is memoized in the isolate for 15 minutes (`DESK_HOST_CHECKS_TTL_MS`). A map render after the memo expires re-reads D1. A week change drops the memo immediately. D1 Tip-B writes stay live-on-check. The personalized Desk paste stays dynamic.

### Host row and footnote

```html
<span class="desk-host-checks" data-n="N" title="Outside Guard checks for this host this ISO week (UTC). Our own tests excluded. A count, not a rating.">Checked <b>N</b> times this week</span>
```

```html
<p class="desk-host-checks-note">Outside Guard checks this week · <a href="/llms-install.md#how-we-count-outside-attaches">How we count</a> · A count, not a rating</p>
```

The fact sits beside `deskChipsHtml(x)`. The footnote is once after the map table when any host shows a fact. Both stay outside `deskFreeHtml`, the empty `/desk` form, and `#desk-guard`.

## Call sites

| Site | Change |
|---|---|
| `desk.ts` import | imports `attachDeskHostChecks`, `deskHostChecksHtml`, `deskHostChecksNoteHtml` |
| `desk.ts` after the `desk_store` import | `deskPreviewStampHostChecks` awaits `attachDeskHostChecks` (15-minute Desk read) |
| map host cell | `${deskChipsHtml(x)}${deskHostChecksHtml(x.checks_week)}` |
| map table close | `${deskHostChecksNoteHtml(r.nodes)}` once |
| `site.ts` CSS | six LOCK rules after the Pack1 tease media query, before `.bw-stats b` |
| `worker/src/desk_host_checks.ts` | SUM, smoke-key filter, own-host filter, gate, 15-minute memo |
| `worker/test/desk_host_checks_unit.ts` | gate, smoke exclusion, TTL, LOCK strings, no `outside_count` import |
| `tools.ts` | no hunk. `${outsideCallersChipHtml()}` stays the one Pack1 map-result call |

`deskPreviewStampHostChecks(db, nodes)` is the deskPreview await on the anchored import block. The host cell reads `checks_week`. With `qa_clean` false the stamp stores null and the fact is omitted.

## C2

`callers_week_host_unit` is not in the public anchor tree, so this pack does not guess its bytes. The Desk-only allow is `loadDeskHostChecks`. `/s/:host`, OpenAPI, seller JSON, and the home tease get no new read. `host_stats` is not queried. `internal` is not selected.

## Soft CTA walls

Recipe `grep -E 'DESK_FREE|da-free-card|POLLERS_NUDGE|da-pollers-nudge|poller_nudge|DESK_MAP_FREE|DESK_MAP_PRO|STICKY_FREE' worker/src/desk.ts | md5sum` stays **ebf26695dfaccfcea740027fc1d2b7b0**. Added lines: `free_quota` 0, `?soft=` 0, `quota` 0, `429` 0. Dry-apply on a tip-shaped desk.ts left its 77 recipe lines byte-identical (stand-in md5 `15669f8bdbfb010ad6e4680cea7f0ddf` before and after).

## Apply

```
patch -p1 --fuzz=0 --no-backup-if-mismatch < worker/patches/desk-host-checks.patch
```

Dry-apply on the Pack1 post-image lines succeeded with `--fuzz=0` and 0 `.rej`. Unit `node --experimental-strip-types test/desk_host_checks_unit.ts` passed. All hunks or none. Soft CTA Prefer KEEP tip HOLD APPLY.

## For Security

Prefer READY against Design LOCK body **ba26a862**. Soft CTA tip tip **6360c8c0** want **c72e1e43** Soft CTA walls HOLD Soft CTA fp **ebf26695**. Smoke-exclude leave-off **2e7581cb**. Absolute No-Grade. HOLD tip / HOLD APPLY until DC CLEAR unpaid outside >0 and re-MATCH. Do not tip.

---

## md5

`af1e87bf0242b69be501edc25e98d0c2`
