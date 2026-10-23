// Compile-only check (npm run typecheck): the tools-registry usage example must type-check
// against the AI SDK's ToolSet under strict TypeScript. Not executed.
import { generateText, isStepCount, type ToolSet } from "ai";
import { BotsRatedClient, botsratedTools } from "../src/index.js";

export async function registryExample() {
  const { text } = await generateText({
    model: "openai/gpt-5-mini",
    prompt: "Before paying https://blockrun.ai/api/v1/chat/completions, check the seller with BotsRated.",
    tools: botsratedTools(),
    stopWhen: isStepCount(3),
  });
  return text;
}

const paid = new BotsRatedClient({ paid: { budgetUsd: 0.01, x402Client: { createPaymentPayload: async () => ({}) } } });
export const merged: ToolSet = { ...botsratedTools(paid), other: botsratedTools().botsratedPreflight! };
