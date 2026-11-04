import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guardAttach } from "../src/guard-attach";
import { evaluateCustomerPolicy, buildPolicyReceipt } from "../src/guard-policy";
import { STRICT_MODE_HALT_CHIPS, evaluateHalt, strictModeHalt } from "../src/halt-policy";

const BANNED = /\b(safe|trusted|verified|scam|risky|ranking|grades?|independent|established)\b/i;
const PAYTO = "0x1111111111111111111111111111111111111111";
const NOW = "2026-11-04T12:30:00Z";

const policy = {
  id: "pol_desk",
  version: "3",
  fail_mode: "open" as const,
  pay_to: [PAYTO],
  networks: ["eip155:8453"],
  resource_hosts: ["seller.example"],
  max_amount_atomic: "5000000",
};

const payToChanged = {
  as_of: "2026-11-04T12:00:00Z",
  expires_at: "2026-11-04T13:00:00Z",
  pay_to_unchanged: false,
  valid_402: true,
};

const probeFailed = {
  as_of: "2026-11-04T12:00:00Z",
  probe_failed: true,
};

const requirement = {
  amount: "1000",
  payTo: PAYTO,
  network: "eip155:8453",
};

function hook(attach: ReturnType<typeof guardAttach>) {
  return attach.onBeforePaymentCreation({
    paymentRequired: { resource: { url: "https://seller.example/api", description: "trusted seller text" } },
    selectedRequirements: requirement,
  });
}

describe("evaluateHalt", () => {
  it("stays off when omitted, and the strict_mode sample is the two chips", () => {
    expect(evaluateHalt(["payTo changed"], undefined).abort).toBe(false);
    expect(evaluateHalt(["payTo changed"], undefined).enabled).toBe(false);
    expect(STRICT_MODE_HALT_CHIPS).toEqual(["payTo changed", "probe failed"]);
    expect(strictModeHalt()).toEqual({ strict_mode: true });
    const src = readFileSync(new URL("../src/halt-policy.ts", import.meta.url), "utf8");
    expect(src).not.toContain("failOpen");
    const guard = readFileSync(new URL("../src/payment-guard.ts", import.meta.url), "utf8");
    expect(guard).toContain("const failOpen = opts.failOpen !== false");
    expect(guard).not.toContain("haltOn");
  });

  it("matches the customer's first listed chip and rejects a word outside the set", () => {
    const matched = evaluateHalt(["live", "402 ok", "payTo changed"], ["402 ok", "payTo changed"]);
    expect(matched.abort).toBe(true);
    expect(matched.matched).toBe("402 ok");
    expect(matched.message).toMatch(/measured chip "402 ok"/);
    expect(matched.message).toMatch(/this record only/);
    expect(matched.message).toMatch(/not a rating/);
    expect(matched.message).not.toMatch(BANNED);

    const bad = evaluateHalt(["payTo changed"], ["trusted"]);
    expect(bad.abort).toBe(true);
    expect(bad.matched).toBeNull();
    expect(bad.message).toBe("Your halt list could not be read. The payment stops.");
    expect(bad.message).not.toMatch(BANNED);
    expect(evaluateHalt(["payTo changed"], []).abort).toBe(false);
    expect(evaluateHalt(["no data yet"], { strict_mode: true }).abort).toBe(false);
    expect(evaluateHalt(["probe failed"], { strict_mode: false }).abort).toBe(false);
  });
});

describe("guardAttach halt", () => {
  it("does not abort a payTo change unless the customer opts in", async () => {
    const open = guardAttach({ policy, measured: payToChanged, now: NOW });
    expect(await hook(open)).toBeUndefined();
    expect(open.failOpenDefault).toBe(true);
    expect(open.lastVerdict()?.verdict).toBe("pass");
    expect(open.lastVerdict()?.chips).toEqual(["live", "402 ok", "payTo changed"]);
    expect(open.lastHalt()?.enabled).toBe(false);

    const halted = guardAttach({ policy, measured: payToChanged, now: NOW, haltOn: strictModeHalt() });
    const result = await hook(halted);
    expect(result).toEqual({ abort: true, reason: expect.stringMatching(/measured chip "payTo changed"/) });
    expect(halted.failOpenDefault).toBe(true);
    expect(halted.lastVerdict()?.verdict).toBe("pass");
    expect(halted.lastVerdict()?.abort).toBe(false);
    expect(halted.lastHalt()?.abort).toBe(true);
    expect(String(result && "reason" in result ? result.reason : "")).not.toMatch(BANNED);
  });

  it("keeps the policy reason when the policy already aborts", async () => {
    const attach = guardAttach({
      policy,
      measured: payToChanged,
      now: NOW,
      haltOn: strictModeHalt(),
    });
    const result = await attach.onBeforePaymentCreation({
      paymentRequired: { resource: { url: "https://seller.example/api" } },
      selectedRequirements: { ...requirement, payTo: "0x2222222222222222222222222222222222222222" },
    });
    expect(result).toEqual({ abort: true, reason: expect.stringMatching(/Your policy failed \(rule: pay_to\)/) });
    expect(attach.lastHalt()?.matched).toBe("payTo changed");
  });

  it("lets the customer replace the sample, including via policy fields", async () => {
    const onlyProbe = guardAttach({
      policy: { ...policy, strict_mode: true },
      measured: payToChanged,
      now: NOW,
      haltOn: ["probe failed"],
    });
    expect(await hook(onlyProbe)).toBeUndefined();
    expect(onlyProbe.lastHalt()?.enabled).toBe(true);
    expect(onlyProbe.lastHalt()?.chips).toEqual(["probe failed"]);

    const fromPolicy = guardAttach({
      policy: { ...policy, strict_mode: true },
      measured: probeFailed,
      now: NOW,
    });
    expect(await hook(fromPolicy)).toEqual({ abort: true, reason: expect.stringMatching(/measured chip "probe failed"/) });

    const listed = guardAttach({
      policy: { ...policy, halt_on: ["no data yet"] },
    });
    expect(await hook(listed)).toEqual({ abort: true, reason: expect.stringMatching(/measured chip "no data yet"/) });
  });

  it("drops an MCP option and refuses onPaymentRequested without changing the policy verdict", async () => {
    const evaluation = evaluateCustomerPolicy({ ...policy, strict_mode: true }, requirement, {
      resourceUrl: "https://seller.example/api",
      measured: probeFailed,
      now: NOW,
    });
    expect(evaluation.verdict).toBe("pass");
    expect(evaluation.abort).toBe(false);
    expect(evaluation.chips).toEqual(["probe failed"]);
    const receipt = await buildPolicyReceipt({
      evaluation,
      orgId: "org_desk",
      policyId: "pol_desk",
      policyVersion: "3",
    });
    expect(receipt.verdict).toBe("pass");
    expect(receipt.chips).toEqual(["probe failed"]);
    expect(JSON.stringify(receipt)).not.toMatch(BANNED);

    const attach = guardAttach({ policy, measured: probeFailed, now: NOW, haltOn: { strict_mode: true } });
    expect(attach.mcpPolicy(2, [{ ...requirement }])).toEqual([]);
    expect(attach.lastVerdict()?.verdict).toBe("pass");
    expect(attach.lastHalt()?.abort).toBe(true);
    const approved = await attach.onPaymentRequested({
      paymentRequired: {
        resource: { url: "https://seller.example/api" },
        accepts: [{ ...requirement }],
      },
    });
    expect(approved).toBe(false);
    expect(attach.failOpenDefault).toBe(true);
  });

  it("keeps fail_mode open when the halt list cannot be read", async () => {
    const attach = guardAttach({ policy, haltOn: { strict_mode: "yes" as unknown as boolean } });
    const result = await hook(attach);
    expect(result).toEqual({ abort: true, reason: "Your halt list could not be read. The payment stops." });
    expect(attach.lastVerdict()?.fail_mode).toBe("open");
    expect(attach.failOpenDefault).toBe(true);
    const attachSrc = readFileSync(new URL("../src/guard-attach.ts", import.meta.url), "utf8");
    expect(attachSrc).not.toContain("failOpen: false");
  });
});
