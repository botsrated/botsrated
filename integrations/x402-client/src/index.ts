/**
 * @botsrated/x402-preflight
 *
 * Ask BotsRated (https://botsrated.com) about an x402 seller before paying it.
 * The default path only uses the free `GET /v1/preflight` route. Paid BotsRated
 * routes (`/v1/check` $0.001, `/v1/report/{host}` $0.002, `/v1/best` $0.01; first 100 checks + 10 reports per day free) are
 * off unless you pass `paid` with a budget and an x402 client (or a payment-capable fetch).
 */

import {
  BASE_MAINNET,
  BASE_USDC,
  BOTSRATED_BASE_URL,
  BotsRatedError,
  DISPUTE_URL,
  MAX_HEADER_BYTES,
  USER_AGENT,
  cleanText,
  hostOf,
  isAddress,
  sameSiteHost,
  tryHostOf,
} from "./util.js";

export {
  BASE_CHAIN_ID_HEX,
  BASE_MAINNET,
  BASE_USDC,
  BOTSRATED_BASE_URL,
  BotsRatedError,
  DISPUTE_URL,
  PRIVACY_URL,
  TERMS_URL,
  USER_AGENT,
  VERSION,
  cleanText,
  hostOf,
  isAddress,
  sameSiteHost,
  tryHostOf,
} from "./util.js";
export * from "./payment-guard.js";
export * from "./onchain.js";

/** BotsRated's payTo on Base. Paid calls to any other payTo are refused. */
export const BOTSRATED_PAY_TO = "0x7F936f42F46B6c4Cbd3242cF8A1759dfe829E349";
/** Published prices of the paid routes (since 2026-10-23), in atomic USDC (6 decimals). Quotes above these are refused. */
export const PAID_ROUTE_MAX_ATOMIC = { check: 1000n, report: 2000n, best: 10000n } as const;
/** Free daily quota per client (IP) per UTC day. Within it BotsRated answers 200 with `charged: false` and no 402. */
export const FREE_DAILY_QUOTA = { check: 100, report: 10, best: 0 } as const;
export type PaidRoute = keyof typeof PAID_ROUTE_MAX_ATOMIC;
/** Longest payment authorization window accepted for a BotsRated payment. */
export const MAX_TIMEOUT_SECONDS = 600;
/** EIP-3009 needs only the token's EIP-712 name/version; any other `extra` key (e.g. assetTransferMethod=permit2) is refused. */
const ALLOWED_EXTRA = new Set(["name", "version"]);
/**
 * Discovery metadata and the payment-identifier retry key only. Payment extensions (erc20ApprovalGasSponsoring,
 * eip2612GasSponsoring, ...) are refused. Extensions are never copied into what the signer sees.
 */
const IGNORED_EXTENSIONS = new Set(["bazaar", "payment-identifier"]);

/** True when a PaymentRequired `extensions` value carries nothing but discovery metadata. */
export function extensionsOk(extensions: unknown): boolean {
  if (extensions === undefined || extensions === null) return true;
  return typeof extensions === "object" && !Array.isArray(extensions) && Object.keys(extensions).every((k) => IGNORED_EXTENSIONS.has(k));
}

/**
 * True when a payment option is a plain one-shot EIP-3009 payment: `extra` only name/version strings, timeout 1..600 s.
 * A missing `maxTimeoutSeconds` is invalid (it is no longer read as 600).
 */
function eip3009Only(req: PaymentRequirementsLike): boolean {
  const extra = req.extra ?? {};
  const timeout = req.maxTimeoutSeconds;
  return (
    typeof extra === "object" &&
    !Array.isArray(extra) &&
    Object.entries(extra).every(([k, v]) => ALLOWED_EXTRA.has(k) && typeof v === "string") &&
    Number.isInteger(timeout) &&
    (timeout as number) > 0 &&
    (timeout as number) <= MAX_TIMEOUT_SECONDS
  );
}

/** `free_quota` block of a free-quota answer. */
export interface FreeQuotaInfo {
  route: string;
  used: number;
  limit: number;
  remaining: number;
  resets_at: string;
}

/** True when a 2xx BotsRated body was served from the free daily quota (nothing was charged). */
export function isFreeQuotaAnswer(body: unknown): boolean {
  const b = body as Record<string, any> | null;
  return !!b && typeof b === "object" && b.charged === false && !!b.free_quota && typeof b.free_quota === "object";
}

/** Structural subset of x402 v2 `PaymentRequirements`. */
export interface PaymentRequirementsLike {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: unknown;
  extra?: Record<string, unknown> | null;
}

/** Structural subset of x402 v2 `PaymentRequired`. */
export interface PaymentRequiredLike {
  x402Version: number;
  resource?: { url?: string };
  accepts: PaymentRequirementsLike[];
  extensions?: Record<string, unknown> | null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Structural subset of `x402Client` from `@x402/core/client`: signs one `PaymentRequired`. */
export interface X402ClientLike {
  createPaymentPayload(paymentRequired: any): Promise<unknown>;
}

export interface PaidOptions {
  /** Total USD this client may spend on BotsRated paid routes. Required, > 0. */
  budgetUsd: number;
  /**
   * Recommended. An `x402Client` (from `@x402/core/client` or `@x402/fetch`) with your signer registered.
   * The client signs a copy of the validated 402 rebuilt from allowlisted fields only and sends
   * `PAYMENT-SIGNATURE` itself, so the signer never sees the raw quote. Pass this or `fetchWithPayment`.
   */
  x402Client?: X402ClientLike;
  /**
   * A fetch that pays x402 challenges, e.g. `wrapFetchWithPayment(fetch, x402Client)` from `@x402/fetch`.
   * It re-reads the 402 itself, so register `createPrePaymentGuard({ client })` on the same x402 client.
   */
  fetchWithPayment?: FetchLike;
  /** Defaults to {@link BOTSRATED_PAY_TO}. */
  expectedPayTo?: string;
}

export interface BotsRatedClientOptions {
  baseUrl?: string;
  /** Unpaid fetch used for preflight and for reading 402 quotes. Defaults to global fetch. */
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Preflight cache TTL per host. Default 300 s. 0 disables the cache. */
  cacheTtlMs?: number;
  /** Opt-in paid routes. Omit to keep the client free-only. */
  paid?: PaidOptions;
}

const USDC_DECIMALS = 6;

export function usdToAtomic(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) throw new BotsRatedError(`invalid USD amount: ${usd}`, "invalid_amount");
  return BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
}

export function atomicToUsd(atomic: bigint): number {
  return Number(atomic) / 10 ** USDC_DECIMALS;
}

const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Spend tracker in atomic USDC. Amounts are reserved before paying; a failed paid call stays counted (it may have settled). */
export class Budget {
  private spent = 0n;
  private reserved = 0n;
  constructor(readonly limit: bigint) {
    if (limit <= 0n) throw new BotsRatedError("budget must be greater than 0", "invalid_budget");
  }
  get spentAtomic(): bigint {
    return this.spent;
  }
  get remainingAtomic(): bigint {
    return this.limit - this.spent - this.reserved;
  }
  get pendingAtomic(): bigint {
    return this.reserved;
  }
  reserve(amount: bigint): void {
    if (amount > this.remainingAtomic) {
      throw new BotsRatedError(
        `budget exceeded: need ${atomicToUsd(amount)} USD, ${atomicToUsd(this.remainingAtomic)} USD left`,
        "budget_exceeded",
      );
    }
    this.reserved += amount;
  }
  commit(amount: bigint): void {
    this.reserved -= amount;
    this.spent += amount;
  }
  release(amount: bigint): void {
    this.reserved -= amount;
  }
}

/** Base64 of the JSON payment payload, as the x402 v2 `PAYMENT-SIGNATURE` header expects. */
function encodeHeader(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Decodes the x402 v2 `PAYMENT-REQUIRED` header (base64 JSON), falling back to the JSON body. */
export async function readPaymentRequired(res: Response): Promise<PaymentRequiredLike> {
  const header = res.headers.get("payment-required");
  try {
    if (header) {
      if (header.length > (MAX_HEADER_BYTES * 4) / 3 + 4) throw new Error("too large");
      return JSON.parse(atob(header)) as PaymentRequiredLike;
    }
    const text = await res.text();
    if (text.length > MAX_HEADER_BYTES * 4) throw new Error("too large");
    return JSON.parse(text) as PaymentRequiredLike;
  } catch {
    throw new BotsRatedError("could not parse the 402 payment terms", "bad_402");
  }
}

/** Minimal `AsyncLocalStorage` shape (Node's `node:async_hooks`). */
interface AsyncLocalStorageLike<T> {
  run<R>(store: T, fn: () => R): R;
  getStore(): T | undefined;
}

/** Per-async-context request URL when the runtime exposes AsyncLocalStorage synchronously (Node >= 20.16 / 22.3). */
const requestUrlStore: AsyncLocalStorageLike<string> | undefined = (() => {
  try {
    const mod = (globalThis as any).process?.getBuiltinModule?.("node:async_hooks");
    return mod?.AsyncLocalStorage ? (new mod.AsyncLocalStorage() as AsyncLocalStorageLike<string>) : undefined;
  } catch {
    return undefined;
  }
})();
/** Fallback without AsyncLocalStorage: URLs of the {@link payingRequest} calls currently in flight. */
const inFlightRequestUrls = new Map<string, number>();

/**
 * Runs `fn` (an x402 request that may pay) and tells the guard's `beforePaymentCreation` which URL is actually
 * being paid. The guard then looks up that URL's host, not the seller-supplied 402 `resource.url`, and blocks the
 * payment if `resource.url` names a different host.
 */
export async function payingRequest<T>(url: string, fn: () => Promise<T>): Promise<T> {
  inFlightRequestUrls.set(url, (inFlightRequestUrls.get(url) ?? 0) + 1);
  try {
    return await (requestUrlStore ? requestUrlStore.run(url, fn) : fn());
  } finally {
    const n = (inFlightRequestUrls.get(url) ?? 1) - 1;
    if (n > 0) inFlightRequestUrls.set(url, n);
    else inFlightRequestUrls.delete(url);
  }
}

/**
 * The URL set by {@link payingRequest} for the current async context. Without AsyncLocalStorage (browsers, Node < 20.16)
 * it is the one paid request in flight, or undefined when more than one is in flight (the guard can't tell them apart;
 * set `policy.requireRequestUrl` to block those payments).
 */
export function currentRequestUrl(): string | undefined {
  if (requestUrlStore) return requestUrlStore.getStore();
  let total = 0;
  for (const n of inFlightRequestUrls.values()) total += n;
  return total === 1 ? [...inFlightRequestUrls.keys()][0] : undefined;
}

function requestUrlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return String((input as { url?: unknown })?.url ?? input);
}

export class BotsRatedClient {
  readonly baseUrl: string;
  readonly budget?: Budget;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { at: number; value: PreflightResult }>();

  constructor(private readonly options: BotsRatedClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? BOTSRATED_BASE_URL).replace(/\/$/, "");
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.cacheTtlMs = options.cacheTtlMs ?? 300_000;
    if (options.paid) {
      const { x402Client, fetchWithPayment } = options.paid;
      if (!x402Client === !fetchWithPayment) {
        throw new BotsRatedError("paid routes need exactly one of `x402Client` or `fetchWithPayment`", "invalid_config");
      }
      this.budget = new Budget(usdToAtomic(options.paid.budgetUsd));
    }
  }

  get paidEnabled(): boolean {
    return !!this.options.paid;
  }

  get host(): string {
    return hostOf(this.baseUrl);
  }

  /**
   * Free. Latest stored probe for a seller. `found: false` when BotsRated does not cover the host.
   * Only the host name is sent to BotsRated, never the path or query of a URL you pass.
   */
  async preflight(urlOrHost: string): Promise<PreflightResult> {
    const host = hostOf(urlOrHost);
    const hit = this.cache.get(host);
    if (hit && Date.now() - hit.at < this.cacheTtlMs) return hit.value;
    const res = await this.get(`/v1/preflight?url=${encodeURIComponent(host)}`);
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    let value: PreflightResult;
    if (res.status === 404 && body?.error?.code === "host_not_covered") {
      value = { found: false, host, body: { ...body, found: false } };
    } else if (!res.ok) {
      throw new BotsRatedError(cleanText(body?.error?.message ?? `preflight returned ${res.status}`), cleanText(body?.error?.code ?? "http_error", 40), res.status);
    } else {
      value = { found: body.found !== false, host, body };
    }
    if (this.cacheTtlMs > 0) this.cache.set(host, { at: Date.now(), value });
    return value;
  }

  /** Paid ($0.001; first 100/day free). Facts, paid test-buys and recent receipts for one host. Free within the daily quota; after that requires `paid`. */
  check(urlOrHost: string): Promise<Record<string, any>> {
    return this.paidGet(`/v1/check?host=${encodeURIComponent(hostOf(urlOrHost))}`, "check");
  }

  /** Paid ($0.002; first 10/day free). Full receipt history for one host. Free within the daily quota; after that requires `paid`. */
  report(urlOrHost: string): Promise<Record<string, any>> {
    return this.paidGet(`/v1/report/${encodeURIComponent(hostOf(urlOrHost))}`, "report");
  }

  /** Paid ($0.01). Top providers for a task. Requires `paid`. */
  best(task: string, opts: { sort?: "reliability" | "price" | "latency"; maxPriceUsd?: number } = {}): Promise<Record<string, any>> {
    const q = new URLSearchParams({ task });
    if (opts.sort) q.set("sort", opts.sort);
    if (opts.maxPriceUsd !== undefined) q.set("max_price", String(opts.maxPriceUsd));
    return this.paidGet(`/v1/best?${q}`, "best");
  }

  /**
   * True when `req` is an acceptable BotsRated payment that this client has reserved budget for.
   * Used by {@link createPrePaymentGuard} so payments to BotsRated only happen through this client.
   */
  isReservedBotsRatedPayment(req: PaymentRequirementsLike): boolean {
    return !!this.budget && this.budget.pendingAtomic >= BigInt(req.amount) && this.acceptable(req, PAID_ROUTE_MAX_ATOMIC.best);
  }

  private acceptable(req: PaymentRequirementsLike, max: bigint): boolean {
    return this.minimalOption(req, max) !== undefined;
  }

  /** Allowlisted copy of one payment option, or undefined unless it is exact EIP-3009 Base USDC to BotsRated. */
  private minimalOption(req: PaymentRequirementsLike, max: bigint): PaymentRequirementsLike | undefined {
    const payTo = this.options.paid?.expectedPayTo ?? BOTSRATED_PAY_TO;
    const ok =
      !!req &&
      typeof req === "object" &&
      eip3009Only(req) &&
      req.scheme === "exact" &&
      req.network === BASE_MAINNET &&
      eq(req.asset, BASE_USDC) &&
      eq(req.payTo, payTo) &&
      typeof req.amount === "string" &&
      /^[0-9]+$/.test(req.amount) &&
      BigInt(req.amount) <= max;
    if (!ok) return undefined;
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.extra ?? {})) extra[k] = v as string;
    return {
      scheme: "exact",
      network: BASE_MAINNET,
      asset: req.asset,
      amount: req.amount,
      payTo: req.payTo,
      maxTimeoutSeconds: req.maxTimeoutSeconds as number,
      extra,
    };
  }

  /**
   * Rebuilds a 402 from allowlisted fields only, or returns undefined if any part is not allowed: x402 v2,
   * every option acceptable, `extensions` at most the discovery-only `bazaar` key (never copied).
   */
  signableTerms(terms: PaymentRequiredLike, max: bigint = PAID_ROUTE_MAX_ATOMIC.best): PaymentRequiredLike | undefined {
    if (!terms || typeof terms !== "object" || terms.x402Version !== 2 || !extensionsOk(terms.extensions)) return undefined;
    const accepts = terms.accepts;
    if (!Array.isArray(accepts) || accepts.length === 0) return undefined;
    const clean = accepts.map((a) => this.minimalOption(a, max));
    if (clean.some((c) => c === undefined)) return undefined;
    const out: PaymentRequiredLike = { x402Version: 2, accepts: clean as PaymentRequirementsLike[] };
    const r = terms.resource as Record<string, unknown> | undefined;
    if (r && typeof r === "object" && typeof r.url === "string") {
      const resource: Record<string, string> = {};
      for (const k of ["url", "description", "mimeType"]) if (typeof r[k] === "string") resource[k] = r[k] as string;
      out.resource = resource;
    }
    return out;
  }

  /** Last `free_quota` block seen (from a free-quota answer), or undefined. */
  lastFreeQuota?: FreeQuotaInfo;

  private async paidGet(path: string, route: PaidRoute): Promise<Record<string, any>> {
    const paid = this.options.paid;
    // Ask unpaid first. Within BotsRated's free daily quota this already returns the data (200, charged: false) and
    // nothing is paid or taken from the budget. Unknown hosts and bad input get a free 4xx here, before any payment.
    const quote = await this.get(path);
    if (quote.ok) {
      const body = (await quote.json().catch(() => null)) as Record<string, any> | null;
      if (isFreeQuotaAnswer(body)) {
        this.lastFreeQuota = body!.free_quota as FreeQuotaInfo;
        return body!;
      }
      throw new BotsRatedError(`expected 402 or a free-quota answer, got ${quote.status}`, "unexpected_status", quote.status);
    }
    if (!paid || !this.budget) {
      throw new BotsRatedError(
        // /v1/best has no free daily quota, so only check and report mention one.
        quote.status === 402 && route !== "best"
          ? "free daily quota used up and paid BotsRated routes are disabled; pass `paid: { budgetUsd, x402Client }`"
          : "paid BotsRated routes are disabled; pass `paid: { budgetUsd, x402Client }`",
        "paid_disabled",
        quote.status,
      );
    }
    if (quote.status !== 402) {
      const body = (await quote.json().catch(() => ({}))) as Record<string, any>;
      throw new BotsRatedError(cleanText(body?.error?.message ?? `expected 402, got ${quote.status}`), cleanText(body?.error?.code ?? "unexpected_status", 40), quote.status);
    }
    const terms = await readPaymentRequired(quote);
    // Fail closed: every option must be acceptable (a fetchWithPayment re-reads the 402 and picks one itself).
    const signable = this.signableTerms(terms, PAID_ROUTE_MAX_ATOMIC[route]);
    if (!signable) {
      throw new BotsRatedError(
        "every payment option must be exact EIP-3009 Base USDC to BotsRated at or below the published price, with no payment extensions",
        "terms_rejected",
      );
    }
    const amount = signable.accepts.reduce((m, a) => (BigInt(a.amount) > m ? BigInt(a.amount) : m), 0n);
    this.budget.reserve(amount);
    let signature: string | undefined;
    if (paid.x402Client) {
      try {
        signature = encodeHeader(await paid.x402Client.createPaymentPayload(signable));
      } catch (e) {
        // Nothing was signed, so nothing can settle.
        this.budget.release(amount);
        throw new BotsRatedError(`payment not created: ${cleanText((e as Error)?.message)}`, "payment_not_created");
      }
    }
    let res: Response;
    try {
      res =
        signature !== undefined
          ? await this.fetchFn(this.baseUrl + path, {
              headers: { accept: "application/json", "PAYMENT-SIGNATURE": signature },
              redirect: "manual",
            })
          : await payingRequest(this.baseUrl + path, () =>
              paid.fetchWithPayment!(this.baseUrl + path, { headers: { accept: "application/json" }, redirect: "manual" }),
            );
    } catch (e) {
      // A signed payment may already have settled: keep it counted so the budget is a hard ceiling.
      this.budget.commit(amount);
      throw e;
    }
    if (!res.ok) {
      this.budget.commit(amount);
      throw new BotsRatedError(`paid ${route} returned ${res.status}; the amount stays counted against the budget in case it settled`, "paid_call_failed", res.status);
    }
    const out = (await res.json()) as Record<string, any>;
    // The payer may have signed before this answer, so even a free-quota body keeps the amount counted.
    this.budget.commit(amount);
    if (isFreeQuotaAnswer(out)) this.lastFreeQuota = out.free_quota as FreeQuotaInfo;
    return out;
  }

  private async get(path: string): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(this.baseUrl + path, { headers: { accept: "application/json", "user-agent": USER_AGENT }, signal: ctrl.signal });
    } catch (e) {
      throw new BotsRatedError(`BotsRated unreachable: ${cleanText((e as Error)?.message, 80)}`, "unreachable");
    } finally {
      clearTimeout(t);
    }
  }
}

export interface PreflightResult {
  found: boolean;
  host: string;
  body: Record<string, any>;
}

/** Facts read from a preflight or paid check response. */
export interface SellerFacts {
  covered: boolean;
  host: string;
  /** payTos BotsRated's own probes observed (the listing is seller-controlled and never counts). */
  knownPayTos: string[];
  /** payTo from the seller's directory listing, if any. */
  listingPayTo?: string;
  observedNetwork?: string;
  probedUrl?: string;
  observedAmount?: string;
  valid402Rate?: number;
  recentProbes?: number;
  stale?: boolean;
  lastProbeAt?: string;
  receiptUrl?: string;
  paidTests?: number;
  source: "preflight" | "check";
}

export function factsFrom(body: Record<string, any>, host: string, source: "preflight" | "check"): SellerFacts {
  const probe = body.latest_probe ?? body.receipts?.[0] ?? {};
  const measured = body.measured ?? {};
  const listing = body.listing ?? {};
  const rw = body.recent_window ?? measured.recent_window ?? {};
  const payTos = [probe.live_payTo, measured.last_quoted_payTo].filter((x): x is string => typeof x === "string" && x.length > 0);
  return {
    covered: body.found !== false,
    host,
    knownPayTos: [...new Set(payTos.map((p) => p.toLowerCase()))],
    listingPayTo: typeof listing.payTo === "string" && listing.payTo ? listing.payTo.toLowerCase() : undefined,
    observedNetwork: probe.live_network ?? listing.network,
    probedUrl: probe.url ?? body.route_probed?.url,
    observedAmount: probe.live_amount ?? measured.last_quoted_amount_atomic,
    valid402Rate: typeof rw.valid_402_rate === "number" ? rw.valid_402_rate : undefined,
    recentProbes: typeof rw.probes === "number" ? rw.probes : undefined,
    stale: body.freshness?.stale,
    lastProbeAt: body.freshness?.last_probe_at,
    receiptUrl: probe.receipt_url,
    paidTests: body.paid_tests?.count ?? body.paid_tests_count,
    source,
  };
}

export interface GuardPolicy {
  /** Seller not in BotsRated's coverage. Default "allow". */
  notCovered?: "allow" | "block";
  /**
   * payTo being paid is not among the payTos BotsRated's probes recorded for the host (same network), or is not an
   * address. Default "warn" (changed from "block" in 0.2.0). Pass "block" (or use `strictGuardPolicy`) to stop those payments.
   */
  payToMismatch?: "allow" | "warn" | "block";
  /** Same route, quoted amount above the last amount BotsRated observed. Default "warn". */
  priceAboveObserved?: "allow" | "warn" | "block";
  /** BotsRated data older than 24 h. Default "allow". */
  stale?: "allow" | "block";
  /** Block when the recent valid-402 rate is below this (only with >= 3 recent probes). Off by default. */
  minValid402Rate?: number;
  /**
   * Block a `beforePaymentCreation` payment when the URL being paid is unknown (no {@link payingRequest},
   * `guard.wrapFetch` or `guard.forRequest`). Default false: the host is then read from the 402's `resource.url`.
   */
  requireRequestUrl?: boolean;
}

/** The pre-0.2.0 behaviour as an explicit choice: stop payments whose payTo BotsRated's probes did not record. */
export const strictGuardPolicy: Readonly<GuardPolicy> = Object.freeze({ payToMismatch: "block" });

export interface Reason {
  code: string;
  detail: string;
  effect: "block" | "warn" | "info";
}

export interface Decision {
  action: "allow" | "block";
  host?: string;
  reasons: Reason[];
  facts?: SellerFacts;
  /** Where to dispute a BotsRated measurement. */
  disputeUrl?: string;
}

const DEFAULT_POLICY: Required<Omit<GuardPolicy, "minValid402Rate" | "requireRequestUrl">> = {
  notCovered: "allow",
  payToMismatch: "warn",
  priceAboveObserved: "warn",
  stale: "allow",
};

const sameRoute = (a?: string, b?: string) => {
  if (!a || !b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host.toLowerCase() === y.host.toLowerCase() && x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
};

/** Pure, local policy check of one payment against BotsRated facts. Reason details state facts only. */
export function evaluatePayment(facts: SellerFacts, req: PaymentRequirementsLike, resourceUrl: string | undefined, policy: GuardPolicy = {}): Decision {
  const p = { ...DEFAULT_POLICY, ...policy };
  const reasons: Reason[] = [];
  const add = (code: string, detail: string, effect: "allow" | "warn" | "block" | "info") => {
    if (effect !== "allow") reasons.push({ code, detail, effect });
  };
  const host = cleanText(facts.host, 253);
  const network = cleanText(req?.network, 40);

  if (!facts.covered) {
    add("not_covered", `BotsRated has no probe record for ${host}.`, p.notCovered === "block" ? "block" : "info");
  } else {
    const observedNetwork = facts.observedNetwork ? cleanText(facts.observedNetwork, 40) : undefined;
    const known = facts.knownPayTos.filter(isAddress).map((x) => x.toLowerCase());
    const listing = isAddress(facts.listingPayTo) ? facts.listingPayTo.toLowerCase() : undefined;
    if (!isAddress(req?.payTo)) {
      add("payto_invalid", "the payTo in this payment request is not a 20-byte hex address.", p.payToMismatch);
    } else if (observedNetwork && observedNetwork !== network) {
      add("network_not_observed", `BotsRated's probes recorded ${host} on ${observedNetwork}, not on ${network}.`, "info");
    } else if (known.length > 0 && !known.includes(req.payTo.toLowerCase())) {
      add(
        "payto_not_observed",
        `the payTo in this payment request is not among the payTo addresses BotsRated's probes recorded for ${host} on ${observedNetwork ?? network}.`,
        p.payToMismatch,
      );
    } else if (known.length === 0 && listing) {
      if (req.payTo.toLowerCase() === listing) {
        add("payto_listing_only", `the payTo matches ${host}'s directory listing; BotsRated's probes have not recorded a payTo for ${host} yet.`, "info");
      } else {
        add(
          "payto_not_observed",
          `the payTo in this payment request differs from the payTo in ${host}'s directory listing; BotsRated's probes have not recorded a payTo for ${host} yet.`,
          p.payToMismatch,
        );
      }
    }
    if (facts.observedAmount && /^[0-9]+$/.test(facts.observedAmount) && /^[0-9]+$/.test(String(req?.amount)) && sameRoute(resourceUrl, facts.probedUrl) && BigInt(req.amount) > BigInt(facts.observedAmount)) {
      add("price_above_observed", `the quoted amount (${req.amount} atomic units) is above the last amount BotsRated recorded on this route (${facts.observedAmount}).`, p.priceAboveObserved);
    }
    if (facts.stale) add("data_stale", `BotsRated's latest probe of ${host} is older than 24 hours.`, p.stale === "block" ? "block" : "info");
    if (p.minValid402Rate !== undefined && facts.valid402Rate !== undefined && (facts.recentProbes ?? 0) >= 3 && facts.valid402Rate < p.minValid402Rate) {
      add("low_valid_402_rate", `the recent valid-402 rate BotsRated measured (${facts.valid402Rate}) is below your minimum (${p.minValid402Rate}).`, "block");
    }
  }
  return { action: reasons.some((r) => r.effect === "block") ? "block" : "allow", host: facts.host, reasons, facts, disputeUrl: DISPUTE_URL };
}

export interface GuardOptions {
  /** Reuse a client (needed for paid checks). Defaults to a free-only client. */
  client?: BotsRatedClient;
  policy?: GuardPolicy;
  /** Allow the payment when BotsRated cannot be reached (or the guard errors). Default true. */
  failOpen?: boolean;
  /** Run a check for payments at or above this USD amount: free within the daily quota (100/day), then a $0.001 paid check if the client is paid-enabled (otherwise skipped). */
  paidCheckAtOrAboveUsd?: number;
  onDecision?: (decision: Decision, req: PaymentRequirementsLike) => void;
}

/** Context passed by `x402Client.onBeforePaymentCreation` in `@x402/core` v2. */
export interface BeforePaymentContextLike {
  paymentRequired: PaymentRequiredLike;
  selectedRequirements: PaymentRequirementsLike;
}

export type BeforePaymentHook = (ctx: BeforePaymentContextLike) => Promise<void | { abort: true; reason: string }>;

export interface PrePaymentGuard {
  client: BotsRatedClient;
  /**
   * Decide on one payment. Never throws when `failOpen` is true.
   * @param resourceUrl The URL the payment is for; in an x402 hook this is the seller-supplied 402 `resource.url`.
   * @param requestUrl The URL actually being requested and paid. When given, its host is looked up, and the payment
   *   is blocked (even with `failOpen`) if `resourceUrl` names a different host. Only host names go to BotsRated.
   */
  decide(resourceUrl: string | undefined, req: PaymentRequirementsLike, requestUrl?: string): Promise<Decision>;
  /**
   * Register with `x402Client.onBeforePaymentCreation(guard.beforePaymentCreation)`. The URL being paid comes from
   * {@link payingRequest} / {@link PrePaymentGuard.wrapFetch}; without it the host is read from the 402's `resource.url`.
   */
  beforePaymentCreation: BeforePaymentHook;
  /** A hook bound to one request URL, for an x402 client used for a single request. */
  forRequest(requestUrl: string): BeforePaymentHook;
  /** Wraps a paying fetch (e.g. `wrapFetchWithPayment(fetch, client)`) so `beforePaymentCreation` knows the URL being paid. */
  wrapFetch<F extends (input: any, init?: any) => Promise<Response>>(fetchWithPayment: F): F;
}

const MEASUREMENT_NOTE = "This is a measurement, not a finding about the seller.";

/** Fact-only text for a decision, with the dispute link. Seller text is never echoed beyond a parsed host name. */
export function formatDecision(d: Decision): string {
  const blocking = d.reasons.filter((r) => r.effect === "block");
  const dispute = d.disputeUrl ?? DISPUTE_URL;
  const receipt = d.facts?.receiptUrl && /^https:\/\/(www\.)?botsrated\.com\//.test(d.facts.receiptUrl) ? ` Receipt: ${cleanText(d.facts.receiptUrl, 200)}.` : "";
  if (d.action === "block" && blocking.length) {
    const r = blocking[0];
    return cleanText(`Payment stopped by your payment policy (rule: ${r.code}). Fact: ${r.detail}${receipt} ${MEASUREMENT_NOTE} Dispute: ${dispute}`, 700);
  }
  const list = d.reasons.map((r) => `${r.code}: ${r.detail}`).join(" ");
  return cleanText(`BotsRated pre-payment check for ${d.host ?? "this payment"}: ${list || "no rule matched."}${receipt} ${MEASUREMENT_NOTE} Dispute: ${dispute}`, 700);
}

export function createPrePaymentGuard(options: GuardOptions = {}): PrePaymentGuard {
  const client = options.client ?? new BotsRatedClient();
  const failOpen = options.failOpen ?? true;
  const openOrClosed = (code: string, detail: string, host?: string): Decision => ({
    action: failOpen ? "allow" : "block",
    ...(host ? { host } : {}),
    reasons: [{ code, detail, effect: failOpen ? "info" : "block" }],
    disputeUrl: DISPUTE_URL,
  });

  async function decide(resourceUrl: string | undefined, req: PaymentRequirementsLike, requestUrl?: string): Promise<Decision> {
    try {
      return await decideInner(resourceUrl, req, requestUrl);
    } catch {
      return openOrClosed("hook_error", "the pre-payment check could not evaluate this payment.");
    }
  }

  async function decideInner(resourceUrl: string | undefined, req: PaymentRequirementsLike, requestUrl?: string): Promise<Decision> {
    if (requestUrl) {
      const paidHost = tryHostOf(requestUrl);
      if (!paidHost) {
        return { action: "block", reasons: [{ code: "invalid_request_url", detail: "the URL being paid has no valid host.", effect: "block" }], disputeUrl: DISPUTE_URL };
      }
      if (resourceUrl) {
        const claimed = tryHostOf(resourceUrl);
        // An apex <-> www redirect is tolerated: the 402 then comes from the redirected host.
        if (claimed === undefined || !sameSiteHost(claimed, paidHost)) {
          return {
            action: "block",
            host: paidHost,
            reasons: [
              {
                code: "resource_url_mismatch",
                detail: claimed
                  ? `the 402's resource.url names ${claimed}, not ${paidHost}, the host being paid.`
                  : `the 402's resource.url has no valid host; the host being paid is ${paidHost}.`,
                effect: "block",
              },
            ],
            disputeUrl: DISPUTE_URL,
          };
        }
      }
      resourceUrl = requestUrl;
    }
    if (!resourceUrl) return openOrClosed("no_resource_url", "the payment has no resource URL to look up.");
    const host = tryHostOf(resourceUrl);
    if (!host) return openOrClosed("invalid_resource_url", "the 402's resource.url has no valid host.");
    // Payments to BotsRated itself: only the client's own budgeted calls.
    if (host === client.host) {
      const ok = client.isReservedBotsRatedPayment(req);
      return {
        action: ok ? "allow" : "block",
        host,
        reasons: ok ? [] : [{ code: "botsrated_payment_not_reserved", detail: "payments to BotsRated must go through BotsRatedClient with a budget.", effect: "block" }],
        disputeUrl: DISPUTE_URL,
      };
    }
    try {
      // Host name only: the path and query of resourceUrl never leave this process.
      const pre = await client.preflight(host);
      let facts = factsFrom(pre.body, host, "preflight");
      const extra: Reason[] = [];
      const threshold = options.paidCheckAtOrAboveUsd;
      // Uses BotsRated's free daily quota first; pays (within budget) only with a paid-enabled client.
      if (pre.found && threshold !== undefined && /^[0-9]+$/.test(String(req.amount)) && BigInt(req.amount) >= usdToAtomic(threshold)) {
        try {
          facts = factsFrom(await client.check(host), host, "check");
        } catch (e) {
          extra.push({ code: "paid_check_skipped", detail: cleanText((e as Error)?.message), effect: "info" });
        }
      }
      const d = evaluatePayment(facts, req, resourceUrl, options.policy);
      d.reasons.push(...extra);
      return d;
    } catch {
      return openOrClosed("botsrated_unreachable", "BotsRated's preflight could not be reached in time.", host);
    }
  }

  async function hookInner(ctx: BeforePaymentContextLike, requestUrl: string | undefined): Promise<Decision> {
    const url = ctx.paymentRequired.resource?.url;
    let d: Decision =
      !requestUrl && options.policy?.requireRequestUrl
        ? { action: "block", reasons: [{ code: "no_request_url", detail: "the URL being paid is unknown; wrap the request with guard.wrapFetch or payingRequest.", effect: "block" }], disputeUrl: DISPUTE_URL }
        : await decide(url, ctx.selectedRequirements, requestUrl);
    const paidUrl = requestUrl ?? url;
    if (d.action === "allow" && paidUrl && tryHostOf(paidUrl) === client.host) {
      // A BotsRated payment is a one-shot EIP-3009 transfer: refuse payment extensions (e.g. an ERC-20
      // approval of Permit2) and never hand any extensions to the signer. This only ever touches BotsRated's own quote.
      if (!extensionsOk(ctx.paymentRequired.extensions)) {
        d = { action: "block", host: d.host, reasons: [{ code: "botsrated_payment_extensions", detail: "BotsRated quotes must not carry payment extensions.", effect: "block" }], disputeUrl: DISPUTE_URL };
      } else {
        delete ctx.paymentRequired.extensions;
      }
    }
    return d;
  }

  async function hook(ctx: BeforePaymentContextLike, requestUrl: string | undefined): Promise<void | { abort: true; reason: string }> {
    let d: Decision;
    try {
      d = await hookInner(ctx, requestUrl);
    } catch {
      d = openOrClosed("hook_error", "the pre-payment check could not evaluate this payment.");
    }
    try {
      options.onDecision?.(d, ctx?.selectedRequirements);
    } catch {
      /* caller callback errors are ignored */
    }
    if (d.action === "block") return { abort: true, reason: formatDecision(d) };
    return undefined;
  }

  return {
    client,
    decide,
    beforePaymentCreation: (ctx) => hook(ctx, currentRequestUrl()),
    forRequest: (requestUrl) => (ctx) => hook(ctx, requestUrl),
    wrapFetch<F extends (input: any, init?: any) => Promise<Response>>(fetchWithPayment: F): F {
      return ((input: any, init?: any) => payingRequest(requestUrlOf(input), () => fetchWithPayment(input, init))) as F;
    },
  };
}

export interface McpPaymentApproverOptions {
  /**
   * Hosts (exact, after normalization) the 402 `resource.url` may name besides the MCP server's own host (and its
   * apex/www twin). Use for a server whose paid resources live on another host you trust. Default none.
   * Exact host names only: an entry containing `*` throws (`invalid_host`).
   */
  allowResourceHosts?: string[];
  /** What to do when `resource.url` names any other host. Default "block"; "warn" approves on the server's facts. */
  resourceUrlMismatch?: "block" | "warn";
  /** Receives every decision, including the mismatch warning. */
  onDecision?: (decision: Decision, req: PaymentRequirementsLike) => void;
}

/** `url` if it parses (after trimming) as an http(s) URL; the raw string if it only looks like one; else undefined. */
function httpResourceUrl(url: unknown): string | undefined {
  if (typeof url !== "string" || !url.trim()) return undefined;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    // Looks like http(s) but does not parse: keep it so the host comparison fails closed.
    return /^\s*https?:/i.test(url) ? url : undefined;
  }
}

/**
 * Adapter for `@x402/mcp`'s `onPaymentRequested` option. Approves a paid MCP tool call only if every offered payment
 * option passes the guard. `serverUrl` (the MCP server actually being paid) is the host looked up. By default an
 * http(s) `resource.url` in the 402 that names a different host (other than an apex/www twin) is refused; see
 * {@link McpPaymentApproverOptions} to allow specific hosts or only warn.
 */
export function mcpPaymentApprover(guard: PrePaymentGuard, serverUrl: string, options: McpPaymentApproverOptions = {}) {
  for (const h of options.allowResourceHosts ?? []) {
    if (typeof h !== "string" || h.includes("*")) {
      throw new BotsRatedError(`allowResourceHosts takes exact host names; wildcards are not supported: ${String(h)}`, "invalid_host");
    }
  }
  const allowed = new Set((options.allowResourceHosts ?? []).map((h) => hostOf(h)));
  return async (ctx: { paymentRequired: PaymentRequiredLike }): Promise<boolean> => {
    let resourceUrl = httpResourceUrl(ctx.paymentRequired.resource?.url);
    let note: Reason | undefined;
    if (resourceUrl) {
      let claimed: string | undefined;
      let paid: string | undefined;
      try {
        claimed = hostOf(resourceUrl);
        paid = hostOf(serverUrl);
      } catch {
        claimed = undefined;
      }
      if (claimed && paid && !sameSiteHost(claimed, paid)) {
        if (allowed.has(claimed)) {
          note = { code: "resource_host_allowed", detail: `resource.url host ${claimed} is in allowResourceHosts.`, effect: "info" };
          resourceUrl = undefined;
        } else if (options.resourceUrlMismatch === "warn") {
          note = {
            code: "resource_url_mismatch",
            detail: `the 402's resource.url names ${claimed}, not the MCP server ${paid}; allowed because resourceUrlMismatch is "warn".`,
            effect: "warn",
          };
          resourceUrl = undefined;
        }
      }
    }
    for (const req of ctx.paymentRequired.accepts ?? []) {
      const d = await guard.decide(resourceUrl, req, serverUrl);
      if (note) d.reasons.push(note);
      options.onDecision?.(d, req);
      if (d.action === "block") return false;
    }
    return true;
  };
}
