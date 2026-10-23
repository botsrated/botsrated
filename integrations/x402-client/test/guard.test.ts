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
  mcpPaymentApprover,
  usdToAtomic,
} from "../src/index";

const fx = (name: string) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8");
const FOUND = JSON.parse(fx("preflight-found.json"));
const NOT_COVERED = fx("preflight-not-covered.json");
const CHECK_402_B64 = fx("check-402-payment-required.b64").trim();
const SAMPLE_CHECK = fx("sample-check.json");

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
    expect(c.budget!.spentAtomic).toBe(2000n);
    expect(c.budget!.remainingAtomic).toBe(3000n);
  });

  it("refuses before paying when the budget is too small", async () => {
    const pay = vi.fn();
    const c = new BotsRatedClient({ fetch: botsratedFetch(), paid: { budgetUsd: 0.001, fetchWithPayment: pay } });
    await expect(c.check("blockrun.ai")).rejects.toMatchObject({ code: "budget_exceeded" });
    expect(pay).not.toHaveBeenCalled();
  });

  it("refuses a quote with a different payTo", async () => {
    const pay = vi.fn();
    const c = new BotsRatedClient({ fetch: botsratedFetch(), paid: { budgetUsd: 1, fetchWithPayment: pay, expectedPayTo: "0x000000000000000000000000000000000000dEaD" } });
    await expect(c.check("blockrun.ai")).rejects.toMatchObject({ code: "terms_rejected" });
    expect(pay).not.toHaveBeenCalled();
  });

  it("releases the reservation when the paid call fails", async () => {
    const c = new BotsRatedClient({ fetch: botsratedFetch(), paid: { budgetUsd: 0.01, fetchWithPayment: async () => json({}, 500) } });
    await expect(c.check("blockrun.ai")).rejects.toMatchObject({ code: "paid_call_failed" });
    expect(c.budget!.spentAtomic).toBe(0n);
    expect(c.budget!.remainingAtomic).toBe(10000n);
  });

  it("the guard lets the client's own reserved payment through", async () => {
    let client!: BotsRatedClient;
    const r = { scheme: "exact", network: BASE_MAINNET, asset: BASE_USDC, payTo: BOTSRATED_PAY_TO, amount: "2000" };
    const pay = vi.fn(async () => {
      const verdict = await guard.beforePaymentCreation({ paymentRequired: { x402Version: 2, resource: { url: "https://botsrated.com/v1/check?host=blockrun.ai" }, accepts: [r] }, selectedRequirements: r });
      return verdict ? json({}, 402) : json(SAMPLE_CHECK);
    });
    client = new BotsRatedClient({ fetch: botsratedFetch(), paid: { budgetUsd: 0.01, fetchWithPayment: pay } });
    const guard = createPrePaymentGuard({ client, paidCheckAtOrAboveUsd: 0.5 });
    // Seller payment of $1 triggers the paid check, which passes the guard's BotsRated branch.
    const d = await guard.decide(SELLER_URL, req({ amount: "1000000" }));
    expect(d.facts?.source).toBe("check");
    expect(client.budget!.spentAtomic).toBe(2000n);
  });

  it("Budget rejects non-positive limits and usdToAtomic rounds to 6 decimals", () => {
    expect(() => new Budget(0n)).toThrow();
    expect(usdToAtomic(0.002)).toBe(2000n);
  });
});
