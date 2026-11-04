# guard-policy-receipt-v1

| | |
|---|---|
| Status | Draft. Docs and an offline signer for tests. Not a live badge. |
| Spec string | `botsrated-guard-policy-receipt/1` |
| Schema | [`policy-receipt-v1.schema.json`](policy-receipt-v1.schema.json) |
| Vectors | [`policy-vectors.json`](policy-vectors.json) |
| Example | [`examples/policy-receipt-v1.json`](examples/policy-receipt-v1.json) (unsigned body; no `sig`) |

A policy receipt records one pass or fail of **your policy** against one signed x402 requirement. The verdict names your policy id and version.

Rails are x402 and MCP only.

## What is signed

The signed body is the receipt object below, including `id`, and excluding presentation fields (`sig`, `signature_present`, `signing_key_id`, `signing_key_scope`, `signed`). `id` is the first 20 hex characters of SHA-256 of the canonical JSON of the body without `id`. Canonical JSON sorts object keys and has no insignificant whitespace.

`sig` is `{ alg: "ed25519", key_id, sig_b64, signed }`. `signed` is a sentence for people. The bytes that are signed are the canonical body, not that sentence.

The key id MUST match `botsrated-guard-policy-…`. It MUST NOT be `botsrated-prod-1`, `botsrated-prober-1`, or `botsrated-staging-1`, and it MUST NOT use a `botsrated-prod`, `botsrated-prober`, or `botsrated-staging` prefix. Those keys sign measurements and snapshots. They do not sign policy decisions. The check path is Courthouse, `GET /v1/verify`. That route is not mounted for this receipt kind in this repository. Tests can round-trip a throwaway `botsrated-guard-policy-test` key offline. The HTTP stub does not hold a private key, so `signature_present` stays false.

The receipt carries no balance and no custody.

## Verdict

| Field | Values | Meaning |
|---|---|---|
| `verdict` | `pass`, `fail`, or `null` | `pass` or `fail` is your rule. `null` means the check returned no decision. A missing decision is not a pass. |
| `rule_hit` | `none`, `amount`, `pay_to`, `network`, `resource_host`, `unevaluable` | The first customer rule that decided the result. |
| `fail_mode` | `open` or `closed` | Your choice when the check cannot run. See [`fail-mode.md`](fail-mode.md). |
| `your_policy` | `true` | The verdict cites your policy id and version. |
| `not_a_botsrated_rating` | `true` | Fixed. This object is not a rating. |
| `policy_id`, `policy_version` | labels | The policy version pin. |
| `org_id`, `team_id`, `agent_id` | labels or null | Who the check was for. `team_id` and `agent_id` may be null. |

Rule order when several could fail: `amount`, then `pay_to`, then `network`, then `resource_host`.

A `fail` aborts the payment hook. `verdict: null` aborts only when `fail_mode` is `closed`. `open` lets the payment continue and still does not record a pass.

## Enforced fields

Only these fields from the signed requirement are inputs:

| Input | Rule |
|---|---|
| `amount` | Decimal atomic string. Fails when it is above `max_amount_atomic`. |
| `payTo` | 20-byte hex address. Fails when `pay_to` is set and the address is not in that list. |
| `network` | Token such as `eip155:8453`. Fails when `networks` is set and the value is not listed. |
| `resource.url` host | Host of an http(s) URL. The path and query are dropped. Fails when `resource_hosts` is set and the host is not listed. |

Seller text is not an input. `description`, `mimeType`, `extra`, and any other seller-written field do not change `verdict`. An allowlist is exact after normalization (lowercase host, lowercase address). A `*` entry is rejected with the policy document, not treated as a match.

`@x402/core` `policies` functions do not receive `resource.url`. `guardAttach().mcpPolicy` therefore enforces amount, payTo, and network only. The host rule runs in `onBeforePaymentCreation` and `onPaymentRequested`, which see the 402.

This layer does not apply the SDK `$1` spend cap. That cap stays in the SDK. See the compat note in [`guard-check.md`](guard-check.md).

## Measured facts and chips

`measured` is supplied by the caller from a probe that already ran. This receipt does not probe. When the caller omits it, the only chip is `no data yet`.

| Chip | One meaning |
|---|---|
| `no data yet` | No measurement was supplied, or the supplied block has no `as_of`. |
| `probe failed` | The attempt failed. `pay_to_unchanged` and `valid_402` are null. An older success is not copied forward. |
| `live` | `as_of` and `expires_at` are both present and the check time is inside that window. |
| `402 ok` | `valid_402` is true on that measurement. |
| `payTo changed` | `pay_to_unchanged` is false on that measurement. |

`as_of` and `last_checked` are the same timestamp when a measurement is present. `expires_at` is the caller-supplied end of that window. An evidence URL is kept only when it is `https://botsrated.com/…` (or `www`). Anything else is stored as null. The receipt records `as_of`. It does not add a minutes-to-detect figure.

## Halt

A client may abort when one of these chips is on the customer's halt list. That abort is not a new verdict and not a new chip. The signed body on this page is unchanged. `verdict` stays the customer's pass, fail, or null. `evaluateCustomerPolicy` does not read the halt fields. See [`halt-policy.md`](halt-policy.md). `fail_mode` is unchanged: see [`fail-mode.md`](fail-mode.md).

## Ids

`org_id`, `team_id`, `agent_id`, `policy_id`, `policy_version`, and the signing key id are labels: they start with a letter or digit and then use only letters, digits, `.`, `_`, `:`, and `-`, at most 80 characters. The HTTP stub takes `org_id` from the bearer, not from a conflicting body field.
