# Prefer READY — Pack 1 Lead BINDING B (test-only recount)

Digests → LA. Absolute No-Grade. Soft CTA walls HOLD. Soft CTA Prefer KEEP tip HOLD APPLY. No tip, no deploy, no merge. This file does not record a MATCH. Do not partial-apply.

Security re-MATCH NO OWN `62417c60`. Report `reports/security/PR82-OUTSIDE-CALLERS-WEEK-CHIP-REMATCH-493d02be-2026-11-04.md` md5 `52d07c5876bb238d2268be5584b100fc`. Apply was clean. Soft CTA fp stayed `ebf26695dfaccfcea740027fc1d2b7b0`. The only failure was the unit test 38/39: `chip(tools) === 1` looks for `${outsideCallersChipHtml()}`, and the hero1 ternary calls `outsideCallersChipHtml()` without that exact prefix.

Held: body `d293f4338823dc815127a92cf13fb611` / patch `9a4e12fde23d5b6e57f308e36fc0f9bb` / head `493d02bec25fb5ccd71f35016692bbf65b471db0`.

## Pins

| Pin | Value |
|---|---|
| Design LOCK body | `aa481854dd2916d21061943630adecf4` |
| Design LOCK file | `eae645282e05dedc73f1310926d40e4b` |
| Legal OVERRIDE digest | `7911ec33` |
| DC live | full `f84345f2` / leaf `b1782fb0` |
| Published N | `2` · `2026-W45` · as_of `2026-11-05T00:14:00Z` |
| Soft CTA tip | `5fe37df8` |
| Soft CTA want | `96a0df8b` |
| Soft CTA fp | `ebf26695dfaccfcea740027fc1d2b7b0` |
| Patch | `worker/patches/outside-callers-week-chip.patch` |
| Patch md5 | `03aa8bb093c09e08ce1ac30d9b1a22cd` |

## What changed

Test only. `site.ts`, `tools.ts`, and `desk.ts` hunks are byte-identical to the held pack.

`chip call sites option B` now counts the tools call with `tools.split("outsideCallersChipHtml()").length-1===1`. Desk still uses `chip(desk) === 1`, because the map-result insert is the template `${outsideCallersChipHtml()}`. Expect 39/39.

Empty `/desk` stays out. `deskFreeHtml` is not edited. The Soft CTA recipe line is not edited.

## Soft CTA fp

The desk source hunks are unchanged, so the 77 recipe lines stay byte-identical and the fingerprint stays `ebf26695dfaccfcea740027fc1d2b7b0`. Diff greps: `free_quota` 0, `?soft=` 0, `quota` 0, `429` 0.

## Apply

```
patch -p1 --fuzz=0 --no-backup-if-mismatch < worker/patches/outside-callers-week-chip.patch
```

All hunks, or none. Soft CTA Prefer KEEP tip HOLD APPLY.

## For Security

Prefer READY against Design LOCK body `aa481854dd2916d21061943630adecf4`. Re-MATCH on tip `5fe37df8`. Do not tip.

---

## md5

`0af01abf3a5c80b8da368f76f1be589c`
