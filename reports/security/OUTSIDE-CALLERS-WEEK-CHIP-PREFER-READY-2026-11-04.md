# Prefer READY — Pack 1 Lead BINDING B (tip-anchored)

Digests → LA. Absolute No-Grade. Soft CTA walls HOLD. Soft CTA Prefer KEEP tip HOLD APPLY. No tip, no deploy, no merge. Do not partial-apply.

Held: body `52ea2d7236830f3d21e75d817c996d56` / patch `c9a22ca108a965b66cae6b5a316fb61f` / head `73e626d5e1f654f38d0f6d4ff508bd79722a425e`. Stop body `87731f99b2d35b16facb6e32f61e2f2d` / head `9fb8ba615e1e4e476f6bd18916de52cf57e5953e`. Prior option-B body `fb369108316db2c25aa66b32043a7387` / patch `9ee98ad9e55a55e2e1f8f554e7eb8a9c` / head `db6ed5898b511a6b280105ed5d879afa79f76cfd` (interiors were not full tip lines).

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
| Tip desk.ts | `68ed2fff67f6d7641a8963af80966b2c` |
| Tip tools.ts | `db56c412b512e5d26277fc8e1dd3fd11` |
| Patch | `worker/patches/outside-callers-week-chip.patch` |
| Patch md5 | `9a4e12fde23d5b6e57f308e36fc0f9bb` |

N is outside Guard callers only (`callers_week`, `channel='guard'`, internal excluded). Not a per-seller or per-host count. The day window stays parked. The home tease is an Anton OVERRIDE, not a Legal CLEAR.

## What ships

`site.ts`: helpers, LOCK CSS, home tease after `.bw-market-chip` and before `.bw-whats-new`. Gate is `outsideGuardCallersWeekN`.

`tools.ts`: import from `./site`. `hero1` inserts the chip after `</p>` and before `<div class="t1-cta">` only when the lead is the payment-guard sentence. The hunk is the real one-line template (`${p}`, `${esc(h1)}`, `${lead}`, `${cta}`, `${link}`, `${note}`).

`desk.ts`: import from `./site`, placed as its own statement. Map-result only:

`${deskMapNextHtml(r, esc)}${outsideCallersChipHtml()}${deskGuardHtml(source)}`

Empty `/desk` is not edited. `deskFreeHtml` is not edited.

## Soft CTA fp proof

Recipe: `grep -E 'DESK_FREE|da-free-card|POLLERS_NUDGE|da-pollers-nudge|poller_nudge|DESK_MAP_FREE|DESK_MAP_PRO|STICKY_FREE' worker/src/desk.ts | md5sum`

Untouched tip: `ebf26695dfaccfcea740027fc1d2b7b0` (77 lines). The desk hunks are the import and the map-result line. Neither matches the recipe. `DESK_FREE_CARD_ID` is absent from the patch. A clean apply leaves the 77 lines byte-identical, so the fingerprint stays `ebf26695dfaccfcea740027fc1d2b7b0`.

Diff greps: `free_quota` 0, `?soft=` 0, `quota` 0, `429` 0.

## Apply

```
patch -p1 --fuzz=0 --no-backup-if-mismatch < worker/patches/outside-callers-week-chip.patch
```

All hunks, or none. Soft CTA Prefer KEEP tip HOLD APPLY.

## Smoke at N = 2

| Surface | Result |
|---|---|
| `/tools/payment-guard` | chip ×1 after the lead, before `.t1-cta` |
| `/desk` map-result | chip ×1 before `deskGuardHtml(source)` |
| `/desk` empty | chip ×0 |
| `/` | tease ×1, chip ×0 |
| `/s/*` | chip ×0, tease ×0 |
| Day clause | ×0 |

## For Security

Prefer READY against LOCK body `aa481854dd2916d21061943630adecf4`. This file does not record a MATCH. Re-MATCH on a copy of tip `5fe37df8`.

---

## md5

`d293f4338823dc815127a92cf13fb611`
