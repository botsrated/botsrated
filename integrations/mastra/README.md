# @botsrated/mastra

## Default install

Pairs with [Mastra](https://mastra.ai) (`@mastra/core`). Payment-client wrap only. Not an agent, workflow, or tool runtime. The Mastra `Agent` stays Mastra's. Not published: from a checkout, `npm install` in `integrations/mastra` (needs `@botsrated/x402-preflight` `^0.3.0`).

```ts
import { attachPaymentGuard } from "@botsrated/mastra";
const guard = attachPaymentGuard(x402Client, { preset: "carefulBuyer", failMode: "open" });
```

Omit `preset` for advice only. `carefulBuyer` and `strict` block an unobserved payTo only when selected. Omit `failMode` to fail open. Free preflight is `https://botsrated.com` only. No custody and no payment signing. A `generate()` or `stream()` `hooks.beforeToolCall` overrides the agent hook; compose with `next`, or pass `botsratedBeforeToolCall` on that run.

## Token and before-tool hook

`attach_payment_guard` is the same function as `attachPaymentGuard`.

`token`, or `BOTSRATED_TOKEN` when `token` is omitted, is passed as `remotePolicy: { token, failMode }` only when PaymentGuard accepts `remotePolicy`. A bare token string is never passed. On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info. A missing decision is not a pass. A remote pass does not clear a local block. Published `@botsrated/x402-preflight` 0.2.1 does not accept `remotePolicy`; 0.3.0 does. A configured token without `normalizeRemotePolicy` raises and is not dropped.

`botsratedPreflight(url)` is the free preflight and does not attach a guard.

`attachPaymentGuard` does not import `@mastra/core`. The before-tool hook needs `@mastra/core` >=1.49.0 and <2. For an opaque client the app cannot wrap, `botsratedBeforeToolCall(guard, { paidTools: ["paidApi"] })` returns Mastra `ToolHooks` for `new Agent({ hooks })`. It runs only for those tool names (the `tools` object keys). It reads `payment_context`, `x402`, or `payment` from the tool input, or the input itself when it already has `paymentRequired`, and calls the same guard. On a block it returns `{ proceed: false, output: { blocked: true, reason } }` and the tool does not run. If that context cannot be read, the named tool does not run. `next` is called only when this guard does not block. MCP payment tools that pay in another process are out of scope.

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
