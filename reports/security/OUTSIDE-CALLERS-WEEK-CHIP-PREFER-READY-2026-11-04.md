# Prefer READY rematch — outside Guard callers, chip + home tease

Digests → LA. Absolute No-Grade. Soft CTA walls HOLD. No tip, no deploy, no merge. Site Cleaner does not tip. Do not partial-apply.

Held: previous Prefer READY body `d981f57ff35fb3039028bf4e20868d37`, patch `19c7a987d8c1eef13ff84c9548a1bef1`, head `4c97d3a33260fbcd2b750d4969fc6c0c84564f40`. Security MATCH NO OWN `209e54926274237cc2233601bb2511f9` (report `a7848978`). This file replaces that pack.

## Pins

| Pin | Value |
|---|---|
| Design LOCK body | `df2d95a37140e83b5920fb983999daf9` |
| Design LOCK file | `c16bb49401b77425702d65a6f0bb701b` |
| Legal OVERRIDE digest | `7911ec33` (tease ships under Anton OVERRIDE, not a Legal CLEAR) |
| DC live | full `f84345f2` / leaf `b1782fb0` |
| Published N | `2` |
| ISO week | `2026-W45` |
| as_of | `2026-11-05T00:14:00Z` |
| Soft CTA tip | `5fe37df8` |
| Soft CTA want | `96a0df8b` |
| Soft CTA fp | `ebf26695dfaccfcea740027fc1d2b7b0` |
| Git base | `1f4791b59f552bd9ab2d9d4a067518971af9ba61` |
| Patch | `worker/patches/outside-callers-week-chip.patch` |
| Patch md5 | `c9a22ca108a965b66cae6b5a316fb61f` |

N is outside Guard callers only: `callers_week`, `channel='guard'`, internal excluded. The published figure is not a buyer×seller count and not a per-host count. Our own tests stay out of N. The day window stays parked.

## What ships (one patch, all hunks)

Apply on a copy of the private receipts-mvp tree at tip `5fe37df8`. Paths: `worker/src/site.ts`, `worker/src/tools.ts`, `worker/src/desk.ts`, `worker/test/d1_failsoft_unit.ts`.

Owner-set `OUTSIDE_GUARD_CALLERS_WEEK` in `site.ts`: metric `outside_guard_callers_week`, week `2026-W45`, `n: 2`, `qa_clean: true`, `as_of: 2026-11-05T00:14:00Z`.

Gate, exact, on the shipped helper `outsideGuardCallersWeekN`: `qa_clean === true && Number.isInteger(n) && n > 0`. A failed gate returns an empty string, so the element is omitted. The unit test calls that helper. It does not keep a local copy of the gate.

### `site.ts`

Helpers, chip CSS, tease CSS, and the home tease only. The tease stays in `homePulseStrip` after `.bw-market-chip` and before `.bw-whats-new`. Home does not emit the chip. The synthetic payment-guard and Desk HTML lines from the held patch are gone.

### `tools.ts`

Imports `outsideCallersChipHtml` from `./site.ts`. Inside `hero1`, the chip is emitted only when `lead` is the payment-guard sentence, and it sits after `</p>` and before `<div class="t1-cta">`. Other tool heroes keep an empty string there.

### `desk.ts`

Imports the same helper. Two inserts only:

- `${outsideCallersChipHtml()}` immediately before `${deskGuardHtml(source)}` (map result).
- `${outsideCallersChipHtml()}` immediately before `${deskGuardHtml(null)}` (empty `/desk` form).

`deskFreeHtml` is not edited. The Attach Guard free anchor stays the body of `deskGuardHtml`.

Exact chip: `Guard checks this week: N outside callers · How we count` with the LOCK title. Exact tease: `See which sellers are being checked out the most → here` linking to `/desk`. CSS is the LOCK chip rules plus the LOCK tease rules, in `SITE_CSS`, which the live payment-guard and Desk documents already include.

Out of this pack: `/s/:host`, badges, embeds, receipts, leaderboard, sort-by-N, and the day clause.

## How to apply (does not deploy)

On a copy of the private tree, from that tree's root:

```
patch -p1 --fuzz=0 --no-backup-if-mismatch < worker/patches/outside-callers-week-chip.patch
```

All hunks, or none. A rejected hunk means do not keep a partial tree. This does not retarget Pages.

## Smoke

Security's NO already showed the `site.ts` CSS, helper, and home-tease hunks apply on the real tip tree (`--fuzz=0`, hunks at 583, 856, and 898). Those three hunks are unchanged in role. The synthetic `t1-hero` and expanded Desk HTML hunks are removed.

This VM does not have `/tmp/guard-cwh-349386f7/receipts-mvp` or tip `5fe37df8` checked out. The tools and Desk hunks were applied here only against the anchor lines named below, and a second apply was rejected. Security re-MATCH on a copy of tip `5fe37df8` is the real apply.

| Anchor | Old line this patch expects |
|---|---|
| `hero1` lead/cta junction | the whole line `<p class="t1-lead">${lead}</p><div class="t1-cta">` |
| map result | the whole line `${deskGuardHtml(source)}` |
| empty `/desk` form | the live form line through `</main>`, with the rendered guard paragraph replaced by `${deskGuardHtml(null)}` |

The empty-form line still contains the href fragment `#da-free-card`. The chip expression is added beside the call. Constant definition lines for `STICKY_FREE`, `DESK_FREE`, `DESK_MAP_FREE`, `DESK_MAP_PRO`, `POLLERS_NUDGE`, `da-pollers-nudge`, and `poller_nudge` are not in the diff. If the fp hash includes every line that contains `da-free-card`, that one template line changes the fp. Re-measure `ebf26695dfaccfcea740027fc1d2b7b0` on the real tree.

| Surface | Published N=2 | Gate fail |
|---|---|---|
| `/tools/payment-guard` | `bw-checked-chip` ×1 after the lead, before `.t1-cta` | omitted |
| `/desk` empty form and map result | `bw-checked-chip` ×1 immediately before `deskGuardHtml` | omitted |
| `/` | tease ×1, chip ×0 | tease omitted |
| `/s/*` | chip ×0, tease ×0 | ×0 |
| Day clause | ×0 | ×0 |

## Soft CTA wall check

HOLD. Tip `5fe37df8`, want `96a0df8b`, fp target `ebf26695dfaccfcea740027fc1d2b7b0`.

Diff greps: `free_quota` 0, `?soft=` 0, `quota` 0, `429` 0, day clause 0. `Open Desk` 0. `Get change alerts` 0. Sticky alerts-50 is untouched.

## For Security

This file is the rematch Prefer READY. It does not record a MATCH. Re-MATCH against LOCK `df2d95a37140e83b5920fb983999daf9` on a copy of tip `5fe37df8`. Do not partial-apply.

---

## md5

`52ea2d7236830f3d21e75d817c996d56`
