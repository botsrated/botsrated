# @botsrated/ai-sdk

## Default install

Pairs with the [Vercel AI SDK](https://ai-sdk.dev) (`ai`). Payment-client wrap only. Not a generation runtime, agent, or model. `generateText` and `streamText` stay the SDK's. Not published: from a checkout, `npm install` in `integrations/vercel-ai-sdk` (needs `@botsrated/x402-preflight` 0.2.1 or newer).

```ts
import { attachPaymentGuard } from "@botsrated/ai-sdk";
const guard = attachPaymentGuard(x402Client, { preset: "carefulBuyer", failMode: "open" });
```

Omit `preset` for advice only. `carefulBuyer` and `strict` block an unobserved payTo only when selected. Omit `failMode` to fail open. Free preflight is `https://botsrated.com` only. No custody and no payment signing. A tool-level approval helper is deferred: pinned AI SDK 7 deprecates `needsApproval` (it asks the user; it does not deny).

## Token

`attach_payment_guard` is the same function as `attachPaymentGuard`.

`token`, or `BOTSRATED_TOKEN` when `token` is omitted, is passed as `remotePolicy: { token, failMode }` only when PaymentGuard accepts `remotePolicy`. A bare token string is never passed. On a remote `decision: null`, HTTP 503, or transport failure, closed blocks and open reports info. A missing decision is not a pass. A remote pass does not clear a local block. Published `@botsrated/x402-preflight` 0.2.1 does not accept `remotePolicy`, so the token is not sent.

`botsratedPreflight()`, `botsratedCheck()`, and `botsratedTools()` stay optional and do not attach a guard. Wrap the paying fetch with `guard.wrapFetch` so the guard knows the URL being paid.

```ts
import { generateText } from "ai";
import { attachPaymentGuard, botsratedTools } from "@botsrated/ai-sdk";

const guard = attachPaymentGuard(x402Client, {
  preset: "carefulBuyer", // omit => warn-only advice
  failMode: "open",
  token: process.env.BOTSRATED_TOKEN,
});
const payingFetch = guard.wrapFetch(fetchWithPayment);
const result = await generateText({ model, tools: { ...botsratedTools(), paidTool /* uses x402Client */ }, prompt });
```

## Tools

[AI SDK](https://ai-sdk.dev) tools for [BotsRated](https://botsrated.com). Use them as a
pre-payment check before an agent pays an x402 seller.

**Status: published on npm as [`@botsrated/ai-sdk`](https://www.npmjs.com/package/@botsrated/ai-sdk) (0.1.2).** `attachPaymentGuard` is not in that release. The source here depends on
[`@botsrated/x402-preflight`](https://www.npmjs.com/package/@botsrated/x402-preflight) `^0.2.1`. Docs: https://botsrated.com/docs/ai-sdk

```bash
npm install @botsrated/ai-sdk ai zod
```

```ts
import { generateText, stepCountIs } from "ai";
import { botsratedTools } from "@botsrated/ai-sdk";

const { text } = await generateText({
  model: "openai/gpt-5-mini",
  prompt: "Before paying https://blockrun.ai/api/v1/chat/completions (payTo 0xe903...1aBf), check it.",
  tools: botsratedTools(),            // { botsratedPreflight } – free, no guard
  stopWhen: stepCountIs(3),          // AI SDK 7 also exports isStepCount(3)
});
```

`botsratedTools()` returns the AI SDK's `ToolSet` type, so it type-checks as `tools:` (or spread into one) under
strict TypeScript on AI SDK 5, 6 and 7 (0.1.1 did not on AI SDK 7; fixed in 0.1.2). The single tools are also
exported as `botsratedPreflight(client)` and `botsratedCheck(client)`. `stepCountIs` works on AI SDK 5, 6 and 7. `isStepCount` is the AI SDK 7 name (AI SDK 7 needs Node 22+).

Opt-in paid check, capped by a budget:

```ts
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { BotsRatedClient, botsratedTools } from "@botsrated/ai-sdk";

const x402 = new x402Client();
registerExactEvmScheme(x402, { signer }); // your signer, e.g. a viem account
const client = new BotsRatedClient({ paid: { budgetUsd: 0.02, x402Client: x402 } });
const tools = botsratedTools(client); // { botsratedPreflight, botsratedCheck ($0.001 each after 25 free checks per client IP per UTC day, stops at $0.02) }
```

The client validates BotsRated's 402 and signs only a copy rebuilt from allowlisted fields: a one-shot
EIP-3009 USDC payment on Base to BotsRated's payTo at the published price. A quote asking for Permit2
(`extra.assetTransferMethod`), carrying payment extensions such as `erc20ApprovalGasSponsoring`, or a
`maxTimeoutSeconds` above 600 is refused before anything is signed.

Tests: `npm test` (includes a `generateText` run with `MockLanguageModelV3`) and `npm run typecheck`
(compiles the tools-registry usage example under strict TypeScript).
