# fail_mode

`@botsrated/x402-preflight` defaults to `failOpen: true` (3 s timeout). Set `fail_mode` to closed if you'd rather block when the check can't run.

That default is unchanged. `fail_mode: "closed"` on a policy does not set `failOpen: false`. A change to the default is a separate decision. This page is the chip and the wording only.

## What the customer chooses

| `fail_mode` | When the check returns a decision | When the check cannot run |
|---|---|---|
| `open` (default if omitted) | `pass` continues. `fail` stops the payment. | The payment continues. The result is `verdict: null`, not a pass. |
| `closed` | `pass` continues. `fail` stops the payment. | The payment stops. The result is still `verdict: null`, not a pass. |

A missing decision is never stored as a pass. HTTP 503, HTTP 429, HTTP 404, a timeout, and `decision: null` on the existing `POST /v1/policy/check` path follow this same choice. They are not a pass.

## Chip copy

Show `fail_mode` as a mode chip on the receipt. The words are:

| Chip | Copy |
|---|---|
| Fail open | Fail open. If the check cannot run, the payment continues. |
| Fail closed | Fail closed. If the check cannot run, the payment stops. |

The chip names the mode. Status chips for the measurement stay the fixed set: `live`, `402 ok`, `payTo changed`, `probe failed`, `no data yet`.
