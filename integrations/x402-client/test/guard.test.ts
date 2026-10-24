import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  BASE_MAINNET,
  BASE_USDC,
  BOTSRATED_PAY_TO,
  BotsRatedClient,
  Budget,
  createPrePaymentGuard,
  evaluatePayment,
  factsFrom,
  hostOf,
  currentRequestUrl,
  mcpPaymentApprover,
  payingRequest,
  usdToAtomic,
} from "../src/index";

const fx = (name: string) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8");
const FOUND = JSON.parse(fx("preflight-found.json"));
const NOT_COVERED = fx("preflight-not-covered.json");
const CHECK_402_B64 = fx("check-402-payment-required.b64").trim();
const SAMPLE_CHECK = fx("sample-check.json");
const FREE_CHECK = fx("check-free-quota.json"); // real 200 served from the free daily quota (charged: false)

const SELLER_URL = FOUND.latest_probe.url as string; // https://blockrun.ai/api/v1/chat/completions
const SELLER_PAYTO = FOUND.latest_probe.live_payTo as string;
const req = (over: Partial<{ payTo: string; amount: string; network: string }> = {}) => ({
  scheme: "exact",
  network: BASE_MAINNET,
  asset: BASE_USDC,
  payTo: SELLER_PAYTO,
  amount: FOUND.latest_probe.live_amount as string,
  ...over,
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function botsratedFetch() {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname === "/v1/preflight") {
      return u.searchParams.get("url")!.includes("blockrun.ai") ? json(FOUND) : json(NOT_COVERED, 404);
    }
    if (u.pathname === "/v1/check") return json({ x402Version: 2 }, 402, { "payment-required": CHECK_402_B64 });
    return json({}, 404);
  });
}

describe("hostOf", () => {
  it("accepts URLs and bare hosts", () => {
    expect(hostOf("https://Blockrun.ai/api/x?y=1")).toBe("blockrun.ai");
    expect(hostOf("blockrun.ai")).toBe("blockrun.ai");
  });
});

describe("evaluatePayment (real preflight fixture)", () => {
  const facts = factsFrom(FOUND, "blockrun.ai", "preflight");

  it("allows a payment that matches what BotsRated observed", () => {
    expect(evaluatePayment(facts, req(), SELLER_URL).action).toBe("allow");
  });

  it("blocks an unseen payTo by default", () => {
    const d = evaluatePayment(facts, req({ payTo: "0x000000000000000000000000000000000000dEaD" }), SELLER_URL);
    expect(d.action).toBe("block");
    expect(d.reasons.map((r) => r.code)).toContain("payto_mismatch");
  });

  it("payTo mismatch can be downgraded to a warning", () => {
    const d = evaluatePayment(facts, req({ payTo: "0x000000000000000000000000000000000000dEaD" }), SELLER_URL, { payToMismatch: "warn" });
    expect(d.action).toBe("allow");
    expect(d.reasons[0].effect).toBe("warn");
  });

  it("only compares payTo on the measured network", () => {
    const d = evaluatePayment(facts, req({ network: "eip155:84532", payTo: "0x000000000000000000000000000000000000dEaD" }), SELLER_URL);
    expect(d.action).toBe("allow");
    expect(d.reasons[0].code).toBe("network_not_measured");
  });

  it("warns (not blocks) on a price above the observed price for the same route", () => {
    const d = evaluatePayment(facts, req({ amount: "999999" }), SELLER_URL);
    expect(d.action).toBe("allow");
    expect(d.reasons.map((r) => r.code)).toContain("price_above_observed");
    expect(evaluatePayment(facts, req({ amount: "999999" }), SELLER_URL, { priceAboveObserved: "block" }).action).toBe("block");
  });

  it("does not compare prices across different routes of the same host", () => {
    const d = evaluatePayment(facts, req({ amount: "999999" }), "https://blockrun.ai/api/v1/images/generate");
    expect(d.reasons.map((r) => r.code)).not.toContain("price_above_observed");
  });

  it("minValid402Rate needs at least 3 recent probes", () => {
    const low = { ...facts, valid402Rate: 0.2, recentProbes: 5 };
    expect(evaluatePayment(low, req(), SELLER_URL, { minValid402Rate: 0.9 }).action).toBe("block");
    expect(evaluatePayment({ ...low, recentProbes: 2 }, req(), SELLER_URL, { minValid402Rate: 0.9 }).action).toBe("allow");
  });

  it("not covered: allow by default, block on request", () => {
    const nc = factsFrom({ found: false }, "x.example", "preflight");
    expect(evaluatePayment(nc, req(), "https://x.example/a").action).toBe("allow");
    expect(evaluatePayment(nc, req(), "https://x.example/a", { notCovered: "block" }).action).toBe("block");
  });
});

describe("createPrePaymentGuard", () => {
  const ctx = (url: string, r = req()) => ({ paymentRequired: { x402Version: 2, resource: { url }, accepts: [r] }, selectedRequirements: r });

  it("uses only the free preflight by default", async () => {
    const f = botsratedFetch();
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: f }) });
    expect(await guard.beforePaymentCreation(ctx(SELLER_URL))).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toContain("/v1/preflight?url=");
  });

  it("aborts with a readable reason on a payTo mismatch", async () => {
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: botsratedFetch() }) });
    const out = await guard.beforePaymentCreation(ctx(SELLER_URL, req({ payTo: "0x000000000000000000000000000000000000dEaD" })));
    expect(out).toMatchObject({ abort: true });
    expect((out as { reason: string }).reason).toMatch(/payto_mismatch.*receipt: https:\/\/botsrated\.com\/receipt\//);
  });

  it("allows uncovered hosts by default and blocks them on request", async () => {
    const f = botsratedFetch();
    const r = req();
    const open = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: f }) });
    expect(await open.beforePaymentCreation(ctx("https://x.example/a", r))).toBeUndefined();
    const strict = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: f }), policy: { notCovered: "block" } });
    expect(await strict.beforePaymentCreation(ctx("https://x.example/a", r))).toMatchObject({ abort: true });
  });

  it("caches preflight per host", async () => {
    const f = botsratedFetch();
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: f }) });
    await guard.beforePaymentCreation(ctx(SELLER_URL));
    await guard.beforePaymentCreation(ctx("https://blockrun.ai/other"));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("fails open when BotsRated is unreachable, closed if configured", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const open = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: down }) });
    expect(await open.beforePaymentCreation(ctx(SELLER_URL))).toBeUndefined();
    const closed = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: down }), failOpen: false });
    expect(await closed.beforePaymentCreation(ctx(SELLER_URL))).toMatchObject({ abort: true });
  });

  it("blocks payments to BotsRated that were not reserved by the client", async () => {
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: botsratedFetch() }) });
    const r = { ...req(), payTo: BOTSRATED_PAY_TO, amount: "2000" };
    expect(await guard.beforePaymentCreation(ctx("https://botsrated.com/v1/check?host=blockrun.ai", r))).toMatchObject({ abort: true });
  });

  it("mcpPaymentApprover rejects when any option is blocked", async () => {
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: botsratedFetch() }) });
    const approve = mcpPaymentApprover(guard, "https://blockrun.ai/mcp");
    expect(await approve({ paymentRequired: { x402Version: 2, resource: { url: "mcp://tool/x" }, accepts: [req()] } })).toBe(true);
    expect(await approve({ paymentRequired: { x402Version: 2, accepts: [req(), req({ payTo: "0x000000000000000000000000000000000000dEaD" })] } })).toBe(false);
  });
});

describe("paid routes (opt-in, budgeted)", () => {
  it("are disabled unless configured", async () => {
    const c = new BotsRatedClient({ fetch: botsratedFetch() });
    await expect(c.check("blockrun.ai")).rejects.toMatchObject({ code: "paid_disabled" });
  });

  it("validates the quote, pays once, and charges the budget", async () => {
    const pay = vi.fn(async () => json(SAMPLE_CHECK));
    const c = new BotsRatedClient({ fetch: botsratedFetch(), paid: { budgetUsd: 0.005, fetchWithPayment: pay } });
    const out = await c.check("https://blockrun.ai/api/v1/chat/completions");
    expect(out.host).toBe("blockrun.ai");
    expect(pay).toHaveBeenCalledOnce();
    expect(c.budget!.spentAtomic).toBe(1000n);
    expect(c.budget!.remainingAtomic).toBe(4000n);
  });

  it("refuses before paying when the budget is too small", async () => {
    const pay = vi.fn();
    const c = new BotsRatedClient({ fetch: botsratedFetch(), paid: { budgetUsd: 0.0005, fetchWithPayment: pay } });
    await expect(c.check("blockrun.ai")).rejects.toMatchObject({ code: "budget_exceeded" });
    expect(pay).not.toHaveBeenCalled();
  });

  it("refuses a quote with a different payTo", async () => {
    const pay = vi.fn();
    const c = new BotsRatedClient({ fetch: botsratedFetch(), paid: { budgetUsd: 1, fetchWithPayment: pay, expectedPayTo: "0x000000000000000000000000000000000000dEaD" } });
    await expect(c.check("blockrun.ai")).rejects.toMatchObject({ code: "terms_rejected" });
    expect(pay).not.toHaveBeenCalled();
  });

  it("keeps the amount counted when the paid call fails (it may have settled)", async () => {
    const pay = vi.fn(async () => json({}, 500));
    const c = new BotsRatedClient({ fetch: botsratedFetch(), paid: { budgetUsd: 0.001, fetchWithPayment: pay } });
    await expect(c.check("blockrun.ai")).rejects.toMatchObject({ code: "paid_call_failed" });
    expect(c.budget!.spentAtomic).toBe(1000n);
    expect(c.budget!.remainingAtomic).toBe(0n);
    await expect(c.check("blockrun.ai")).rejects.toMatchObject({ code: "budget_exceeded" });
    expect(pay).toHaveBeenCalledTimes(1);
    expect((pay.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({ redirect: "manual" });
  });

  it("refuses a quote that also offers any other payment option", async () => {
    const terms = JSON.parse(atob(CHECK_402_B64));
    const good = terms.accepts[0];
    terms.accepts = [{ ...good, amount: "500000", payTo: "0x000000000000000000000000000000000000dEaD" }, good];
    const f = async (u: string | URL | Request) =>
      String(u).includes("/v1/check") ? json({}, 402, { "payment-required": btoa(JSON.stringify(terms)) }) : botsratedFetch()(String(u));
    const pay = vi.fn();
    const c = new BotsRatedClient({ fetch: f as typeof fetch, paid: { budgetUsd: 1, fetchWithPayment: pay } });
    await expect(c.check("blockrun.ai")).rejects.toMatchObject({ code: "terms_rejected" });
    expect(pay).not.toHaveBeenCalled();
  });

  it("does not treat a listing-only payTo as observed", () => {
    const listed = "0x1111111111111111111111111111111111111111";
    const facts = factsFrom({ ...FOUND, listing: { ...(FOUND.listing ?? {}), payTo: listed } }, "blockrun.ai", "preflight");
    expect(facts.knownPayTos).not.toContain(listed);
    expect(evaluatePayment(facts, req({ payTo: listed }), SELLER_URL).action).toBe("block");
    const noProbe = factsFrom({ ...FOUND, latest_probe: null, measured: {}, listing: { payTo: listed } }, "blockrun.ai", "preflight");
    const d = evaluatePayment(noProbe, req({ payTo: listed }), SELLER_URL);
    expect(d.action).toBe("allow");
    expect(d.reasons[0].code).toBe("payto_listing_only");
  });

  it("the guard lets the client's own reserved payment through", async () => {
    let client!: BotsRatedClient;
    const r = { scheme: "exact", network: BASE_MAINNET, asset: BASE_USDC, payTo: BOTSRATED_PAY_TO, amount: "1000" };
    const pay = vi.fn(async () => {
      const verdict = await guard.beforePaymentCreation({ paymentRequired: { x402Version: 2, resource: { url: "https://botsrated.com/v1/check?host=blockrun.ai" }, accepts: [r] }, selectedRequirements: r });
      return verdict ? json({}, 402) : json(SAMPLE_CHECK);
    });
    client = new BotsRatedClient({ fetch: botsratedFetch(), paid: { budgetUsd: 0.01, fetchWithPayment: pay } });
    const guard = createPrePaymentGuard({ client, paidCheckAtOrAboveUsd: 0.5 });
    // Seller payment of $1 triggers the paid check, which passes the guard's BotsRated branch.
    const d = await guard.decide(SELLER_URL, req({ amount: "1000000" }));
    expect(d.facts?.source).toBe("check");
    expect(client.budget!.spentAtomic).toBe(1000n);
  });

  it("uses a free-quota answer without paying or touching the budget (also without `paid`)", async () => {
    const f = vi.fn(async (url: string) => (new URL(url).pathname === "/v1/check" ? json(FREE_CHECK) : botsratedFetch()(url)));
    const pay = vi.fn();
    const c = new BotsRatedClient({ fetch: f, paid: { budgetUsd: 0.005, fetchWithPayment: pay } });
    const out = await c.check("www.ax1.vc");
    expect(out.charged).toBe(false);
    expect(out.free_quota.limit).toBe(100);
    expect(pay).not.toHaveBeenCalled();
    expect(c.budget!.spentAtomic).toBe(0n);
    expect(c.budget!.remainingAtomic).toBe(5000n);
    expect(c.lastFreeQuota?.remaining).toBe(out.free_quota.remaining);
    const free = new BotsRatedClient({ fetch: f });
    expect((await free.check("www.ax1.vc")).charged).toBe(false);
  });

  it("keeps the amount counted when the paid attempt returns a free-quota body (the payer may have signed)", async () => {
    const pay = vi.fn(async () => json(FREE_CHECK));
    const c = new BotsRatedClient({ fetch: botsratedFetch(), paid: { budgetUsd: 0.005, fetchWithPayment: pay } });
    expect((await c.check("blockrun.ai")).charged).toBe(false);
    expect(c.budget!.spentAtomic).toBe(1000n);
    expect(c.budget!.pendingAtomic).toBe(0n);
  });

  it("says the free quota is used up when unpaid and the route returns 402", async () => {
    const c = new BotsRatedClient({ fetch: botsratedFetch() });
    await expect(c.check("blockrun.ai")).rejects.toThrow(/free daily quota used up/);
  });

  it("refuses a check quote above the new published price (1000 atomic)", async () => {
    const terms = JSON.parse(atob(CHECK_402_B64));
    terms.accepts = terms.accepts.map((a: any) => ({ ...a, amount: "2000" }));
    const f = vi.fn(async () => json({}, 402, { "payment-required": btoa(JSON.stringify(terms)) }));
    const pay = vi.fn();
    const c = new BotsRatedClient({ fetch: f, paid: { budgetUsd: 1, fetchWithPayment: pay } });
    await expect(c.check("blockrun.ai")).rejects.toMatchObject({ code: "terms_rejected" });
    expect(pay).not.toHaveBeenCalled();
  });

  it("the guard's check uses the free quota even without a paid-enabled client", async () => {
    const f = vi.fn(async (url: string) => (new URL(url).pathname === "/v1/check" ? json(FREE_CHECK) : botsratedFetch()(url)));
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: f }), paidCheckAtOrAboveUsd: 0.5 });
    const d = await guard.decide(SELLER_URL, req({ amount: "1000000" }));
    expect(d.facts?.source).toBe("check");
  });

  it("Budget rejects non-positive limits and usdToAtomic rounds to 6 decimals", () => {
    expect(() => new Budget(0n)).toThrow();
    expect(usdToAtomic(0.002)).toBe(2000n);
  });
});

describe("paid quote hardening (Permit2 / payment extensions)", () => {
  const base = () => JSON.parse(atob(CHECK_402_B64));
  const cases: Array<[string, (t: any) => void]> = [
    ["permit2 extra", (t) => (t.accepts[0].extra = { ...t.accepts[0].extra, assetTransferMethod: "permit2" })],
    ["paymentFlow extra", (t) => (t.accepts[0].extra = { ...t.accepts[0].extra, paymentFlow: "x" })],
    ["approval extension", (t) => (t.extensions = { ...(t.extensions ?? {}), erc20ApprovalGasSponsoring: {} })],
    ["eip2612 extension", (t) => (t.extensions = { eip2612GasSponsoring: {} })],
    ["long timeout", (t) => (t.accepts[0].maxTimeoutSeconds = 86400)],
    ["string timeout", (t) => (t.accepts[0].maxTimeoutSeconds = "300")],
    ["x402 v1", (t) => (t.x402Version = 1)],
  ];
  it.each(cases)("refuses a quote with %s before paying", async (_n, mutate) => {
    const terms = base();
    mutate(terms);
    const f = async (u: string | URL | Request) =>
      String(u).includes("/v1/check") ? json({}, 402, { "payment-required": btoa(JSON.stringify(terms)) }) : botsratedFetch()(String(u));
    const pay = vi.fn();
    const c = new BotsRatedClient({ fetch: f as typeof fetch, paid: { budgetUsd: 1, fetchWithPayment: pay } });
    await expect(c.check("blockrun.ai")).rejects.toMatchObject({ code: "terms_rejected" });
    expect(pay).not.toHaveBeenCalled();
    expect(c.budget!.pendingAtomic + c.budget!.spentAtomic).toBe(0n);
  });

  it("accepts BotsRated's real 402 (EIP-3009 extra, bazaar discovery extension)", async () => {
    const t = base();
    expect(Object.keys(t.extensions ?? {})).toEqual(["bazaar"]);
    const pay = vi.fn(async () => json(SAMPLE_CHECK));
    const c = new BotsRatedClient({ fetch: botsratedFetch(), paid: { budgetUsd: 0.01, fetchWithPayment: pay } });
    expect((await c.check("blockrun.ai")).host).toBe("blockrun.ai");
  });
});

describe("request URL vs the seller's resource.url", () => {
  const ctx = (url: string, r = req()) => ({ paymentRequired: { x402Version: 2, resource: { url }, accepts: [r] }, selectedRequirements: r });
  const EVIL = "https://evil.example/pay";

  it("decide() blocks a resource.url naming another host, even with failOpen", async () => {
    const f = botsratedFetch();
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: f }) });
    const d = await guard.decide(SELLER_URL, req(), EVIL);
    expect(d).toMatchObject({ action: "block", host: "evil.example", reasons: [{ code: "resource_url_mismatch" }] });
    expect(f).not.toHaveBeenCalled();
    expect((await guard.decide(SELLER_URL, req(), SELLER_URL)).action).toBe("allow");
    expect((await guard.decide(undefined, req(), SELLER_URL)).action).toBe("allow");
    expect((await guard.decide("https://botsrated.com/v1/check?host=x", req(), EVIL)).reasons[0].code).toBe("resource_url_mismatch");
  });

  it("decide() looks up the request URL's host", async () => {
    const f = botsratedFetch();
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: f }) });
    const d = await guard.decide(undefined, req(), "https://other.example/x");
    expect(d.host).toBe("other.example");
    expect(String(f.mock.calls[0][0])).toContain("other.example");
  });

  it("wrapFetch / payingRequest / forRequest give beforePaymentCreation the URL being paid", async () => {
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: botsratedFetch() }) });
    const paying = guard.wrapFetch(async (input: string | URL) => {
      const out = await guard.beforePaymentCreation(ctx(SELLER_URL));
      return json({ out: out ?? null, seen: currentRequestUrl() ?? null });
    });
    const evil = await (await paying(EVIL)).json();
    expect(evil.seen).toBe(EVIL);
    expect(evil.out).toMatchObject({ abort: true });
    expect(evil.out.reason).toMatch(/resource_url_mismatch/);
    const good = await (await paying(new URL(SELLER_URL))).json();
    expect(good).toEqual({ out: null, seen: SELLER_URL });
    expect(currentRequestUrl()).toBeUndefined();
    expect(await payingRequest(EVIL, () => guard.beforePaymentCreation(ctx(SELLER_URL)))).toMatchObject({ abort: true });
    expect(await guard.forRequest(EVIL)(ctx(SELLER_URL))).toMatchObject({ abort: true });
    expect(await guard.forRequest(SELLER_URL)(ctx(SELLER_URL))).toBeUndefined();
  });

  it("keeps concurrent requests apart", async () => {
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: botsratedFetch() }) });
    const tick = () => new Promise((r) => setTimeout(r, 5));
    const [a, b] = await Promise.all([
      payingRequest(EVIL, async () => (await tick(), guard.beforePaymentCreation(ctx(SELLER_URL)))),
      payingRequest(SELLER_URL, async () => (await tick(), guard.beforePaymentCreation(ctx(SELLER_URL)))),
    ]);
    expect(a).toMatchObject({ abort: true });
    expect(b).toBeUndefined();
  });

  it("without a request URL keeps the old behavior unless requireRequestUrl is set", async () => {
    const f = botsratedFetch();
    expect(await createPrePaymentGuard({ client: new BotsRatedClient({ fetch: f }) }).beforePaymentCreation(ctx(SELLER_URL))).toBeUndefined();
    const strict = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: f }), policy: { requireRequestUrl: true } });
    expect(await strict.beforePaymentCreation(ctx(SELLER_URL))).toMatchObject({ abort: true, reason: expect.stringMatching(/no_request_url/) });
    expect(await payingRequest(SELLER_URL, () => strict.beforePaymentCreation(ctx(SELLER_URL)))).toBeUndefined();
  });

  it("mcpPaymentApprover looks up the server URL and refuses a resource.url on another host", async () => {
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: botsratedFetch() }) });
    const approve = mcpPaymentApprover(guard, "https://evil.example/mcp");
    expect(await approve({ paymentRequired: { x402Version: 2, resource: { url: SELLER_URL }, accepts: [req()] } })).toBe(false);
    const ok = mcpPaymentApprover(guard, "https://blockrun.ai/mcp");
    expect(await ok({ paymentRequired: { x402Version: 2, resource: { url: SELLER_URL }, accepts: [req()] } })).toBe(true);
  });

  it("paid routes through fetchWithPayment run inside payingRequest", async () => {
    let seen: string | undefined;
    const c = new BotsRatedClient({
      fetch: botsratedFetch(),
      paid: {
        budgetUsd: 0.01,
        fetchWithPayment: async () => {
          seen = currentRequestUrl();
          return json(JSON.parse(SAMPLE_CHECK));
        },
      },
    });
    await c.check("blockrun.ai");
    expect(seen).toBe("https://botsrated.com/v1/check?host=blockrun.ai");
  });

  it("refuses non-ASCII digit amounts", () => {
    const c = new BotsRatedClient({ fetch: botsratedFetch(), paid: { budgetUsd: 1, fetchWithPayment: async () => json({}) } });
    const terms = JSON.parse(atob(CHECK_402_B64));
    expect(c.signableTerms(terms)).toBeDefined();
    terms.accepts[0].amount = "\u0661\u0660\u0660\u0660";
    expect(c.signableTerms(terms)).toBeUndefined();
  });
});

describe("security follow-ups (0.1.4)", () => {
  const ctx = (url: string, r = req()) => ({ paymentRequired: { x402Version: 2, resource: { url }, accepts: [r] }, selectedRequirements: r });
  const pr = (url: string | undefined, accepts = [req()]) => ({ paymentRequired: { x402Version: 2, resource: url === undefined ? undefined : { url }, accepts } });

  it("hostOf normalizes IDNA, case, trailing dots and scheme-without-slashes", () => {
    expect(hostOf("https://Bücher.Example./x")).toBe("xn--bcher-kva.example");
    expect(hostOf("blockrun.ai.")).toBe("blockrun.ai");
    expect(hostOf("https:evil.example")).toBe("evil.example");
    expect(hostOf("  https://evil.example/x")).toBe("evil.example");
    expect(() => hostOf("https://")).toThrow();
  });

  it("tolerates only an apex <-> www difference between request and resource.url", async () => {
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: botsratedFetch() }) });
    expect((await guard.decide("https://www.blockrun.ai/api/v1/chat/completions", req(), SELLER_URL)).action).toBe("allow");
    expect((await guard.decide(SELLER_URL, req(), "https://www.blockrun.ai/api/v1/chat/completions")).action).toBe("allow");
    expect((await guard.decide("https://BLOCKRUN.AI./x", req(), SELLER_URL)).action).toBe("allow");
    for (const other of ["https://api.blockrun.ai/x", "https://wwwblockrun.ai/x", "https://www.www.blockrun.ai/x", "https:evil.example", "  https://evil.example"]) {
      const d = await guard.decide(other, req(), SELLER_URL);
      expect(d.reasons[0]?.code, other).toBe("resource_url_mismatch");
    }
    // wrapFetch after an apex -> www redirect: the 402 names www.blockrun.ai.
    const paying = guard.wrapFetch(async () => json({ out: (await guard.beforePaymentCreation(ctx("https://www.blockrun.ai/api/v1/chat/completions"))) ?? null }));
    expect((await (await paying(SELLER_URL)).json()).out).toBeNull();
  });

  it("mcpPaymentApprover: odd resource.url spellings cannot skip the host comparison", async () => {
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: botsratedFetch() }) });
    const approve = mcpPaymentApprover(guard, "https://blockrun.ai/mcp");
    for (const u of ["  https://evil.example/x", "https:evil.example", "HTTPS://evil.example", "https://exa mple.com/"]) {
      expect(await approve(pr(u)), u).toBe(false);
    }
    expect(await approve(pr("mcp://tool/x"))).toBe(true);
    expect(await approve(pr(undefined))).toBe(true);
    expect(await approve(pr("https://www.blockrun.ai/x"))).toBe(true);
  });

  it("mcpPaymentApprover: strict by default, allowResourceHosts and resourceUrlMismatch: warn", async () => {
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: botsratedFetch() }) });
    const strict = mcpPaymentApprover(guard, "https://blockrun.ai/mcp");
    expect(await strict(pr("https://api.example/x"))).toBe(false);

    const seen: string[] = [];
    const allow = mcpPaymentApprover(guard, "https://blockrun.ai/mcp", { allowResourceHosts: ["API.example."], onDecision: (d) => seen.push(...d.reasons.map((r) => r.code)) });
    expect(await allow(pr("https://api.example/x"))).toBe(true);
    expect(seen).toContain("resource_host_allowed");
    expect(await allow(pr("https://other.example/x"))).toBe(false);
    // The server's own facts still decide: a bad payTo is blocked even for an allowed resource host.
    expect(await allow(pr("https://api.example/x", [req({ payTo: "0x000000000000000000000000000000000000dEaD" })]))).toBe(false);

    const warned: Array<{ code: string; effect: string }> = [];
    const warn = mcpPaymentApprover(guard, "https://blockrun.ai/mcp", { resourceUrlMismatch: "warn", onDecision: (d) => warned.push(...d.reasons) });
    expect(await warn(pr("https://other.example/x"))).toBe(true);
    expect(warned).toContainEqual(expect.objectContaining({ code: "resource_url_mismatch", effect: "warn" }));
    expect(await warn(pr("https://other.example/x", [req({ payTo: "0x000000000000000000000000000000000000dEaD" })]))).toBe(false);
  });

  it("without AsyncLocalStorage, several paid requests in flight give no request URL", async () => {
    const proc = process as unknown as { getBuiltinModule?: unknown };
    const orig = proc.getBuiltinModule;
    vi.resetModules();
    proc.getBuiltinModule = undefined;
    try {
      const m = await import("../src/index");
      const guard = m.createPrePaymentGuard({ client: new m.BotsRatedClient({ fetch: botsratedFetch() }) });
      const strict = m.createPrePaymentGuard({ client: new m.BotsRatedClient({ fetch: botsratedFetch() }), policy: { requireRequestUrl: true } });
      // Both callbacks wait until both requests are in flight, then read before either finishes.
      let started = 0;
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const tick = async () => {
        if (++started === 2) release();
        await gate;
      };
      const reset = () => {
        started = 0;
      };
      // One in flight: it is the request URL.
      expect(await m.payingRequest("https://evil.example/x", () => guard.beforePaymentCreation(ctx(SELLER_URL)))).toMatchObject({ abort: true });
      // Several in flight (even the same URL twice): unknown.
      const seen = await Promise.all([
        m.payingRequest("https://evil.example/x", async () => (await tick(), m.currentRequestUrl())),
        m.payingRequest(SELLER_URL, async () => (await tick(), m.currentRequestUrl())),
      ]);
      expect(seen).toEqual([undefined, undefined]);
      reset();
      let release2!: () => void;
      const gate2 = new Promise<void>((r) => (release2 = r));
      const tick2 = async () => {
        if (++started === 2) release2();
        await gate2;
      };
      const same = await Promise.all([1, 2].map(() => m.payingRequest(SELLER_URL, async () => (await tick2(), m.currentRequestUrl()))));
      expect(same).toEqual([undefined, undefined]);
      reset();
      let release3!: () => void;
      const gate3 = new Promise<void>((r) => (release3 = r));
      const tick3 = async () => {
        if (++started === 2) release3();
        await gate3;
      };
      const [a, b] = await Promise.all([
        m.payingRequest("https://evil.example/x", async () => (await tick3(), strict.beforePaymentCreation(ctx(SELLER_URL)))),
        m.payingRequest(SELLER_URL, async () => (await tick3(), guard.beforePaymentCreation(ctx(SELLER_URL)))),
      ]);
      expect(a).toMatchObject({ abort: true, reason: expect.stringMatching(/no_request_url/) });
      expect(b).toBeUndefined(); // default policy falls back to resource.url
      expect(m.currentRequestUrl()).toBeUndefined();
    } finally {
      proc.getBuiltinModule = orig;
      vi.resetModules();
    }
  });
});
