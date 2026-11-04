# Halt policy

The customer sets halt rules on measured chips. BotsRated does not score. A halt aborts the payment hook. It does not change `failOpen` (the default stays open) and it does not change `fail_mode`.

This page extends [`fail-mode.md`](fail-mode.md) and [`policy-receipt-v1.md`](policy-receipt-v1.md). The signed policy receipt body is unchanged. A halt is not a new verdict and not a new chip.

## What the customer sets

| Field | Where | When it aborts |
|---|---|---|
| `haltOn` | `guardAttach({ haltOn })` | A listed chip is present on the measurement. This field wins when it is set. |
| `halt_on` | the policy object, only if `haltOn` is omitted | Same, using the customer's chip list. |
| `strict_mode: true` | `haltOn` or the policy object, only if no chip list is set | The sample list below. |

Omit all three and chip halt stays off. An empty chip list is on, and it matches nothing, so it does not abort. A list that names anything outside the fixed chip set could not be read: the payment stops. The unread word is not echoed.

`strict_mode` here is that sample. It is not `policies.strict`, and it is not a closed `fail_mode`.

## Sample (`strict_mode`)

| Chip | Halt |
|---|---|
| `payTo changed` | yes |
| `probe failed` | yes |
| `live` | no |
| `402 ok` | no |
| `no data yet` | no |

The customer can pass a different list. Their list replaces the sample. The helper is `strictModeHalt()` in `@botsrated/x402-preflight`.

```ts
import { guardAttach, strictModeHalt } from "@botsrated/x402-preflight/guard-attach";

const attach = guardAttach({
  policy: { id: "pol_desk", version: "3", fail_mode: "open", pay_to: ["0x…"] },
  measured: {
    as_of: "2026-11-04T12:00:00Z",
    expires_at: "2026-11-04T13:00:00Z",
    pay_to_unchanged: false,
    valid_402: true,
  },
  now: "2026-11-04T12:30:00Z",
  haltOn: strictModeHalt(),
});
```

That measurement carries `payTo changed`. The sample halt aborts. The policy verdict can still be `pass`. `fail_mode` stays `open`. `failOpenDefault` stays true.

Copy-paste client sample: [`examples/strict-mode-halt.md`](examples/strict-mode-halt.md) and `integrations/x402-client/examples/strict-mode-halt.ts`.

## Chips

The chip vocabulary stays the fixed measurement set from [`fail-mode.md`](fail-mode.md): `live`, `402 ok`, `payTo changed`, `probe failed`, `no data yet`.

The attach does not probe. `measured` is facts the caller already has. Omitted means `no data yet`. The sample does not halt on `no data yet`.

## Abort only

The hook returns `{ abort: true }` when the customer's halt matches, or when the policy already aborts. When only the halt matches, the reason names the chip. When the policy already aborts, the reason stays the policy reason.

`evaluateCustomerPolicy` does not read `halt_on` or `strict_mode`. The policy receipt still records `pass`, `fail`, or `null` for the customer's amount, payTo, network, and host rules. `your_policy` and `not_a_botsrated_rating` stay true.

This layer does not sign a payment and does not hold funds. The hosted `POST /v1/guard/check` stub does not apply this halt. It still only runs `evaluateCustomerPolicy`.
