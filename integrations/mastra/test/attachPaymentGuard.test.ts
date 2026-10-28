/**
 * attachPaymentGuard registers PaymentGuard on an x402 client. Free preflight stays unguarded.
 * No model calls. Fetch is stubbed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GuardDecision, PaymentGuard, PaymentGuardOptions } from "@botsrated/x402-preflight/payment-guard";
import { policies } from "@botsrated/x402-preflight/payment-guard";
import { attachPaymentGuard, attach_payment_guard, botsratedPreflight } from "../src/index";
import { paymentGuardModule, remotePolicyKey, tokenFrom, usePaymentGuardModule, type PaymentGuardModule } from "../src/guard";

const FOUND = JSON.parse(readFileSync(new URL("../../fixtures/preflight-found.json", import.meta.url), "utf8"));
const DEAD = "0x000000000000000000000000000000000000dEaD";
const TOKEN = "policy-token-example";
const SELLER_URL: string = FOUND.latest_probe.url;
const OBSERVED: string = FOUND.latest_probe.live_payTo;
const ORIGINAL_TOKEN = process.env.BOTSRATED_TOKEN;

type Decision = GuardDecision & { remote_decision?: "pass" | "warn" | "block" | null };
type HookResult = void | { abort: true; reason: string };

class RecordingClient {
  calls: string[] = [];
  hooks: Record<string, (ctx: unknown) => Promise<HookResult>> = {};

  onBeforePaymentCreation(hook: (ctx: unknown) => Promise<HookResult>) {
    this.calls.push("before");
    this.hooks.before = hook;
  }
  onAfterPaymentCreation(hook: (ctx: unknown) => Promise<HookResult>) {
    this.calls.push("after");
    this.hooks.after = hook;
  }
  onPaymentResponse(hook: (ctx: unknown) => Promise<HookResult>) {
    this.calls.push("response");
    this.hooks.response = hook;
  }
  registerExtension(ext: unknown) {
    this.calls.push("extension");
    this.hooks.extension = ext as (ctx: unknown) => Promise<HookResult>;
  }
  onPaymentCreationFailure() {
    this.calls.push("failure");
  }
  createPaymentPayload() {
    this.calls.push("sign");
    throw new Error("must not sign");
  }
}

function req(payTo: string) {
  return {
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo,
    amount: FOUND.latest_probe.live_amount as string,
    maxTimeoutSeconds: 60,
    extra: { name: "USD Coin", version: "2" },
  };
}

function paymentCtx(payTo: string) {
  const selected = req(payTo);
  return {
    paymentRequired: { x402Version: 2, resource: { url: SELLER_URL }, accepts: [selected] },
    selectedRequirements: selected,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function installFetch(policy?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/v1/policy/check")) {
      if (!policy) throw new Error("unexpected policy call");
      return policy(url, init);
    }
    if (new URL(url).pathname === "/v1/preflight") {
      const host = new URL(url).searchParams.get("url") ?? "";
      if (host.includes("blockrun.ai")) return json(FOUND);
      return json({ error: { code: "host_not_covered" } }, 404);
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

async function runBefore(guard: PaymentGuard, payTo: string): Promise<HookResult> {
  let out: HookResult;
  await guard.wrapFetch(async () => {
    out = await guard.hooks.beforePaymentCreation(paymentCtx(payTo));
    return new Response(null, { status: 204 });
  })(SELLER_URL);
  return out;
}

function policyCalls(calls: Array<{ url: string; init?: RequestInit }>) {
  return calls.filter((call) => call.url.includes("/v1/policy/check"));
}

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.BOTSRATED_TOKEN;
  else process.env.BOTSRATED_TOKEN = ORIGINAL_TOKEN;
  usePaymentGuardModule();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("attachPaymentGuard", () => {
  it("is a payment-client wrap, not a Mastra runtime", () => {
    const srcDir = new URL("../src/", import.meta.url);
    expect(readdirSync(srcDir).sort()).toEqual(["guard.ts", "hooks.ts", "index.ts"]);
    expect(attach_payment_guard).toBe(attachPaymentGuard);
    const sources = ["guard.ts", "hooks.ts", "index.ts"].map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8")).join("\n");
    for (const needle of [
      "createPaymentPayload",
      "signTypedData",
      "private_key",
      "eth_send",
      "FEATURE_GUARD_POLICY",
      "requireApproval",
      "requireToolApproval",
      "onInputAvailable",
      "inputProcessor",
      "outputProcessor",
      "wrapLanguageModel",
    ]) {
      expect(sources).not.toContain(needle);
    }
    const guardSrc = readFileSync(new URL("../src/guard.ts", import.meta.url), "utf8");
    expect(guardSrc).not.toContain("@mastra/core");
    expect(guardSrc).not.toContain("/v1/policy");
    const indexSrc = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(indexSrc).not.toContain("@mastra/core");
    const hooksSrc = readFileSync(new URL("../src/hooks.ts", import.meta.url), "utf8");
    expect(hooksSrc).toContain('import type { ToolBeforeHookResult, ToolHookContext, ToolHooks } from "@mastra/core/tools"');
    expect(hooksSrc).not.toContain(".install(");
    expect(remotePolicyKey(paymentGuardModule())).toBe("remotePolicy");
  });

  it("keeps the default-install section within 15 lines", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const start = readme.indexOf("## Default install");
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = readme.slice(start);
    const next = rest.indexOf("\n## ", 1);
    const section = next === -1 ? rest : rest.slice(0, next);
    const lines = section.trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(15);
    expect(section).toContain("Mastra");
    expect(section.toLowerCase()).toContain("not an agent");
    expect(section.toLowerCase()).toContain("beforetoolcall");
    expect(section.toLowerCase()).not.toContain("deferred");
    expect(readme.toLowerCase()).not.toContain("escrow");
    expect(readme.toLowerCase()).not.toContain("custody of");
  });

  it("does not let free preflight attach a guard", async () => {
    const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const start = src.indexOf("export async function botsratedPreflight");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start);
    expect(body).not.toContain("attachPaymentGuard");
    expect(body).not.toContain("createPaymentGuard");
    expect(body).not.toContain("onBeforePaymentCreation");
    expect(body).not.toContain(".install(");
    expect(body).not.toContain("botsratedBeforeToolCall");
    const calls = installFetch();
    const client = new RecordingClient();
    const facts = await botsratedPreflight(SELLER_URL);
    expect(facts.covered).toBe(true);
    expect(facts.host).toBe("blockrun.ai");
    expect(policyCalls(calls)).toEqual([]);
    expect(calls.every((call) => call.url.startsWith("https://botsrated.com/v1/preflight"))).toBe(true);
    expect(client.calls).toEqual([]);
    expect(JSON.stringify(facts)).not.toContain("remotePolicy");
  });

  it.each(["carefulBuyer", "strict"] as const)("blocks an unobserved payTo only for %s", async (preset) => {
    const calls = installFetch();
    const decisions: Decision[] = [];
    const client = new RecordingClient();
    const guard = attachPaymentGuard(client, { preset, failMode: "open", onDecision: (d) => decisions.push(d) });
    expect(client.calls).toEqual(["before", "after", "response", "extension"]);
    expect(client.calls).not.toContain("failure");
    expect(client.calls).not.toContain("sign");
    expect(guard.options.failOpen).toBe(true);
    const out = await runBefore(guard, DEAD);
    expect(out).toMatchObject({ abort: true });
    expect(out && "reason" in out && out.reason).toContain("Payment stopped by your payment policy");
    expect(decisions[0].action).toBe("block");
    expect(decisions[0].reasons).toContainEqual(expect.objectContaining({ code: "payto_not_observed", effect: "block" }));
    expect(policyCalls(calls)).toEqual([]);
    for (const call of calls) {
      expect(call.url.startsWith("https://botsrated.com/v1/preflight")).toBe(true);
      expect(call.url).not.toContain("payTo");
      expect(call.url).not.toContain(DEAD);
    }
    expect(client.calls).not.toContain("sign");
  });

  it("warns and does not block an unobserved payTo when preset is omitted", async () => {
    const calls = installFetch();
    const decisions: Decision[] = [];
    const client = new RecordingClient();
    const guard = attachPaymentGuard(client, { onDecision: (d) => decisions.push(d) });
    expect(guard.options.failOpen).toBeUndefined();
    expect(guard.options.preset).toBeUndefined();
    expect(guard.options.policy).toBeUndefined();
    const out = await runBefore(guard, DEAD);
    expect(out).toBeUndefined();
    expect(decisions[0].action).toBe("allow");
    expect(decisions[0].wouldBlock).toBe(false);
    expect(decisions[0].reasons).toContainEqual(expect.objectContaining({ code: "payto_not_observed", effect: "warn" }));
    expect(decisions[0].remote_decision).toBeUndefined();
    expect(policyCalls(calls)).toEqual([]);
    expect(client.calls).not.toContain("sign");
  });

  it("maps strict onto the strict policy table", () => {
    const guard = attachPaymentGuard(new RecordingClient(), { preset: "strict" });
    expect(guard.options.policy).toBe(policies.strict);
    expect(policies.strict).toBe(policies.carefulBuyer);
    expect(guard.options.preset).toBeUndefined();
  });

  it("rejects an unknown preset or failMode", () => {
    expect(() => attachPaymentGuard(new RecordingClient(), { failMode: "block" as "open" })).toThrow(/failMode/);
    expect(() => attachPaymentGuard(new RecordingClient(), { preset: "dry-run-only" as "warn" })).toThrow(/preset/);
  });

  it("fails open unless failMode is closed, and closed stops when preflight is unreachable", async () => {
    const opened = attachPaymentGuard(new RecordingClient(), { preset: "warn", failMode: "open" });
    const omitted = attachPaymentGuard(new RecordingClient(), { preset: "warn" });
    expect(opened.options.failOpen).toBe(true);
    expect(omitted.options.failOpen).toBeUndefined();

    const calls = installFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push({ url });
        throw new Error("unreachable");
      }),
    );
    const decisions: Decision[] = [];
    const client = new RecordingClient();
    const guard = attachPaymentGuard(client, { preset: "warn", failMode: "closed", onDecision: (d) => decisions.push(d) });
    expect(guard.options.failOpen).toBe(false);
    const out = await runBefore(guard, OBSERVED);
    expect(decisions[0].action).toBe("block");
    expect(decisions[0].reasons).toContainEqual(expect.objectContaining({ code: "botsrated_unreachable", effect: "block" }));
    expect(out).toMatchObject({ abort: true });
    expect(policyCalls(calls)).toEqual([]);
    expect(client.calls).not.toContain("sign");
  });

  it("makes no remote policy HTTP when token is omitted", async () => {
    const calls = installFetch();
    const decisions: Decision[] = [];
    const guard = attachPaymentGuard(new RecordingClient(), { preset: "warn", onDecision: (d) => decisions.push(d) });
    await runBefore(guard, OBSERVED);
    expect(calls.length).toBeGreaterThan(0);
    expect(policyCalls(calls)).toEqual([]);
    expect(JSON.stringify(guard.options)).not.toContain("remotePolicy");
    expect(decisions[0].remote_decision).toBeUndefined();
  });

  it("passes a mapping only when PaymentGuard accepts remotePolicy", () => {
    const recorded: unknown[] = [];
    function withRemote(options?: PaymentGuardOptions) {
      recorded.push(options);
      return { install() {}, options } as unknown as PaymentGuard;
    }
    function withSnake(options?: PaymentGuardOptions) {
      recorded.push(options);
      return { install() {}, options } as unknown as PaymentGuard;
    }
    const snakeSrc = function createPaymentGuard(options?: PaymentGuardOptions) {
      recorded.push(options);
      recorded.push("remote_policy");
      return { install() {}, options } as unknown as PaymentGuard;
    };

    expect(remotePolicyKey({ createPaymentGuard: withRemote, policies, normalizeRemotePolicy() {} })).toBe("remotePolicy");
    expect(remotePolicyKey({ createPaymentGuard: snakeSrc, policies })).toBe("remote_policy");
    expect(remotePolicyKey({ createPaymentGuard: withSnake, policies })).toBeUndefined();
    expect(tokenFrom(undefined)).toBeUndefined();
    expect(tokenFrom("")).toBeUndefined();

    usePaymentGuardModule({ createPaymentGuard: withRemote, policies, normalizeRemotePolicy() {} });
    attachPaymentGuard(new RecordingClient(), { preset: "warn", token: "abc", failMode: "closed" });
    expect(recorded.at(-1)).toMatchObject({ remotePolicy: { token: "abc", failMode: "closed" } });
    expect(typeof (recorded.at(-1) as { remotePolicy?: unknown }).remotePolicy).toBe("object");

    recorded.length = 0;
    usePaymentGuardModule({ createPaymentGuard: snakeSrc, policies });
    attachPaymentGuard(new RecordingClient(), { token: "abc" });
    expect(recorded.filter((item) => item && typeof item === "object").at(-1)).toMatchObject({ remote_policy: { token: "abc", fail_mode: "open" } });

    recorded.length = 0;
    usePaymentGuardModule({ createPaymentGuard: withSnake, policies });
    const guard = attachPaymentGuard(new RecordingClient(), { preset: "warn", token: TOKEN, failMode: "closed" });
    expect(recorded.at(-1)).not.toHaveProperty("remotePolicy");
    expect(recorded.at(-1)).not.toHaveProperty("remote_policy");
    expect(JSON.stringify(guard.options)).not.toContain(TOKEN);
  });

  it("does not call remote policy when the installed PaymentGuard lacks it", async () => {
    const published = (await import("../node_modules/@botsrated/x402-preflight/dist/payment-guard.js")) as PaymentGuardModule;
    expect(remotePolicyKey(published)).toBeUndefined();
    usePaymentGuardModule(published);
    const calls = installFetch(() => json({ decision: "pass" }));
    const client = new RecordingClient();
    const guard = attachPaymentGuard(client, { preset: "warn", token: TOKEN, failMode: "closed" });
    const out = await runBefore(guard, OBSERVED);
    const sent = calls.map((call) => call.url + JSON.stringify(call.init ?? {})).join("\n");
    expect(sent).not.toContain(TOKEN);
    expect(policyCalls(calls)).toEqual([]);
    expect(JSON.stringify(guard.options)).not.toContain(TOKEN);
    expect(out).toBeUndefined();
    expect(client.calls).not.toContain("sign");
  });

  it("reads BOTSRATED_TOKEN when token is omitted, and an explicit token wins", () => {
    const recorded: Array<PaymentGuardOptions & Record<string, unknown>> = [];
    function createPaymentGuard(options?: PaymentGuardOptions) {
      recorded.push(options ?? {});
      return { install() {}, options } as unknown as PaymentGuard;
    }
    usePaymentGuardModule({ createPaymentGuard, policies, normalizeRemotePolicy() {} });
    process.env.BOTSRATED_TOKEN = "env-token";
    attachPaymentGuard(new RecordingClient(), { preset: "warn" });
    expect(recorded.at(-1)?.remotePolicy).toEqual({ token: "env-token", failMode: "open" });

    attachPaymentGuard(new RecordingClient(), { token: "explicit-token", failMode: "closed" });
    expect(recorded.at(-1)?.remotePolicy).toEqual({ token: "explicit-token", failMode: "closed" });

    attachPaymentGuard(new RecordingClient(), { token: "" });
    expect(recorded.at(-1)?.remotePolicy).toBeUndefined();
  });

  it("stops on a remote block, and a remote pass does not clear a local block", async () => {
    const queue = [
      { decision: "block", decided_by: "customer" },
      { decision: "pass" },
    ];
    const calls = installFetch(() => json(queue.shift()));
    const blockedSeen: Decision[] = [];
    const client = new RecordingClient();
    const guard = attachPaymentGuard(client, {
      preset: "warn",
      token: TOKEN,
      failMode: "open",
      onDecision: (d) => blockedSeen.push(d),
    });
    expect(guard.options.remotePolicy).toEqual({ token: TOKEN, failMode: "open" });
    expect(typeof guard.options.remotePolicy).toBe("object");
    const stopped = await runBefore(guard, OBSERVED);
    expect(policyCalls(calls)).toHaveLength(1);
    const posted = policyCalls(calls)[0];
    expect(posted.url).toBe("https://botsrated.com/v1/policy/check");
    const headers = new Headers(posted.init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("payment-signature")).toBeNull();
    expect(blockedSeen[0].action).toBe("block");
    expect(blockedSeen[0].remote_decision).toBe("block");
    expect(blockedSeen[0].reasons).toContainEqual(expect.objectContaining({ code: "remote_policy", effect: "block" }));
    expect(stopped).toMatchObject({ abort: true });
    expect(client.calls).not.toContain("sign");

    const stillSeen: Decision[] = [];
    const strict = attachPaymentGuard(new RecordingClient(), {
      preset: "carefulBuyer",
      token: TOKEN,
      failMode: "open",
      onDecision: (d) => stillSeen.push(d),
    });
    const still = await runBefore(strict, DEAD);
    expect(queue).toEqual([]);
    expect(still).toMatchObject({ abort: true });
    expect(stillSeen[0].action).toBe("block");
    expect(stillSeen[0].remote_decision).toBe("pass");
    expect(stillSeen[0].policyRule).toBe("payToMismatch");
    expect(stillSeen[0].reasons).toContainEqual(expect.objectContaining({ code: "payto_not_observed", effect: "block" }));
  });

  it.each([
    { status: 200, body: { decision: null }, transport: false },
    { status: 503, body: { decision: null }, transport: false },
    { status: 200, body: {}, transport: true },
  ])("does not proceed when failMode is closed and the remote decision is missing ($status, transport=$transport)", async ({ status, body, transport }) => {
    const calls = installFetch((url) => {
      if (transport) throw new Error(`unreachable ${url}`);
      return json(body, status);
    });
    const decisions: Decision[] = [];
    const client = new RecordingClient();
    const guard = attachPaymentGuard(client, { preset: "warn", token: TOKEN, failMode: "closed", onDecision: (d) => decisions.push(d) });
    expect(guard.options.failOpen).toBe(false);
    expect(guard.options.remotePolicy).toEqual({ token: TOKEN, failMode: "closed" });
    const stopped = await runBefore(guard, OBSERVED);
    expect(policyCalls(calls)).toHaveLength(1);
    expect(decisions[0].action).toBe("block");
    expect(decisions[0].remote_decision).toBeNull();
    expect(decisions[0].remote_decision).not.toBe("pass");
    expect(decisions[0].reasons).toContainEqual(expect.objectContaining({ code: "remote_policy_unavailable", effect: "block" }));
    expect(stopped).toMatchObject({ abort: true });
    expect(client.calls).not.toContain("sign");
  });

  it("reports info and does not invent a pass when failMode is open and the remote decision is null", async () => {
    installFetch(() => json({ decision: null }));
    const decisions: Decision[] = [];
    const client = new RecordingClient();
    const guard = attachPaymentGuard(client, { preset: "warn", token: TOKEN, failMode: "open", onDecision: (d) => decisions.push(d) });
    const out = await runBefore(guard, OBSERVED);
    expect(decisions[0].action).toBe("allow");
    expect(decisions[0].remote_decision).toBeNull();
    expect(decisions[0].reasons).toContainEqual(expect.objectContaining({ code: "remote_policy_unavailable", effect: "info" }));
    expect(decisions[0].reasons.some((reason) => reason.effect === "block")).toBe(false);
    expect(out).toBeUndefined();
    expect(client.calls).not.toContain("sign");
  });
});
