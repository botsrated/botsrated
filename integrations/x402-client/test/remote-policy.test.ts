import { describe, expect, it, vi } from "vitest";
import { BotsRatedClient, createPrePaymentGuard, strictGuardPolicy } from "../src/index";
import { createPaymentGuard, interpretPolicyBody, policies, type GuardDecision } from "../src/payment-guard";
import { FOUND, OTHER_PAYTO, SELLER_URL, json, pr, req } from "./helpers";

const TOKEN = "policy-token-1";
const FRAMING = { decided_by: "your_policy", not_a_botsrated_rating: true, policy_version: "7" };

const ctx = (resourceUrl: string, row = req()) => ({ paymentRequired: pr(resourceUrl, [row]), selectedRequirements: row });

function splitFetch(policy: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/v1/policy/check")) {
      const answer = policy(url, init);
      return json(answer.body, answer.status);
    }
    return json(FOUND);
  });
  return { f, calls };
}

function bodies(calls: Array<{ url: string; init?: RequestInit }>) {
  return calls.filter((c) => c.url.includes("/v1/policy/check")).map((c) => JSON.parse(String(c.init?.body)));
}

async function before(g: ReturnType<typeof createPaymentGuard>, paidUrl: string, c: unknown) {
  let out: unknown;
  await g.wrapFetch(async () => {
    out = await g.hooks.beforePaymentCreation(c);
    return new Response("");
  })(paidUrl);
  return out as void | { abort: true; reason: string };
}

describe("remotePolicy", () => {
  it("leaves local presets alone when unset", async () => {
    const { f, calls } = splitFetch(() => ({ status: 200, body: {} }));
    const seen: GuardDecision[] = [];
    const g = createPaymentGuard({ fetch: f, policy: policies.carefulBuyer, onDecision: (d) => seen.push(d) });
    expect(await before(g, SELLER_URL, ctx(SELLER_URL, req({ payTo: OTHER_PAYTO })))).toMatchObject({ abort: true });
    expect(seen[0].policyRule).toBe("payToMismatch");
    expect(seen[0].remote_decision).toBeUndefined();
    expect(calls.some((c) => c.url.includes("/v1/policy/check"))).toBe(false);
  });

  it("a remote block wins over a local allow and keeps the server framing", async () => {
    const { f, calls } = splitFetch(() => ({ status: 200, body: { decision: "block", ...FRAMING } }));
    const seen: GuardDecision[] = [];
    const g = createPaymentGuard({ fetch: f, onDecision: (d) => seen.push(d), remotePolicy: { token: TOKEN, failMode: "open" } });
    const out = await before(g, SELLER_URL, ctx(SELLER_URL));
    expect(out).toMatchObject({ abort: true });
    expect(seen[0]).toMatchObject({
      action: "block",
      policyRule: "remotePolicy",
      remote_decision: "block",
      decided_by: "your_policy",
      not_a_botsrated_rating: true,
      policy_version: "7",
    });
    expect(g.remotePolicyVersion()).toBe("7");
    const body = bodies(calls)[0];
    expect(body.host).toBe("blockrun.ai");
    expect(Object.keys(body).sort()).toEqual(["host", "quote"]);
    expect(Object.keys(body.quote).sort()).toEqual(["amount", "asset", "network", "payTo"]);
    const posted = calls.find((c) => c.url.includes("/v1/policy/check"))!;
    expect(posted.url).toBe("https://botsrated.com/v1/policy/check");
    expect((posted.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("a remote pass does not clear a local block", async () => {
    const { f } = splitFetch(() => ({ status: 200, body: { decision: "pass", ...FRAMING } }));
    const seen: GuardDecision[] = [];
    const g = createPaymentGuard({
      fetch: f,
      policy: policies.strict,
      onDecision: (d) => seen.push(d),
      remotePolicy: { token: TOKEN, fail_mode: "open" },
    });
    expect(await before(g, SELLER_URL, ctx(SELLER_URL, req({ payTo: OTHER_PAYTO })))).toMatchObject({ abort: true });
    expect(seen[0].policyRule).toBe("payToMismatch");
    expect(seen[0].remote_decision).toBe("pass");
    expect(seen[0].decided_by).toBe("your_policy");
  });

  it("503, 404 and a null decision follow fail_mode and never invent a pass", async () => {
    const cases = [
      { status: 503, body: { decision: null, ...FRAMING } },
      { status: 200, body: { decision: null, decided_by: "your_policy", not_a_botsrated_rating: true } },
      { status: 404, body: {} },
      { status: 200, body: { decision: "safe" } },
    ];
    for (const answer of cases) {
      const closedFetch = splitFetch(() => answer);
      const closedSeen: GuardDecision[] = [];
      const closed = createPaymentGuard({
        fetch: closedFetch.f,
        onDecision: (d) => closedSeen.push(d),
        remotePolicy: { token: TOKEN, failMode: "closed" },
      });
      expect(await before(closed, SELLER_URL, ctx(SELLER_URL))).toMatchObject({ abort: true });
      expect(closedSeen[0].remote_decision).toBeNull();
      expect(closedSeen[0].reasons).toContainEqual(expect.objectContaining({ code: "remote_policy_unavailable", effect: "block" }));
      expect(closedSeen[0].reasons.map((r) => r.fact).join(" ")).toContain("fail_mode is closed");

      const openFetch = splitFetch(() => answer);
      const openSeen: GuardDecision[] = [];
      const opened = createPaymentGuard({
        fetch: openFetch.f,
        onDecision: (d) => openSeen.push(d),
        remotePolicy: { token: TOKEN, fail_mode: "open" },
      });
      expect(await before(opened, SELLER_URL, ctx(SELLER_URL))).toBeUndefined();
      expect(openSeen[0].action).toBe("allow");
      expect(openSeen[0].remote_decision).toBeNull();
      expect(openSeen[0].reasons).toContainEqual(expect.objectContaining({ code: "remote_policy_unavailable", effect: "info" }));
    }

    const { f } = splitFetch(() => ({ status: 503, body: { decision: null } }));
    const seen: GuardDecision[] = [];
    const strict = createPaymentGuard({
      fetch: f,
      policy: policies.strict,
      onDecision: (d) => seen.push(d),
      remotePolicy: { token: TOKEN, failMode: "open" },
    });
    expect(await before(strict, SELLER_URL, ctx(SELLER_URL, req({ payTo: OTHER_PAYTO })))).toMatchObject({ abort: true });
    expect(seen[0].policyRule).toBe("payToMismatch");
    expect(seen[0].remote_decision).toBeNull();
  });

  it("does not sign the policy decision and does not send the path, query or a returned signature", async () => {
    const { f, calls } = splitFetch(() => ({ status: 200, body: { decision: "block", signature: "PRODKEYSIG", ...FRAMING } }));
    const seen: GuardDecision[] = [];
    const g = createPaymentGuard({ fetch: f, onDecision: (d) => seen.push(d), remotePolicy: { token: TOKEN, failMode: "closed" } });
    const secret = "https://blockrun.ai/api/v1/chat?api_key=SECRET123";
    await before(g, secret, ctx(secret));
    const posted = calls.find((c) => c.url.includes("/v1/policy/check"))!;
    const headers = posted.init?.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("payment-signature");
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("x-payment");
    const raw = String(posted.init?.body);
    expect(raw).not.toContain("SECRET123");
    expect(raw).not.toContain("PRODKEYSIG");
    expect(raw).not.toContain("signature");
    expect(raw).not.toContain("/api/v1");
    expect(seen[0].message).not.toContain("PRODKEYSIG");
    expect(seen[0].message).not.toContain(TOKEN);
    expect(JSON.stringify(seen[0])).not.toContain("PRODKEYSIG");
  });

  it("remembers the last policy_version when the next check returns 503", async () => {
    let n = 0;
    const { f } = splitFetch(() => {
      n += 1;
      return n === 1
        ? { status: 200, body: { decision: "pass", policy_version: "9", decided_by: "your_policy", not_a_botsrated_rating: true } }
        : { status: 503, body: { decision: null } };
    });
    const seen: GuardDecision[] = [];
    const g = createPaymentGuard({ fetch: f, onDecision: (d) => seen.push(d), remotePolicy: { token: TOKEN, failMode: "closed" } });
    expect(await before(g, SELLER_URL, ctx(SELLER_URL))).toBeUndefined();
    expect(seen[0].remote_decision).toBe("pass");
    expect(await before(g, SELLER_URL, ctx(SELLER_URL))).toMatchObject({ abort: true });
    expect(seen[1].remote_decision).toBeNull();
    expect(seen[1].policy_version).toBe("9");
    expect(g.remotePolicyVersion()).toBe("9");
  });

  it("uses a custom origin and rejects a missing fail mode", async () => {
    const { f, calls } = splitFetch(() => ({ status: 200, body: { decision: "warn" } }));
    const g = createPaymentGuard({
      fetch: f,
      remotePolicy: { token: TOKEN, fail_mode: "open", baseUrl: "https://policy.example/v1/" },
    });
    expect(await before(g, SELLER_URL, ctx(SELLER_URL))).toBeUndefined();
    expect(calls.find((c) => c.url.includes("/policy/check"))!.url).toBe("https://policy.example/v1/policy/check");
    expect(() => createPaymentGuard({ remotePolicy: { token: TOKEN } })).toThrow(/failMode/);
    expect(() => createPaymentGuard({ remotePolicy: { token: "has space", failMode: "open" } })).toThrow(/token/);
  });

  it("PrePaymentGuard: block wins, 503 follows fail_mode, and the check is not signed", async () => {
    const block = splitFetch(() => ({ status: 200, body: { decision: "block", signature: "PRODKEYSIG", ...FRAMING } }));
    const guard = createPrePaymentGuard({
      client: new BotsRatedClient({ fetch: block.f }),
      remotePolicy: { token: TOKEN, failMode: "open" },
    });
    const decision = await guard.decide(SELLER_URL, req(), SELLER_URL);
    expect(decision.action).toBe("block");
    expect(decision.remote_decision).toBe("block");
    expect(decision.decided_by).toBe("your_policy");
    expect(decision.not_a_botsrated_rating).toBe(true);
    const posted = block.calls.find((c) => c.url.includes("/v1/policy/check"))!;
    expect(Object.keys(posted.init?.headers as object).map((k) => k.toLowerCase())).not.toContain("payment-signature");
    expect(String(posted.init?.body)).not.toContain("PRODKEYSIG");

    const down = () => ({ status: 503, body: { decision: null, decided_by: "your_policy", not_a_botsrated_rating: true } });
    const closed = createPrePaymentGuard({
      client: new BotsRatedClient({ fetch: splitFetch(down).f }),
      remotePolicy: { token: TOKEN, failMode: "closed" },
    });
    const blocked = await closed.decide(SELLER_URL, req(), SELLER_URL);
    expect(blocked.action).toBe("block");
    expect(blocked.remote_decision).toBeNull();
    expect(blocked.reasons.map((r) => r.detail).join(" ")).toContain("fail_mode is closed");

    const opened = createPrePaymentGuard({
      client: new BotsRatedClient({ fetch: splitFetch(down).f }),
      remotePolicy: { token: TOKEN, failMode: "open" },
    });
    const allowed = await opened.decide(SELLER_URL, req(), SELLER_URL);
    expect(allowed.action).toBe("allow");
    expect(allowed.remote_decision).toBeNull();
    expect(allowed.reasons).toContainEqual(expect.objectContaining({ effect: "info", code: "remote_policy_unavailable" }));

    const passed = createPrePaymentGuard({
      client: new BotsRatedClient({ fetch: splitFetch(() => ({ status: 200, body: { decision: "pass" } })).f }),
      policy: strictGuardPolicy,
      remotePolicy: { token: TOKEN, failMode: "open" },
    });
    const still = await passed.decide(SELLER_URL, req({ payTo: OTHER_PAYTO }), SELLER_URL);
    expect(still.action).toBe("block");
    expect(still.remote_decision).toBe("pass");
    expect(passed.remotePolicyVersion()).toBeUndefined();
  });

  it("interpretPolicyBody does not map null to pass", () => {
    expect(interpretPolicyBody(503, { decision: null }, "open", "blockrun.ai").decision).toBeNull();
    expect(interpretPolicyBody(200, { decision: null }, "closed", "blockrun.ai")).toMatchObject({ decision: null, effect: "block" });
    expect(interpretPolicyBody(200, { decision: "block" }, "open", "blockrun.ai").decision).toBe("block");
    expect(interpretPolicyBody(null, {}, "closed", "blockrun.ai")).toMatchObject({ decision: null, effect: "block" });
  });
});
