# LOCKED: Desk per-host outside Guard check counts — 2026-11-04

Status: Design LOCK READY · Prefer KEEP after Tip-B `callers_week_host` LIVE + Security MATCH + DC qa_clean · Soft CTA tip `349386f7` want `2a22280c` Soft CTA walls HOLD Soft CTA fp `ebf26695` · Absolute No-Grade · sticky alerts-50 untouched

**Anton GO NOW via Lead ~6:27–6:28pm CT:** Design LOCK ASAP for Desk per-tool / per-host check-count facts from outside Guard `callers_week_host` (after Tip-B LIVE). Facts only. No ranks as grades.

**Pack 1 chip + OVERRIDE home tease LOCK `df2d95a3…` / file `c16bb494…` remains Prefer KEEP path UNCHANGED** — do not fold this into that LOCK.

Guard Tip-B (logging only tonight): `guard-track/SOFT-OPEN-CALLERS-WEEK-HOST-BRIEF-2026-11-04.md` · leave-off · migrate `0.25` · `recordCallerWeekHost` on `/v1/preflight`. No public surface in Tip-B pack.

Legal option-2 foreshadow (report `67598831`): Desk must show a real list + How we count + "A count, not a rating"; reword home tease off "checked out" when list ships; never badge `/s/:host`.

## Binding

- Source table: `callers_week_host` (`week`, `k`, `host`, `channel`, `n`). Outside only: `channel = 'guard'`. Never `internal`. Never prober / `host_stats`.
- Window: **this ISO week (UTC)** only (same week key as `callers_week`).
- Per-host fact (Prefer KEEP): **checks** = `SUM(n)` for that host this week. Optional secondary: **outside callers** = `COUNT(DISTINCT k)` — do not ship secondary on Pack A unless Lead GO.
- Gate public N: `qa_clean === true && Number.isInteger(N) && N > 0` (DC owner-set). Omit fact line at 0/null. No hardcoded N.
- Absolute No-Grade: no used / trusted / verified / independent / audited / vetted / safe / approved / top / most / popular / leading / grade / score / rank / rating next to the fact. Title / helper: **A count, not a rating.**
- Sort of Desk host list by checks DESC is OK as a **fact order** only if UI does **not** label it rank/top/most/best. No medals, no #1, no "hottest".
- Surfaces: **Desk only** (host row + optional host-detail). **OUT:** `/s/:host` badges, embeds, receipts, seller JSON fields, home Soft CTA tiles, Market rows as grade.
- Soft CTA walls HOLD; fp `ebf26695`; alerts-50 sticky untouched.
- APPLY after Tip-B LIVE rows exist + MATCH + DC CLEAR — Design LOCK seals copy/HTML now; SC Prefer READY when Lead GO.

## Exact copy

### Per-host fact (Desk host row / detail)

When N>0:

```text
Checked N times this week
```

Hover / `title`:

```text
Outside Guard checks for this host this ISO week (UTC). Our own tests excluded. A count, not a rating.
```

Optional footnote once per Desk section (not per row):

```text
How we count · A count, not a rating
```

`How we count` → same anchor as Pack 1 (`/llms-install.md#how-we-count-outside-attaches` or github blob when SC swaps).

**Do not ship:** "most checked", "top sellers", "checked out", "trusted", "safe", buyer×seller invented counts, day clause (no day column yet).

### Empty / zero

Omit the fact line. Do not show `Checked 0 times`. Do not invent placeholders.

## Placement Prefer KEEP (Desk)

### Host row (primary)

Muted 13px fact under / beside host label on the Desk map list / host row — Pack B chrome weight (same as `bw-checked-chip`). Class: `desk-host-checks`. Not inside Attach Guard free / Soft CTA / `#desk-guard` attach CTAs.

### Host detail (optional same pack)

Same string once in host-detail panel if Desk has one open. Same class.

### Section header (optional)

If Desk shows a "checked this week" subsection of mapped hosts with N>0:

```text
Outside Guard checks this week
```

No "most" / "top" in the header.

### OUT forever for this N

`/s/:host`, seller badges, embeds, receipts, OpenAPI public field until Lead GO + Legal re-spot, home Soft CTA, pulse tiles as grade.

## Exact HTML

### Host row fact

```html
<span class="desk-host-checks" data-n="N" title="Outside Guard checks for this host this ISO week (UTC). Our own tests excluded. A count, not a rating.">Checked <b>N</b> times this week</span>
```

### Section footnote (×1 Desk)

```html
<p class="desk-host-checks-note">Outside Guard checks this week · <a href="/llms-install.md#how-we-count-outside-attaches">How we count</a> · A count, not a rating</p>
```

## Exact CSS (Pack B; B/W; ASCII)

```css
.desk-host-checks{display:inline-block;margin:4px 0 0;font-size:13px;line-height:1.4;color:var(--bw-muted)}
.desk-host-checks b{color:var(--bw-fg);font-weight:600}
.desk-host-checks[data-n="0"],.desk-host-checks:not([data-n]){display:none}
.desk-host-checks-note{margin:8px 0 0;font-size:13px;line-height:1.4;color:var(--bw-muted)}
.desk-host-checks-note a{color:var(--bw-fg);text-decoration:none;border-bottom:1px solid var(--bw-line)}
.desk-host-checks-note a:hover{border-bottom-color:var(--bw-fg)}
```

Server-side omit when gate fails; CSS is backstop. No pill/fill/badge chrome.

## Soft CTA walls HOLD

Tip `349386f7` want `2a22280c` · fp `ebf26695` · Desk Soft CTA / Attach Guard free / poller nudge / alerts-50 sticky unchanged · Soft CTA greps 0 · no new Soft CTA tile for this fact.

## Relation to Pack 1 (df2d95a3)

| Pack | Surface | Copy |
|---|---|---|
| 1 (unchanged) | payment-guard + Desk header chip | `Guard checks this week: N outside callers · How we count` |
| 1 (unchanged) | home tease OVERRIDE | `See which sellers are being checked out the most → here` → `/desk` |
| **This LOCK** | Desk **per host** | `Checked N times this week` |

When this list LIVE + DC CLEAR, Design will AMEND Pack 1 home tease (Legal option 2) to drop "checked out" — e.g. `See which sellers get the most Guard checks this week → here` — in a **separate** AMEND; not this seal.

## Smoke after Prefer KEEP

| Check | Pass |
|---|---|
| Desk host with N>0 | `desk-host-checks` ×1 exact string |
| Desk host N=0/null | fact ×0 |
| `/s/*` | `desk-host-checks` ×0; no N badge |
| Soft CTA greps / fp | unchanged |
| Banned words near fact | ×0 (except LOCK title negation / "not a rating") |
| Sort UI labels | no top/most/rank/# |

## SC / Legal / DC / Security next

1. Guard Tip-B LIVE `callers_week_host` + MATCH
2. DC QA gate + qa_clean N per host (or sitewide allowlist)
3. Legal unpaid re-spot this LOCK body md5
4. SC Prefer READY → MATCH → Lead tip
5. Digests→LA

Design MATCH notes: Absolute No-Grade; facts only; Soft CTA walls HOLD; Pack 1 df2d95a3 untouched.

---

## md5

`ba26a8626ca47a8de232b8f5505db453`
