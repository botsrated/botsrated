/**
 * The before-tool helper must match the public Mastra hook types.
 * `@mastra/core` is an optional peer; this file is typechecked against the pinned dev install.
 */
import type { AgentConfig } from "@mastra/core/agent";
import type { ToolHookContext, ToolHooks } from "@mastra/core/tools";
import type { PaymentGuard } from "@botsrated/x402-preflight/payment-guard";
import { botsratedBeforeToolCall } from "../src/index.js";

declare const guard: PaymentGuard;

const hooks: ToolHooks = botsratedBeforeToolCall(guard, {
  paidTools: ["paidApi"],
  next(ctx: ToolHookContext) {
    void ctx.toolName;
    return undefined;
  },
});

const config: Pick<AgentConfig, "hooks"> = { hooks };
void config;
