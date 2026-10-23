/**
 * @botsrated/x402-preflight
 *
 * Ask BotsRated (https://botsrated.com) about an x402 seller before paying it.
 * The default path only uses the free `GET /v1/preflight` route. Paid BotsRated
 * routes (`/v1/check` $0.001, `/v1/report/{host}` $0.002, `/v1/best` $0.01; first 100 checks + 10 reports per day free) are
 * off unless you pass `paid` with a budget and a payment-capable fetch.
 */

export const BOTSRATED_BASE_URL = "https://botsrated.com";
/** BotsRated's payTo on Base. Paid calls to any other payTo are refused. */
export const BOTSRATED_PAY_TO = "0x7F936f42F46B6c4Cbd3242cF8A1759dfe829E349";
export const BASE_MAINNET = "eip155:8453";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** Published prices of the paid routes (since 2026-10-23), in atomic USDC (6 decimals). Quotes above these are refused. */
export const PAID_ROUTE_MAX_ATOMIC = { check: 1000n, report: 2000n, best: 10000n } as const;
/** Free daily quota per client (IP) per UTC day. Within it BotsRated answers 200 with `charged: false` and no 402. */
export const FREE_DAILY_QUOTA = { check: 100, report: 10, best: 0 } as const;
export type PaidRoute = keyof typeof PAID_ROUTE_MAX_ATOMIC;
/** Longest payment authorization window accepted for a BotsRated payment. */
export const MAX_TIMEOUT_SECONDS = 600;
/** EIP-3009 needs only the token's EIP-712 name/version; any other `extra` key (e.g. assetTransferMethod=permit2) is refused. */
const ALLOWED_EXTRA = new Set(["name", "version"]);
/** Discovery metadata only. Payment extensions (erc20ApprovalGasSponsoring, eip2612GasSponsoring, ...) are refused. */
const IGNORED_EXTENSIONS = new Set(["bazaar"]);

/** True when a PaymentRequired `extensions` value carries nothing but discovery metadata. */
export function extensionsOk(extensions: unknown): boolean {
  if (extensions === undefined || extensions === null) return true;
  return typeof extensions === "object" && !Array.isArray(extensions) && Object.keys(extensions).every((k) => IGNORED_EXTENSIONS.has(k));
}

/** True when a payment option is a plain one-shot EIP-3009 payment: `extra` only name/version strings, timeout 1..600 s. */
function eip3009Only(req: PaymentRequirementsLike): boolean {
  const extra = req.extra ?? {};
  const timeout = req.maxTimeoutSeconds ?? MAX_TIMEOUT_SECONDS;
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

export interface PaidOptions {
  /** Total USD this client may spend on BotsRated paid routes. Required, > 0. */
  budgetUsd: number;
  /** A fetch that pays x402 challenges, e.g. `wrapFetchWithPayment(fetch, x402Client)` from `@x402/fetch`. */
  fetchWithPayment: FetchLike;
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

export class BotsRatedError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BotsRatedError";
  }
}

const USDC_DECIMALS = 6;

export function usdToAtomic(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) throw new BotsRatedError(`invalid USD amount: ${usd}`, "invalid_amount");
  return BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
}

export function atomicToUsd(atomic: bigint): number {
  return Number(atomic) / 10 ** USDC_DECIMALS;
}

/** Returns the lowercase host of a URL or bare host string. */
export function hostOf(urlOrHost: string): string {
  const s = urlOrHost.trim();
  try {
    return new URL(s.includes("://") ? s : `https://${s}`).hostname.toLowerCase();
  } catch {
    throw new BotsRatedError(`not a URL or host: ${urlOrHost}`, "invalid_host");
  }
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

/** Decodes the x402 v2 `PAYMENT-REQUIRED` header (base64 JSON), falling back to the JSON body. */
export async function readPaymentRequired(res: Response): Promise<PaymentRequiredLike> {
  const header = res.headers.get("payment-required");
  try {
    if (header) return JSON.parse(atob(header)) as PaymentRequiredLike;
    return (await res.json()) as PaymentRequiredLike;
  } catch {
    throw new BotsRatedError("could not parse the 402 payment terms", "bad_402");
  }
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
    if (options.paid) this.budget = new Budget(usdToAtomic(options.paid.budgetUsd));
  }

  get paidEnabled(): boolean {
    return !!this.options.paid;
  }

  get host(): string {
    return hostOf(this.baseUrl);
  }

  /** Free. Latest stored probe for a seller. `found: false` when BotsRated does not cover the host. */
  async preflight(urlOrHost: string): Promise<PreflightResult> {
    const host = hostOf(urlOrHost);
    const hit = this.cache.get(host);
    if (hit && Date.now() - hit.at < this.cacheTtlMs) return hit.value;
    const target = urlOrHost.includes("://") ? urlOrHost : host;
    const res = await this.get(`/v1/preflight?url=${encodeURIComponent(target)}`);
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    let value: PreflightResult;
    if (res.status === 404 && body?.error?.code === "host_not_covered") {
      value = { found: false, host, body: { ...body, found: false } };
    } else if (!res.ok) {
      throw new BotsRatedError(body?.error?.message ?? `preflight returned ${res.status}`, body?.error?.code ?? "http_error", res.status);
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
    const payTo = this.options.paid?.expectedPayTo ?? BOTSRATED_PAY_TO;
    return (
      !!req &&
      typeof req === "object" &&
      eip3009Only(req) &&
      req.scheme === "exact" &&
      req.network === BASE_MAINNET &&
      eq(req.asset, BASE_USDC) &&
      eq(req.payTo, payTo) &&
      /^\d+$/.test(req.amount) &&
      BigInt(req.amount) <= max
    );
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
        quote.status === 402
          ? "free daily quota used up and paid BotsRated routes are disabled; pass `paid: { budgetUsd, fetchWithPayment }`"
          : "paid BotsRated routes are disabled; pass `paid: { budgetUsd, fetchWithPayment }`",
        "paid_disabled",
        quote.status,
      );
    }
    if (quote.status !== 402) {
      const body = (await quote.json().catch(() => ({}))) as Record<string, any>;
      throw new BotsRatedError(body?.error?.message ?? `expected 402, got ${quote.status}`, body?.error?.code ?? "unexpected_status", quote.status);
    }
    const terms = await readPaymentRequired(quote);
    const accepts = terms.accepts;
    // Fail closed: the payment client re-reads the 402 and picks an option itself, so every option must be acceptable.
    if (
      terms?.x402Version !== 2 ||
      !extensionsOk(terms.extensions) ||
      !Array.isArray(accepts) ||
      accepts.length === 0 ||
      !accepts.every((a) => this.acceptable(a, PAID_ROUTE_MAX_ATOMIC[route]))
    ) {
      throw new BotsRatedError(
        "every payment option must be exact EIP-3009 Base USDC to BotsRated at or below the published price, with no payment extensions",
        "terms_rejected",
      );
    }
    const amount = accepts.reduce((m, a) => (BigInt(a.amount) > m ? BigInt(a.amount) : m), 0n);
    this.budget.reserve(amount);
    let res: Response;
    try {
      res = await paid.fetchWithPayment(this.baseUrl + path, { headers: { accept: "application/json" }, redirect: "manual" });
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
      return await this.fetchFn(this.baseUrl + path, { headers: { accept: "application/json" }, signal: ctrl.signal });
    } catch (e) {
      throw new BotsRatedError(`BotsRated unreachable: ${(e as Error).message}`, "unreachable");
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
  /** payTo being paid differs from every payTo BotsRated has seen for the host (same network). Default "block". */
  payToMismatch?: "allow" | "warn" | "block";
  /** Same route, quoted amount above the last amount BotsRated observed. Default "warn". */
  priceAboveObserved?: "allow" | "warn" | "block";
  /** BotsRated data older than 24 h. Default "allow". */
  stale?: "allow" | "block";
  /** Block when the recent valid-402 rate is below this (only with >= 3 recent probes). Off by default. */
  minValid402Rate?: number;
}

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
}

const DEFAULT_POLICY: Required<Omit<GuardPolicy, "minValid402Rate">> = {
  notCovered: "allow",
  payToMismatch: "block",
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

/** Pure policy check of one payment against BotsRated facts. */
export function evaluatePayment(facts: SellerFacts, req: PaymentRequirementsLike, resourceUrl: string | undefined, policy: GuardPolicy = {}): Decision {
  const p = { ...DEFAULT_POLICY, ...policy };
  const reasons: Reason[] = [];
  const add = (code: string, detail: string, effect: "allow" | "warn" | "block" | "info") => {
    if (effect !== "allow") reasons.push({ code, detail, effect });
  };

  if (!facts.covered) {
    add("not_covered", `${facts.host} is not in BotsRated's probe set`, p.notCovered === "block" ? "block" : "info");
  } else {
    if (facts.observedNetwork && facts.observedNetwork !== req.network) {
      add("network_not_measured", `paying on ${req.network}; BotsRated measured ${facts.observedNetwork}`, "info");
    } else if (facts.knownPayTos.length > 0 && !facts.knownPayTos.includes(req.payTo.toLowerCase())) {
      add("payto_mismatch", `payTo ${req.payTo} was never seen by BotsRated for ${facts.host} (seen: ${facts.knownPayTos.join(", ")})`, p.payToMismatch);
    } else if (facts.knownPayTos.length === 0 && facts.listingPayTo) {
      if (req.payTo.toLowerCase() === facts.listingPayTo) {
        add("payto_listing_only", `payTo ${req.payTo} matches ${facts.host}'s listing but no BotsRated probe has observed it yet`, "info");
      } else {
        add("payto_mismatch", `payTo ${req.payTo} differs from ${facts.host}'s listing (${facts.listingPayTo})`, p.payToMismatch);
      }
    }
    if (facts.observedAmount && /^\d+$/.test(facts.observedAmount) && sameRoute(resourceUrl, facts.probedUrl) && BigInt(req.amount) > BigInt(facts.observedAmount)) {
      add("price_above_observed", `quoted ${req.amount} atomic; BotsRated last observed ${facts.observedAmount} on this route`, p.priceAboveObserved);
    }
    if (facts.stale) add("stale", `BotsRated data is older than 24 h (last probe ${facts.lastProbeAt})`, p.stale === "block" ? "block" : "info");
    if (p.minValid402Rate !== undefined && facts.valid402Rate !== undefined && (facts.recentProbes ?? 0) >= 3 && facts.valid402Rate < p.minValid402Rate) {
      add("low_valid_402_rate", `recent valid-402 rate ${facts.valid402Rate} is below ${p.minValid402Rate}`, "block");
    }
  }
  return { action: reasons.some((r) => r.effect === "block") ? "block" : "allow", host: facts.host, reasons, facts };
}

export interface GuardOptions {
  /** Reuse a client (needed for paid checks). Defaults to a free-only client. */
  client?: BotsRatedClient;
  policy?: GuardPolicy;
  /** Allow the payment when BotsRated cannot be reached. Default true. */
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

export interface PrePaymentGuard {
  client: BotsRatedClient;
  /** Decide on one payment. Never throws when `failOpen` is true. */
  decide(resourceUrl: string | undefined, req: PaymentRequirementsLike): Promise<Decision>;
  /** Register with `x402Client.onBeforePaymentCreation(guard.beforePaymentCreation)`. */
  beforePaymentCreation(ctx: BeforePaymentContextLike): Promise<void | { abort: true; reason: string }>;
}

export function formatDecision(d: Decision): string {
  const blocking = d.reasons.filter((r) => r.effect === "block");
  const list = (blocking.length ? blocking : d.reasons).map((r) => `${r.code}: ${r.detail}`).join("; ");
  const receipt = d.facts?.receiptUrl ? ` (receipt: ${d.facts.receiptUrl})` : "";
  return `BotsRated pre-payment check ${d.action === "block" ? "blocked" : "allowed"} ${d.host ?? "payment"}${list ? ` - ${list}` : ""}${receipt}`;
}

export function createPrePaymentGuard(options: GuardOptions = {}): PrePaymentGuard {
  const client = options.client ?? new BotsRatedClient();
  const failOpen = options.failOpen ?? true;

  async function decide(resourceUrl: string | undefined, req: PaymentRequirementsLike): Promise<Decision> {
    if (!resourceUrl) {
      return { action: failOpen ? "allow" : "block", reasons: [{ code: "no_resource_url", detail: "payment has no resource URL to look up", effect: failOpen ? "info" : "block" }] };
    }
    const host = hostOf(resourceUrl);
    // Payments to BotsRated itself: only the client's own budgeted calls.
    if (host === client.host) {
      const ok = client.isReservedBotsRatedPayment(req);
      return {
        action: ok ? "allow" : "block",
        host,
        reasons: ok ? [] : [{ code: "botsrated_payment_not_reserved", detail: "payments to BotsRated must go through BotsRatedClient with a budget", effect: "block" }],
      };
    }
    try {
      const pre = await client.preflight(resourceUrl);
      let facts = factsFrom(pre.body, host, "preflight");
      const extra: Reason[] = [];
      const threshold = options.paidCheckAtOrAboveUsd;
      // Uses BotsRated's free daily quota first; pays (within budget) only with a paid-enabled client.
      if (pre.found && threshold !== undefined && BigInt(req.amount) >= usdToAtomic(threshold)) {
        try {
          facts = factsFrom(await client.check(host), host, "check");
        } catch (e) {
          extra.push({ code: "paid_check_skipped", detail: (e as Error).message, effect: "info" });
        }
      }
      const d = evaluatePayment(facts, req, resourceUrl, options.policy);
      d.reasons.push(...extra);
      return d;
    } catch (e) {
      return {
        action: failOpen ? "allow" : "block",
        host,
        reasons: [{ code: "botsrated_unavailable", detail: (e as Error).message, effect: failOpen ? "info" : "block" }],
      };
    }
  }

  return {
    client,
    decide,
    async beforePaymentCreation(ctx) {
      const url = ctx.paymentRequired.resource?.url;
      let d = await decide(url, ctx.selectedRequirements);
      if (d.action === "allow" && url && hostOf(url) === client.host) {
        // A BotsRated payment is a one-shot EIP-3009 transfer: refuse payment extensions (e.g. an ERC-20
        // approval of Permit2) and never hand any extensions to the signer.
        if (!extensionsOk(ctx.paymentRequired.extensions)) {
          d = { action: "block", host: d.host, reasons: [{ code: "botsrated_payment_extensions", detail: "BotsRated quotes must not carry payment extensions", effect: "block" }] };
        } else {
          delete ctx.paymentRequired.extensions;
        }
      }
      options.onDecision?.(d, ctx.selectedRequirements);
      if (d.action === "block") return { abort: true, reason: formatDecision(d) };
    },
  };
}

/**
 * Adapter for `@x402/mcp`'s `onPaymentRequested` option. Approves a paid MCP tool call only if
 * every offered payment option passes the guard. `serverUrl` is used when the 402 has no http(s) resource URL.
 */
export function mcpPaymentApprover(guard: PrePaymentGuard, serverUrl: string) {
  return async (ctx: { paymentRequired: PaymentRequiredLike }): Promise<boolean> => {
    const url = ctx.paymentRequired.resource?.url;
    const resourceUrl = url && /^https?:\/\//i.test(url) ? url : serverUrl;
    for (const req of ctx.paymentRequired.accepts ?? []) {
      if ((await guard.decide(resourceUrl, req)).action === "block") return false;
    }
    return true;
  };
}
