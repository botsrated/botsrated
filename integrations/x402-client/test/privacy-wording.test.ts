// Legal M2/M5, Security H3: only the host name goes to botsrated.com; fact-only wording; no banned words.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BotsRatedClient, USER_AGENT, VERSION, createPrePaymentGuard, evaluatePayment, factsFrom, formatDecision, strictGuardPolicy } from "../src/index";
import { checkPaymentState } from "../src/onchain";
import { createPaymentGuard, policies, type GuardDecision } from "../src/payment-guard";
import { BANNED, FOUND, OTHER_PAYTO, SELLER_URL, json, pr, recordingFetch, req } from "./helpers";

const SECRET_URL = "https://blockrun.ai/api/v1/chat/completions?api_key=SECRET123&prompt=hello%20world#frag";
const WALLET = "0x" + "a".repeat(40);
const NONCE = "0x" + "1".repeat(64);

describe("privacy: host name only", () => {
  it("payment guard sends only ?url=<host>, a fixed User-Agent and nothing about the payer", async () => {
    const { f, calls } = recordingFetch();
    const g = createPaymentGuard({ fetch: f, policy: policies.strict });
    const c = { paymentRequired: pr(SECRET_URL), selectedRequirements: req({ amount: "123456" }) };
    await g.wrapFetch(async () => {
      await g.hooks.beforePaymentCreation(c);
      await g.hooks.afterPaymentCreation({ ...c, paymentPayload: { x402Version: 2, payload: { signature: "0xSIGNATURE", authorization: { from: WALLET, nonce: NONCE, validBefore: "9999999999" } }, accepted: req({ amount: "123456" }) } });
      await g.hooks.paymentResponse({ paymentPayload: { x402Version: 2, payload: { signature: "0xSIGNATURE", authorization: { from: WALLET, nonce: NONCE, validBefore: "9999999999" } }, accepted: req({ amount: "123456" }) }, requirements: req(), settleResponse: { success: false, transaction: "0x" + "c".repeat(64) } });
      return new Response("");
    })(SECRET_URL);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe("https://botsrated.com/v1/preflight");
    expect([...u.searchParams.keys()]).toEqual(["url"]);
    expect(u.searchParams.get("url")).toBe("blockrun.ai");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual(["accept", "user-agent"]);
    expect(headers["user-agent"]).toBe(`botsrated-x402-preflight/${VERSION}`);
    expect(calls[0].init?.body).toBeUndefined();
    const everything = JSON.stringify(calls);
    for (const s of ["SECRET123", "hello", "/api/v1", "frag", WALLET, "123456", NONCE, "SIGNATURE", "cccc"]) expect(everything).not.toContain(s);
  });

  it("BotsRatedClient.preflight and the existing pre-payment guard send only the host", async () => {
    const { f, calls } = recordingFetch();
    const client = new BotsRatedClient({ fetch: f });
    await client.preflight(SECRET_URL);
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: f }) });
    await guard.decide(SECRET_URL, req());
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(new URL(c.url).searchParams.get("url")).toBe("blockrun.ai");
      expect(c.url).not.toMatch(/SECRET|prompt|api%2Fv1|api\/v1/);
      expect((c.init?.headers as Record<string, string>)["user-agent"]).toBe(USER_AGENT);
    }
  });

  it("version constant matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});

describe("wording: fact-only, no banned words", () => {
  async function allMessages(): Promise<string[]> {
    const out: string[] = [];
    const push = (d: GuardDecision) => out.push(d.message, ...d.reasons.flatMap((r) => [r.code, r.fact, r.rule ?? ""]), d.policyRule ?? "");
    const fetches = [() => json(FOUND), () => json({ error: { code: "host_not_covered" } }, 404), () => json({ ...FOUND, freshness: { stale: true } }), () => { throw new Error("down"); }];
    const reqs = [req(), req({ payTo: OTHER_PAYTO }), req({ payTo: "junk" }), req({ amount: "99999999" }), req({ maxTimeoutSeconds: undefined }), req({ network: "eip155:1" })];
    for (const policy of [policies.warn, policies.strict]) {
      for (const dryRun of [false, true]) {
        for (const ff of fetches) {
          const g = createPaymentGuard({ fetch: async () => ff(), policy, dryRun, onDecision: push, failOpen: !dryRun });
          for (const r of reqs) {
            for (const url of [SELLER_URL, "http://[bad", "https://other.example/x"]) {
              await g.wrapFetch(async () => {
                const res = await g.hooks.beforePaymentCreation({ paymentRequired: pr(url, [r]), selectedRequirements: r });
                if (res) out.push(res.reason);
                return new Response("");
              })(SELLER_URL);
            }
          }
        }
      }
    }
    const g = createPaymentGuard({ hosted: false, onDecision: push });
    await g.hooks.paymentResponse({ paymentPayload: { x402Version: 2, payload: { authorization: { from: WALLET, nonce: NONCE, validBefore: "1" } }, accepted: req() }, requirements: req() });
    for (const s of [await checkPaymentState({ network: "x", asset: "", from: "", payTo: "", amount: "", nonce: "", validBefore: 1 }), await g.paymentState({ payTo: OTHER_PAYTO, nonce: NONCE })]) {
      out.push((s as any).message ?? "", (s as any).reason ?? "");
    }
    // Existing guard
    const facts = factsFrom(FOUND, "blockrun.ai", "preflight");
    for (const r of reqs) for (const p of [{}, strictGuardPolicy, { notCovered: "block" as const, stale: "block" as const, minValid402Rate: 2 }]) {
      const d = evaluatePayment({ ...facts, stale: true, valid402Rate: 0.1, recentProbes: 5 }, r as any, SELLER_URL, p);
      out.push(formatDecision(d), ...d.reasons.flatMap((x) => [x.code, x.detail]));
      const nc = evaluatePayment(factsFrom({ found: false }, "x.example", "preflight"), r as any, SELLER_URL, p);
      out.push(formatDecision(nc));
    }
    const legacy = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: async () => { throw new Error("down"); } }), failOpen: false });
    for (const d of [await legacy.decide(SELLER_URL, req()), await legacy.decide("http://[bad", req()), await legacy.decide("https://a.example", req(), "https://b.example")]) {
      out.push(formatDecision(d), ...d.reasons.map((x) => x.detail));
    }
    return out.filter(Boolean);
  }

  it("no decision, reason, message or state text uses a banned word", async () => {
    const msgs = await allMessages();
    expect(msgs.length).toBeGreaterThan(200);
    const hits = msgs.filter((m) => BANNED.test(m));
    expect(hits).toEqual([]);
  });

  it("every stopping message states the rule, the fact, the measurement note and the dispute link", async () => {
    const msgs = (await allMessages()).filter((m) => m.startsWith("Payment stopped by your payment policy"));
    expect(msgs.length).toBeGreaterThan(5);
    for (const m of msgs) {
      expect(m).toMatch(/\(rule: [A-Za-z_]+\)\. Fact: /);
      expect(m).toContain("This is a measurement, not a finding about the seller.");
      expect(m).toContain("Dispute: https://botsrated.com/disputes");
    }
  });

  it("README and guard sources use no banned word outside code", () => {
    // Only code is excluded. The disclaimer paragraph is checked too (it no longer uses a banned word).
    const strip = (t: string) => t.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
    for (const f of ["../README.md", "../src/payment-guard.ts"]) {
      const text = strip(readFileSync(new URL(f, import.meta.url), "utf8"));
      const lines = text.split("\n").filter((l) => BANNED.test(l));
      expect(lines, f).toEqual([]);
    }
  });
});
