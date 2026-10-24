// C1 (Security review 2026-10-24): the payment guard must never cause a second payment.
// - Hook adapters discard whatever the hook body returns (observe-only hooks always resolve to undefined).
// - The payment-creation-failure hook is never registered.
// - The guard's modules never import a signer, never build or send a payment header, never ask a client to
//   create a payment payload, and contain no retry or resend code.
// - With the real @x402/fetch wrapper and a seller that fails after payment, exactly one payload is created.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { abortOnly, createPaymentGuard, observeOnly, policies } from "../src/payment-guard";
import { FOUND, OTHER_PAYTO, PAYMENT_IDENTIFIER_DECL, SELLER_URL, json, pr, req } from "./helpers";

const ROOT = new URL("..", import.meta.url).pathname;
const GUARD_MODULES = ["payment-guard", "onchain", "util", "chain-cache"];
const FORBIDDEN: Array<[string, RegExp]> = [
  ["createPaymentPayload", /createPaymentPayload/],
  ["recovered", /recovered/i],
  ["onPaymentCreationFailure", /onPaymentCreationFailure|on_payment_creation_failure/],
  ["signTypedData", /signTypedData|sign_typed_data/],
  ["signer / private key", /privateKey|private_key|privateKeyToAccount|mnemonic/i],
  ["payment header", /PAYMENT-SIGNATURE|X-PAYMENT\b/i],
  ["signer packages", /from\s+["'](viem|@coinbase\/cdp-sdk|ethers|@x402\/[^"']+)["']/],
  ["transaction sending", /eth_sendRawTransaction|eth_sendTransaction|cancelAuthorization|transferWithAuthorization/],
  ["retry pipeline", /retry\.mjs|runReplay|RETRY_CHECK/],
  ["dynamic code", /\beval\s*\(|\bnew\s+Function\s*\(|\bimport\s*\(/],
];

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("C1: hook adapters discard return values", () => {
  const evil = [() => ({ recovered: true }), () => ({ recovered: true, payload: { x: 1 } }), () => "x", () => 1, () => { throw new Error("boom"); }, async () => ({ recovered: true })];
  for (const [i, body] of evil.entries()) {
    it(`observeOnly resolves to undefined for a body returning/throwing case ${i}`, async () => {
      await expect(observeOnly(body as any)({})).resolves.toBeUndefined();
    });
  }
  it("abortOnly resolves to undefined or exactly { abort: true, reason }", async () => {
    await expect(abortOnly(async () => ({ stop: false, reason: "x", recovered: true }) as any)({})).resolves.toBeUndefined();
    const out = await abortOnly(async () => ({ stop: true, reason: "r", recovered: true, payload: {} }) as any)({});
    expect(Object.keys(out as object).sort()).toEqual(["abort", "reason"]);
    await expect(abortOnly(async () => { throw new Error("x"); })({})).resolves.toBeUndefined();
  });
});

describe("C1: fuzzed contexts never produce anything but undefined (or an abort)", () => {
  const throwingProxy = new Proxy({}, { get() { throw new Error("hostile getter"); } });
  const contexts: unknown[] = [
    undefined, null, 0, "", "x", [], {}, throwingProxy,
    { paymentRequired: null, selectedRequirements: null },
    { paymentRequired: pr("http://[bad"), selectedRequirements: req({ payTo: "x".repeat(500) }) },
    { paymentRequired: pr(SELLER_URL, [req()], { "payment-identifier": PAYMENT_IDENTIFIER_DECL }), selectedRequirements: req() },
    { paymentRequired: pr(SELLER_URL), selectedRequirements: req({ payTo: OTHER_PAYTO }) },
    { paymentPayload: { x402Version: 2, payload: { authorization: throwingProxy }, accepted: req() }, requirements: req() },
    { paymentPayload: { x402Version: 2, payload: { signature: "0x1", authorization: { from: "0x" + "a".repeat(40), nonce: "0x" + "1".repeat(64), validBefore: "1" } }, accepted: req() }, requirements: req(), settleResponse: { success: false } },
    { paymentPayload: { x402Version: 2, payload: {}, accepted: req() }, requirements: req(), paymentRequired: pr(SELLER_URL), settleResponse: undefined },
    { paymentPayload: { x402Version: 2, payload: {}, accepted: req() }, requirements: req(), settleResponse: { success: true, transaction: "0x" + "f".repeat(64) } },
    { paymentPayload: "garbage", requirements: 7, error: new Error("5xx after settle") },
  ];
  const fetches: Array<(u: string) => Promise<Response>> = [
    async () => json(FOUND),
    async () => json({}, 500),
    async () => new Response("not json", { status: 200 }),
    async () => { throw new Error("down"); },
    async () => json({ error: { code: "host_not_covered" } }, 404),
  ];
  const configs = [{}, { policy: policies.strict }, { dryRun: true, policy: policies.strict }, { failOpen: false, policy: policies.strict }, { hosted: false }];

  it("observe-only hooks always resolve to undefined; the pre-payment hook only ever aborts", async () => {
    let runs = 0;
    for (const cfg of configs) {
      for (const f of fetches) {
        const g = createPaymentGuard({ ...cfg, fetch: f as any, onDecision: () => { throw new Error("cb"); } });
        for (const c of contexts) {
          expect(await g.hooks.afterPaymentCreation(c)).toBeUndefined();
          expect(await g.hooks.paymentResponse(c)).toBeUndefined();
          const before = await g.hooks.beforePaymentCreation(c);
          if (before !== undefined) {
            expect(Object.keys(before).sort()).toEqual(["abort", "reason"]);
            expect(before.abort).toBe(true);
            expect(typeof before.reason).toBe("string");
            expect(before.reason.length).toBeLessThanOrEqual(701);
          }
          if (cfg === configs[0] || (cfg as any).dryRun) expect(before).toBeUndefined();
          runs++;
        }
      }
    }
    expect(runs).toBe(configs.length * fetches.length * contexts.length);
  });
});

describe("C1: install never registers the payment-failure hook", () => {
  it("registers before/after/response (+ extension) only", () => {
    const client = {
      onBeforePaymentCreation: vi.fn(),
      onAfterPaymentCreation: vi.fn(),
      onPaymentResponse: vi.fn(),
      onPaymentCreationFailure: vi.fn(),
      registerExtension: vi.fn(),
      createPaymentPayload: vi.fn(),
    };
    createPaymentGuard().install(client);
    expect(client.onPaymentCreationFailure).not.toHaveBeenCalled();
    expect(client.createPaymentPayload).not.toHaveBeenCalled();
    expect(client.onBeforePaymentCreation).toHaveBeenCalledOnce();
    expect(client.onAfterPaymentCreation).toHaveBeenCalledOnce();
    expect(client.onPaymentResponse).toHaveBeenCalledOnce();
    expect(client.registerExtension).toHaveBeenCalledOnce();
  });
});

describe("C1: source and dist of the guard contain no signing, resend or retry capability", () => {
  const files = (dir: string, ext: string) => GUARD_MODULES.map((m) => join(dir, `${m}${ext}`));
  it("src: no forbidden tokens, imports only sibling guard modules", () => {
    for (const f of files("src", ".ts")) {
      const text = read(f);
      for (const [name, re] of FORBIDDEN) expect(re.test(text), `${f} contains ${name}`).toBe(false);
      const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const i of imports) expect(["./onchain.js", "./util.js", "./chain-cache.js"], `${f} imports ${i}`).toContain(i);
    }
  });

  it("dist is current (equals a fresh build of src) and the guard's dist files pass the same grep", () => {
    const out = mkdtempSync(join(tmpdir(), "pg-dist-"));
    execFileSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", join(ROOT, "tsconfig.json"), "--outDir", out], { stdio: "pipe" });
    const built = readdirSync(out).filter((f) => f.endsWith(".js") || f.endsWith(".d.ts")).sort();
    const committed = readdirSync(join(ROOT, "dist")).filter((f) => f.endsWith(".js") || f.endsWith(".d.ts")).sort();
    expect(committed).toEqual(built);
    for (const f of built) expect(read(join("dist", f)), `dist/${f} is stale; run npm run build`).toBe(readFileSync(join(out, f), "utf8"));
    for (const f of files("dist", ".js")) {
      expect(existsSync(join(ROOT, f))).toBe(true);
      const text = read(f);
      for (const [name, re] of FORBIDDEN) expect(re.test(text), `${f} contains ${name}`).toBe(false);
    }
    // Whole package: no failure-hook registration, no recovery flag, no dynamic code anywhere in dist.
    for (const f of built.filter((x) => x.endsWith(".js"))) {
      const text = read(join("dist", f));
      expect(/onPaymentCreationFailure|recovered|\beval\s*\(|\bnew\s+Function\s*\(|\bimport\s*\(/.test(text), `dist/${f}`).toBe(false);
    }
  });

  it("zero runtime dependencies (M6)", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });
});

describe("C1 integration: real @x402/fetch + @x402/core + a seller that fails after payment", () => {
  function setup(sellerAfterPay: (headers: Headers) => Response, extensions?: Record<string, unknown>, guardOpts = {}) {
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: privateKeyToAccount(generatePrivateKey()) });
    const created = vi.spyOn(client, "createPaymentPayload");
    const botsrated = vi.fn(async () => json(FOUND));
    const guard = createPaymentGuard({ fetch: botsrated, ...guardOpts });
    guard.install(client);
    const sent: Headers[] = [];
    const seller = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = input instanceof Request ? input : new Request(input, init);
      if (!r.headers.get("payment-signature")) {
        const body = pr(SELLER_URL, [req({ maxTimeoutSeconds: 60 })], extensions);
        return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": btoa(JSON.stringify(body)) } });
      }
      sent.push(r.headers);
      return sellerAfterPay(r.headers);
    });
    const paidFetch = guard.wrapFetch(wrapFetchWithPayment(seller as any, client));
    return { client, created, guard, seller, sent, paidFetch, botsrated };
  }

  for (const status of [500, 502, 503, 402]) {
    it(`seller answers ${status} after payment: exactly one payload is created and sent`, async () => {
      const { created, sent, paidFetch, guard } = setup(() => new Response("upstream error", { status }), { "payment-identifier": PAYMENT_IDENTIFIER_DECL });
      const res = await paidFetch(SELLER_URL);
      expect(res.status).toBe(status);
      expect(created).toHaveBeenCalledTimes(1);
      expect(sent).toHaveLength(1);
      expect(guard.records()).toHaveLength(1);
    });
  }

  it("adds the retry key to what is sent only when the seller advertises it", async () => {
    const a = setup(() => json({ ok: true }), { "payment-identifier": PAYMENT_IDENTIFIER_DECL });
    await a.paidFetch(SELLER_URL);
    const sentA = JSON.parse(atob(a.sent[0].get("payment-signature")!));
    expect(sentA.extensions["payment-identifier"].info.id).toMatch(/^pay_[0-9a-f]{32}$/);
    const b = setup(() => json({ ok: true }));
    await b.paidFetch(SELLER_URL);
    const sentB = JSON.parse(atob(b.sent[0].get("payment-signature")!));
    expect(sentB.extensions?.["payment-identifier"]).toBeUndefined();
  });

  it("strict policy stops before anything is signed; nothing is sent to the seller with a payment", async () => {
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: privateKeyToAccount(generatePrivateKey()) });
    const created = vi.spyOn(client, "createPaymentPayload");
    const after = vi.fn();
    client.onAfterPaymentCreation(after);
    const g = createPaymentGuard({ fetch: async () => json(FOUND), policy: policies.strict });
    g.install(client);
    const seller2 = vi.fn(async () => new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": btoa(JSON.stringify(pr(SELLER_URL, [req({ payTo: OTHER_PAYTO })]))) } }));
    await expect(g.wrapFetch(wrapFetchWithPayment(seller2 as any, client))(SELLER_URL)).rejects.toThrow(/Payment stopped by your payment policy/);
    expect(seller2).toHaveBeenCalledTimes(1); // only the unpaid request
    expect(created).toHaveBeenCalledTimes(1); // the wrapper asked once; the guard aborted before signing
    expect(after).not.toHaveBeenCalled(); // nothing was signed
  });
});
