# @botsrated/ai-sdk

[AI SDK](https://ai-sdk.dev) tools for [BotsRated](https://botsrated.com) (beta). Use them as a
pre-payment check before an agent pays an x402 seller.

**Status: prepared, not yet published to npm.** It depends on `@botsrated/x402-preflight` (`../x402-client`),
which is also unpublished.

```ts
import { generateText, isStepCount } from "ai";
import { botsratedTools } from "@botsrated/ai-sdk";

const { text } = await generateText({
  model: "openai/gpt-5-mini",
  prompt: "Before paying https://blockrun.ai/api/v1/chat/completions (payTo 0xe903...1aBf), check it.",
  tools: botsratedTools(),            // { botsratedPreflight } – free
  stopWhen: isStepCount(3),
});
```

Opt-in paid check, capped by a budget:

```ts
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { BotsRatedClient, botsratedTools } from "@botsrated/ai-sdk";

const client = new BotsRatedClient({ paid: { budgetUsd: 0.02, fetchWithPayment: wrapFetchWithPayment(fetch, x402) } });
const tools = botsratedTools(client); // { botsratedPreflight, botsratedCheck ($0.001 each after 100 free/day, stops at $0.02) }
```

To guard every x402 payment, not only those the model calls a tool for, register
`createPrePaymentGuard().beforePaymentCreation` from `@botsrated/x402-preflight` on your `x402Client`.

Tests: `npm test`. They include a `generateText` run with `MockLanguageModelV3`.
