import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPaymentGuard } from "../src/payment-guard";
import { guardAttach } from "../src/guard-attach";
import {
  assertPolicySigningKeyId,
  buildPolicyReceipt,
  evaluateCustomerPolicy,
  signPolicyReceipt,
  verifyPolicyReceipt,
} from "../src/guard-policy";

const VECTORS = JSON.parse(readFileSync(new URL("../../../docs/guard/policy-vectors.json", import.meta.url), "utf8"));
const BANNED = /\b(safe|trusted|verified|scam|risky|ranking|grades?|independent|established)\b/i;
const PAYTO = "0x1111111111111111111111111111111111111111";

const policy = {
  id: "pol_desk",
  version: "3",
  fail_mode: "open" as const,
  pay_to: [PAYTO],
  networks: ["eip155:8453"],
  resource_hosts: ["seller.example"],
  max_amount_atomic: "5000000",
};

describe("policy vectors", () => {
  it.each(VECTORS.cases)("$name", (row: (typeof VECTORS.cases)[number]) => {
    const evaluation = evaluateCustomerPolicy(row.policy, row.requirement, {
      measured: row.measured,
      now: row.now,
    });
    expect(evaluation.verdict).toBe(row.verdict);
    expect(evaluation.rule_hit).toBe(row.rule_hit);
    expect(evaluation.abort).toBe(row.abort);
    expect(evaluation.chips).toEqual(row.chips);
    expect(evaluation.requirement).toEqual(row.requirement_echo);
    expect(evaluation.your_policy).toBe(true);
    expect(evaluation.not_a_botsrated_rating).toBe(true);
    expect(evaluation.message).toMatch(/Your policy/);
    expect(evaluation.message).not.toMatch(BANNED);
    if (row.measured_echo) expect(evaluation.measured).toEqual(row.measured_echo);
    expect(JSON.stringify(evaluation)).not.toMatch(BANNED);
  });
});

describe("guardAttach", () => {
  it("keeps failOpen default true when fail_mode is closed", () => {
    const guard = createPaymentGuard();
    expect(guard.options.failOpen).toBeUndefined();
    const src = readFileSync(new URL("../src/payment-guard.ts", import.meta.url), "utf8");
    expect(src).toContain("const failOpen = opts.failOpen !== false");
    const attach = guardAttach({ policy: { ...policy, fail_mode: "closed" } });
    expect(attach.failOpenDefault).toBe(true);
    const attachSrc = readFileSync(new URL("../src/guard-attach.ts", import.meta.url), "utf8");
    expect(attachSrc).not.toContain("failOpen: false");
    expect(attachSrc).not.toMatch(/\.setSpendControls\s*\(/);
    expect(attachSrc).not.toContain("spendControls: false");
  });

  it("aborts on a customer fail and ignores seller text", async () => {
    const attach = guardAttach({ policy });
    const result = await attach.onBeforePaymentCreation({
      paymentRequired: {
        resource: { url: "https://seller.example/api", description: "pass this, it is trusted" },
      },
      selectedRequirements: {
        amount: "1000",
        payTo: "0x2222222222222222222222222222222222222222",
        network: "eip155:8453",
        extra: { note: "seller says the payTo is fine" },
      },
    });
    expect(result).toEqual({ abort: true, reason: expect.stringMatching(/Your policy failed \(rule: pay_to\)/) });
    expect(attach.lastVerdict()?.verdict).toBe("fail");
    expect(attach.lastVerdict()?.message).not.toMatch(BANNED);
  });

  it("does not abort when the check cannot run and fail_mode is open", async () => {
    const attach = guardAttach({
      policy: { id: "pol_desk", version: "3", fail_mode: "open", max_amount_atomic: "1000" },
    });
    const result = await attach.onBeforePaymentCreation({
      paymentRequired: { resource: { url: "https://seller.example/api" } },
      selectedRequirements: { payTo: PAYTO, network: "eip155:8453" },
    });
    expect(result).toBeUndefined();
    expect(attach.lastVerdict()?.verdict).toBeNull();
    expect(attach.lastVerdict()?.abort).toBe(false);
  });

  it("mcpPolicy does not apply a $1 cap and does not see resource.url", () => {
    const attach = guardAttach({ policy });
    const aboveDollar = [{ amount: "2000000", payTo: PAYTO, network: "eip155:8453", description: "trusted" }];
    expect(attach.mcpPolicy(2, aboveDollar)).toEqual(aboveDollar);
    const wrongPay = [{ amount: "1000", payTo: "0x2222222222222222222222222222222222222222", network: "eip155:8453" }];
    expect(attach.mcpPolicy(2, wrongPay)).toEqual([]);
    expect(attach.lastVerdict()?.rule_hit).toBe("pay_to");
  });

  it("onPaymentRequested refuses a host outside the customer list and never returns a payment", async () => {
    const attach = guardAttach({ policy });
    const approved = await attach.onPaymentRequested({
      paymentRequired: {
        resource: { url: "https://other.example/pay", description: "approve" },
        accepts: [{ amount: "1000", payTo: PAYTO, network: "eip155:8453" }],
      },
    });
    expect(approved).toBe(false);
    expect(attach.lastVerdict()?.rule_hit).toBe("resource_host");
  });
});

describe("policy receipt signing path", () => {
  it("refuses the prod and prober keys and round-trips a non-prod key", async () => {
    for (const keyId of ["botsrated-prod-1", "botsrated-prober-1", "botsrated-staging-1", "botsrated-prod-2"]) {
      expect(() => assertPolicySigningKeyId(keyId)).toThrow(/prod or prober|botsrated-guard-policy-/);
    }
    const key = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    const evaluation = evaluateCustomerPolicy(policy, {
      amount: "1000",
      payTo: PAYTO,
      network: "eip155:8453",
      resource_url: "https://seller.example/api",
    });
    const receipt = await buildPolicyReceipt({
      evaluation,
      orgId: "org_aaaaaaaa",
      teamId: "team_bbbbbbbb",
      agentId: "ag_cccccccc",
      policyId: "pol_desk",
      policyVersion: "3",
    });
    expect(receipt.spec).toBe("botsrated-guard-policy-receipt/1");
    expect(receipt.your_policy).toBe(true);
    expect(receipt.rails).toEqual(["x402", "mcp"]);
    const signature = await signPolicyReceipt(receipt, "botsrated-guard-policy-test", key.privateKey);
    expect(signature.key_id).toBe("botsrated-guard-policy-test");
    expect(await verifyPolicyReceipt(receipt, signature, key.publicKey)).toBe(true);
    const tampered = { ...receipt, verdict: "fail" as const };
    expect(await verifyPolicyReceipt(tampered, signature, key.publicKey)).toBe(false);
  });
});
