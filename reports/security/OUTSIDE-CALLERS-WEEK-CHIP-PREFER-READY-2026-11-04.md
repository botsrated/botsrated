# Prefer READY — outside Guard callers, week chip + home tease

Digests → LA. Absolute No-Grade. Soft CTA walls HOLD. No tip, no deploy, no merge from this pack. Site Cleaner does not tip.

## Pins

| Pin | Value |
|---|---|
| Design LOCK body | `df2d95a37140e83b5920fb983999daf9` |
| Design LOCK file | `c16bb49401b77425702d65a6f0bb701b` |
| Legal OVERRIDE digest | `7911ec33` (tease ships under Anton OVERRIDE, not a Legal CLEAR) |
| DC qa_clean | full pack `b3bd4914` / leaf `42993bb4` |
| Published N | `2` |
| ISO week | `2026-W45` |
| as_of | `2026-11-05T00:14:00Z` |
| Soft CTA tip | `349386f7` |
| Soft CTA want | `2a22280c` |
| Soft CTA fp | `ebf26695` |
| Git base | `1f4791b59f552bd9ab2d9d4a067518971af9ba61` |
| Patch | `worker/patches/outside-callers-week-chip.patch` |
| Patch md5 | `19c7a987d8c1eef13ff84c9548a1bef1` |

Prefer READY is against Design LOCK body `df2d95a37140e83b5920fb983999daf9` only. The home tease ships under Anton OVERRIDE. Legal OVERRIDE digest `7911ec33` records that ship. The tease is not a Legal CLEAR. The week fact chip stays the CLEAR-with-notes fact. The day window stays parked.

N is outside Guard callers only: `callers_week`, `channel='guard'`, internal excluded. The published figure is not a buyer×seller count and not a per-host count. Our own tests stay out of N.

## What ships

Pack 1 only. Apply on the private receipts-mvp tree at tip `349386f7`. Paths: `worker/src/site.ts`, `worker/test/d1_failsoft_unit.ts`.

Owner-set published figure in `OUTSIDE_GUARD_CALLERS_WEEK`:

- metric `outside_guard_callers_week`
- week `2026-W45`
- `n: 2`
- `qa_clean: true`
- `as_of: 2026-11-05T00:14:00Z`

This is the distinct outside-caller count for the ISO week (`callers_week`, `channel='guard'`, internal excluded). It is a different figure from week-over-week retained attaches. The renderer does not query D1, does not fill N from anywhere else, and does not invent a seller or host count. The home tease links to `/desk` and carries no seller number.

Gate, exact: `qa_clean === true && Number.isInteger(n) && n > 0`. When the gate fails, both helpers return an empty string, so the chip element and the tease element are omitted. CSS `display:none` for `data-n="0"` and a missing `data-n` is the backstop.

### `/tools/payment-guard`

One chip after the hero `.t1-lead`, before `.t1-cta`. It sits outside `#sticky-free`, outside attach CTAs, and outside `t1-chips`.

### `/desk`

The same chip immediately above `<p class="desk-again" id="desk-guard">`. The Attach Guard free anchor is unchanged.

### Home `/`

One tease inside `homePulseStrip`, after `.bw-market-chip` and before `.bw-whats-new`. The home strip does not emit `bw-checked-chip`. The visible sentence has no numeral. `data-n` is the LOCK attribute on the element.

Exact chip:

```html
<p class="bw-checked-chip" data-n="N" title="Distinct outside networks that ran a free Guard check this ISO week (UTC). Our own tests excluded. A count, not a rating.">Guard checks this week: <b>N</b> outside callers · <a href="/llms-install.md#how-we-count-outside-attaches">How we count</a></p>
```

Exact tease:

```html
<p class="bw-checked-tease" data-n="N"><a href="/desk">See which sellers are being checked out the most → here</a></p>
```

`N` in those templates is the published integer when the gate passes. CSS is the LOCK chip rules plus the LOCK tease rules, inserted after the live mobile market-chip rule and before `.bw-stats b`.

Out of this pack: `/s/:host`, seller badges, embeds, receipts, leaderboard, sort-by-N, and the day clause.

## How to apply (does not deploy)

On the private receipts-mvp tree, from that tree's root:

```
patch -p1 --fuzz=0 --no-backup-if-mismatch < worker/patches/outside-callers-week-chip.patch
```

A clean apply leaves no `.orig` or `.rej`. This does not retarget Pages.

## Smoke (published N = 2)

Checked by applying the patch with `--fuzz=0` on a synthetic tree whose anchors match tip `349386f7` (payment-guard hero line, Desk line through `</main>`, `homePulseStrip` return, and the live CSS neighbors). A second apply is rejected. The HTML builders were executed for the gate. This pack does not tip, so live botsrated.com is unchanged.

| Surface | N>0 (published 2) | Gate fail |
|---|---|---|
| `/tools/payment-guard` | `bw-checked-chip` ×1, week copy only | element omitted |
| `/desk` | `bw-checked-chip` ×1, above `#desk-guard` | element omitted |
| `/` | `bw-checked-tease` ×1, exact Anton sentence; `bw-checked-chip` ×0 | tease omitted |
| `/s/*` | chip ×0, tease ×0 (no call site) | ×0 |
| Day clause | ×0 | ×0 |
| Soft CTA | pins unchanged | pins unchanged |

Call sites in `site.ts`: `${outsideCallersChipHtml()}` ×2 (payment-guard hero, Desk), `${outsideCallersTeaseHtml()}` ×1 (`homePulseStrip` only).

Gate checks: N=2 with `qa_clean` renders both strings; N=0, null, a non-integer, and `qa_clean: false` each return an empty string.

Chip title keeps the LOCK negation "A count, not a rating." The word "most" appears only in the LOCK tease sentence (function, home return test, cadence test).

## Soft CTA wall check

HOLD. fp `ebf26695`. Tip `349386f7`, want `2a22280c`.

Diff greps: `free_quota` 0, `?soft=` 0, `quota` 0, `429` 0, day clause 0. `Attach Guard free` is 3 on removed lines and 3 on added lines (the payment-guard hero line and the Desk line already contain that anchor; the chip is inserted beside it). `Open Desk` 0. `Get change alerts` 0. Sticky alerts-50 is untouched. `desk.ts` is not in the diff.

## For Security

This file is Prefer READY. It does not record a MATCH. Security MATCH is the next read of this body against LOCK `df2d95a37140e83b5920fb983999daf9`.

---

## md5

`d981f57ff35fb3039028bf4e20868d37`
