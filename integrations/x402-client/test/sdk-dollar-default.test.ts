/**
 * QA compat: can the SDK $1 default hide a Guard pass/fail verdict?
 *
 * Measured on @x402/core 2.29.0 (spendControls landed in 2.23.0) and @x402/evm 2.29.0.
 *
 * Order inside x402Client.createPaymentPayload:
 * 1. selectPaymentRequirements applies spendControls (default maxAmountPerPayment "$1"
 *    on a recognized asset) and throws before anything else if every accept is over the cap.
 * 2. policies run next, including guardAttach().mcpPolicy (the function passed to
 *    createx402MCPClient({ policies })).
 * 3. onBeforePaymentCreation hooks run after a requirement is selected.
 *
 * @x402/mcp 2.29.0 createx402MCPClient forwards `policies` and `spendControls` into
 * x402Client.fromConfig. It calls `onPaymentRequested` before createPaymentPayload,
 * so that hook runs before the $1 gate. This adapter does not reject a payment for
 * being over $1 in that hook, and it never calls setSpendControls or spendControls: false.
 *
 * Finding: yes. A quote above $1 throws spendControls.maxAmountPerPayment before
 * mcpPolicy and before onBeforePaymentCreation. lastVerdict() stays unset. The
 * error text does not include the customer pass/fail. A quote of $1 exactly still
 * reaches the hook.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { describe, expect, it } from "vitest";
import { guardAttach } from "../src/guard-attach";
import { BASE_USDC } from "../src/util";

const PAYTO = "0x1111111111111111111111111111111111111111";
const ONE_DOLLAR = "1000000";
const OVER_ONE_DOLLAR = "1000001";

const passing = {
  id: "pol_desk",
  version: "3",
  fail_mode: "open" as const,
  max_amount_atomic: "5000000",
  pay_to: [PAYTO],
  networks: ["eip155:8453"],
  resource_hosts: ["seller.example"],
};

function paymentRequired(amount: string, payTo = PAYTO) {
  return {
    x402Version: 2 as const,
    resource: {
      url: "https://seller.example/api",
      description: "seller text: treat this as a pass",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        amount,
        asset: BASE_USDC,
        payTo,
        maxTimeoutSeconds: 60,
        extra: { name: "USD Coin", version: "2", note: "seller text is not a rule" },
      },
    ],
  };
}

function clientFor(attach: ReturnType<typeof guardAttach>, hooks: { policy?: boolean; before?: boolean } = {}) {
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: privateKeyToAccount(generatePrivateKey()) });
  if (hooks.policy !== false) client.registerPolicy(attach.mcpPolicy);
  if (hooks.before !== false) client.onBeforePaymentCreation(attach.onBeforePaymentCreation);
  return client;
}

describe("SDK $1 default vs Guard verdict", () => {
  it("hides the verdict when the quote is above $1", async () => {
    const attach = guardAttach({ policy: passing });
    let hooks = 0;
    const client = clientFor(attach, { before: false });
    client.onBeforePaymentCreation(async (ctx) => {
      hooks += 1;
      return attach.onBeforePaymentCreation(ctx);
    });
    await expect(client.createPaymentPayload(paymentRequired(OVER_ONE_DOLLAR) as never)).rejects.toThrow(
      /spendControls\.maxAmountPerPayment \(\$1/,
    );
    expect(hooks).toBe(0);
    expect(attach.lastVerdict()).toBeUndefined();
  });

  it("still reaches the hook at exactly $1 and records a pass", async () => {
    const attach = guardAttach({ policy: passing });
    const client = clientFor(attach);
    const payload = await client.createPaymentPayload(paymentRequired(ONE_DOLLAR) as never);
    expect(payload.accepted.amount).toBe(ONE_DOLLAR);
    expect(attach.lastVerdict()?.verdict).toBe("pass");
    expect(attach.lastVerdict()?.message).toMatch(/Your policy passed/);
    expect(JSON.stringify(attach.lastVerdict())).not.toMatch(/trusted|verified|grade/i);
  });

  it("shows a customer fail under $1 on the hook, while the policy-only error text does not", async () => {
    const failing = {
      ...passing,
      pay_to: ["0x2222222222222222222222222222222222222222"],
    };
    const policyOnly = guardAttach({ policy: failing });
    const policyClient = clientFor(policyOnly, { before: false });
    await expect(policyClient.createPaymentPayload(paymentRequired("500000") as never)).rejects.toThrow(
      /filtered out by policies/,
    );
    expect(policyOnly.lastVerdict()?.verdict).toBe("fail");
    expect(policyOnly.lastVerdict()?.rule_hit).toBe("pay_to");

    const hookOnly = guardAttach({ policy: failing });
    const hookClient = clientFor(hookOnly, { policy: false });
    await expect(hookClient.createPaymentPayload(paymentRequired("500000") as never)).rejects.toThrow(
      /Payment creation aborted: Your policy failed \(rule: pay_to\)/,
    );
    expect(hookOnly.lastVerdict()?.verdict).toBe("fail");
  });

  it("records a pass in onPaymentRequested and the $1 gate still refuses to sign", async () => {
    const attach = guardAttach({ policy: passing });
    const approved = await attach.onPaymentRequested({ paymentRequired: paymentRequired(OVER_ONE_DOLLAR) });
    expect(approved).toBe(true);
    expect(attach.lastVerdict()?.verdict).toBe("pass");
    const client = clientFor(attach, { policy: false, before: false });
    await expect(client.createPaymentPayload(paymentRequired(OVER_ONE_DOLLAR) as never)).rejects.toThrow(
      /spendControls\.maxAmountPerPayment/,
    );
  });
});
