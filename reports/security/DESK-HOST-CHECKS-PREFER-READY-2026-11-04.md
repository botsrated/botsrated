# Prefer READY — Desk per-host outside Guard checks (Design LOCK ba26a862)

Digests→LA. Absolute No-Grade. Soft CTA Prefer KEEP tip HOLD APPLY. Desk **no tip** / HOLD APPLY until Security MATCH → Lead Soft CTA Prefer KEEP tip. Do not partial-apply.

Anton GO NOW via Lead Soft CTA tip tip **6360c8c0** want **c72e1e43** Soft CTA walls HOLD Soft CTA fp **ebf26695** Soft CTA greps 0. Smoke-exclude LIVE leave-off **2e7581cb**.

## Pins
| Pin | Value |
|---|---|
| Soft CTA tip / want | **6360c8c0** / **c72e1e43** |
| Soft CTA fp | **ebf26695dfaccfcea740027fc1d2b7b0** |
| Design LOCK body / whole | **ba26a862** / **4a836030** |
| Legal Design-copy / Legal B | **14e1c72a** / **4487ca62** |
| Tip desk/tools/site/outside_count | **0922547f** / **4608ab48** / **df8f7845** / **02f39860** |
| Prefer READY leave-off | this file (md5 sidecar) |
| Patch | **34250c7e** (`34250c7e3a4d15ec3c4ddd73c744e4f1`) — N6 D1 catch on **57179e7d** / MATCH YES-with-notes OWN **058d3bde** sidecar **b0aafbee** |
| Post-apply tip dry | desk **647401fd** / desk_host_checks **749e48f2** / site **c2f2c98e** / unit **036369f8** / outside_count **02f39860** |
| Exit 53 amend | tip-local **06fa30a7** / **fca1dd83** (not in PR) |
| Prior | VOID **4f4a0e79**; HOLD **48a1e23c**; MATCH YES base **57179e7d** + N6 delta this patch |
| Tip NOT GO until | DC CLEAR unpaid outside >0 qa_clean smoke-excluded **and** Security MATCH on this patch **and** CA re-pack PR #84 (N5 unit D2/D5 + deploy exits 4/7/51 re-pins) |

## What ships (Desk only)
Exact Design LOCK HTML/CSS. Fact = `SUM(n)` ISO week UTC `callers_week_host` `channel='guard'`. Gate `qa_clean === true && Number.isInteger(N) && N > 0` else omit. Absolute No-Grade. Soft CTA walls untouched.

Host fact + footnote + CSS: unchanged from Design LOCK ba26a862 (byte fences).

## Data path
1. `outsideGuardHostChecksSql(week)` → `{sql,binds}` → `prepare.bind(...binds).all()`; map `{host,checks}`.
2. `await deskPreviewStampHostChecks(db, nodes)` inside `deskPreview`.
3. **N6:** wrap D1 read in try/catch; on error `return []` (omit fact; fail-soft Desk map).
4. Edge TTL 15m; own hosts filtered; `qa_clean` stays false until DC owner-set.
5. Soft CTA recipe / Pack1 `outsideCallersChipHtml` untouched.

## Soft CTA walls
Recipe → **ebf26695** before = after. Soft CTA greps 0 on added lines. Pack1 chip call-site ×1.

## Apply
```
patch -p1 --fuzz=0 --no-backup-if-mismatch < worker/patches/desk-host-checks.patch
```
All hunks or none. Soft CTA Prefer KEEP tip HOLD APPLY.

## Verified (~11:27pm CT)
- Dry-apply tip **6360c8c0** fuzz=0, 0 `.rej`
- Soft CTA fp ebf26695; greps 0; Pack1 ×1; unit ok; importers=desk.ts only
- N6 catch present; adapter+callsite retained

## CA pack (must-before-tip; SC owns)
- Re-pack PR #84 tip-anchored to this patch
- N5: outside_count_exclude_unit D2→importers==[desk.ts]; D5 desk→post-apply desk md5; OX0/exit53 re-pins with desk/site/desk_host_checks
- Deploy exits 4/7/51 → desk **647401fd** / site **c2f2c98e** (+ desk_host_checks **749e48f2**)

## Follow-ons
- Design AMEND Pack1 tease after list LIVE
- Next-cut **b5912aad** HOLD APPLY until this LIVE
