# MATCH-READY — withheld receipt offline check (Prefer KEEP)

Digests → LA. Absolute No-Grade. Soft CTA walls HOLD. No tip, no deploy, no merge from this pack. Prober does not tip. Lead/Ship tip after MATCH.

Base: `origin/main` after PR #72 (`3091012e`), including #51 and #59 (`e257d19`). Live tip stays `84f45f14`, want `433883f19b5eae20c8b7e6b15d50263b`.

## Decision

Prefer KEEP, LO option 1. Legal redaction stays. `listed_amount`, `listed_payTo`, and `checks.*listing*` stay withheld on the public copy. This repo has no Pages `deco()`. PR #72 (`worker/patches/home-pulse-drop-last-check.patch`) only drops the home pulse last-check cell. It does not publish the full signed receipt. No Prefer KEEP path in this tree restores those signed fields.

## What a reader gets

Withheld copy (`withheld_fields` or `withheld_note` on the receipt, or on the wrapper):

- Status `redacted copy`. `valid` is false. `offline_verifiable` is false. Error `redacted_copy`.
- CLI prints `REDACTED` and exits 3. It does not print `FAIL`, `VALID`, `INVALID`, or `signature invalid`.
- It points at `GET /v1/verify?id=&host=&day=` for the stored record.
- Receipt HTML does not paste `node spec/verify.mjs` or the curl one-liner. Heading is `Stored record`.
- Courthouse paste of that JSON, or of the allowlisted receipt link, shows `redacted copy` (including when WebCrypto is missing).

Full signed examples (`spec/examples/unpaid-probe.signed.json` and the other signed fixtures): still `signature valid`, CLI exit 0, `VALID`.

A body that drops `listed_amount` / `listed_payTo` and does not carry the withheld markers stays `signature invalid`. The marker is what stops the false "signature invalid". It is not a pass: adding `withheld_fields` to a complete signed receipt also returns `redacted copy`, not `signature valid`.

Checked against the live public JSON for `ac16e0eeff1e0d9ffcfc` (GET only): the CLI on that file prints `REDACTED` and the stored-record URL `https://botsrated.com/v1/verify?id=ac16e0eeff1e0d9ffcfc&host=api.exa.ai&day=2026-10-23`. Fixture: `spec/examples/unpaid-probe.withheld.json`.

## Soft CTA wall check

HOLD. This pack does not edit walls, 429, quota, `free_quota.note`, or the Desk CTA. The receipt page still has `Map many hosts free in Desk →`. Courthouse `?soft=1` still gates the Attach Guard link; the idle booth heading is unchanged. `worker/patches/home-pulse-drop-last-check.patch` is untouched. No prober or mcp-cron toml, no wrangler cron flag, no D1 write, no secret, no money-out. Disk EMERGENCY-paused tomls are not reconciled here.

## Leave-off for Security

1. Live HTML at `/receipt/ac16e0eeff1e0d9ffcfc` still shows the `verify.mjs` one-liner. `spec/receipt-page.mjs` is not what Pages serves until a later tip returns it. This pack does not tip.
2. After this merges to `main`, that one-liner (it downloads `spec/verify.mjs` at `ref=main`) will print `REDACTED` instead of `INVALID`. The page text still invites the command until the Pages tip.
3. Live `GET /v1/verify` already checks the stored record (`valid: true`). This pack does not mount or change that route. `verifyResultJson` only mirrors the offline result.
4. Exit code 3 is new. Exit 0 remains a matching signature. Exit 1 remains a failed check. `valid: false` with status `redacted copy` is not a bad signature and not a pass.
5. `@botsrated/x402-preflight` stays 0.3.1. No publish. `vendor/verify-core.mjs` and `spec/courthouse/verify-core.mjs` are byte copies of `spec/verify-core.mjs`.
6. Do not present `ac16e0eeff1e0d9ffcfc` as offline-verifiable. The signer is not the defect.

## Tests

`node --test spec/verify.test.mjs` 22/22. `node --test integrations/x402-client/test/verify-receipt.parity.test.mjs` 10/10.
