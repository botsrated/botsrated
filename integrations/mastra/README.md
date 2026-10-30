# @botsrated/mastra

## One-click attach

Free. No key for local attach. Pairs with Mastra. Not an agent, workflow, or tool runtime. Paid checks are not required to attach. `@botsrated/mastra` is not on npm.

```bash
npm install @botsrated/x402-preflight
```

```ts
import { createPaymentGuard } from "@botsrated/x402-preflight/payment-guard";
const guard = createPaymentGuard({ preset: "carefulBuyer" }); // omit preset = warn only
guard.install(x402Client); // the x402 client your agent already pays with
```

The pair-with package is not on npm yet: `npm install` in `integrations/mastra`, then `attachPaymentGuard` from `@botsrated/mastra`.

Preflight and the guard surface signed receipt links (`receipt_url`). When org ledger is enabled, paid checks write there by default. No custody. Facts, not grades.

Live docs: [botsrated.com/docs/guard#mastra](https://botsrated.com/docs/guard#mastra).

## Install in 3 steps

1. Free. No key for local attach. Install the guard that works today: `npm install @botsrated/x402-preflight`, then `createPaymentGuard` on the x402 client your agent already pays with (one-click above). `@botsrated/mastra` is not on npm. The pair-with package is the checkout: `npm install` in `integrations/mastra` (pulls `@botsrated/x402-preflight` `^0.3.0`, which is on npm).
2. Attach to your x402 client. Installing does not attach a guard:
```ts
import { createPaymentGuard } from "@botsrated/x402-preflight/payment-guard";
const guard = createPaymentGuard({ preset: "carefulBuyer" });
guard.install(x402Client);
```
3. Omit `preset` for advice only (`carefulBuyer` / `strict` stop an unobserved payTo when you pass them). Omit `failMode` to stay open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On `@botsrated/x402-preflight` 0.3.0 and later it is sent only as `remotePolicy: { token, failMode }`, never as a bare string. A configured token on a core without `normalizeRemotePolicy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

Omit `failMode` and the guard stays open. `"closed"` stops the payment when BotsRated or your policy cannot answer. A missing decision is never a pass. A remote pass never clears a local block. Nothing defaults you to closed.

## Default install

Free. No key for local attach. Pairs with [Mastra](https://mastra.ai) (`@mastra/core`). Payment-client wrap only. Not an agent, workflow, or tool runtime. The Mastra `Agent` stays Mastra's. Paid checks are not required to attach. Today: `npm install @botsrated/x402-preflight` and `createPaymentGuard`. `@botsrated/mastra` is not on npm.

```ts
import { createPaymentGuard } from "@botsrated/x402-preflight/payment-guard";
const guard = createPaymentGuard({ preset: "carefulBuyer" });
guard.install(x402Client);
```

Pair-with package (not on npm yet): `npm install` in `integrations/mastra`, then `attachPaymentGuard` from `@botsrated/mastra`.

Omit `preset` for advice only. `carefulBuyer` and `strict` block an unobserved payTo only when selected. Omit `failMode` to stay open. Free preflight is `https://botsrated.com` only. No custody and no payment signing. A `generate()` or `stream()` `hooks.beforeToolCall` overrides the agent hook; compose with `next`, or pass `botsratedBeforeToolCall` on that run.

## Token and before-tool hook

`attach_payment_guard` is the same function as `attachPaymentGuard`.

`BOTSRATED_TOKEN` is optional. Omit `token` and the guard reads `BOTSRATED_TOKEN`. On `@botsrated/x402-preflight` 0.3.0 and later it is sent only as `remotePolicy: { token, failMode }`, never as a bare string. A configured token on a core without `normalizeRemotePolicy` raises and is not dropped. The policy decision is not signed. Get a token in [Desk](https://botsrated.com/desk).

`botsratedPreflight(url)` is the free preflight and does not attach a guard.

`attachPaymentGuard` in the example below is the pair-with package in this directory. `@botsrated/mastra` is not on npm. The registry path is `createPaymentGuard` from `@botsrated/x402-preflight`. `attachPaymentGuard` does not import `@mastra/core`. The before-tool hook needs `@mastra/core` >=1.49.0 and <2. For an opaque client the app cannot wrap, `botsratedBeforeToolCall(guard, { paidTools: ["paidApi"] })` returns Mastra `ToolHooks` for `new Agent({ hooks })`. It runs only for those tool names (the `tools` object keys). It reads `payment_context`, `x402`, or `payment` from the tool input, or the input itself when it already has `paymentRequired`, and calls the same guard. On a block it returns `{ proceed: false, output: { blocked: true, reason } }` and the tool does not run. If that context cannot be read, the named tool does not run. `next` is called only when this guard does not block. MCP payment tools that pay in another process are out of scope.

```ts
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { attachPaymentGuard, botsratedBeforeToolCall } from "@botsrated/mastra";

const guard = attachPaymentGuard(x402Client, {
  preset: "carefulBuyer", // omit => warn-only advice
  failMode: "open",
  token: process.env.BOTSRATED_TOKEN,
});
const paidFetch = guard.wrapFetch(fetchWithPayment);
const paidApi = createTool({ id: "paid-api", description: "…", execute: async () => (await paidFetch(url)).json() });
const agent = new Agent({ id: "a", name: "a", instructions: "…", model, tools: { paidApi } });
// Opaque client only:
// new Agent({ ..., hooks: botsratedBeforeToolCall(guard, { paidTools: ["paidApi"] }) })
```

Tests: `npm test` in this directory. They do not call a model.
