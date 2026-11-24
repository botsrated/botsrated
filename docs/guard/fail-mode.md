# fail_mode

`@botsrated/x402-preflight` defaults to `failOpen: true` (3 s timeout). Set `fail_mode` to closed if you'd rather block when the check can't run.

That default is unchanged. `fail_mode: "closed"` on a policy does not set `failOpen: false`. A change to the default is a separate decision. This page is the chip and the wording only.

## What the customer chooses

| `fail_mode` | When the check returns a decision | When the check cannot run |
|---|---|---|
| `open` (default if omitted) | `pass` continues. `fail` stops the payment. | The payment continues. The result is `verdict: null`, not a pass. |
| `closed` | `pass` continues. `fail` stops the payment. | The payment stops. The result is still `verdict: null`, not a pass. |

## What counts as "cannot run"

Only a field that is absent from the signed requirement. If your policy has a rule for a field and that field is not there, the result is `verdict: null` and `fail_mode` decides.

A field that is there but cannot satisfy its rule is a `fail`, on either `fail_mode`:

- an amount above your ceiling, or one that is not a whole atomic amount string;
- a payTo that is not on your list, including one that is not a 20-byte hex address, and a requirement that carries `payTo` and `pay_to` with different values;
- a network that is not on your list;
- a `resource.url` host that is not on your list, and a request whose host differs from the `resource.url` host.

Every rule that can be decided is decided before a missing field is reported, so one odd or absent field does not hide a failed rule.

A missing decision is never stored as a pass. HTTP 503, HTTP 429, HTTP 404, a timeout, and `decision: null` on the existing `POST /v1/policy/check` path follow this same choice. They are not a pass.

## Chip copy

Show `fail_mode` as a mode chip on the receipt. The words are:

| Chip | Copy |
|---|---|
| Fail open | Fail open. If the check cannot run, the payment continues. |
| Fail closed | Fail closed. If the check cannot run, the payment stops. |

The chip names the mode. Status chips for the measurement stay the fixed set: `live`, `402 ok`, `payTo changed`, `probe failed`, `no data yet`.

## Halt on a measured chip

`fail_mode` is what happens when the check cannot run. A halt rule is separate. The customer may opt in to stop a payment when one of those chips is present. The halt does not set `failOpen` to false. The chip set stays the list above. See [`halt-policy.md`](halt-policy.md).
