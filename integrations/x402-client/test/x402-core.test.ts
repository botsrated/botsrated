// Compatibility with the real @x402/core v2 client and @x402/evm exact scheme.
// Signs with a random throwaway key; nothing is sent anywhere.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { BASE_MAINNET, BASE_USDC, BOTSRATED_PAY_TO, BotsRatedClient, createPrePaymentGuard, strictGuardPolicy } from "../src/index";

const FOUND = JSON.parse(readFileSync(new URL("../../fixtures/preflight-found.json", import.meta.url), "utf8"));
const fetchStub = vi.fn(async () => new Response(JSON.stringify(FOUND), { status: 200 }));

function setup() {
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: privateKeyToAccount(generatePrivateKey()) });
  const created = vi.fn(async () => {});
  client.onAfterPaymentCreation(created);
  const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: fetchStub }), policy: strictGuardPolicy });
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
      /Payment creation aborted: Payment stopped by your payment policy \(rule: payto_not_observed\)/,
    );
    expect(created).not.toHaveBeenCalled();
  });
});

describe("BotsRated's own payment with a transaction-capable signer", () => {
  const botsratedPr = (extra: Record<string, string> = {}, extensions?: Record<string, unknown>) => ({
    x402Version: 2,
    resource: { url: "https://botsrated.com/v1/check?host=blockrun.ai", description: "", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: BASE_MAINNET, amount: "1000", asset: BASE_USDC, payTo: BOTSRATED_PAY_TO, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2", ...extra } }],
    ...(extensions ? { extensions } : {}),
  });

  it("never signs a Permit2 approval for a re-served BotsRated quote", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signer = {
      ...account,
      signTypedData: vi.fn(account.signTypedData),
      signTransaction: vi.fn(account.signTransaction),
      getTransactionCount: vi.fn(async () => 0),
      readContract: vi.fn(async () => 0n),
    };
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: signer as any });
    const bc = new BotsRatedClient({ fetch: fetchStub, paid: { budgetUsd: 0.01, fetchWithPayment: vi.fn() } });
    bc.budget!.reserve(1000n); // as during BotsRatedClient.check()
    client.onBeforePaymentCreation(createPrePaymentGuard({ client: bc }).beforePaymentCreation);
    const approval = { erc20ApprovalGasSponsoring: { info: {}, schema: {} } };
    for (const pr of [botsratedPr({ assetTransferMethod: "permit2" }, approval), botsratedPr({ assetTransferMethod: "permit2" }), botsratedPr({}, approval)]) {
      await expect(client.createPaymentPayload(pr as any)).rejects.toThrow(/Payment creation aborted/);
    }
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(signer.readContract).not.toHaveBeenCalled();
    // The real quote shape still signs a plain EIP-3009 payment, without extensions.
    const payload = await client.createPaymentPayload(botsratedPr({}, { bazaar: { info: {} } }) as any);
    expect(payload.accepted.amount).toBe("1000");
    expect(payload.extensions ?? {}).toEqual({});
    expect(signer.signTransaction).not.toHaveBeenCalled();
  });
});

describe("BotsRatedClient paid: { x402Client } (signs only the rebuilt quote)", () => {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  const quote = (accepts: Record<string, unknown>[], extensions?: Record<string, unknown>) => ({
    x402Version: 2,
    error: "Payment required",
    resource: { url: "https://botsrated.com/v1/check?host=blockrun.ai", description: "", mimeType: "application/json", tags: ["x"] },
    accepts,
    ...(extensions ? { extensions } : {}),
  });
  const ok = { scheme: "exact", network: BASE_MAINNET, amount: "1000", asset: BASE_USDC, payTo: BOTSRATED_PAY_TO, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } };
  const txSigner = () => {
    const account = privateKeyToAccount(generatePrivateKey());
    return {
      ...account,
      signTypedData: vi.fn(account.signTypedData),
      signTransaction: vi.fn(account.signTransaction),
      getTransactionCount: vi.fn(async () => 0),
      readContract: vi.fn(async () => 0n),
    };
  };

  it("signs a minimal copy with the real x402Client and sends PAYMENT-SIGNATURE itself", async () => {
    const signer = txSigner();
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: signer as any });
    const create = vi.spyOn(client, "createPaymentPayload");
    const served = quote([{ ...ok, unknownField: "x" }], { bazaar: { info: {} } });
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      return h.get("payment-signature")
        ? new Response(JSON.stringify({ host: "blockrun.ai" }), { status: 200 })
        : new Response("{}", { status: 402, headers: { "payment-required": b64(served) } });
    });
    const bc = new BotsRatedClient({ fetch: fetchFn, paid: { budgetUsd: 0.01, x402Client: client } });
    expect(await bc.check("blockrun.ai")).toEqual({ host: "blockrun.ai" });
    const signed = create.mock.calls[0][0] as any;
    expect(signed).toEqual({
      x402Version: 2,
      resource: { url: "https://botsrated.com/v1/check?host=blockrun.ai", description: "", mimeType: "application/json" },
      accepts: [ok],
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(atob(new Headers(fetchFn.mock.calls[1][1]?.headers).get("payment-signature")!));
    expect(sent.accepted.payTo).toBe(BOTSRATED_PAY_TO);
    expect(sent.extensions ?? {}).toEqual({});
    expect(fetchFn.mock.calls[1][1]?.redirect).toBe("manual");
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(bc.budget!.spentAtomic).toBe(1000n);
  });

  it.each([
    ["permit2 extra + approval extension", quote([{ ...ok, extra: { ...ok.extra, assetTransferMethod: "permit2" } }], { erc20ApprovalGasSponsoring: { info: {}, schema: {} } })],
    ["permit2 extra alone", quote([{ ...ok, extra: { ...ok.extra, assetTransferMethod: "permit2" } }])],
    ["approval extension alone", quote([ok], { erc20ApprovalGasSponsoring: {} })],
    ["paymentFlow", quote([{ ...ok, extra: { paymentFlow: "x" } }])],
    ["long timeout", quote([{ ...ok, maxTimeoutSeconds: 86400 }])],
  ])("rejects %s before the x402Client is called", async (_n, served) => {
    const signer = txSigner();
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: signer as any });
    const create = vi.spyOn(client, "createPaymentPayload");
    const fetchFn = vi.fn(async () => new Response("{}", { status: 402, headers: { "payment-required": b64(served) } }));
    const bc = new BotsRatedClient({ fetch: fetchFn, paid: { budgetUsd: 1, x402Client: client } });
    await expect(bc.check("blockrun.ai")).rejects.toMatchObject({ code: "terms_rejected" });
    expect(create).not.toHaveBeenCalled();
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(bc.budget!.remainingAtomic).toBe(1_000_000n);
  });

  it("releases the reservation when signing fails, and needs exactly one payer", async () => {
    const served = quote([ok]);
    const fetchFn = vi.fn(async () => new Response("{}", { status: 402, headers: { "payment-required": b64(served) } }));
    const bc = new BotsRatedClient({ fetch: fetchFn, paid: { budgetUsd: 0.001, x402Client: { createPaymentPayload: async () => { throw new Error("no"); } } } });
    await expect(bc.check("blockrun.ai")).rejects.toMatchObject({ code: "payment_not_created" });
    expect(bc.budget!.remainingAtomic).toBe(1000n);
    expect(() => new BotsRatedClient({ paid: { budgetUsd: 1 } })).toThrow(/exactly one/);
    expect(() => new BotsRatedClient({ paid: { budgetUsd: 1, fetchWithPayment: vi.fn(), x402Client: { createPaymentPayload: vi.fn() } } })).toThrow(/exactly one/);
  });
});

describe("@x402/core with guard.wrapFetch: the request URL, not resource.url, is checked", () => {
  it("aborts when a 402 copies another seller's resource.url", async () => {
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: privateKeyToAccount(generatePrivateKey()) });
    const guard = createPrePaymentGuard({ client: new BotsRatedClient({ fetch: fetchStub }), policy: strictGuardPolicy });
    client.onBeforePaymentCreation(guard.beforePaymentCreation);
    const pay = guard.wrapFetch(async (input: string) => {
      await client.createPaymentPayload(paymentRequired(FOUND.latest_probe.live_payTo) as any);
      return new Response("ok");
    });
    await expect(pay("https://evil.example/api")).rejects.toThrow(/resource_url_mismatch/);
    expect(await (await pay(FOUND.latest_probe.url)).text()).toBe("ok");
  });
});
