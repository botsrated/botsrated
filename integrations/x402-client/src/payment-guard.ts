/**
 * BotsRated payment guard for x402 clients.
 *
 * What it does, and nothing more:
 * - Before your agent signs: looks up facts BotsRated measured about the seller's HOST (only the host name is sent to
 *   botsrated.com) and compares them locally with the payment request. Advice-only by default: it reports facts and
 *   stops a payment only when you choose a blocking policy (e.g. `policies.strict`).
 * - While the payload is built: adds a random x402 `payment-identifier` retry key, only when the seller advertises
 *   that extension, through x402's extension mechanism.
 * - After: records the payment locally (never the signature) and offers a read-only on-chain check of whether it
 *   settled once (see ./onchain.ts).
 *
 * Structural limits (enforced by tests in test/c1-no-repay.test.ts):
 * - Every hook goes through an adapter that discards what the hook body returns. Observe-only hooks always resolve
 *   to undefined; the pre-payment hook resolves to undefined or `{ abort: true, reason }`.
 * - The payment-creation-failure hook is never registered. This module never imports a signer, never builds or
 *   sends a payment header, and never asks a client to create a payment payload.
 * - The seller's 402 and the x402 contexts are treated as read-only.
 */
import { checkPaymentState, type OnchainOptions, type PaymentRecord, type PaymentState } from "./onchain.js";
import {
  BOTSRATED_BASE_URL,
  DISPUTE_URL,
  USER_AGENT,
  cleanText,
  hostAndPath,
  isAddress,
  isAtomicAmount,
  isBytes32,
  isTxHash,
  sameSiteHost,
  tryHostOf,
} from "./util.js";

export type RuleEffect = "allow" | "warn" | "block";

/** Which facts warn and which stop a payment. Every rule defaults to advice only (warn or info). */
export interface PaymentGuardPolicy {
  /** The payTo is not among the payTos BotsRated's probes recorded for the host. Default "warn". */
  payToMismatch?: RuleEffect;
  /** The payTo is not a 20-byte hex address. Default "warn". */
  payToInvalid?: RuleEffect;
  /** Same route, quoted amount above the last amount BotsRated recorded. Default "warn". */
  priceAboveObserved?: RuleEffect;
  /** The 402's resource.url names a different host than the URL being paid (checked locally). Default "warn". */
  resourceHostMismatch?: RuleEffect;
  /** BotsRated has no record of the host. Default "allow" (reported as info). */
  notCovered?: RuleEffect;
  /** BotsRated's data for the host is older than 24 h. Default "allow" (reported as info). */
  stale?: RuleEffect;
}

/** Named presets. Choosing one is your decision; the zero-config default is `policies.warn`. */
export const policies = Object.freeze({
  /** Advice only: never stops a payment. The default. */
  warn: Object.freeze<Required<PaymentGuardPolicy>>({
    payToMismatch: "warn",
    payToInvalid: "warn",
    priceAboveObserved: "warn",
    resourceHostMismatch: "warn",
    notCovered: "allow",
    stale: "allow",
  }),
  /** Stops a payment when the payTo was not recorded by BotsRated's probes, is not an address, or the 402 names another host. */
  strict: Object.freeze<Required<PaymentGuardPolicy>>({
    payToMismatch: "block",
    payToInvalid: "block",
    priceAboveObserved: "warn",
    resourceHostMismatch: "block",
    notCovered: "allow",
    stale: "allow",
  }),
});

export interface GuardReason {
  /** Fact-only code, e.g. `payto_not_observed`, `price_above_observed`, `not_covered`, `data_stale`, `botsrated_unreachable`, `payment_state_unknown`. */
  code: string;
  effect: "info" | "warn" | "block";
  /** The policy rule that set the effect, when one did. */
  rule?: keyof PaymentGuardPolicy | "failOpen";
  /** One sentence stating a fact. Seller text is never echoed except a parsed host name. */
  fact: string;
}

export interface GuardFacts {
  covered: boolean;
  host: string;
  knownPayTos: string[];
  listingPayTo?: string;
  observedNetwork?: string;
  observedAmount?: string;
  stale?: boolean;
  receiptUrl?: string;
}

export interface GuardDecision {
  phase: "before_payment" | "payment_response";
  /** "block" only when your policy says so (never in dry-run). */
  action: "allow" | "block";
  /** True in dry-run when the policy would have stopped the payment. */
  wouldBlock: boolean;
  dryRun: boolean;
  host?: string;
  reasons: GuardReason[];
  /** The rule that stopped (or in dry-run would have stopped) the payment. */
  policyRule?: string;
  facts?: GuardFacts;
  disputeUrl: string;
  /** Human-readable summary, built only from facts and parsed host names. */
  message: string;
}

export type PreflightFn = (host: string) => Promise<{ found: boolean; body: Record<string, any> }>;

export interface PaymentGuardOptions {
  /** Which facts warn or stop a payment. Default {@link policies.warn} (advice only). */
  policy?: PaymentGuardPolicy;
  /** Log decisions and change nothing: no payment is stopped and no retry key is added. Recommended first setting. */
  dryRun?: boolean;
  /** Call BotsRated's free hosted preflight. Default true. With false, nothing is sent to botsrated.com. */
  hosted?: boolean;
  /** When BotsRated can't be reached (or the guard itself errors): true allows the payment (default), false stops it. */
  failOpen?: boolean;
  /** Add an x402 `payment-identifier` retry key when the seller advertises the extension. Default true. */
  retryKey?: boolean;
  /** Read-only on-chain check settings, or false to disable `paymentState`. */
  onchain?: OnchainOptions | false;
  /** Default https://botsrated.com. */
  baseUrl?: string;
  /** Fetch used for the hosted preflight. Default global fetch. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Hosted preflight timeout. Default 1500 ms. */
  timeoutMs?: number;
  /** Preflight cache per host. Default 300 000 ms. */
  cacheTtlMs?: number;
  /** Replace the hosted lookup, e.g. `(h) => botsRatedClient.preflight(h)` to share one cache. Receives a host name only. */
  preflight?: PreflightFn;
  /** Receives every decision. Errors thrown here are ignored. */
  onDecision?: (decision: GuardDecision) => void;
}

/** Minimal shape of an `@x402/core` x402Client used by {@link PaymentGuard.install}. */
export interface X402HookTarget {
  onBeforePaymentCreation(hook: (ctx: any) => Promise<void | { abort: true; reason: string }>): unknown;
  onAfterPaymentCreation(hook: (ctx: any) => Promise<void>): unknown;
  onPaymentResponse?(hook: (ctx: any) => Promise<void>): unknown;
  registerExtension?(ext: { key: string; enrichPaymentPayload: (payload: any, paymentRequired: any) => Promise<any> }): unknown;
}

export interface PaymentGuard {
  readonly options: Readonly<PaymentGuardOptions>;
  /** Hook adapters. Observe-only ones always resolve to undefined. */
  readonly hooks: {
    beforePaymentCreation(ctx: any): Promise<void | { abort: true; reason: string }>;
    afterPaymentCreation(ctx: any): Promise<void>;
    paymentResponse(ctx: any): Promise<void>;
  };
  /** The `payment-identifier` client extension (register with `x402Client.registerExtension`). */
  readonly extension: { key: "payment-identifier"; enrichPaymentPayload(payload: any, paymentRequired: any): Promise<any> };
  /** Registers the hooks (and the retry-key extension unless dry-run or `retryKey: false`) on an x402Client. Never registers a failure hook. */
  install<T extends X402HookTarget>(client: T): T;
  /** Wraps a paying fetch (e.g. `wrapFetchWithPayment(fetch, client)`) so the guard knows the URL being paid. */
  wrapFetch<F extends (input: any, init?: any) => Promise<Response>>(fetchWithPayment: F): F;
  /** Runs `fn` as one logical operation: a retried payment inside the same operation reuses its retry key. */
  operation<R>(operationKey: string, fn: () => Promise<R>): Promise<R>;
  /** Payments seen being created (newest last). No signatures. */
  records(): PaymentRecord[];
  /** Read-only on-chain state of a payment: "settled", "unknown" (wait) or "expired_unsettled". Never pays or retries. */
  paymentState(ref: PaymentRecord | { payTo: string; nonce: string }): Promise<PaymentState>;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-request context (URL being paid, operation key). AsyncLocalStorage where the runtime has it synchronously.
interface Ctx {
  requestUrl?: string;
  operationKey?: string;
}
interface Als<T> {
  run<R>(store: T, fn: () => R): R;
  getStore(): T | undefined;
}
const als: Als<Ctx> | undefined = (() => {
  try {
    const mod = (globalThis as any).process?.getBuiltinModule?.("node:async_hooks");
    return mod?.AsyncLocalStorage ? (new mod.AsyncLocalStorage() as Als<Ctx>) : undefined;
  } catch {
    return undefined;
  }
})();
const currentCtx = (): Ctx => als?.getStore() ?? {};
const runWith = <R>(patch: Ctx, fn: () => Promise<R>): Promise<R> => (als ? als.run({ ...currentCtx(), ...patch }, fn) : fn());

function requestUrlOf(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  const u = (input as { url?: unknown })?.url;
  return typeof u === "string" ? u : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// C1 adapters: the value a hook body returns is discarded.

/** Observe-only adapter: runs `body`, swallows errors, and always resolves to undefined. */
export function observeOnly<C>(body: (ctx: C) => unknown): (ctx: C) => Promise<void> {
  return async (ctx: C): Promise<void> => {
    try {
      await body(ctx);
    } catch {
      /* observe-only: never affects the payment flow */
    }
    return undefined;
  };
}

/** Pre-payment adapter: resolves to undefined or exactly `{ abort: true, reason }` (a capped string). Nothing else. */
export function abortOnly<C>(body: (ctx: C) => Promise<{ stop: boolean; reason: string }>): (ctx: C) => Promise<void | { abort: true; reason: string }> {
  return async (ctx: C) => {
    let stop = false;
    let reason = "";
    try {
      const r = await body(ctx);
      stop = r?.stop === true;
      reason = typeof r?.reason === "string" ? r.reason : "";
    } catch {
      stop = false;
    }
    return stop ? { abort: true as const, reason: cleanText(reason || "Payment stopped by your payment policy.", 700) } : undefined;
  };
}

// ---------------------------------------------------------------------------------------------------------------

const MEASUREMENT_NOTE = "This is a measurement, not a finding about the seller.";

/** Facts read from a preflight body, sanitized: addresses validated, text capped, only botsrated.com receipt URLs. */
export function guardFactsFrom(body: Record<string, any>, host: string): GuardFacts {
  const b = body && typeof body === "object" ? body : {};
  const probe = (b.latest_probe && typeof b.latest_probe === "object" ? b.latest_probe : b.receipts?.[0]) ?? {};
  const measured = b.measured ?? {};
  const listing = b.listing ?? {};
  const payTos = [probe.live_payTo, measured.last_quoted_payTo].filter(isAddress).map((p) => p.toLowerCase());
  const receipt = typeof probe.receipt_url === "string" ? probe.receipt_url : undefined;
  const receiptHost = tryHostOf(receipt);
  const amount = probe.live_amount ?? measured.last_quoted_amount_atomic;
  const network = probe.live_network ?? listing.network;
  return {
    covered: b.found !== false,
    host,
    knownPayTos: [...new Set(payTos)],
    listingPayTo: isAddress(listing.payTo) ? listing.payTo.toLowerCase() : undefined,
    observedNetwork: typeof network === "string" ? cleanText(network, 40) : undefined,
    observedAmount: isAtomicAmount(amount) ? amount : undefined,
    stale: b.freshness?.stale === true,
    receiptUrl: receipt && receiptHost && sameSiteHost(receiptHost, "botsrated.com") && /^https:\/\//.test(receipt) ? cleanText(receipt, 200) : undefined,
    ...(hostAndPath(probe.url ?? b.route_probed?.url) ? { _probed: hostAndPath(probe.url ?? b.route_probed?.url) } : {}),
  } as GuardFacts;
}

const RULE_TO_EFFECT = (e: RuleEffect | undefined, fallback: GuardReason["effect"]): GuardReason["effect"] =>
  e === "block" ? "block" : e === "warn" ? "warn" : e === "allow" ? "info" : fallback;

function summarize(d: Omit<GuardDecision, "message">): string {
  const stopping = d.reasons.find((r) => r.effect === "block");
  const hostPart = d.host ? ` for ${d.host}` : "";
  if (stopping) {
    const lead = d.dryRun ? `Dry run: your payment policy would stop this payment${hostPart}` : `Payment stopped by your payment policy`;
    const receipt = d.facts?.receiptUrl ? ` Receipt: ${d.facts.receiptUrl}.` : "";
    return `${lead} (rule: ${stopping.rule ?? stopping.code}). Fact: ${stopping.fact}${receipt} ${MEASUREMENT_NOTE} Dispute: ${d.disputeUrl}`;
  }
  const notes = d.reasons.filter((r) => r.effect === "warn");
  if (notes.length) return `Payment guard note${hostPart}: ${notes.map((r) => `${r.code}: ${r.fact}`).join(" ")} ${MEASUREMENT_NOTE} Dispute: ${d.disputeUrl}`;
  return `Payment guard: no policy rule matched${hostPart}.`;
}

/** Pure, local comparison of one payment option with BotsRated facts. */
export function evaluateFacts(facts: GuardFacts, req: { payTo?: unknown; amount?: unknown; network?: unknown }, paidUrl: string | undefined, policy: PaymentGuardPolicy): GuardReason[] {
  const p = { ...policies.warn, ...policy };
  const out: GuardReason[] = [];
  const add = (code: string, rule: keyof PaymentGuardPolicy | undefined, effect: GuardReason["effect"], fact: string) => {
    out.push({ code, effect, ...(rule ? { rule } : {}), fact });
  };
  const network = typeof req.network === "string" ? cleanText(req.network, 40) : "";
  const payTo = isAddress(req.payTo) ? req.payTo.toLowerCase() : undefined;
  if (!facts.covered) {
    add("not_covered", "notCovered", RULE_TO_EFFECT(p.notCovered, "info"), `BotsRated has no probe record for ${facts.host}.`);
    return out;
  }
  if (payTo) {
    if (facts.observedNetwork && network && facts.observedNetwork !== network) {
      add("network_not_observed", undefined, "info", `BotsRated's probes recorded ${facts.host} on ${facts.observedNetwork}, not on ${network}.`);
    } else if (facts.knownPayTos.length > 0 && !facts.knownPayTos.includes(payTo)) {
      add(
        "payto_not_observed",
        "payToMismatch",
        RULE_TO_EFFECT(p.payToMismatch, "warn"),
        `the payTo in this payment request is not among the payTo addresses BotsRated's probes recorded for ${facts.host} on ${facts.observedNetwork ?? (network || "this network")}.`,
      );
    } else if (facts.knownPayTos.length === 0 && facts.listingPayTo) {
      if (payTo === facts.listingPayTo) {
        add("payto_listing_only", undefined, "info", `the payTo matches ${facts.host}'s directory listing; BotsRated's probes have not recorded a payTo for ${facts.host} yet.`);
      } else {
        add(
          "payto_not_observed",
          "payToMismatch",
          RULE_TO_EFFECT(p.payToMismatch, "warn"),
          `the payTo in this payment request differs from the payTo in ${facts.host}'s directory listing; BotsRated's probes have not recorded a payTo for ${facts.host} yet.`,
        );
      }
    }
  }
  const probed = (facts as any)._probed as { host: string; path: string } | undefined;
  const paid = hostAndPath(paidUrl);
  if (facts.observedAmount && isAtomicAmount(req.amount) && probed && paid && probed.host === paid.host && probed.path === paid.path && BigInt(req.amount) > BigInt(facts.observedAmount)) {
    add(
      "price_above_observed",
      "priceAboveObserved",
      RULE_TO_EFFECT(p.priceAboveObserved, "warn"),
      `the quoted amount (${req.amount} atomic units) is above the last amount BotsRated recorded on this route (${facts.observedAmount}).`,
    );
  }
  if (facts.stale) add("data_stale", "stale", RULE_TO_EFFECT(p.stale, "info"), `BotsRated's latest probe of ${facts.host} is older than 24 hours.`);
  return out;
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return "pay_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Creates a payment guard. Zero-config: advice only, hosted host-name lookup, fail-open, retry key where advertised. */
export function createPaymentGuard(options: PaymentGuardOptions = {}): PaymentGuard {
  const opts: PaymentGuardOptions = { ...options };
  const policy: PaymentGuardPolicy = { ...policies.warn, ...(opts.policy ?? {}) };
  const dryRun = opts.dryRun === true;
  const hosted = opts.hosted !== false;
  const failOpen = opts.failOpen !== false;
  const retryKeyOn = opts.retryKey !== false && !dryRun;
  const baseUrl = (opts.baseUrl ?? BOTSRATED_BASE_URL).replace(/\/+$/, "");
  const ownHost = tryHostOf(baseUrl) ?? "botsrated.com";
  const ttl = opts.cacheTtlMs ?? 300_000;
  const cache = new Map<string, { at: number; value: { found: boolean; body: Record<string, any> } }>();
  const records = new Map<string, PaymentRecord & { expiresAt: number }>();
  const retryKeys = new Map<string, { id: string; expiresAt: number }>();

  const emit = (d: GuardDecision) => {
    try {
      opts.onDecision?.(d);
    } catch {
      /* caller callback errors are ignored */
    }
  };

  const hostedPreflight: PreflightFn = async (host) => {
    const hit = cache.get(host);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const f = opts.fetch ?? ((i: string, init?: RequestInit) => fetch(i, init));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 1500);
    try {
      // Host name only: never the path, query, wallet, amount, tx hash or payment header.
      const res = await f(`${baseUrl}/v1/preflight?url=${encodeURIComponent(host)}`, {
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: ctrl.signal,
        redirect: "error",
      });
      const text = await res.text();
      let body: Record<string, any> = {};
      try {
        body = text.length <= 1_000_000 ? JSON.parse(text) : {};
      } catch {
        body = {};
      }
      let value: { found: boolean; body: Record<string, any> };
      if (res.status === 404 && body?.error?.code === "host_not_covered") value = { found: false, body: { found: false } };
      else if (!res.ok) throw new Error(`HTTP ${res.status}`);
      else value = { found: body.found !== false, body };
      if (ttl > 0) cache.set(host, { at: Date.now(), value });
      return value;
    } finally {
      clearTimeout(t);
    }
  };
  const lookup: PreflightFn = opts.preflight ?? hostedPreflight;

  const finish = (partial: Omit<GuardDecision, "message" | "action" | "wouldBlock" | "dryRun" | "disputeUrl" | "policyRule">): GuardDecision => {
    const stopping = partial.reasons.find((r) => r.effect === "block");
    const base = {
      ...partial,
      action: (stopping && !dryRun ? "block" : "allow") as GuardDecision["action"],
      wouldBlock: !!stopping,
      dryRun,
      disputeUrl: DISPUTE_URL,
      ...(stopping ? { policyRule: stopping.rule ?? stopping.code } : {}),
    };
    return { ...base, message: summarize(base) };
  };

  async function beforeBody(ctx: any): Promise<{ stop: boolean; reason: string }> {
    let decision: GuardDecision;
    try {
      decision = await decideBefore(ctx);
    } catch {
      decision = finish({
        phase: "before_payment",
        reasons: [{ code: "hook_error", effect: failOpen ? "info" : "block", rule: "failOpen", fact: "the payment guard could not evaluate this payment." }],
      });
    }
    emit(decision);
    return { stop: decision.action === "block", reason: decision.message };
  }

  async function decideBefore(ctx: any): Promise<GuardDecision> {
    const pr = ctx?.paymentRequired ?? {};
    const req = ctx?.selectedRequirements ?? {};
    const reasons: GuardReason[] = [];
    const requestUrl = currentCtx().requestUrl;
    const requestHost = tryHostOf(requestUrl);
    const resourceUrl = typeof pr?.resource?.url === "string" ? pr.resource.url : undefined;
    const claimedHost = resourceUrl !== undefined ? (hostAndPath(resourceUrl)?.host ?? undefined) : undefined;
    const host = requestHost ?? claimedHost;
    // Local check: the 402's resource.url must name the host being paid (apex <-> www tolerated). Never sent anywhere.
    if (requestHost && resourceUrl !== undefined && (!claimedHost || !sameSiteHost(claimedHost, requestHost))) {
      reasons.push({
        code: "resource_host_mismatch",
        effect: RULE_TO_EFFECT(policy.resourceHostMismatch, "warn"),
        rule: "resourceHostMismatch",
        fact: claimedHost
          ? `the 402's resource.url names ${claimedHost}, not ${requestHost}, the host being paid.`
          : `the 402's resource.url is not an http(s) URL; the host being paid is ${requestHost}.`,
      });
    }
    if (!isAddress(req?.payTo)) {
      reasons.push({ code: "payto_invalid", effect: RULE_TO_EFFECT(policy.payToInvalid, "warn"), rule: "payToInvalid", fact: "the payTo in this payment request is not a 20-byte hex address." });
    }
    const t = req?.maxTimeoutSeconds;
    if (t === undefined || t === null) reasons.push({ code: "max_timeout_missing", effect: "info", fact: "the payment request has no maxTimeoutSeconds." });
    else if (!Number.isInteger(t) || t <= 0 || t > 600) reasons.push({ code: "max_timeout_above_600", effect: "info", fact: "the payment request's maxTimeoutSeconds is not an integer from 1 to 600." });

    let facts: GuardFacts | undefined;
    if (!host) {
      reasons.push({ code: "no_host", effect: "info", fact: "the payment request names no http(s) host to look up." });
    } else if (host === ownHost || sameSiteHost(host, ownHost)) {
      reasons.push({ code: "botsrated_payment", effect: "info", fact: "this is a payment to BotsRated; use createPrePaymentGuard with BotsRatedClient for those." });
    } else if (!hosted) {
      reasons.push({ code: "hosted_off", effect: "info", fact: "hosted checks are off (hosted: false); only local checks ran." });
    } else {
      try {
        const pre = await lookup(host);
        facts = guardFactsFrom(pre.body, host);
        if (!pre.found) facts.covered = false;
        reasons.push(...evaluateFacts(facts, req, requestUrl ?? resourceUrl, policy));
      } catch {
        reasons.push({
          code: "botsrated_unreachable",
          effect: failOpen ? "info" : "block",
          rule: "failOpen",
          fact: "BotsRated's preflight could not be reached in time.",
        });
      }
    }
    const publicFacts = facts ? (({ _probed, ...rest }: any) => rest)(facts) : undefined;
    return finish({ phase: "before_payment", host, reasons, ...(publicFacts ? { facts: publicFacts } : {}) });
  }

  function recordFrom(ctx: any): (PaymentRecord & { expiresAt: number }) | undefined {
    const payload = ctx?.paymentPayload;
    const auth = payload?.payload?.authorization;
    const accepted = payload?.accepted ?? ctx?.requirements ?? ctx?.selectedRequirements;
    if (!auth || !accepted) return undefined;
    const validBefore = Number(auth.validBefore);
    const validAfter = Number(auth.validAfter);
    if (!isAddress(auth.from) || !isAddress(accepted.payTo) || !isBytes32(auth.nonce) || !isAtomicAmount(String(accepted.amount)) || !Number.isSafeInteger(validBefore)) return undefined;
    const host = tryHostOf(currentCtx().requestUrl) ?? hostAndPath(ctx?.paymentRequired?.resource?.url ?? payload?.resource?.url)?.host;
    return {
      network: cleanText(accepted.network, 40),
      asset: isAddress(accepted.asset) ? accepted.asset : "",
      from: auth.from.toLowerCase(),
      payTo: accepted.payTo.toLowerCase(),
      amount: String(accepted.amount),
      nonce: auth.nonce.toLowerCase(),
      validBefore,
      ...(Number.isSafeInteger(validAfter) ? { validAfter } : {}),
      ...(host ? { host } : {}),
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: validBefore + 3600,
    };
  }

  const prune = () => {
    const now = Math.floor(Date.now() / 1000);
    for (const [k, r] of records) if (r.expiresAt < now) records.delete(k);
    for (const [k, r] of retryKeys) if (r.expiresAt < now) retryKeys.delete(k);
  };

  function afterBody(ctx: any): void {
    prune();
    const rec = recordFrom(ctx);
    if (rec) records.set(`${rec.payTo}:${rec.nonce}`, rec);
  }

  function responseBody(ctx: any): void {
    const auth = ctx?.paymentPayload?.payload?.authorization;
    const payTo = (ctx?.paymentPayload?.accepted ?? ctx?.requirements)?.payTo;
    if (!auth || !isBytes32(auth.nonce) || !isAddress(payTo)) return;
    const key = `${payTo.toLowerCase()}:${auth.nonce.toLowerCase()}`;
    const rec = records.get(key) ?? recordFrom(ctx);
    if (!rec) return;
    const tx = ctx?.settleResponse?.transaction;
    if (isTxHash(tx)) rec.txHashHint = tx.toLowerCase();
    records.set(key, rec);
    if (ctx?.settleResponse?.success === true) return;
    const waitUntil = rec.validBefore + 60;
    emit(
      finish({
        phase: "payment_response",
        ...(rec.host ? { host: rec.host } : {}),
        reasons: [
          {
            code: "payment_state_unknown",
            effect: "warn",
            fact: `the seller's response did not report a settled payment. The signed authorization stays valid until ${new Date(rec.validBefore * 1000).toISOString()}. Do not sign a new payment for this purchase before ${new Date(waitUntil * 1000).toISOString()}; call guard.paymentState() for an on-chain answer.`,
          },
        ],
      }),
    );
  }

  const extension = {
    key: "payment-identifier" as const,
    async enrichPaymentPayload(payload: any, paymentRequired: any): Promise<any> {
      try {
        if (!retryKeyOn || !payload || typeof payload !== "object" || payload.x402Version !== 2) return payload;
        const decl = paymentRequired?.extensions?.["payment-identifier"];
        if (!decl || typeof decl !== "object" || Array.isArray(decl)) return payload; // seller did not advertise it
        const existing = payload.extensions?.["payment-identifier"];
        if (existing?.info?.id !== undefined) return payload; // someone already set one
        const payTo = payload.accepted?.payTo;
        const route = hostAndPath(currentCtx().requestUrl) ?? hostAndPath(paymentRequired?.resource?.url);
        if (!isAddress(payTo) || !route) return payload;
        prune();
        const op = currentCtx().operationKey;
        let id: string;
        const validBefore = Number(payload.payload?.authorization?.validBefore);
        const expiresAt = (Number.isSafeInteger(validBefore) ? validBefore : Math.floor(Date.now() / 1000) + 600) + 600;
        if (op !== undefined) {
          // One id per (operation, payTo, host, path): a retry of the same operation reuses it; nothing crosses sellers.
          const k = JSON.stringify([op, payTo.toLowerCase(), route.host, route.path]);
          const hit = retryKeys.get(k);
          id = hit?.id ?? randomId();
          retryKeys.set(k, { id, expiresAt: Math.max(expiresAt, hit?.expiresAt ?? 0) });
        } else {
          id = randomId();
        }
        const base = existing && typeof existing === "object" ? existing : decl;
        const info = base.info && typeof base.info === "object" && !Array.isArray(base.info) ? base.info : {};
        const out = {
          ...payload,
          extensions: { ...(payload.extensions ?? {}), "payment-identifier": { ...base, info: { ...info, id } } },
        };
        // Invariant: the result equals the input except extensions["payment-identifier"](.info.id). Otherwise unchanged.
        const hadKey = !!existing && typeof existing === "object";
        const check = JSON.parse(JSON.stringify(out));
        if (hadKey) delete check.extensions["payment-identifier"].info.id;
        else {
          delete check.extensions["payment-identifier"];
          if (payload.extensions === undefined || payload.extensions === null) check.extensions = payload.extensions;
        }
        if (JSON.stringify(check) !== JSON.stringify(payload)) return payload;
        return out;
      } catch {
        return payload;
      }
    },
  };

  const hooks = {
    beforePaymentCreation: abortOnly(beforeBody),
    afterPaymentCreation: observeOnly(afterBody),
    paymentResponse: observeOnly(responseBody),
  };

  return {
    options: Object.freeze({ ...opts }),
    hooks,
    extension,
    install<T extends X402HookTarget>(client: T): T {
      client.onBeforePaymentCreation(hooks.beforePaymentCreation);
      client.onAfterPaymentCreation(hooks.afterPaymentCreation);
      client.onPaymentResponse?.(hooks.paymentResponse);
      if (retryKeyOn) client.registerExtension?.(extension);
      return client;
    },
    wrapFetch<F extends (input: any, init?: any) => Promise<Response>>(fetchWithPayment: F): F {
      return ((input: any, init?: any) => runWith({ requestUrl: requestUrlOf(input) }, () => fetchWithPayment(input, init))) as F;
    },
    operation<R>(operationKey: string, fn: () => Promise<R>): Promise<R> {
      return runWith({ operationKey: String(operationKey) }, fn);
    },
    records(): PaymentRecord[] {
      prune();
      return [...records.values()].map(({ expiresAt, ...r }) => ({ ...r }));
    },
    async paymentState(ref): Promise<PaymentState> {
      const full = "from" in ref ? (ref as PaymentRecord) : records.get(`${String(ref.payTo).toLowerCase()}:${String(ref.nonce).toLowerCase()}`);
      if (opts.onchain === false || !full) {
        const vb = full?.validBefore ?? Math.floor(Date.now() / 1000);
        return {
          state: "unknown",
          code: "payment_state_unknown",
          reason: opts.onchain === false ? "onchain_disabled" : "no_record",
          waitUntil: vb + 60,
          rpcHosts: [],
          message: "Payment state unknown. Do not sign a new payment for this purchase until you can confirm it.",
        };
      }
      return checkPaymentState(full, opts.onchain ?? {});
    },
  };
}
