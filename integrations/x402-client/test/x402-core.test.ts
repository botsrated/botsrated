// Compatibility with the real @x402/core v2 client and @x402/evm exact scheme.
// Signs with a random throwaway key; nothing is sent anywhere.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { BASE_MAINNET, BASE_USDC, BotsRatedClient, createPrePaymentGuard } from "../src/index";

const FOUND = JSON.parse(readFileSync(new URL("../../fixtures/preflight-found.json", import.meta.url), "utf8"));
const fetchStub = vi.fn(async () => new Response(JSON.stringify(FOUND), { status: 200 }));

function setup() {
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: privateKeyToAccount(generatePrivateKey()) });
  const created = vi.fn(async () => {});
  client.onAfterPaymentCreation(created);
  const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: fetchStub }) });
  client.onBeforePaymentCreation(guard.beforePaymentCreation);
  return { client, created };
}

const paymentRequired = (payTo: string) => ({
  x402Version: 2,
  resource: { url: FOUND.latest_probe.url, description: "", mimeType: "application/json" },
  accepts: [{ scheme: "exact", network: BASE_MAINNET, amount: FOUND.latest_probe.live_amount, asset: BASE_USDC, payTo, maxTimeoutSeconds: 60, extra: { name: "USD Coin", version: "2" } }],
});

describe("@x402/core x402Client.onBeforePaymentCreation", () => {
  it("lets a matching payment through to the scheme", async () => {
    const { client, created } = setup();
    const payload = await client.createPaymentPayload(paymentRequired(FOUND.latest_probe.live_payTo) as any);
    expect(payload.accepted.payTo).toBe(FOUND.latest_probe.live_payTo);
    expect(created).toHaveBeenCalledOnce();
  });

  it("aborts before signing when the payTo was never observed", async () => {
    const { client, created } = setup();
    await expect(client.createPaymentPayload(paymentRequired("0x000000000000000000000000000000000000dEaD") as any)).rejects.toThrow(
      /Payment creation aborted: BotsRated pre-payment check blocked blockrun\.ai - payto_mismatch/,
    );
    expect(created).not.toHaveBeenCalled();
  });
});
