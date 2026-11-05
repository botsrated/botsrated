# Security MATCH: Desk per-host outside Guard checks — N6 delta re-MATCH, Prefer READY f532f4f7, patch 34250c7e, 2026-11-04

Security CODE auditor (read-only, suggest-only). Anton has the final say. Digests→LA. Absolute No-Grade. Soft CTA Prefer KEEP tip HOLD APPLY. Security never tips, merges, deploys, comments, or writes SQL against prod.

**VERDICT: YES-with-notes (code)**. Tip NOT GO until DC CLEAR (unpaid outside >0, qa_clean, smoke-excluded) and the CA re-pack of PR #84 (N5/N3).

**OWN: 40e67a5e8ebb412e55b0e4a595b8dce4**
(OWN = md5 of this file with every occurrence of the OWN hex replaced by the token "@@" + "OWN" + "@@", written with no spaces or quotes. Sidecar .md5 = md5 of the final file.)

**Lineage:** this report **supersedes** prior YES-with-notes OWN **058d3bde8be1c6b1a8e0d07a81d85361** (DESK-HOST-CHECKS-MATCH-PR84-57179e7d, sidecar b0aafbee) for N6. That MATCH already PASS'd Prefer READY↔LOCK, Soft CTA, adapter `{sql,binds}`→prepare/bind/all, and `await deskPreviewStampHostChecks(db, nodes)` inside deskPreview. Its should-fix N6 (D1 catch omit fact) is now **FIXED** in patch **34250c7e** on Prefer READY leave-off **f532f4f7**. DC outside=0 remains open → Tip NOT GO. Prior HOLD 48a1e23c / VOID 4f4a0e79 stay withdrawn/stale.

LEAD_LINE: Soft CTA tip tip 6360c8c0 want c72e1e43 Soft CTA walls HOLD Soft CTA fp ebf26695 Soft CTA greps 0 Soft CTA Prefer KEEP tip HOLD APPLY. Desk host checks MATCH **YES-with-notes** OWN 40e67a5e8ebb412e55b0e4a595b8dce4 supersedes 058d3bde for N6 (N6 FIXED). Prefer READY f532f4f7↔LOCK ba26a862 PASS 3/3. Soft CTA PASS. Dry-apply 34250c7e PASS (fuzz=0, 0 .rej; post pins 647401fd/749e48f2/c2f2c98e/02f39860 match). Adapter `{sql,binds}` + deskPreview await call-site retained PASS. Tip NOT GO until DC CLEAR unpaid outside >0 qa_clean smoke-excluded **and** CA re-pack (N5 unit/deploy re-pins; N3 exit53 tip-local). Security never tips.

SC_LINE: SC/CA: re-pack PR #84 tip-anchored to 34250c7e (N6 on 57179e7d lineage). In the same pack, re-pin outside_count_exclude_unit D2→importers==[desk.ts] and D5 desk→647401fd; re-pin deploy exits 4/7/51 for desk 647401fd / site c2f2c98e (+ desk_host_checks 749e48f2). Leave qa_clean false. Soft CTA Prefer KEEP tip HOLD APPLY.
DESK_LINE: Desk: N6 FIXED — deskPreviewStampHostChecks wraps D1 read in try/catch and on error returns [] (omit fact; fail-soft Desk map). Adapter and call-site still PASS. Soft CTA Prefer KEEP tip HOLD APPLY / no tip until DC CLEAR + CA re-pack.

FINDINGS_ONE_LINE: Pins match: Prefer READY f532f4f7, patch 34250c7e (+sidecar), LOCK 4a836030/ba26a862, Legal 14e1c72a/4487ca62, smoke-exclude 2e7581cb, DC 96a18970 outside=0, Soft CTA tip 6360c8c0/fp ebf26695, tip desk/tools/site/outside_count 0922547f/4608ab48/df8f7845/02f39860, exit53 06fa30a7/fca1dd83, post-apply 647401fd/749e48f2/c2f2c98e/036369f8/02f39860. LOCK fences PASS 3/3. Soft CTA PASS (fp before=after; greps 0; Pack1 ×1). Dry-apply PASS. N6 try/catch return [] PASS; adapter+callsite retained PASS. desk_host_checks_unit ok. outside_count_exclude_unit 21/23 (D2/D5) = N5 CA. DC outside=0. → YES-with-notes (code), Tip NOT GO. Soft CTA Prefer KEEP tip HOLD APPLY.

## Pins verified (box md5, 2026-11-04 ~11:31 PM CT)
| Pin | Want | Measured |
|---|---|---|
| Prefer READY leave-off | f532f4f7 | f532f4f73275839bc62844282cbaec63 **match** |
| Patch desk-host-checks.patch | 34250c7e | 34250c7e3a4d15ec3c4ddd73c744e4f1 **match**; sidecar .md5 present and equal |
| Design LOCK whole / body | 4a836030 / ba26a862 | 4a8360302fa1ddbf13f8739245da1f77 **match** / body (pre `\n---\n\n## md5`, offset 6418) ba26a8626ca47a8de232b8f5505db453 **match** |
| Legal CLEAR / Legal B | 14e1c72a / 4487ca62 | 14e1c72a2dde57c0cb593848b05da75e / 4487ca62f2d2c367ea23ddb86a70095d **match** |
| Smoke-exclude LIVE | 2e7581cb | 2e7581cb2b85713da0fe2f5696a711af **match** |
| DC spot | 96a18970 (newest) | 96a18970ed3574c2fd848c3321cd5e92: **outside guard host rows = 0** (smoke-only) |
| Tip tree desk / tools / site / outside_count | 0922547f / 4608ab48 / df8f7845 / 02f39860 | **all match** (`/tmp/ship-oce-tip-36699bae/receipts-mvp`) |
| Soft CTA tip / want / fp | 6360c8c0 / c72e1e43 / ebf26695 | tip pages `_worker.js` c72e1e43df2760675ac62df3e9f412f7; recipe md5 ebf26695dfaccfcea740027fc1d2b7b0 (77 lines) **match** |
| Exit53 full / diff | 06fa30a7 / fca1dd83 | 06fa30a713d6dca43a12c78df0a4052c / fca1dd83871df604f6e40092e02e0bd8 **match** (unchanged; N5/N3 CA) |
| Post-apply (Desk pins) | desk 647401fd / desk_host_checks 749e48f2 / site c2f2c98e / unit 036369f8 / outside_count 02f39860 | **all match** on tip copy |
| Prior YES OWN / patch | 058d3bde / 57179e7d | lineage retained; this OWN supersedes for N6 |

## Audit (delta-focused)
### 1. Prefer READY vs Design LOCK, byte-for-byte: PASS 3/3
- HTML host-row fact fence: equal to LOCK.
- HTML section-note fence: equal to LOCK.
- CSS fence: all 6 rules present verbatim in post-apply site.ts.
- Rendered `deskHostChecksHtml(7,true)` equals LOCK fact with N=7. Rendered note equals LOCK note.

### 2. Soft CTA tip baseline: PASS
- Recipe `grep -E 'DESK_FREE|da-free-card|POLLERS_NUDGE|da-pollers-nudge|poller_nudge|DESK_MAP_FREE|DESK_MAP_PRO|STICKY_FREE' worker/src/desk.ts | md5sum` → **ebf26695dfaccfcea740027fc1d2b7b0** (77 lines) **before = after** dry-apply; lines diff-identical.
- On added patch lines: `free_quota` 0, `?soft=` 0, `quota` 0, `429` 0; Soft CTA recipe tokens 0.
- No-Grade words on added lines: 0 beyond the LOCK negation "A count, not a rating".
- Pack1 call-site `${outsideCallersChipHtml()}` ×1 unchanged. tools.ts unchanged (4608ab48).

### 3. Dry-apply on a tip copy: PASS
- Copy `/tmp/sec-desk-host-pr84n6-3989259/receipts-mvp` via `cp -a` from the tip. Tip itself never written.
- `patch -p1 --fuzz=0 --no-backup-if-mismatch`: --dry-run clean; all 4 files applied. 0 `.rej`, 0 `.orig`.
- Post-apply: desk **647401fd**, desk_host_checks **749e48f2**, site **c2f2c98e**, unit **036369f8**, outside_count **02f39860** (unchanged), tools 4608ab48. **All match Desk pins.**
- Diff vs tip: only desk.ts and site.ts changed, plus 2 new files (desk_host_checks.ts + unit).

### 4. N6 + adapter/call-site retained: PASS
- `deskPreviewStampHostChecks` wraps `outsideGuardHostChecksSql` → `prepare.bind(...binds).all()` in **try/catch**; on error **`return []`** (omit fact; fail-soft Desk map). Mock: throw → `[]`; ok → rows. **N6 FIXED.**
- Adapter `{sql,binds}` + map `{host,checks}` (drop empty / non-integer / ≤0) retained from 57179e7d YES.
- `await deskPreviewStampHostChecks(db, nodes)` still inside `deskPreview` after status_chips, before return.
- Importers of `./outside_count`: **x1 = desk.ts**. desk_host_checks.ts does not import it (comments only).
- `DESK_HOST_CHECKS_QA_CLEAN = false` until DC owner-set.

### 5. Units: desk_host_checks_unit ok; N5 CA unchanged
- esbuild ESM + node from `worker/`: **`desk_host_checks_unit ok`**.
- `outside_count_exclude_unit` **21/23**: D2 (no runtime import yet) and D5 (desk pin 0922547f) fail as intended — patch does not re-pin them (**N5 CA pack**).

### 6. DC CLEAR: NOT CLEAR
- Newest DC file 96a18970 (10:41 PM CT): outside `channel=guard` host rows (excl. smoke) = **0**. Tip NOT GO even with code YES-with-notes.

## Notes (YES-with-notes)
- **N1** DC outside=0 (96a18970). Tip NOT GO until DC CLEAR: unpaid outside >0, qa_clean, smoke-excluded. `DESK_HOST_CHECKS_QA_CLEAN` stays false until DC owner-set.
- **N5** (must-fix; CA pack) outside_count_exclude_unit D2/D5 + deploy exits 4/7/51 re-pins to desk **647401fd** / site **c2f2c98e** (+ desk_host_checks **749e48f2**); OX0/exit53 re-pins with them.
- **N3** Exit53 tip-local 06fa30a7/fca1dd83 unchanged (not in PR); still pins pre-apply desk/site — abort at exit 4 without CA re-pack.
- **N4** Draft / Prefer READY only. Nothing applied to the tip.
- **N6** FIXED this delta: D1 catch → `return []` omit fact.
- Prior N7 nit (`void outsideGuardHostChecks`) retained; harmless.

## Hygiene
- Tip tree `/tmp/ship-oce-tip-36699bae/receipts-mvp` not modified. desk/tools/site/outside_count md5s unchanged after the run.
- Scratch only under `/tmp/sec-desk-host-pr84n6-*`; deleted after this report.
- No tip, merge, deploy, publish, spend, send, GitHub comment, or prod SQL.
- Soft CTA; tipped? **NO**. Soft CTA Prefer KEEP tip HOLD APPLY.
