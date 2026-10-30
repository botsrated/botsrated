import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HOSTED_TIMEOUT_MS,
  MAX_HOSTED_TIMEOUT_MS,
  createPaymentGuard,
  resetHostedLookupCircuit,
  type GuardDecision,
} from "../src/payment-guard";
import { FOUND, SELLER_URL, json, pr, req } from "./helpers";

const ctx = (resourceUrl: string, row = req()) => ({ paymentRequired: pr(resourceUrl, [row]), selectedRequirements: row });

afterEach(() => {
  vi.useRealTimers();
});

describe("hosted lookup timeout clamp and overload circuit", () => {
  it("keeps the 3s default and clamps timeoutMs to 10s", async () => {
    expect(DEFAULT_HOSTED_TIMEOUT_MS).toBe(3_000);
    expect(MAX_HOSTED_TIMEOUT_MS).toBe(10_000);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const seen: number[] = [];
    const hang = () => {
      let signal: AbortSignal | undefined;
      const f = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_res, rej) => {
            signal = init?.signal ?? undefined;
            signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
          }),
      );
      return { f, signal: () => signal };
    };

    resetHostedLookupCircuit();
    const under = hang();
    const underGuard = createPaymentGuard({ fetch: under.f as any, timeoutMs: 1_500 });
    const underRun = underGuard.hooks.beforePaymentCreation(ctx(SELLER_URL));
    await vi.advanceTimersByTimeAsync(1_499);
    expect(under.signal()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(under.signal()?.aborted).toBe(true);
    expect(await underRun).toBeUndefined();
    seen.push(under.f.mock.calls.length);

    resetHostedLookupCircuit();
    const over = hang();
    const overGuard = createPaymentGuard({ fetch: over.f as any, timeoutMs: 60_000 });
    const overRun = overGuard.hooks.beforePaymentCreation(ctx(SELLER_URL));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(over.signal()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(over.signal()?.aborted).toBe(true);
    expect(await overRun).toBeUndefined();
    await overGuard.hooks.beforePaymentCreation(ctx("https://other.example/a"));
    expect(over.f).toHaveBeenCalledOnce();
    seen.push(over.f.mock.calls.length);

    resetHostedLookupCircuit();
    const inf = hang();
    const infGuard = createPaymentGuard({ fetch: inf.f as any, timeoutMs: Number.POSITIVE_INFINITY });
    const infRun = infGuard.hooks.beforePaymentCreation(ctx(SELLER_URL));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(inf.signal()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(inf.signal()?.aborted).toBe(true);
    expect(await infRun).toBeUndefined();
    expect(seen).toEqual([1, 1]);
  });

  it("503 Retry-After opens a process circuit, skips the next lookup, and stays advice-only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const decisions: GuardDecision[] = [];
    const f = vi.fn(async () => json({ error: "overload" }, 503, { "retry-after": "30" }));
    const first = createPaymentGuard({ fetch: f as any, onDecision: (d) => decisions.push(d) });
    expect(await first.hooks.beforePaymentCreation(ctx(SELLER_URL))).toBeUndefined();
    expect(f).toHaveBeenCalledOnce();
    expect(f.mock.calls[0][0]).toBe("https://botsrated.com/v1/preflight?url=blockrun.ai");
    expect(String(f.mock.calls[0][0])).not.toContain("/api");
    expect(decisions[0]).toMatchObject({ action: "allow", wouldBlock: false });
    expect(decisions[0].reasons).toContainEqual(expect.objectContaining({ code: "botsrated_unreachable", effect: "info", rule: "failOpen" }));
    expect(decisions[0].remote_decision).toBeUndefined();
    expect(decisions[0].message).not.toMatch(/\bpass\b/i);

    const second = createPaymentGuard({ fetch: f as any, onDecision: (d) => decisions.push(d) });
    expect(await second.hooks.beforePaymentCreation(ctx(SELLER_URL))).toBeUndefined();
    expect(f).toHaveBeenCalledOnce();
    expect(decisions[1]).toMatchObject({ action: "allow", wouldBlock: false });
    expect(decisions[1].reasons).toContainEqual(expect.objectContaining({ code: "botsrated_unreachable", effect: "info" }));

    await vi.advanceTimersByTimeAsync(29_000);
    await second.hooks.beforePaymentCreation(ctx("https://other.example/a"));
    expect(f).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    await second.hooks.beforePaymentCreation(ctx("https://other.example/a"));
    expect(f).toHaveBeenCalledTimes(2);

    resetHostedLookupCircuit();
    const closedDecisions: GuardDecision[] = [];
    const closedFetch = vi.fn(async () => json({ error: "overload" }, 503, { "retry-after": "15" }));
    const closed = createPaymentGuard({ fetch: closedFetch as any, failOpen: false, onDecision: (d) => closedDecisions.push(d) });
    expect(await closed.hooks.beforePaymentCreation(ctx(SELLER_URL))).toMatchObject({ abort: true });
    expect(closedDecisions[0].reasons).toContainEqual(expect.objectContaining({ code: "botsrated_unreachable", effect: "block" }));
    expect(closedDecisions[0].remote_decision).toBeUndefined();
    const skipped = createPaymentGuard({ fetch: closedFetch as any, failOpen: false });
    expect(await skipped.hooks.beforePaymentCreation(ctx("https://third.example/a"))).toMatchObject({ abort: true });
    expect(closedFetch).toHaveBeenCalledOnce();
  });

  it("503 without Retry-After uses a 5s circuit, and 429 skips the next lookup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const slow = vi.fn(async () => json({}, 503));
    const g = createPaymentGuard({ fetch: slow as any });
    await g.hooks.beforePaymentCreation(ctx(SELLER_URL));
    await vi.advanceTimersByTimeAsync(4_999);
    await g.hooks.beforePaymentCreation(ctx("https://other.example/a"));
    expect(slow).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await g.hooks.beforePaymentCreation(ctx("https://other.example/a"));
    expect(slow).toHaveBeenCalledTimes(2);

    resetHostedLookupCircuit();
    const limited = vi.fn(async () => json({}, 429, { "retry-after": "12" }));
    const again = createPaymentGuard({ fetch: limited as any });
    await again.hooks.beforePaymentCreation(ctx(SELLER_URL));
    const other = createPaymentGuard({ fetch: limited as any });
    await other.hooks.beforePaymentCreation(ctx("https://other.example/b"));
    expect(limited).toHaveBeenCalledOnce();
  });

  it("honors an HTTP-date Retry-After", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const when = new Date(Date.now() + 40_000).toUTCString();
    const f = vi.fn(async () => json({}, 503, { "retry-after": when }));
    const g = createPaymentGuard({ fetch: f as any });
    await g.hooks.beforePaymentCreation(ctx(SELLER_URL));
    await vi.advanceTimersByTimeAsync(20_000);
    await g.hooks.beforePaymentCreation(ctx("https://other.example/a"));
    expect(f).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(21_000);
    await g.hooks.beforePaymentCreation(ctx("https://other.example/a"));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("policy 503 is a miss, opens the circuit, and does not invent a pass", async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/v1/policy/check")) return json({ decision: "pass" }, 503, { "retry-after": "20" });
      return json(FOUND);
    });
    const seen: GuardDecision[] = [];
    const g = createPaymentGuard({
      fetch: f as any,
      onDecision: (d) => seen.push(d),
      remotePolicy: { token: "policy-token-1", failMode: "open" },
    });
    expect(await g.hooks.beforePaymentCreation(ctx(SELLER_URL))).toBeUndefined();
    expect(seen[0].action).toBe("allow");
    expect(seen[0].remote_decision).toBeNull();
    expect(seen[0].reasons).toContainEqual(expect.objectContaining({ code: "remote_policy_unavailable", effect: "info", rule: "failMode" }));
    expect(calls.filter((url) => url.includes("/v1/policy/check"))).toHaveLength(1);

    const next = createPaymentGuard({
      fetch: f as any,
      onDecision: (d) => seen.push(d),
      remotePolicy: { token: "policy-token-1", failMode: "open" },
    });
    expect(await next.hooks.beforePaymentCreation(ctx(SELLER_URL))).toBeUndefined();
    expect(calls.filter((url) => url.includes("/v1/policy/check"))).toHaveLength(1);
    expect(seen[1].remote_decision).toBeNull();
    expect(seen[1].action).toBe("allow");
  });

  it("a 503 on another policy origin does not skip the botsrated preflight", async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("policy.example")) return json({ decision: null }, 503, { "retry-after": "30" });
      return json(FOUND);
    });
    const g = createPaymentGuard({
      fetch: f as any,
      remotePolicy: { token: "policy-token-1", failMode: "open", baseUrl: "https://policy.example" },
    });
    await g.hooks.beforePaymentCreation(ctx(SELLER_URL));
    await g.hooks.beforePaymentCreation(ctx("https://other.example/a"));
    expect(calls.filter((url) => url.includes("botsrated.com/v1/preflight"))).toHaveLength(2);
  });

  it("404 and 500 do not open the circuit", async () => {
    const missing = vi.fn(async () => json({ error: { code: "host_not_covered" } }, 404));
    const uncovered = createPaymentGuard({ fetch: missing as any });
    await uncovered.hooks.beforePaymentCreation(ctx(SELLER_URL));
    await uncovered.hooks.beforePaymentCreation(ctx("https://other.example/a"));
    expect(missing).toHaveBeenCalledTimes(2);

    const broken = vi.fn(async () => json({}, 500));
    const errored = createPaymentGuard({ fetch: broken as any });
    await errored.hooks.beforePaymentCreation(ctx(SELLER_URL));
    await errored.hooks.beforePaymentCreation(ctx("https://other.example/a"));
    expect(broken).toHaveBeenCalledTimes(2);
  });
});
