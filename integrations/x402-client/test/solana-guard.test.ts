// Per-network guard facts from the 2026-11-07 Solana proposal, reconciled onto this package.
// The proposal called the behavior 0.5.0. This package is 0.3.3, so wedge pins stay below 0.4.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateFacts, guardFactsFrom, policies, policyQuote } from "../src/payment-guard.js";
import { VERSION, isBase58Pubkey, networkFamily, payToFormatFor } from "../src/util.js";
import { SOLANA_FIXTURES as X } from "./solana_fixtures.js";

const body = X.preflightBody;
const codes = (f: ReturnType<typeof guardFactsFrom>, req: { payTo?: unknown; amount?: unknown; network?: unknown }, pol = policies.warn, paid?: string) =>
  evaluateFacts(f, req, paid, pol).map((r) => r.code);

describe("solana per-network guard facts", () => {
  it("keeps Base facts as before and adds per-network records", () => {
    const f = guardFactsFrom(body, "seller.example");
    expect(f.knownPayTos).toEqual([X.EVM.toLowerCase()]);
    expect(f.quotesByNetwork?.[X.SOL_NET]?.payTo).toBe(X.SOL_PAY);
    expect(f.quotesByNetwork?.[X.BASE_NET]?.payTo).toBe(X.EVM.toLowerCase());
  });

  it("compares a Solana request with the Solana record only", () => {
    const f = guardFactsFrom(body, "seller.example");
    expect(codes(f, { payTo: X.SOL_PAY, network: X.SOL_NET })).not.toContain("payto_not_observed");
    expect(codes(f, { payTo: X.SOL_PAY, network: X.SOL_NET })).not.toContain("network_not_observed");
    expect(codes(f, { payTo: X.SOL_OTHER, network: X.SOL_NET })).toContain("payto_not_observed");
    expect(codes(f, { payTo: X.SOL_PAY.toLowerCase(), network: X.SOL_NET })).toContain("payto_not_observed");
  });

  it("Base request unchanged; feePayer never a known payTo; rotating Solana payTo not compared", () => {
    const f = guardFactsFrom(body, "seller.example");
    expect(codes(f, { payTo: X.EVM.toUpperCase().replace("0X", "0x"), network: X.BASE_NET })).not.toContain("payto_not_observed");
    expect(codes(f, { payTo: X.FEE, network: X.SOL_NET })).toContain("payto_not_observed");
    const rot = guardFactsFrom(X.rotatingBody, "seller.example");
    const rotCodes = codes(rot, { payTo: X.SOL_OTHER, network: X.SOL_NET }, policies.carefulBuyer);
    expect(rotCodes).toContain("payto_rotating");
    expect(rotCodes).not.toContain("payto_not_observed");
  });

  it("bodies without quotes_by_network behave as the 0.4.x family check", () => {
    const { quotes_by_network, ...old } = body;
    const f = guardFactsFrom(old, "seller.example");
    expect(f.quotesByNetwork).toBeUndefined();
    expect(codes(f, { payTo: X.SOL_PAY, network: X.SOL_NET })).toContain("network_not_observed");
  });

  it("compares a Solana amount with the Solana record on the probed route", () => {
    const f = guardFactsFrom(body, "seller.example");
    expect(codes(f, { payTo: X.SOL_PAY, network: X.SOL_NET, amount: "10001" }, policies.warn, "https://seller.example/api")).toContain("price_above_observed");
    expect(codes(f, { payTo: X.SOL_PAY, network: X.SOL_NET, amount: "10000" }, policies.warn, "https://seller.example/api")).not.toContain("price_above_observed");
  });

  it("ignores an unknown family and keeps at most 16 quotes_by_network keys", () => {
    const extra = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`eip155:${100 + i}`, { payTo: X.EVM, amount_atomic: "10000" }]));
    const f = guardFactsFrom({ ...body, quotes_by_network: { ...body.quotes_by_network, bitcoin: { payTo: "bc1q" }, ...extra } }, "seller.example");
    expect(f.quotesByNetwork?.bitcoin).toBeUndefined();
    expect(Object.keys(f.quotesByNetwork ?? {}).length).toBeLessThanOrEqual(16);
  });
});

describe("x402 v1 network names are known families", () => {
  it("treats base and solana as families and does not rewrite them to CAIP-2", () => {
    expect(networkFamily("base")).toBe("eip155");
    expect(networkFamily("base-sepolia")).toBe("eip155");
    expect(networkFamily("solana")).toBe("solana");
    expect(networkFamily("solana-devnet")).toBe("solana");
    expect(networkFamily(X.BASE_NET)).toBe("eip155");
    expect(networkFamily(X.SOL_NET)).toBe("solana");
    expect(networkFamily("bitcoin")).toBeUndefined();
    expect(payToFormatFor("base", X.EVM)).toBe("ok");
    expect(payToFormatFor("solana", X.SOL_PAY)).toBe("ok");
    expect(payToFormatFor("solana", X.EVM)).toBe("invalid");
    expect(payToFormatFor("base", X.SOL_PAY)).toBe("invalid");
    expect(isBase58Pubkey(X.SECRET)).toBe(false);
    const f = guardFactsFrom(body, "seller.example");
    expect(codes(f, { payTo: X.SOL_PAY, network: "solana" })).not.toContain("network_not_observed");
    expect(codes(f, { payTo: X.SOL_PAY, network: "solana" })).not.toContain("payto_not_observed");
    expect(codes(f, { payTo: X.SOL_OTHER, network: "solana" })).toContain("payto_not_observed");
    expect(codes(f, { payTo: X.EVM, network: "base" })).not.toContain("network_not_observed");
    expect(codes(f, { payTo: "0x000000000000000000000000000000000000dEaD", network: "base" })).toContain("payto_not_observed");
    const v1 = guardFactsFrom(
      { ...body, quotes_by_network: { solana: { payTo: X.SOL_PAY, amount_atomic: "10000", payto_pattern: "single_address" } } },
      "seller.example",
    );
    expect(v1.quotesByNetwork?.solana?.payTo).toBe(X.SOL_PAY);
    expect(codes(v1, { payTo: X.SOL_PAY, network: "solana" })).not.toContain("payto_not_observed");
    expect(v1.quotesByNetwork?.[X.SOL_NET]).toBeUndefined();
  });
});

describe("policyQuote base58 payTo", () => {
  it("includes an exact base58 payTo on a solana-family network and leaves hex quotes unchanged", () => {
    expect(policyQuote({ payTo: X.SOL_PAY, amount: "10000", network: X.SOL_NET }).payTo).toBe(X.SOL_PAY);
    expect(policyQuote({ payTo: X.SOL_PAY, amount: "10000", network: "solana" }).payTo).toBe(X.SOL_PAY);
    const lower = X.SOL_PAY.toLowerCase();
    expect(lower).not.toBe(X.SOL_PAY);
    expect(policyQuote({ payTo: lower, network: "solana" }).payTo).toBe(lower);
    expect(policyQuote({ payTo: "not a key", network: "solana" }).payTo).toBeUndefined();
    expect(policyQuote({ payTo: X.SOL_PAY, network: X.BASE_NET }).payTo).toBeUndefined();
    expect(policyQuote({ payTo: X.SECRET, network: "solana" }).payTo).toBeUndefined();
    expect(policyQuote({ payTo: X.EVM, amount: "10000", asset: X.EVM, network: "base" })).toMatchObject({
      payTo: X.EVM,
      amount: "10000",
      asset: X.EVM,
      network: "base",
    });
    expect(policyQuote({ payTo: X.SOL_PAY, asset: X.SOL_PAY, network: "solana" }).asset).toBeUndefined();
  });
});

describe("0.4.x wedge pins", () => {
  it("keeps this package at 0.3.3 and wedge dependency ceilings below 0.4", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.version).toBe("0.3.3");
    expect(VERSION).toBe("0.3.3");
    const root = new URL("../../", import.meta.url);
    const pyprojectPins: string[] = [];
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      try {
        const text = readFileSync(new URL(`${dir.name}/pyproject.toml`, root), "utf8");
        for (const line of text.split("\n")) if (line.includes("botsrated>=")) pyprojectPins.push(`${dir.name}: ${line.trim()}`);
      } catch {
        // not a Python wedge
      }
    }
    expect(pyprojectPins.length).toBeGreaterThan(0);
    for (const pin of pyprojectPins) expect(pin).toMatch(/botsrated>=0\.3\.\d,<0\.4/);
    for (const name of ["mastra", "vercel-ai-sdk"]) {
      const manifest = JSON.parse(readFileSync(new URL(`../../${name}/package.json`, import.meta.url), "utf8"));
      expect(manifest.dependencies["@botsrated/x402-preflight"]).toBe("^0.3.0");
    }
  });
});
