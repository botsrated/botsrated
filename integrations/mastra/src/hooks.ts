/**
 * Optional Mastra `hooks.beforeToolCall` for named paid tools whose x402 client
 * the app cannot wrap. Returns `{ beforeToolCall }` for `new Agent({ hooks })`.
 * Mastra stays the agent. This does not install a guard and does not run a tool.
 */
import type { ToolBeforeHookResult, ToolHookContext, ToolHooks } from "@mastra/core/tools";
import type { PaymentGuard } from "@botsrated/x402-preflight/payment-guard";

const CONTEXT_KEYS = ["payment_context", "x402", "payment"] as const;
const UNREADABLE = "Payment stopped by your payment policy. The payment context for this tool could not be read.";
const GUARD_ERROR = "Payment stopped by your payment policy. The payment guard could not evaluate this payment.";

/** What the model receives when this hook stops a named paid tool. The tool does not run. */
export interface BotsratedBlockedToolOutput {
  blocked: true;
  reason: string;
}

export interface BotsratedBeforeToolCallOptions {
  /**
   * Names of paid tools, matching the keys on `new Agent({ tools })` (`toolName` is that key).
   * A string, a list of strings, or a mapping whose keys are the names.
   */
  paidTools: readonly string[] | string | { readonly [name: string]: unknown };
  /** The customer's own `beforeToolCall`. Called only when this guard does not block. */
  next?: ToolHooks["beforeToolCall"];
}

function block(reason: string): ToolBeforeHookResult<BotsratedBlockedToolOutput> {
  return { proceed: false, output: { blocked: true, reason } };
}

function paidNames(paidTools: BotsratedBeforeToolCallOptions["paidTools"]): ReadonlySet<string> {
  let names: readonly unknown[];
  if (typeof paidTools === "string") names = [paidTools];
  else if (Array.isArray(paidTools)) names = paidTools;
  else if (paidTools && typeof paidTools === "object") names = Object.keys(paidTools);
  else throw new TypeError("paidTools must name at least one paid tool.");
  if (names.length === 0 || names.some((name) => typeof name !== "string" || name === "")) {
    throw new TypeError("paidTools must name at least one paid tool.");
  }
  return new Set(names as string[]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An x402 payment-creation context: `paymentRequired` plus the selected requirement. */
function carriesPaymentRequired(value: unknown): boolean {
  return isRecord(value) && value.paymentRequired != null;
}

function contextFromInput(input: unknown): unknown {
  if (isRecord(input)) {
    for (const key of CONTEXT_KEYS) {
      if (input[key] != null) return input[key];
    }
    if (carriesPaymentRequired(input)) return input;
  }
  throw new Error(UNREADABLE);
}

/**
 * Return Mastra tool hooks that run `guard.hooks.beforePaymentCreation` before named paid tools.
 *
 * On a block the return is `{ proceed: false, output: { blocked: true, reason } }`, which is how
 * Mastra skips the tool. Other tools do not ask the guard. `next` runs only when this guard does
 * not block. A context that cannot be read, or a throw from the guard, blocks. This function does
 * not throw to ask the model to retry, and it does not call `install`.
 */
export function botsratedBeforeToolCall(guard: Pick<PaymentGuard, "hooks">, options: BotsratedBeforeToolCallOptions): ToolHooks {
  if (typeof guard?.hooks?.beforePaymentCreation !== "function") {
    throw new TypeError("botsratedBeforeToolCall needs a PaymentGuard (hooks.beforePaymentCreation).");
  }
  const names = paidNames(options.paidTools);
  const next = options.next;
  const before = guard.hooks.beforePaymentCreation.bind(guard.hooks);

  return {
    async beforeToolCall(hookContext: ToolHookContext): Promise<void | ToolBeforeHookResult> {
      const toolName = hookContext && typeof hookContext.toolName === "string" ? hookContext.toolName : "";
      if (!names.has(toolName)) return next ? await next(hookContext) : undefined;

      let payment: unknown;
      try {
        payment = contextFromInput(hookContext.input);
      } catch {
        return block(UNREADABLE);
      }

      let verdict: void | { abort?: unknown; reason?: unknown };
      try {
        verdict = await before(payment);
      } catch {
        return block(GUARD_ERROR);
      }
      if (verdict?.abort === true) {
        const reason = typeof verdict.reason === "string" && verdict.reason ? verdict.reason : GUARD_ERROR;
        return block(reason);
      }
      return next ? await next(hookContext) : undefined;
    },
  };
}
