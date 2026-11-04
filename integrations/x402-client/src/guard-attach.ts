/**
 * Thin Desk Guard attach for an x402 client or an MCP payment client.
 *
 * Three call sites, one verdict:
 * - `x402Client.onBeforePaymentCreation(attach.onBeforePaymentCreation)`
 * - `@x402/mcp` `onPaymentRequested: attach.onPaymentRequested`
 * - `createx402MCPClient({ policies: [attach.mcpPolicy] })`
 *
 * `@x402/core` since 2.23.0 applies `spendControls` (default `$1` on recognized
 * assets) before policies and before `onBeforePaymentCreation`. This module
 * does not change those controls and does not turn them off. It does not
 * replace that cap. See test/sdk-dollar-default.test.ts for whether the cap
 * can hide this verdict.
 *
 * `fail_mode` is the customer's choice when the check cannot run. It does not
 * change `createPaymentGuard`'s `failOpen` default.
 *
 * Optional `haltOn` aborts when a measured chip is on the customer's list.
 * Omit it and that halt stays off. A policy `halt_on` or `strict_mode` is
 * read only when `haltOn` is omitted. The halt does not change the default above.
 *
 * This module never signs a payment and never sends one.
 */
import { evaluateHalt, type HaltDecision, type HaltOn } from "./halt-policy.js";
import { abortOnly } from "./payment-guard.js";
import {
  evaluateCustomerPolicy,
  type CustomerPolicy,
  type MeasuredFacts,
  type PolicyEvaluation,
} from "./guard-policy.js";

export { STRICT_MODE_HALT_CHIPS, evaluateHalt, strictModeHalt, type HaltDecision, type HaltOn } from "./halt-policy.js";

export interface GuardAttachOptions {
  policy: CustomerPolicy;
  /** Facts already measured. Omitted means the chip `no data yet`. This attach does not probe. */
  measured?: MeasuredFacts | null;
  now?: Date | string;
  /**
   * Opt-in chip halt. Abort when a listed measurement chip is present.
   * Omit to leave chip halt off. When omitted, `policy.halt_on` or
   * `policy.strict_mode` is used if the customer set one.
   */
  haltOn?: HaltOn;
}

export interface GuardAttachClient {
  onBeforePaymentCreation(hook: (ctx: { paymentRequired?: unknown; selectedRequirements?: Record<string, unknown> }) => Promise<void | { abort: true; reason: string }>): unknown;
  registerPolicy?(policy: (version: number, requirements: ReadonlyArray<Record<string, unknown>>) => Array<Record<string, unknown>>): unknown;
}

type Requirement = Record<string, unknown>;

function acceptsOf(paymentRequired: unknown): Requirement[] {
  if (!paymentRequired || typeof paymentRequired !== "object") return [];
  const accepts = (paymentRequired as { accepts?: unknown }).accepts;
  if (!Array.isArray(accepts)) return [];
  return accepts.filter((item): item is Requirement => !!item && typeof item === "object" && !Array.isArray(item));
}

function resourceUrlOf(paymentRequired: unknown): unknown {
  if (!paymentRequired || typeof paymentRequired !== "object") return undefined;
  const resource = (paymentRequired as { resource?: unknown }).resource;
  if (!resource || typeof resource !== "object") return undefined;
  return (resource as { url?: unknown }).url;
}

/**
 * One attach. `failOpenDefault` is always true: this object does not flip the
 * payment-guard default. `fail_mode` on the policy is a separate chip.
 * `haltOn` is a separate abort. It does not change `failOpenDefault`.
 */
export function guardAttach(options: GuardAttachOptions) {
  let last: PolicyEvaluation | undefined;
  let lastHaltDecision: HaltDecision | undefined;

  function haltSource(): unknown {
    if (options.haltOn !== undefined) return options.haltOn;
    const policy = options.policy;
    if (policy && Object.prototype.hasOwnProperty.call(policy, "halt_on") && policy.halt_on !== undefined) return policy.halt_on;
    if (policy && Object.prototype.hasOwnProperty.call(policy, "strict_mode") && policy.strict_mode !== undefined) {
      return { strict_mode: policy.strict_mode };
    }
    return undefined;
  }

  function evaluateOne(requirement: Requirement, resourceUrl: unknown, enforceResourceHost: boolean): PolicyEvaluation {
    return evaluateCustomerPolicy(options.policy, requirement, {
      resourceUrl,
      measured: options.measured,
      now: options.now,
      enforceResourceHost,
    });
  }

  function remember(evaluation: PolicyEvaluation): { evaluation: PolicyEvaluation; halt: HaltDecision } {
    last = evaluation;
    const halt = evaluateHalt(evaluation.chips, haltSource());
    lastHaltDecision = halt;
    return { evaluation, halt };
  }

  function stopped(evaluation: PolicyEvaluation, halt: HaltDecision): boolean {
    return evaluation.verdict === "fail" || evaluation.abort || halt.abort;
  }

  /**
   * Policy for `createx402MCPClient({ policies })` / `client.registerPolicy`.
   * Runs only after the SDK spend-control gate. Amount, payTo, and network
   * are enforced here. `resource.url` is enforced in the hooks, because a
   * policy function does not receive it. A customer halt drops the option too.
   */
  function mcpPolicy<T extends Requirement>(version: number, requirements: readonly T[]): T[] {
    void version;
    const kept: T[] = [];
    let blocking: { evaluation: PolicyEvaluation; halt: HaltDecision } | undefined;
    for (const requirement of requirements) {
      const evaluation = evaluateOne(requirement, undefined, false);
      const halt = evaluateHalt(evaluation.chips, haltSource());
      if (stopped(evaluation, halt)) blocking = blocking ?? { evaluation, halt };
      else kept.push(requirement);
    }
    if (kept.length === 0 && blocking) remember(blocking.evaluation);
    else if (kept.length > 0 && options.policy.resource_hosts === undefined) {
      remember(evaluateOne(kept[0], undefined, false));
    }
    return kept;
  }

  const onBeforePaymentCreation = abortOnly(async (ctx: { paymentRequired?: unknown; selectedRequirements?: Requirement }) => {
    const selected = ctx?.selectedRequirements ?? {};
    const { evaluation, halt } = remember(evaluateOne(selected, resourceUrlOf(ctx?.paymentRequired), true));
    return {
      stop: evaluation.abort || halt.abort,
      reason: halt.abort && !evaluation.abort ? halt.message : evaluation.message,
    };
  });

  async function onPaymentRequested(ctx: { paymentRequired?: unknown }): Promise<boolean> {
    const resourceUrl = resourceUrlOf(ctx?.paymentRequired);
    const accepts = acceptsOf(ctx?.paymentRequired);
    const specs = accepts.length === 0 ? [{}] : accepts;
    let sawStop = false;
    let lastEvaluation: PolicyEvaluation | undefined;
    for (const requirement of specs) {
      const evaluation = evaluateOne(requirement, resourceUrl, true);
      lastEvaluation = evaluation;
      const halt = evaluateHalt(evaluation.chips, haltSource());
      if (stopped(evaluation, halt)) {
        remember(evaluation);
        sawStop = true;
        break;
      }
    }
    if (!sawStop && lastEvaluation) remember(lastEvaluation);
    return !sawStop;
  }

  function install<T extends GuardAttachClient>(client: T): T {
    client.registerPolicy?.(mcpPolicy as (version: number, requirements: ReadonlyArray<Record<string, unknown>>) => Array<Record<string, unknown>>);
    client.onBeforePaymentCreation(onBeforePaymentCreation);
    return client;
  }

  return {
    /** Always true. `fail_mode: "closed"` does not change this. A chip halt does not change this. */
    failOpenDefault: true as const,
    mcpPolicy,
    onBeforePaymentCreation,
    onPaymentRequested,
    install,
    lastVerdict(): PolicyEvaluation | undefined {
      return last ? { ...last, requirement: { ...last.requirement }, measured: { ...last.measured }, chips: [...last.chips] } : undefined;
    },
    lastHalt(): HaltDecision | undefined {
      return lastHaltDecision ? { ...lastHaltDecision, chips: [...lastHaltDecision.chips] } : undefined;
    },
  };
}

export type GuardAttach = ReturnType<typeof guardAttach>;
