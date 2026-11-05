# Prefer READY — Desk per-host outside Guard checks (Design LOCK ba26a862)

Digests→LA. Absolute No-Grade. Soft CTA Prefer KEEP tip HOLD APPLY. HOLD tip / HOLD APPLY until DC CLEAR unpaid outside >0 and re-MATCH. Do not partial-apply. No tip, no deploy, no merge.

Security MATCH HOLD OWN **9f494ffa**. The previous patch md5 `4f4a0e79` is withdrawn. This rewrite removes the raw host-table read. Host N is read only through `outsideGuardHostChecksSql(week)` and `outsideGuardHostChecks(rows)` from `./outside_count`. `desk.ts` is the only importer.

EXPECT_TIP **6360c8c0** (from **36699bae**). WANT stays **c72e1e43** until this patch is applied on the tip tree and the bundle hash is measured. A new WANT is not invented here.

## Pins

| Pin | Value |
|---|---|
| Soft CTA tip / want | **6360c8c0** / **c72e1e43** (WANT unmeasured after this patch) |
| Soft CTA fp | **ebf26695dfaccfcea740027fc1d2b7b0** (77 recipe lines, before = after) |
| Smoke-exclude leave-off | **2e7581cb** |
| Design LOCK body | **ba26a8626ca47a8de232b8f5505db453** |
| Design LOCK whole | **4a8360302fa1ddbf13f8739245da1f77** |
| desk.ts | **0922547f313cf73e71d0645bfbaff314** |
| tools.ts | **4608ab482849597cdfb116114e0fc4a5** (no hunk) |
| site.ts | **df8f784563f3857efc16e02b762f4bb1** |
| outside_count.ts | **02f39860342c1444bccd6e71eca92314** |
| outside_count_exclude_unit.ts | **bdec320f1ca585dc172bb1aaf4aaf48a** |
| Patch | `worker/patches/desk-host-checks.patch` |
| Patch md5 | `48a1e23c253f0153a8d226ce63a01cc9` |
| Edge read TTL | **900000** ms |

These file md5s are the measured pins from this Lead ACTION. `/tmp/ship-oce-tip-36699bae/receipts-mvp` was not mounted on this machine, so they were not recomputed from local bytes.

## What changed since 4f4a0e79

The helper module no longer contains a table read. `deskPreviewStampHostChecks` in `desk.ts` calls `outsideGuardHostChecksSql(week)`, runs that statement, and passes the rows through `outsideGuardHostChecks`. The map uses the `checks` field. Own hosts `botsrated.com`, `www.botsrated.com`, and `botpulse.botsrated.com` are filtered after the helper. Gate: `qa_clean === true && Number.isInteger(N) && N > 0`, else omit. `DESK_HOST_CHECKS_QA_CLEAN` stays false. The 15-minute edge memo is unchanged. D1 writes are untouched. Pack1 `outsideCallersChipHtml` and `n: 2` / `qa_clean: true` are untouched.

The smoke-key literal is not added in this diff. Exclusion stays in `outside_count.ts`. If that helper's array already contains the literal, the bundle count is not zero; this patch does not add another copy.

## deploy.sh exit 53

Not amended. The tip tree path was not on this machine, so a hunk against `deploy.sh` would have been invented and would fail `--fuzz=0`. The existing exit 53 check is left as it is. Intended amendment, once the file is in hand: importers == 1 and that importer is `desk.ts` only; keep readers = `[outside_count.ts]`; keep bundle `AND` and `k NOT IN` at least once; keep seed x1; keep Pack1 n2+qa x2; keep softcta 6/3/1 and fp `ebf26695`; keep the smoke literal at x0 in the bundle when the helper still allows it. EXPECT_TIP default `36699bae` → `6360c8c0`. Do not delete exit 53.

## Call sites

| Site | Change |
|---|---|
| `desk.ts` | `import { outsideGuardHostChecks, outsideGuardHostChecksSql } from "./outside_count"` (only importer) |
| `desk.ts` | `deskPreviewStampHostChecks` awaits the helper, then `attachDeskHostChecks` |
| map host cell | `${deskChipsHtml(x)}${deskHostChecksHtml(x.checks_week)}` |
| map table | `${deskHostChecksNoteHtml(r.nodes)}` once |
| `site.ts` CSS | six LOCK rules before `.bw-stats b` |
| `tools.ts` | no hunk |
| `outside_count.ts` | no hunk |

## Soft CTA walls

Recipe fp stays **ebf26695dfaccfcea740027fc1d2b7b0**. Added lines: `free_quota` 0, `?soft=` 0, `quota` 0, `429` 0. Dry-apply on a tip-shaped desk.ts left its 77 recipe lines byte-identical (stand-in md5 `15669f8bdbfb010ad6e4680cea7f0ddf` before and after).

## Apply

```
patch -p1 --fuzz=0 --no-backup-if-mismatch < worker/patches/desk-host-checks.patch
```

Dry-apply on the Pack1 post-image desk/site lines: `--fuzz=0`, 0 `.rej`. Unit `node --experimental-strip-types test/desk_host_checks_unit.ts` passed. This dry-apply did not include `deploy.sh`.

## For Security

Prefer READY against Design LOCK body **ba26a862**. The raw host-table read is gone. `desk.ts` is the only `outside_count` importer. exit 53 is not rewritten in this diff. Soft CTA tip tip **6360c8c0** want **c72e1e43** Soft CTA walls HOLD Soft CTA fp **ebf26695**. HOLD tip / HOLD APPLY. Do not tip.

---

## md5

`f788102a468918b5f00ee59f5993b2df`
