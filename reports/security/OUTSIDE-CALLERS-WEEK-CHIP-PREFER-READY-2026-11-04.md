# STOP — empty-form chip sits on a Soft CTA fingerprint line

Digests → LA. Absolute No-Grade. Soft CTA walls HOLD. Site Cleaner does not tip. No deploy. No merge. Prefer READY is not filed.

Held and void: Prefer READY body `52ea2d7236830f3d21e75d817c996d56`, patch `c9a22ca108a965b66cae6b5a316fb61f`, head `73e626d5e1f654f38d0f6d4ff508bd79722a425e`. Desk call-site FAIL leave-off. Do not apply that patch.

## Pins

| Pin | Value |
|---|---|
| Design LOCK body | `df2d95a37140e83b5920fb983999daf9` |
| Design LOCK file | `c16bb49401b77425702d65a6f0bb701b` |
| Legal OVERRIDE digest | `7911ec33` |
| DC live | full `f84345f2` / leaf `b1782fb0` |
| Soft CTA tip | `5fe37df8` |
| Soft CTA want | `96a0df8b` |
| Soft CTA fp before | `ebf26695dfaccfcea740027fc1d2b7b0` (Desk, 77 recipe lines, tip desk.ts `68ed2fff67f6d7641a8963af80966b2c`) |
| Tip tools.ts | `db56c412b512e5d26277fc8e1dd3fd11` |

Recipe:

```
grep -E 'DESK_FREE|da-free-card|POLLERS_NUDGE|da-pollers-nudge|poller_nudge|DESK_MAP_FREE|DESK_MAP_PRO|STICKY_FREE' worker/src/desk.ts | md5sum
```

## Why this stops

Tip `5fe37df8` places the empty `/desk` call on one line with the Soft CTA tokens (`DESK_FREE_CARD_ID` and the rest) and ends `+ (inner ? "" : deskGuardHtml(null));`. That line matches `DESK_FREE`. The fingerprint hashes every full matching line.

Inserting the chip on that line changes the line. Splitting it also changes the line: the token-bearing line is no longer the original bytes, so the grep output changes. Either way the fingerprint cannot stay `ebf26695dfaccfcea740027fc1d2b7b0`.

`deskFreeHtml` (~L752) also calls `deskGuardHtml(null)` and must stay untouched, so the helper itself cannot prepend the chip for every null caller.

This VM does not have tip desk.ts, so there is no measured after-hash of the real 77-line set. A one-line stand-in that matches the same shape moves as soon as the call is edited:

| Edit | Recipe md5 |
|---|---|
| Untouched stand-in | `8ba3f9961859b87be6e757809dd5bd4d` |
| Chip inserted in place | `88dd67255bf9987c29cd78f3fffab18d` |
| Call split onto a second line | `e1ef82b18c3e617633c45784fad70a92` |

The stand-in is not the tip file. It only shows the recipe changes when that line changes. The tip before-hash remains `ebf26695dfaccfcea740027fc1d2b7b0`.

Map-result `…${deskMapNextHtml(r, esc)}${deskGuardHtml(source)}<p class="desk-again">…` and `hero1`'s one template line are separate anchors. They are not filed here, because the pack is all-or-none and the empty-form insert breaks the fingerprint.

## Soft CTA

Walls HOLD. Tip `5fe37df8`. Want `96a0df8b`. No new patch. `free_quota`, `?soft=`, `quota`, and `429` are not added. `deskFreeHtml` is not edited.

Lead can keep the empty-form chip off that recipe line, or accept a new fingerprint, before a Prefer READY is filed.

---

## md5

`87731f99b2d35b16facb6e32f61e2f2d`
