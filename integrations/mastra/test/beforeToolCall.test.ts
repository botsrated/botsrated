/**
 * botsratedBeforeToolCall runs the same PaymentGuard for named paid tools.
 * No model calls. Fetch is stubbed. One case drives a real Mastra Agent.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import { attachPaymentGuard, botsratedBeforeToolCall } from "../src/index";

const FOUND = JSON.parse(readFileSync(new URL("../../fixtures/preflight-found.json", import.meta.url), "utf8"));
const DEAD = "0x000000000000000000000000000000000000dEaD";
const TOKEN = "policy-token-example";
const SELLER_URL: string = FOUND.latest_probe.url;
const OBSERVED: string = FOUND.latest_probe.live_payTo;

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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
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
    }),
  );
  return calls;
}

class RecordingClient {
  onBeforePaymentCreation() {}
  onAfterPaymentCreation() {}
  onPaymentResponse() {}
  registerExtension() {}
  createPaymentPayload() {
    throw new Error("must not sign");
  }
}

function hookFor(preset: "carefulBuyer" | "warn" | "strict" | undefined, extra: { token?: string; failMode?: "open" | "closed" } = {}) {
  const guard = attachPaymentGuard(new RecordingClient(), { ...(preset ? { preset } : {}), ...extra });
  return { guard, hooks: botsratedBeforeToolCall(guard, { paidTools: ["paidApi"] }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("botsratedBeforeToolCall", () => {
  it("matches hooks, beforeToolCall, and ToolBeforeHookResult in the pinned @mastra/core types", () => {
    const pkg = JSON.parse(readFileSync(new URL("../node_modules/@mastra/core/package.json", import.meta.url), "utf8"));
    const [major, minor] = String(pkg.version).split(".").map(Number);
    expect(major).toBe(1);
    expect(minor).toBeGreaterThanOrEqual(49);
    const tools = readFileSync(new URL("../node_modules/@mastra/core/dist/tools/types.d.ts", import.meta.url), "utf8");
    expect(tools).toContain("export interface ToolHookContext");
    expect(tools).toContain("export interface ToolBeforeHookResult");
    expect(tools).toContain("proceed: false");
    expect(tools).toContain("export interface ToolHooks");
    expect(tools).toContain("beforeToolCall?:");
    const agent = readFileSync(new URL("../node_modules/@mastra/core/dist/agent/types.d.ts", import.meta.url), "utf8");
    expect(agent).toContain("hooks?: ToolHooks");
    const peer = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(peer.peerDependencies["@mastra/core"]).toBe(">=1.49.0 <2");
    expect(peer.peerDependenciesMeta["@mastra/core"].optional).toBe(true);
  });

  it("blocks a named paid tool through the same guard and leaves the input unchanged", async () => {
    installFetch();
    const seen: unknown[] = [];
    const guard = attachPaymentGuard(new RecordingClient(), { preset: "carefulBuyer" });
    const original = guard.hooks.beforePaymentCreation.bind(guard.hooks);
    guard.hooks.beforePaymentCreation = async (ctx: unknown) => {
      seen.push(ctx);
      return original(ctx);
    };
    const hooks = botsratedBeforeToolCall(guard, { paidTools: ["paidApi"] });
    const input = { payment_context: paymentCtx(DEAD), note: "keep" };
    const before = structuredClone(input);
    const out = await hooks.beforeToolCall!({ toolName: "paidApi", input, context: { run: 1 } });
    expect(out).toMatchObject({ proceed: false, output: { blocked: true } });
    expect((out as { output: { reason: string } }).output.reason).toContain("Payment stopped by your payment policy");
    expect(input).toEqual(before);
    expect(seen[0]).toEqual(paymentCtx(DEAD));
  });

  it.each(["x402", "payment"] as const)("reads the payment context from %s", async (key) => {
    installFetch();
    const { hooks } = hookFor("strict");
    const out = await hooks.beforeToolCall!({ toolName: "paidApi", input: { [key]: paymentCtx(DEAD) }, context: {} });
    expect(out).toMatchObject({ proceed: false, output: { blocked: true } });
  });

  it("treats an input that already carries paymentRequired as the context", async () => {
    installFetch();
    const { hooks } = hookFor("carefulBuyer");
    const out = await hooks.beforeToolCall!({ toolName: "paidApi", input: paymentCtx(DEAD), context: {} });
    expect(out).toMatchObject({ proceed: false, output: { blocked: true } });
  });

  it("does not ask the guard about tools that are not named, and calls next on a pass", async () => {
    installFetch();
    const { guard } = hookFor("carefulBuyer");
    let asked = 0;
    const original = guard.hooks.beforePaymentCreation;
    guard.hooks.beforePaymentCreation = async (ctx: unknown) => {
      asked += 1;
      return original(ctx);
    };
    const nextCalls: string[] = [];
    const hooks = botsratedBeforeToolCall(guard, {
      paidTools: { paidApi: true, payOther: "ignored" },
      next(ctx) {
        nextCalls.push(ctx.toolName);
        return undefined;
      },
    });
    const other = { query: "hello", payment_context: paymentCtx(DEAD) };
    const otherBefore = structuredClone(other);
    expect(await hooks.beforeToolCall!({ toolName: "search", input: other, context: {} })).toBeUndefined();
    expect(other).toEqual(otherBefore);
    expect(asked).toBe(0);
    expect(nextCalls).toEqual(["search"]);

    const allowedInput = { payment_context: paymentCtx(OBSERVED) };
    const allowedBefore = structuredClone(allowedInput);
    const warn = attachPaymentGuard(new RecordingClient(), { preset: "warn" });
    const pass = botsratedBeforeToolCall(warn, {
      paidTools: ["paidApi"],
      next(ctx) {
        nextCalls.push(ctx.toolName);
        return undefined;
      },
    });
    expect(await pass.beforeToolCall!({ toolName: "paidApi", input: allowedInput, context: {} })).toBeUndefined();
    expect(allowedInput).toEqual(allowedBefore);
    expect(nextCalls).toEqual(["search", "paidApi"]);
  });

  it("does not call next when the named tool is blocked", async () => {
    installFetch();
    const { guard } = hookFor("carefulBuyer");
    const hooks = botsratedBeforeToolCall(guard, {
      paidTools: ["paidApi"],
      next() {
        throw new Error("next must not run");
      },
    });
    const out = await hooks.beforeToolCall!({ toolName: "paidApi", input: { payment: paymentCtx(DEAD) }, context: {} });
    expect(out).toMatchObject({ proceed: false, output: { blocked: true } });
  });

  it("blocks a named tool when the payment context cannot be read, without calling the guard", async () => {
    const guard = attachPaymentGuard(new RecordingClient(), { preset: "warn" });
    guard.hooks.beforePaymentCreation = async () => {
      throw new Error("guard was asked");
    };
    const hooks = botsratedBeforeToolCall(guard, { paidTools: "paidApi" });
    const input = { city: "Paris" };
    const out = await hooks.beforeToolCall!({ toolName: "paidApi", input, context: {} });
    expect(out).toEqual({
      proceed: false,
      output: { blocked: true, reason: "Payment stopped by your payment policy. The payment context for this tool could not be read." },
    });
    expect(input).toEqual({ city: "Paris" });
    expect(await hooks.beforeToolCall!({ toolName: "search", input: { city: "Paris" }, context: {} })).toBeUndefined();
  });

  it("blocks when the guard throws, and does not throw to retry", async () => {
    const hooks = botsratedBeforeToolCall(
      { hooks: { beforePaymentCreation: async () => { throw new Error("boom"); } } } as never,
      { paidTools: ["paidApi"] },
    );
    const out = await hooks.beforeToolCall!({ toolName: "paidApi", input: { payment_context: paymentCtx(DEAD) }, context: {} });
    expect(out).toEqual({
      proceed: false,
      output: { blocked: true, reason: "Payment stopped by your payment policy. The payment guard could not evaluate this payment." },
    });
  });

  it("stops on a remote block, and a remote pass does not clear a local block", async () => {
    const queue = [{ decision: "block" }, { decision: "pass" }];
    installFetch(() => json(queue.shift()));
    const blocked = botsratedBeforeToolCall(
      attachPaymentGuard(new RecordingClient(), { preset: "warn", token: TOKEN, failMode: "open" }),
      { paidTools: ["paidApi"] },
    );
    const stopped = await blocked.beforeToolCall!({
      toolName: "paidApi",
      input: { x402: paymentCtx(OBSERVED) },
      context: {},
    });
    expect(stopped).toMatchObject({ proceed: false, output: { blocked: true } });

    const still = botsratedBeforeToolCall(
      attachPaymentGuard(new RecordingClient(), { preset: "carefulBuyer", token: TOKEN, failMode: "open" }),
      { paidTools: ["paidApi"] },
    );
    const local = await still.beforeToolCall!({
      toolName: "paidApi",
      input: { payment_context: paymentCtx(DEAD) },
      context: {},
    });
    expect(queue).toEqual([]);
    expect(local).toMatchObject({ proceed: false, output: { blocked: true } });
    expect((local as { output: { reason: string } }).output.reason).toContain("Payment stopped by your payment policy");
  });

  it("does not proceed when failMode is closed and the remote decision is null", async () => {
    installFetch(() => json({ decision: null }));
    const closed = botsratedBeforeToolCall(
      attachPaymentGuard(new RecordingClient(), { preset: "warn", token: TOKEN, failMode: "closed" }),
      { paidTools: ["paidApi"] },
    );
    const stopped = await closed.beforeToolCall!({
      toolName: "paidApi",
      input: { payment_context: paymentCtx(OBSERVED) },
      context: {},
    });
    expect(stopped).toMatchObject({ proceed: false, output: { blocked: true } });

    const opened = botsratedBeforeToolCall(
      attachPaymentGuard(new RecordingClient(), { preset: "warn", token: TOKEN, failMode: "open" }),
      { paidTools: ["paidApi"] },
    );
    const input = { payment_context: paymentCtx(OBSERVED) };
    expect(await opened.beforeToolCall!({ toolName: "paidApi", input, context: {} })).toBeUndefined();
  });

  it("rejects paidTools that do not name a tool", () => {
    const guard = attachPaymentGuard(new RecordingClient(), { preset: "warn" });
    expect(() => botsratedBeforeToolCall(guard, { paidTools: [] })).toThrow(/paidTools/);
    expect(() => botsratedBeforeToolCall(guard, { paidTools: "" })).toThrow(/paidTools/);
    expect(() => botsratedBeforeToolCall(guard, { paidTools: { "": true } })).toThrow(/paidTools/);
  });

  it("skips execute on a real Agent when the hook blocks, and still runs other tools", async () => {
    installFetch();
    const ran: string[] = [];
    const guard = attachPaymentGuard(new RecordingClient(), { preset: "carefulBuyer" });
    const paidApi = createTool({
      id: "paid-api",
      description: "Pay a seller",
      execute: async () => {
        ran.push("paidApi");
        return { paid: true };
      },
    });
    const search = createTool({
      id: "search",
      description: "Search",
      execute: async () => {
        ran.push("search");
        return { ok: true };
      },
    });
    const agent = new Agent({
      id: "a",
      name: "a",
      instructions: "test",
      model: new MastraLanguageModelV2Mock({
        doGenerate: async () => {
          throw new Error("model must not be called");
        },
      }),
      tools: { paidApi, search },
      hooks: botsratedBeforeToolCall(guard, { paidTools: ["paidApi"] }),
    });
    expect(agent.getConfiguredToolHooks()?.beforeToolCall).toBeTypeOf("function");
    const tools = await agent.getToolsForExecution({});
    const blocked = await tools.paidApi.execute!({ payment_context: paymentCtx(DEAD) }, {} as never);
    expect(blocked).toMatchObject({ blocked: true });
    expect(String((blocked as { reason?: string }).reason)).toContain("Payment stopped by your payment policy");
    expect(ran).toEqual([]);
    const allowed = await tools.search.execute!({ q: "hi" }, {} as never);
    expect(allowed).toEqual({ ok: true });
    expect(ran).toEqual(["search"]);
  });
});
