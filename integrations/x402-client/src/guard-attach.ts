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
 * This module never signs a payment and never sends one.
 */
import { abortOnly } from "./payment-guard.js";
import {
  evaluateCustomerPolicy,
  type CustomerPolicy,
  type MeasuredFacts,
  type PolicyEvaluation,
} from "./guard-policy.js";

export interface GuardAttachOptions {
  policy: CustomerPolicy;
  /** Facts already measured. Omitted means the chip `no data yet`. This attach does not probe. */
  measured?: MeasuredFacts | null;
  now?: Date | string;
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
 */
export function guardAttach(options: GuardAttachOptions) {
  let last: PolicyEvaluation | undefined;

  function evaluateOne(requirement: Requirement, resourceUrl: unknown, enforceResourceHost: boolean): PolicyEvaluation {
    return evaluateCustomerPolicy(options.policy, requirement, {
      resourceUrl,
      measured: options.measured,
      now: options.now,
      enforceResourceHost,
    });
  }

  function remember(evaluation: PolicyEvaluation): PolicyEvaluation {
    last = evaluation;
    return evaluation;
  }

  /**
   * Policy for `createx402MCPClient({ policies })` / `client.registerPolicy`.
   * Runs only after the SDK spend-control gate. Amount, payTo, and network
   * are enforced here. `resource.url` is enforced in the hooks, because a
   * policy function does not receive it.
   */
  function mcpPolicy<T extends Requirement>(version: number, requirements: readonly T[]): T[] {
    void version;
    const kept: T[] = [];
    let blocking: PolicyEvaluation | undefined;
    for (const requirement of requirements) {
      const evaluation = evaluateOne(requirement, undefined, false);
      if (evaluation.verdict === "fail" || evaluation.abort) blocking = blocking ?? evaluation;
      else kept.push(requirement);
    }
    if (kept.length === 0 && blocking) remember(blocking);
    else if (kept.length > 0 && options.policy.resource_hosts === undefined) {
      remember(evaluateOne(kept[0], undefined, false));
    }
    return kept;
  }

  const onBeforePaymentCreation = abortOnly(async (ctx: { paymentRequired?: unknown; selectedRequirements?: Requirement }) => {
    const selected = ctx?.selectedRequirements ?? {};
    const evaluation = remember(evaluateOne(selected, resourceUrlOf(ctx?.paymentRequired), true));
    return { stop: evaluation.abort, reason: evaluation.message };
  });

  async function onPaymentRequested(ctx: { paymentRequired?: unknown }): Promise<boolean> {
    const resourceUrl = resourceUrlOf(ctx?.paymentRequired);
    const accepts = acceptsOf(ctx?.paymentRequired);
    if (accepts.length === 0) {
      const evaluation = remember(evaluateCustomerPolicy(options.policy, {}, { resourceUrl, measured: options.measured, now: options.now }));
      return !evaluation.abort;
    }
    let sawFail = false;
    let lastEvaluation: PolicyEvaluation | undefined;
    for (const requirement of accepts) {
      const evaluation = evaluateOne(requirement, resourceUrl, true);
      lastEvaluation = evaluation;
      if (evaluation.verdict === "fail" || evaluation.abort) {
        remember(evaluation);
        sawFail = true;
        break;
      }
    }
    if (!sawFail && lastEvaluation) remember(lastEvaluation);
    return !sawFail;
  }

  function install<T extends GuardAttachClient>(client: T): T {
    client.registerPolicy?.(mcpPolicy as (version: number, requirements: ReadonlyArray<Record<string, unknown>>) => Array<Record<string, unknown>>);
    client.onBeforePaymentCreation(onBeforePaymentCreation);
    return client;
  }

  return {
    /** Always true. `fail_mode: "closed"` does not change this. */
    failOpenDefault: true as const,
    mcpPolicy,
    onBeforePaymentCreation,
    onPaymentRequested,
    install,
    lastVerdict(): PolicyEvaluation | undefined {
      return last ? { ...last, requirement: { ...last.requirement }, measured: { ...last.measured }, chips: [...last.chips] } : undefined;
    },
  };
}

export type GuardAttach = ReturnType<typeof guardAttach>;
