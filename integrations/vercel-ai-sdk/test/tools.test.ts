import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { generateText, isStepCount } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { BotsRatedClient, botsratedTools } from "../src/index";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/${n}`, import.meta.url), "utf8");
const FOUND = JSON.parse(fx("preflight-found.json"));
const B64 = fx("check-402-payment-required.b64").trim();
const SAMPLE = fx("sample-check.json");
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
const api = vi.fn(async (url: string) => {
  const u = new URL(url);
  if (u.pathname === "/v1/preflight") return u.searchParams.get("url")!.includes("blockrun.ai") ? json(FOUND) : json(fx("preflight-not-covered.json"), 404);
  if (u.pathname === "/v1/check") return json({}, 402, { "payment-required": B64 });
  return json({}, 404);
});
const ctx = { toolCallId: "1", messages: [] } as any;

describe("botsratedTools", () => {
  it("is free-only by default", () => {
    expect(Object.keys(botsratedTools(new BotsRatedClient({ fetch: api })))).toEqual(["botsratedPreflight"]);
  });

  it("preflight returns allow/block decisions", async () => {
    const { botsratedPreflight } = botsratedTools(new BotsRatedClient({ fetch: api }));
    const ok: any = await botsratedPreflight.execute!({ url: FOUND.latest_probe.url, payTo: FOUND.latest_probe.live_payTo }, ctx);
    expect(ok.decision.action).toBe("allow");
    const bad: any = await botsratedPreflight.execute!({ url: FOUND.latest_probe.url, payTo: "0x000000000000000000000000000000000000dEaD" }, ctx);
    expect(bad.decision.action).toBe("block");
    expect(((await botsratedPreflight.execute!({ url: "x.example" }, ctx)) as any).covered).toBe(false);
  });

  it("paid check respects the budget", async () => {
    const client = new BotsRatedClient({ fetch: api, paid: { budgetUsd: 0.002, fetchWithPayment: async () => json(SAMPLE) } });
    const tools = botsratedTools(client) as any;
    expect(Object.keys(tools)).toEqual(["botsratedPreflight", "botsratedCheck"]);
    expect((await tools.botsratedCheck.execute({ host: "blockrun.ai" }, ctx)).remainingUsd).toBe(0);
    expect((await tools.botsratedCheck.execute({ host: "blockrun.ai" }, ctx)).error).toBe("budget_exceeded");
  });

  it("works inside generateText with a mock model", async () => {
    let step = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        step++;
        const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
        if (step === 1)
          return { content: [{ type: "tool-call", toolCallId: "c1", toolName: "botsratedPreflight", input: JSON.stringify({ url: FOUND.latest_probe.url }) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] };
        return { content: [{ type: "text", text: "checked" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
      },
    } as any);
    const res = await generateText({ model, prompt: "check blockrun", tools: botsratedTools(new BotsRatedClient({ fetch: api })), stopWhen: isStepCount(3) });
    const toolResult: any = res.steps[0].toolResults[0];
    expect(toolResult.output.covered).toBe(true);
    expect(res.text).toBe("checked");
  });
});
