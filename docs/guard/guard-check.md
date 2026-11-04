# guard-check

Router-callable check. Spec plus a stub. The live route is not mounted by this change.

A router or wallet sends the signed requirement and the org from the bearer. It gets pass or fail, receipt fields, and the fixed chips. The handler is read-only. It does not sign a payment and it does not pay. It does not open a D1 writer.

## HTTP

`POST /v1/guard/check`

`FEATURE_GUARD_CHECK` must be the exact string `true`. Any other value, including unset, returns `501` `{ "error": "coming" }` before auth. With the flag on:

| Case | Status |
|---|---|
| No `Authorization: Bearer` | `401` `bearer_required` |
| Bearer without scope `guard-check` | `403` `guard_check_scope_required` |
| Body `org_id` present and different from the bearer org | `403` `org_mismatch` |
| `GUARD_POLICY_SIGNING_KEY_ID` is a prod or prober id | `500` `policy_signing_key_refused` and no signature |
| Policy and requirement accepted | `200` |

The stub does not hold a private key. A non-prod key id may be named, and `signature_present` stays `false`.

`X-BotsRated-Client` is not read and is not required. No CORS header is added. No webhook is sent.

The body is `{ policy, requirement, measured?, team_id?, agent_id? }`. `measured` is optional facts the caller already has. Omitted means the chip `no data yet`. This route does not probe the seller.

A `200` body includes `verdict` (`pass`, `fail`, or `null`), `your_policy: true`, `not_a_botsrated_rating: true`, `fail_mode`, `rule_hit`, `chips`, `read_only: true`, `pays: false`, and `receipt` as in [`policy-receipt-v1.md`](policy-receipt-v1.md).

## MCP

Tool name `guard_check`. Same body as the HTTP check, same bearer scope. When the flag is off the tool returns `isError: true` and `{ "error": "coming" }`. When the flag is on it returns the same verdict object. It does not sign and it does not pay.

The tool definition is `GUARD_CHECK_TOOL` in `worker/src/guard_check.ts`. Tests call `handleGuardCheck` and `callGuardCheckTool` directly. Production wiring stays behind the flag.

## Attach, and the SDK $1 default

Free local attach stays `createPaymentGuard()` with `failOpen` defaulting true. `guardAttach` is an extra call surface for a customer policy. It does not replace that guard and it does not change the default.

```ts
import { guardAttach } from "@botsrated/x402-preflight/guard-attach";

const attach = guardAttach({
  policy: { id: "pol_desk", version: "3", fail_mode: "open", pay_to: ["0x…"] },
});

client.onBeforePaymentCreation(attach.onBeforePaymentCreation);
// createx402MCPClient({ policies: [attach.mcpPolicy], onPaymentRequested: attach.onPaymentRequested })
```

Do not pass a spend-control override. `@x402/core` 2.29.0 (the `$1` default since 2.23.0) runs `spendControls` before `policies` and before `onBeforePaymentCreation`.

QA, in `integrations/x402-client/test/sdk-dollar-default.test.ts`, on `@x402/core` 2.29.0 and `@x402/evm` 2.29.0:

- A quote of `1000001` atomic USDC (one unit over $1) throws `spendControls.maxAmountPerPayment` before `mcpPolicy` and before the hook. `lastVerdict()` stays unset. The error text does not include the customer pass or fail. The SDK default can hide the verdict.
- A quote of `1000000` ($1 exactly) reaches the hook. A passing customer policy records `verdict: "pass"`.
- Under $1, a payTo outside the customer list records `verdict: "fail"`. Registered only as a policy, the thrown SDK text is `filtered out by policies` while `lastVerdict()` holds the fail. Registered only as the hook, the abort text includes `Your policy failed (rule: pay_to)`.
- `onPaymentRequested` runs earlier inside `@x402/mcp` 2.29.0, before `createPaymentPayload`. A pass recorded there does not turn the `$1` gate off. The later `createPaymentPayload` still throws the spend-control error.

`mcpPolicy` does not itself reject a quote for being over $1. A customer ceiling is a separate field, `max_amount_atomic`.
