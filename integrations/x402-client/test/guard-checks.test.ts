// The four checks from the live Guard page: repeat_payment, delivery_check, payto_base58_format, quote_above_listing.
import { describe, expect, it, vi } from "vitest";
import { BASE_USDC } from "../src/util.js";
import { createPrePaymentGuard, evaluatePayment, factsFrom } from "../src/index.js";
import {
  REPLAY_TESTED,
  createPaymentGuard,
  evaluateDelivery,
  interpretPolicyBody,
  payToBase58Assessment,
  policies,
  type GuardDecision,
} from "../src/payment-guard.js";
import { FOUND, SELLER_URL, json, pr, recordingFetch, req } from "./helpers.js";

const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOL_KEY = "EPjFWdd5AufqSSQEm2Qn1xzybapC8G4wEGGkZwyTDt1v";
const PAY_ID = "pay_0123456789abcdef0123456789abcdef";
const NONCE = "0x" + "ab".repeat(32);
const SCHEMA = { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } };

function withId(id = PAY_ID) {
  return pr(SELLER_URL, [req()], { "payment-identifier": { info: { id } } });
}

describe("repeat_payment", () => {
  it("warns on a repeated payment identifier, keeps the third a warning, and does not call BotsRated", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    const fetch = vi.fn(async () => {
      throw new Error("no network");
    });
    const seen: GuardDecision[] = [];
    const g = createPaymentGuard({ hosted: false, fetch, onDecision: (d) => seen.push(d) });
    const c = { paymentRequired: withId(), selectedRequirements: req() };
    expect(await g.hooks.beforePaymentCreation(c)).toBeUndefined();
    expect(seen[0].reasons.map((r) => r.code)).not.toContain("repeat_payment");

    expect(await g.hooks.beforePaymentCreation(c)).toBeUndefined();
    expect(seen[1].action).toBe("allow");
    expect(seen[1].wouldBlock).toBe(false);
    expect(seen[1].reasons).toContainEqual(expect.objectContaining({ code: "repeat_payment", effect: "warn", rule: "repeatPayment" }));
    expect(seen[1].reasons.find((r) => r.code === "repeat_payment")!.fact).toContain("replay_tested is false");

    expect(await g.hooks.beforePaymentCreation(c)).toBeUndefined();
    expect(seen[2].reasons.filter((r) => r.code === "repeat_payment")).toEqual([expect.objectContaining({ effect: "warn" })]);
    expect(seen[2].action).toBe("allow");
    expect(REPLAY_TESTED).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stops warning after 60 seconds and blocks only when the caller sets that", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    const seen: GuardDecision[] = [];
    const g = createPaymentGuard({ hosted: false, onDecision: (d) => seen.push(d) });
    const c = { paymentRequired: withId(), selectedRequirements: req() };
    await g.hooks.beforePaymentCreation(c);
    vi.advanceTimersByTime(60_000);
    await g.hooks.beforePaymentCreation(c);
    expect(seen.at(-1)!.reasons.map((r) => r.code)).not.toContain("repeat_payment");

    const blocking: GuardDecision[] = [];
    const closed = createPaymentGuard({
      hosted: false,
      policy: { repeatPayment: "block" },
      onDecision: (d) => blocking.push(d),
    });
    const again = { paymentRequired: withId("pay_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), selectedRequirements: req() };
    expect(await closed.hooks.beforePaymentCreation(again)).toBeUndefined();
    expect(await closed.hooks.beforePaymentCreation(again)).toMatchObject({ abort: true });
    expect(blocking[1].reasons).toContainEqual(expect.objectContaining({ code: "repeat_payment", effect: "block" }));
    expect(policies.strict.repeatPayment).toBe("warn");
    expect(policies.warn.repeatPayment).toBe("warn");
    vi.useRealTimers();
  });

  it("warns when host, route, amount and nonce repeat, and not when the nonce differs", async () => {
    const seen: GuardDecision[] = [];
    const g = createPaymentGuard({ hosted: false, onDecision: (d) => seen.push(d) });
    const row = (nonce: string) => req({ extra: { nonce } });
    const ctx = (nonce: string) => ({ paymentRequired: pr(SELLER_URL, [row(nonce)]), selectedRequirements: row(nonce) });
    await g.hooks.beforePaymentCreation(ctx(NONCE));
    await g.hooks.beforePaymentCreation(ctx(NONCE));
    expect(seen[1].reasons).toContainEqual(expect.objectContaining({ code: "repeat_payment", effect: "warn" }));
    await g.hooks.beforePaymentCreation(ctx("0x" + "cd".repeat(32)));
    expect(seen[2].reasons.map((r) => r.code)).not.toContain("repeat_payment");
  });
});

describe("payto_base58_format", () => {
  it("matches the live examples and does not judge a Base payTo", () => {
    expect(BASE_USDC).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(payToBase58Assessment(SOL, SOL_KEY)).toEqual({ applies: true, valid: true, code: "payto_base58_format" });
    expect(payToBase58Assessment(SOL, "not-a-key")).toEqual({ applies: true, valid: false, code: "payto_base58_format" });
    expect(payToBase58Assessment("eip155:8453", "0x1111111111111111111111111111111111111111")).toEqual({
      applies: false,
      valid: null,
      code: "payto_base58_format",
    });
    expect(payToBase58Assessment("base", SOL_KEY).applies).toBe(false);
  });

  it("warns by default, blocks only when set, and leaves a Base payTo to the existing rule", async () => {
    const seen: GuardDecision[] = [];
    const g = createPaymentGuard({ hosted: false, onDecision: (d) => seen.push(d) });
    const bad = { paymentRequired: pr(SELLER_URL, [req({ network: SOL, payTo: "not-a-key" })]), selectedRequirements: req({ network: SOL, payTo: "not-a-key" }) };
    expect(await g.hooks.beforePaymentCreation(bad)).toBeUndefined();
    expect(seen[0].reasons).toContainEqual(expect.objectContaining({ code: "payto_base58_format", effect: "warn" }));
    expect(seen[0].action).toBe("allow");

    const good = { paymentRequired: pr(SELLER_URL, [req({ network: SOL, payTo: SOL_KEY })]), selectedRequirements: req({ network: SOL, payTo: SOL_KEY }) };
    await g.hooks.beforePaymentCreation(good);
    expect(seen[1].reasons.map((r) => r.code)).not.toContain("payto_base58_format");

    const base = createPaymentGuard({ hosted: false, policy: { payToBase58Format: "block" }, onDecision: (d) => seen.push(d) });
    expect(await base.hooks.beforePaymentCreation({ paymentRequired: pr(SELLER_URL), selectedRequirements: req({ payTo: "not-a-key" }) })).toBeUndefined();
    expect(seen[2].reasons.map((r) => r.code)).not.toContain("payto_base58_format");

    const stop = createPaymentGuard({ hosted: false, policy: { payToBase58Format: "block" } });
    expect(await stop.hooks.beforePaymentCreation(bad)).toMatchObject({ abort: true });
    expect(policies.carefulBuyer.payToBase58Format).toBe("warn");
  });
});

describe("quote_above_listing", () => {
  it("warns locally when the quote is above the listed amount on the same route", () => {
    const facts = factsFrom(FOUND, "blockrun.ai", "preflight");
    expect(facts.listedAmount).toBe("2000");
    const above = evaluatePayment(facts, req({ amount: "2001" }), SELLER_URL);
    expect(above.action).toBe("allow");
    expect(above.reasons).toContainEqual(expect.objectContaining({ code: "quote_above_listing", effect: "warn" }));
    expect(evaluatePayment(facts, req({ amount: "2000" }), SELLER_URL).reasons.map((r) => r.code)).not.toContain("quote_above_listing");
    expect(evaluatePayment(facts, req({ amount: "9000" }), "https://blockrun.ai/other").reasons.map((r) => r.code)).not.toContain("quote_above_listing");
    expect(evaluatePayment(facts, req({ amount: "2001" }), SELLER_URL, { quoteAboveListing: "block" }).action).toBe("block");
  });

  it("surfaces a server quote_above_listing reason instead of only remote_policy", async () => {
    const only = interpretPolicyBody(200, { decision: "block", reasons: [{ rule: "quote_above_listing", effect: "block", fact: "quoted 2000 atomic units; listed 1000." }] }, "open", "blockrun.ai");
    expect(only.code).toBeUndefined();
    expect(only.quoteAboveListingFact).toContain("listed 1000");
    const mixed = interpretPolicyBody(
      200,
      {
        decision: "block",
        reasons: [
          { rule: "quote_above_listing", effect: "warn", fact: "quoted 2000 atomic units; listed 1000." },
          { rule: "payto_not_observed", effect: "block", fact: "payTo differs." },
        ],
      },
      "open",
      "blockrun.ai",
    );
    expect(mixed.code).toBe("remote_policy");
    expect(mixed.effect).toBe("block");

    const { f } = recordingFetch((url) => {
      if (url.includes("/v1/policy/check")) {
        return json({ decision: "block", reasons: [{ rule: "quote_above_listing", effect: "block", fact: "quoted 2000 atomic units; listed 1000." }] });
      }
      return json(FOUND);
    });
    const seen: GuardDecision[] = [];
    const g = createPaymentGuard({ fetch: f, remotePolicy: { token: "policy-token-1", failMode: "open" }, onDecision: (d) => seen.push(d) });
    let out: unknown;
    await g.wrapFetch(async () => {
      out = await g.hooks.beforePaymentCreation({ paymentRequired: pr(SELLER_URL), selectedRequirements: req() });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    })(SELLER_URL);
    expect(out).toBeUndefined();
    expect(seen[0].action).toBe("allow");
    expect(seen[0].remote_decision).toBe("block");
    expect(seen[0].reasons).toContainEqual(expect.objectContaining({ code: "quote_above_listing", effect: "warn" }));
    expect(seen[0].reasons.map((r) => r.code)).not.toContain("remote_policy");

    const stopping = createPaymentGuard({
      fetch: f,
      policy: { quoteAboveListing: "block" },
      remotePolicy: { token: "policy-token-1", failMode: "open" },
    });
    await expect(
      stopping.wrapFetch(async () => {
        const stopped = await stopping.hooks.beforePaymentCreation({ paymentRequired: pr(SELLER_URL), selectedRequirements: req() });
        expect(stopped).toMatchObject({ abort: true });
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      })(SELLER_URL),
    ).resolves.toBeInstanceOf(Response);
  });
});

describe("delivery_check", () => {
  it("treats an empty 2xx as not a delivery and a matching schema as delivered", () => {
    const empty = evaluateDelivery({ status: 200, body: "", contentType: "application/json" });
    expect(empty).toMatchObject({
      code: "delivery_check",
      blocks_by_default: false,
      rule: "a 2xx is not a delivery",
      checks: { http_2xx: true, body_non_empty: false, content_type_sane: true, schema: "not_declared" },
      outcome: "not_a_delivery",
      effect: "warn",
    });
    const delivered = evaluateDelivery({ status: 200, body: JSON.stringify({ ok: true }), contentType: "application/json; charset=utf-8", schema: SCHEMA });
    expect(delivered.outcome).toBe("delivered");
    expect(delivered.effect).toBe("allow");
    expect(delivered.checks.schema).toBe("pass");
    const undeclared = evaluateDelivery({ status: 200, body: JSON.stringify({ ok: true }), contentType: "application/json" });
    expect(undeclared.checks.schema).toBe("not_declared");
    expect(undeclared.effect).toBe("warn");
    expect(evaluateDelivery({ status: 200, body: "<p>x</p>", contentType: "text/html" }).checks.content_type_sane).toBe(false);
    expect(evaluateDelivery({ status: 500, body: JSON.stringify({ ok: true }), contentType: "application/json", schema: SCHEMA }).effect).toBe("warn");
  });

  it("warns from wrapFetch after a payment and does not block", async () => {
    const seen: GuardDecision[] = [];
    const g = createPaymentGuard({ hosted: false, onDecision: (d) => seen.push(d) });
    const payload = {
      x402Version: 2,
      payload: { authorization: { from: "0x" + "a".repeat(40), nonce: NONCE, validBefore: "9999999999" } },
      accepted: req(),
    };
    await g.wrapFetch(async () => {
      await g.hooks.beforePaymentCreation({ paymentRequired: pr(SELLER_URL), selectedRequirements: req() });
      await g.hooks.afterPaymentCreation({ paymentPayload: payload });
      return new Response("", { status: 200, headers: { "content-type": "application/json" } });
    })(SELLER_URL);
    const delivery = seen.filter((d) => d.reasons.some((r) => r.code === "delivery_check"));
    expect(delivery).toHaveLength(1);
    expect(delivery[0].action).toBe("allow");
    expect(delivery[0].wouldBlock).toBe(false);
    expect(delivery[0].reasons[0]).toMatchObject({ code: "delivery_check", effect: "warn" });

    const matched: GuardDecision[] = [];
    const ok = createPaymentGuard({ hosted: false, onDecision: (d) => matched.push(d) });
    await ok.wrapFetch(async () => {
      await ok.hooks.beforePaymentCreation({
        paymentRequired: pr(SELLER_URL, [req()], { bazaar: { info: { output: { schema: SCHEMA } } } }),
        selectedRequirements: req(),
      });
      await ok.hooks.afterPaymentCreation({ paymentPayload: payload });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    })(SELLER_URL);
    expect(matched.some((d) => d.reasons.some((r) => r.code === "delivery_check"))).toBe(false);
  });

  it("is on the pre-payment guard too", async () => {
    const seen: Array<{ reasons: Array<{ code: string; effect: string }> }> = [];
    const guard = createPrePaymentGuard({
      client: { unpaidFetch: () => async () => json(FOUND), unpaidTimeoutMs: () => 1000, host: "botsrated.com", preflight: async () => ({ found: true, body: FOUND }) } as never,
      onDecision: (d) => seen.push(d),
    });
    await guard.wrapFetch(async () => {
      await guard.decide(SELLER_URL, req({ extra: { nonce: NONCE } }), SELLER_URL);
      return new Response("", { status: 200, headers: { "content-type": "application/json" } });
    })(SELLER_URL);
    expect(seen.some((d) => d.reasons.some((r) => r.code === "delivery_check" && r.effect === "warn"))).toBe(true);
    const second = await guard.decide(SELLER_URL, req({ extra: { nonce: NONCE } }), SELLER_URL);
    expect(second.reasons).toContainEqual(expect.objectContaining({ code: "repeat_payment", effect: "warn" }));
    expect(second.action).toBe("allow");
  });
});
