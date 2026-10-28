/**
 * Attach a BotsRated PaymentGuard to the x402 client a Vercel AI SDK app uses to pay.
 *
 * This registers the guard's before-payment hook on that client. `generateText` and
 * `streamText` stay the AI SDK's. This module does not sign, send, or hold a payment.
 * `botsratedPreflight`, `botsratedCheck`, and `botsratedTools` do not call this.
 */
import * as paymentGuardNs from "@botsrated/x402-preflight/payment-guard";
import type { GuardDecision, PaymentGuard, PaymentGuardOptions, X402HookTarget } from "@botsrated/x402-preflight/payment-guard";

export type PresetName = "carefulBuyer" | "warn" | "strict";
export type FailMode = "open" | "closed";

const PRESETS = new Set<PresetName>(["carefulBuyer", "warn", "strict"]);
const FAIL_MODES = new Set<FailMode>(["open", "closed"]);
const TOKEN_ENV = "BOTSRATED_TOKEN";

export interface AttachPaymentGuardOptions {
  /**
   * `warn` is advice only. `carefulBuyer` and `strict` block an unobserved payTo.
   * Omit for the guard's advice-only default. `strict` is the same rule table as `carefulBuyer`.
   */
  preset?: PresetName;
  /**
   * `open` (default) or `closed`. When a remote policy check returns no decision, closed stops
   * the payment and open reports info. A missing decision is not a pass.
   */
  failMode?: FailMode;
  /**
   * Bearer token for a private policy check. Omit to read `BOTSRATED_TOKEN`.
   * Passed as `remotePolicy: { token, failMode }` when this install exports `normalizeRemotePolicy` (0.3.0+); otherwise a set token throws.
   * A bare token string is never passed. Empty means unset.
   */
  token?: string;
  /** Receives every decision. Errors thrown here are ignored by PaymentGuard. */
  onDecision?: (decision: GuardDecision) => void;
}

/** The slice of `@botsrated/x402-preflight/payment-guard` this attach call uses. */
export interface PaymentGuardModule {
  createPaymentGuard: (options?: PaymentGuardOptions) => PaymentGuard;
  policies: typeof paymentGuardNs.policies;
  /** Present only when this install implements remote policy. */
  normalizeRemotePolicy?: unknown;
}

const installedNs = paymentGuardNs as typeof paymentGuardNs & { normalizeRemotePolicy?: unknown };

const installedModule: PaymentGuardModule = {
  createPaymentGuard: installedNs.createPaymentGuard,
  policies: installedNs.policies,
  normalizeRemotePolicy: installedNs.normalizeRemotePolicy,
};

let currentModule = installedModule;

/**
 * Swap the PaymentGuard module. Tests use this to stand in for an install that does not
 * accept `remotePolicy`. Omit the argument to restore the installed module.
 * Not part of the package API.
 */
export function usePaymentGuardModule(next?: PaymentGuardModule): void {
  currentModule = next ?? installedModule;
}

export function paymentGuardModule(): PaymentGuardModule {
  return currentModule;
}

/**
 * `remotePolicy` when `normalizeRemotePolicy` is exported. That function is the only
 * capability gate. Source text is not inspected. Otherwise undefined.
 */
export function remotePolicyKey(api: PaymentGuardModule): "remotePolicy" | undefined {
  return typeof api.normalizeRemotePolicy === "function" ? "remotePolicy" : undefined;
}

/** Explicit `token` wins. Omit it to read `BOTSRATED_TOKEN`. `""` means unset and does not fall through. */
export function tokenFrom(token: string | undefined): string | undefined {
  let value = token;
  if (value === undefined) {
    const env = process.env[TOKEN_ENV];
    value = typeof env === "string" ? env : undefined;
  }
  if (typeof value !== "string" || value === "") return undefined;
  return value;
}

export function attachPaymentGuard<T extends X402HookTarget>(x402Client: T, options: AttachPaymentGuardOptions = {}): PaymentGuard {
  const { preset, failMode, token, onDecision } = options;
  if (preset !== undefined && !PRESETS.has(preset)) {
    throw new TypeError('preset must be "carefulBuyer", "warn", or "strict".');
  }
  if (failMode !== undefined && !FAIL_MODES.has(failMode)) {
    throw new TypeError('failMode must be "open" or "closed".');
  }

  const api = paymentGuardModule();
  if (typeof api.createPaymentGuard !== "function") {
    throw new TypeError("attachPaymentGuard needs @botsrated/x402-preflight>=0.2.1 (createPaymentGuard).");
  }

  const createOptions: PaymentGuardOptions & Record<string, unknown> = {};
  if (preset === "strict") {
    // PaymentGuard's preset names are warn, carefulBuyer, and dry-run-only.
    // strict is the same rule table as carefulBuyer, under its policy name.
    createOptions.policy = api.policies.strict;
  } else if (preset !== undefined) {
    createOptions.preset = preset;
  }
  if (failMode === "closed") createOptions.failOpen = false;
  else if (failMode === "open") createOptions.failOpen = true;
  if (onDecision) createOptions.onDecision = onDecision;

  const bearer = tokenFrom(token);
  const key = remotePolicyKey(api);
  if (bearer && !key) {
    throw new TypeError(
      "token is set but this @botsrated/x402-preflight install has no normalizeRemotePolicy. " +
        "Install @botsrated/x402-preflight@^0.3.0 so the token is sent. The token was not dropped.",
    );
  }
  if (key && bearer) {
    const mode: FailMode = failMode === "closed" ? "closed" : "open";
    // A mapping, never a bare token string. PaymentGuard rejects a string.
    createOptions.remotePolicy = { token: bearer, failMode: mode };
  }

  const guard = api.createPaymentGuard(createOptions);
  guard.install(x402Client);
  return guard;
}
