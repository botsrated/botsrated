# Prefer READY — Pack 1 Lead BINDING B

Digests → LA. Absolute No-Grade. Soft CTA walls HOLD. Soft CTA Prefer KEEP tip HOLD APPLY. No tip, no deploy, no merge. Do not partial-apply.

Held: Prefer READY body `52ea2d7236830f3d21e75d817c996d56` / patch `c9a22ca108a965b66cae6b5a316fb61f` / head `73e626d5e1f654f38d0f6d4ff508bd79722a425e`. Stop record body `87731f99b2d35b16facb6e32f61e2f2d` / head `9fb8ba615e1e4e476f6bd18916de52cf57e5953e`.

## Pins

| Pin | Value |
|---|---|
| Design LOCK body | `aa481854dd2916d21061943630adecf4` |
| Design LOCK file | `eae645282e05dedc73f1310926d40e4b` |
| Design LOCK path | `reports/design/checked-by-n-teams-2026-11-04/LOCKED-CHECKED-BY-N-TEAMS-2026-11-04.md` |
| Legal OVERRIDE digest | `7911ec33` (tease is an Anton OVERRIDE, not a Legal CLEAR) |
| DC live | full `f84345f2` / leaf `b1782fb0` |
| Published N | `2` |
| ISO week | `2026-W45` |
| as_of | `2026-11-05T00:14:00Z` |
| Soft CTA tip | `5fe37df8` |
| Soft CTA want | `96a0df8b` |
| Soft CTA fp | `ebf26695dfaccfcea740027fc1d2b7b0` |
| Tip desk.ts | `68ed2fff67f6d7641a8963af80966b2c` |
| Tip tools.ts | `db56c412b512e5d26277fc8e1dd3fd11` |
| Git base | `1f4791b59f552bd9ab2d9d4a067518971af9ba61` |
| Patch | `worker/patches/outside-callers-week-chip.patch` |
| Patch md5 | `9ee98ad9e55a55e2e1f8f554e7eb8a9c` |

Lead BINDING B: the empty `/desk` chip is out. The chip ships on the map-result and on payment-guard `hero1`. N is outside Guard callers only (`callers_week`, `channel='guard'`, internal excluded). Not a buyer×seller count and not a per-host count. The day window stays parked.

## What ships

One patch. Apply on a copy of tip `5fe37df8`. All hunks, or none.

`site.ts` keeps the owner-set figure, `outsideGuardCallersWeekN`, the chip and tease helpers, the LOCK CSS, and the home tease after `.bw-market-chip` and before `.bw-whats-new`. No synthetic payment-guard or Desk HTML. The unit test calls `outsideGuardCallersWeekN`.

`tools.ts` imports `outsideCallersChipHtml`. Inside the `hero1` template, the chip is inserted after `</p>` and before `<div class="t1-cta">`, and only when `lead` is the payment-guard sentence.

`desk.ts` imports the same helper. The map-result template becomes `${deskMapNextHtml(r, esc)}${outsideCallersChipHtml()}${deskGuardHtml(source)}`. The empty-form line is not in the patch. `deskFreeHtml` is not in the patch.

## How to apply (does not deploy)

```
patch -p1 --fuzz=0 --no-backup-if-mismatch < worker/patches/outside-callers-week-chip.patch
```

## Soft CTA fp proof

Recipe:

```
grep -E 'DESK_FREE|da-free-card|POLLERS_NUDGE|da-pollers-nudge|poller_nudge|DESK_MAP_FREE|DESK_MAP_PRO|STICKY_FREE' worker/src/desk.ts | md5sum
```

Desk measured that command on untouched tip desk.ts as `ebf26695dfaccfcea740027fc1d2b7b0` (77 lines).

The `desk.ts` hunks in this patch are the import and the map-result interior. Neither added line nor removed line matches the recipe. `DESK_FREE_CARD_ID` does not appear. `deskGuardHtml(null)` is not an edited source line (the test only asserts the chip is absent beside that call). `deskFreeHtml` is not edited. The empty-form line stays byte-identical.

A clean apply therefore leaves the 77 recipe lines unchanged, and the fingerprint stays `ebf26695dfaccfcea740027fc1d2b7b0`. This VM does not hold tip `5fe37df8`, so the 77-line command was not re-executed here. The `site.ts` hunks are the three Security already applied with `--fuzz=0` on that tip. Tools and Desk imports are the hunks that already applied. The hero1 and map-result hunks are whole lines equal to the interiors Lead quoted. If a tip line has more characters around that interior, that hunk rejects and the apply stops. Do not keep a partial tree.

Diff greps: `free_quota` 0, `?soft=` 0, `quota` 0, `429` 0. Sticky alerts-50 is untouched.

## Smoke at published N = 2

| Surface | Result |
|---|---|
| `/tools/payment-guard` | chip ×1 after the lead, before `.t1-cta` |
| `/desk` map-result | chip ×1 immediately before `deskGuardHtml(source)` |
| `/desk` empty | chip ×0 |
| `/` | tease ×1, chip ×0 |
| `/s/*` | chip ×0, tease ×0 |
| Day clause | ×0 |
| Gate fail | chip and tease omitted |

## For Security

Prefer READY against Design LOCK body `aa481854dd2916d21061943630adecf4`. It does not record a MATCH. Re-MATCH on a copy of tip `5fe37df8`. Soft CTA Prefer KEEP tip HOLD APPLY.

---

## md5

`fb369108316db2c25aa66b32043a7387`
