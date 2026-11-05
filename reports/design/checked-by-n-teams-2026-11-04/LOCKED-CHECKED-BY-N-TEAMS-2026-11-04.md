# LOCKED AMEND: Outside Guard callers chip + Anton OVERRIDE home tease — 2026-11-04

Status: Design LOCK READY · Prefer KEEP Pack 1 · Soft CTA tip `5fe37df8` want `96a0df8b` Soft CTA walls HOLD Soft CTA fp `ebf26695` · Soft OPEN park OVERRIDDEN this chip only · sticky still alerts-50 · Absolute No-Grade

**Anton OVERRIDE BINDING ~6:17pm CT via Lead:** Legal chill; ship punchy home tease TODAY. Prefer KEEP = week-only chip + home tease exact below. Log **OVERRIDE against Legal HOLD** `legal/SOFT-OPEN-GUARD-VOLUME-DAY-WEEK-HOME-TEASE-UNPAID-RESPOT-2026-11-04.md` whole md5 **`67598831`** (bent tease HOLD-with-notes). Digest→LA.

**Lead BINDING ~7:03pm CT:** B — empty-`/desk` chip **OUT this cut**. Desk chip still on **map-result** + `/tools/payment-guard` tools hero1. Soft CTA Prefer KEEP tip HOLD APPLY. Digests→LA.

**Legal CLEAR-with-notes (chip):** week-only fact chip on `/tools/payment-guard` + Desk map-result. Today PARKED.

**No fake per-seller count** — no host column on `callers_week`. Tease is nav/interest copy gated on week N>0; Desk does not claim a sortable seller ranking. No N on home.

Supersedes Prefer KEEP pin `df2d95a37140e83b5920fb983999daf9` (empty-Desk chip in). Prior VOID: `b0dad368…`, `ef1a45b1…`, `f2203dcc…`, `356ddea5…`, `42b41997…`, teams/v2.

## Binding

- Metric: distinct **outside callers** / networks (`callers_week`, `channel='guard'`, `internal` excluded). NOT teams.
- Window: **this week** (ISO week UTC) only. Today PARKED until callers_day + MATCH + DC.
- Gate: `qa_clean === true && Number.isInteger(N) && N > 0`. Omit chip + home tease at 0/null. DC CLEAR N=2 (via LA) for this tip when Lead GO.
- Surfaces chip: `/tools/payment-guard` tools hero1 + **Desk map-result only**. **Empty `/desk` chip OUT this cut.** Never `/s/:host`, badge, embed, receipt, leaderboard, sort-by-N.
- Home tease: `/` only, after `.bw-market-chip`, before `.bw-whats-new`. Link `/desk`. **No N on home.** Not a Soft CTA tile.
- Banned near **fact chip**: used, trusted, verified, independent, audited, vetted, safe, approved, top, most, popular, leading, grade, score, rank, rating.
- **Exception (Anton OVERRIDE):** home tease may use **most** + "checked out" exactly as LOCKed. No grade/score/rank/trusted/verified/safe. Not a fake per-seller metric.
- Soft CTA walls HOLD; alerts-50 sticky untouched.

## Exact copy — Prefer KEEP Pack 1

### Fact chip (`/tools/payment-guard` + Desk map-result)

```text
Guard checks this week: N outside callers · How we count
```

`How we count` → `/llms-install.md#how-we-count-outside-attaches` (Legal Should: blob URL preferred; SC may swap without Design re-LOCK if chip otherwise matches).

Hover / `title`:

```text
Distinct outside networks that ran a free Guard check this ISO week (UTC). Our own tests excluded. A count, not a rating.
```

### Home tease (N>0 only) — Anton OVERRIDE exact

```text
See which sellers are being checked out the most → here
```

→ `/desk`. No N. No per-seller count invented.

## Placement Prefer KEEP (Pack 1)

### `/tools/payment-guard` (tools hero1)

Fact chip after `.t1-lead`, before `.t1-cta`. Not inside attach CTAs / `#sticky-free` / `t1-chips`.

### Desk — map-result only (Lead BINDING B)

Fact chip near map header / map-result, above `#desk-guard`, **only when map-result is showing** (hosts mapped / result panel live).

**OUT this cut:** empty `/desk` (no map-result) — no `bw-checked-chip`. Never inside Attach Guard free.

### Home `/`

Tease after `.bw-market-chip`, before `.bw-whats-new`. Never in `.bw-strip`, Soft CTA tiles, sticky, or pulse. Chip ×0 on home.

### OUT forever for the N fact chip

`/s/:host`, seller badges, embeds, receipts, leaderboard, sort-by-N. **Plus this cut:** empty `/desk`.

## Exact HTML

### Fact chip

```html
<p class="bw-checked-chip" data-n="N" title="Distinct outside networks that ran a free Guard check this ISO week (UTC). Our own tests excluded. A count, not a rating.">Guard checks this week: <b>N</b> outside callers · <a href="/llms-install.md#how-we-count-outside-attaches">How we count</a></p>
```

### Home tease

```html
<p class="bw-checked-tease" data-n="N"><a href="/desk">See which sellers are being checked out the most → here</a></p>
```

Today clause HTML: PARKED — do not ship.

## Exact CSS (Pack B weight; B/W; ASCII)

```css
.bw-checked-chip{margin:12px 0 0;font-size:13px;line-height:1.4;color:var(--bw-muted)}
.bw-checked-chip b{color:var(--bw-fg);font-weight:600}
.bw-checked-chip a{color:var(--bw-fg);text-decoration:none;border-bottom:1px solid var(--bw-line)}
.bw-checked-chip a:hover{border-bottom-color:var(--bw-fg)}
.bw-checked-chip[data-n="0"],.bw-checked-chip:not([data-n]){display:none}
.bw-checked-tease{margin:10px 0 0;padding:0 24px;font-size:13px;line-height:1.4;color:var(--bw-muted)}
.bw-checked-tease a{color:var(--bw-fg);text-decoration:none;border-bottom:1px solid var(--bw-line)}
.bw-checked-tease a:hover{border-bottom-color:var(--bw-fg)}
.bw-checked-tease[data-n="0"],.bw-checked-tease:not([data-n]){display:none}
@media (max-width:767px){.bw-checked-tease{padding:0 4px;margin-top:8px}}
```

Server-side omit when gate fails **or** empty Desk (no map-result); CSS is backstop. No pill/fill/badge/strip merge.

## Soft CTA walls HOLD

Tip `5fe37df8` want `96a0df8b` · fp `ebf26695` · `Attach Guard free` ×2 on `/` · Open Desk / Get change alerts unchanged · free_quota/`?soft=` ×0 new · alerts-50 sticky untouched · Soft CTA greps 0.

## Smoke after Prefer KEEP

| Surface | N>0 | N=0 |
|---|---|---|
| `/tools/payment-guard` | `bw-checked-chip` ×1 week-only | ×0 |
| `/desk` empty (no map-result) | chip ×0 | ×0 |
| `/desk` map-result | `bw-checked-chip` ×1 week-only | ×0 |
| `/` | `bw-checked-tease` ×1 exact Anton tease; chip ×0 | tease ×0 |
| `/s/*` | chip ×0; tease ×0 | ×0 |
| Soft CTA greps | 0 change | 0 change |
| today clause | 0 live | 0 |

## OVERRIDE + BINDING log

- Anton OVERRIDE BINDING 2026-11-04 ~6:17pm CT via Lead against Legal HOLD-with-notes on bent home tease (Legal report whole `67598831`). Ship punchy tease today; no fake host/seller count.
- Lead BINDING 2026-11-04 ~7:03pm CT: empty-`/desk` chip OUT this cut; chip stays on map-result + payment-guard tools hero1. Soft CTA tip `5fe37df8` walls HOLD. Digests→LA.

## SC next

Prefer READY rematch against **this** body md5 — Pack 1 chip + tease; empty Desk chip OUT. Soft CTA walls HOLD tip `5fe37df8`. Digests→LA.

---

## md5

`aa481854dd2916d21061943630adecf4`
