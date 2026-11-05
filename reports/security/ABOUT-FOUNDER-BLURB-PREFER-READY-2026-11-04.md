# Prefer READY — About founder blurb (Prefer KEEP)

Digests → LA. Absolute No-Grade. Soft CTA walls HOLD. SC no tip. No deploy and no merge from this pack.

## Pins

| Pin | Value |
|---|---|
| PR | https://github.com/botsrated/botsrated/pull/83 |
| Head | `c34cdc7918c74d8d37d18649f3c4b00bcccc0acc` |
| Prefer READY path | `reports/security/ABOUT-FOUNDER-BLURB-PREFER-READY-2026-11-04.md` |
| Patch | `worker/patches/about-founder-blurb.patch` |
| Patch md5 | `ca052d0e45f7020abc9ab55a26eea776` |
| Design LOCK body | `4f2479b151b908cde01b9b3bcb8253ac` |
| Soft CTA tip | `81afc6ed` |
| Soft CTA want | `c61383be` |
| Soft CTA fp | `ebf26695` |
| Absolute No-Grade | yes |
| SC no tip | yes |
| Digests | LA |

Head above is the patch commit. This leave-off fill is its child. The pull request head is that child.

## What changed

`/about` only. `page()` in `worker/src/index.ts` renders the legacy `.pg` About page. The live CSS says so: `page() in index.ts`. `shell()` stays in `site.ts`.

The who-runs paragraph:

```html
<p>Run by Anton Clark, Founder. Reachable at <a href="mailto:botsrated@gmail.com">botsrated@gmail.com</a> · <a href="https://botsrated.com">https://botsrated.com</a></p>
```

is replaced with the Design Exact Founder block (H2, contact line, founder paragraph). The `.pg` closer stays on the last line. P1, P2, and the What we never do list are not rewritten. No new classes, no CTA, no `https://botsrated.com` on the contact line. Mailto only.

Home, Desk, tools, pricing, and the Guard page are not in the diff. Soft CTA recipe lines and the sticky strip are not in the diff.

## Soft CTA greps

On `worker/patches/about-founder-blurb.patch`:

| Token | Count |
|---|---|
| `free_quota` | 0 |
| `?soft=` | 0 |
| `quota` | 0 |
| `429` | 0 |

This diff does not edit the Soft CTA recipe lines, so the standing fingerprint stays `ebf26695` (full pin `ebf26695dfaccfcea740027fc1d2b7b0` from the prior pack). Those lines are not in this checkout, so this pack does not rehash them.

## Apply

```
patch -p1 --fuzz=0 --no-backup-if-mismatch < worker/patches/about-founder-blurb.patch
```

Against the tree that still has the who-runs line. All hunks, or none.

## Smoke

Fixture: the `/about` main captured at 2026-11-05T04:08Z on deployment `81afc6ed`, with the `<main>` wrapper removed so the source line ends at `</div>`. `patch -p1 --fuzz=0` exit 0. Hunk landed at line 6.

| Check | Result |
|---|---|
| `<h2>Founder</h2>` | 1 |
| Contact line | degree + UMSL + `mailto:botsrated@gmail.com`; no `https://botsrated.com` on that line |
| Founder paragraph | exact, including "not grades, not vibes" |
| `Run by Anton Clark, Founder` | 0 |
| P1, P2, never-do list | unchanged |
| Founder blurb on `/`, `/desk`, `/tools`, `/pricing`, `/tools/payment-guard`, `/market` | 0 |

Production deployment `36699bae` (2026-11-05T04:25:28Z) was already serving this Founder block when rechecked. This pack did not create that deployment. The live Founder block matches the patch's new HTML byte for byte. Soft CTA tip pin stays `81afc6ed`. Do not tip from this pack.

## For Security

Prefer READY against Design LOCK body `4f2479b151b908cde01b9b3bcb8253ac`. Re-MATCH on tip `81afc6ed`. Soft CTA walls HOLD. Soft CTA fp `ebf26695`. Soft CTA greps 0. Absolute No-Grade. SC no tip. Digests → LA.

---

## md5

`ce4937c20e91f13cb91018b0e076640f`
