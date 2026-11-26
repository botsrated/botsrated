// Repro tests for the Nov 24 audit, findings A and B. Each failed on 0.3.5 and passes on 0.3.6.
import { describe, expect, it } from "vitest";
import { guardAttach } from "../src/guard-attach";
import { evaluateCustomerPolicy } from "../src/guard-policy";
import { SOLANA_FIXTURES } from "./solana_fixtures";

const { SOL_NET, SOL_PAY, SOL_OTHER } = SOLANA_FIXTURES;
const EVM = "0x1111111111111111111111111111111111111111";

describe("finding A: an unreadable policy never lets a payment through silently", () => {
  it("cap 1000 with a Solana pay_to: the cap is enforced", async () => {
    const policy = { id: "pol_sol", version: "1", max_amount_atomic: "1000", pay_to: [SOL_PAY] };
    const attach = guardAttach({ policy });
    const result = await attach.onBeforePaymentCreation({
      selectedRequirements: { amount: "999999999", payTo: SOL_PAY, network: SOL_NET },
    });
    expect(result).toMatchObject({ abort: true });
    expect(attach.lastVerdict()?.rule_hit).toBe("amount");
  });

  it("a Solana pay_to rule passes its own address and fails another", () => {
    const policy = { id: "pol_sol", version: "1", max_amount_atomic: "1000", pay_to: [SOL_PAY] };
    expect(evaluateCustomerPolicy(policy, { amount: "10", payTo: SOL_PAY, network: SOL_NET }).verdict).toBe("pass");
    const other = evaluateCustomerPolicy(policy, { amount: "10", payTo: SOL_OTHER, network: SOL_NET });
    expect(other.verdict).toBe("fail");
    expect(other.rule_hit).toBe("pay_to");
    // Solana addresses are case-sensitive: a case-changed address is a different address.
    const swapped = SOL_PAY.replace(/[a-z]/, (c) => c.toUpperCase());
    if (swapped !== SOL_PAY) {
      expect(evaluateCustomerPolicy(policy, { amount: "10", payTo: swapped, network: SOL_NET }).verdict).not.toBe("pass");
    }
    // EVM still matches case-insensitively.
    const evm = { id: "pol_evm", version: "1", pay_to: [EVM] };
    expect(evaluateCustomerPolicy(evm, { amount: "10", payTo: EVM.toUpperCase().replace("0X", "0x"), network: "eip155:8453" }).verdict).toBe("pass");
  });

  it("a policy id containing a space: guardAttach refuses to start", () => {
    expect(() => guardAttach({ policy: { id: "pol desk", version: "1", max_amount_atomic: "1000" } })).toThrow(/policy cannot be read/);
  });

  it("other unreadable policies also throw at attach", () => {
    expect(() => guardAttach({ policy: { id: "p", version: "1", pay_to: ["not-an-address"] } })).toThrow(/pay_to/);
    expect(() => guardAttach({ policy: { id: "p", version: "1", max_amount_atomic: 1000 } })).toThrow(/max_amount_atomic/);
    expect(() => guardAttach({ policy: { id: "p", version: "1", fail_mode: "opne" } })).toThrow(/fail_mode/);
    expect(() => guardAttach({ policy: null as never })).toThrow(/policy cannot be read/);
  });
});

describe("finding B: x402 v1 quotes (maxAmountRequired) hit the amount cap", () => {
  it("a v1 quote of maxAmountRequired=999999999 is stopped by cap 1000", async () => {
    const policy = { id: "pol_v1", version: "1", max_amount_atomic: "1000" };
    const attach = guardAttach({ policy });
    const result = await attach.onBeforePaymentCreation({
      selectedRequirements: { maxAmountRequired: "999999999", payTo: EVM, network: "base" },
    });
    expect(result).toMatchObject({ abort: true });
    expect(attach.lastVerdict()?.rule_hit).toBe("amount");
    expect(attach.lastVerdict()?.requirement.amount).toBe("999999999");
    expect(attach.mcpPolicy(1, [{ maxAmountRequired: "999999999", payTo: EVM, network: "base" }])).toEqual([]);
  });

  it("a v1 quote under the cap passes; amount wins when both agree; both differing fails", () => {
    const policy = { id: "pol_v1", version: "1", max_amount_atomic: "1000" };
    expect(evaluateCustomerPolicy(policy, { maxAmountRequired: "999" }).verdict).toBe("pass");
    expect(evaluateCustomerPolicy(policy, { amount: "999", maxAmountRequired: "999" }).verdict).toBe("pass");
    const both = evaluateCustomerPolicy(policy, { amount: "10", maxAmountRequired: "999999999" });
    expect(both.verdict).toBe("fail");
    expect(both.rule_hit).toBe("amount");
  });
});
