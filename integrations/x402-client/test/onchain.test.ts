import { beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toFunctionSelector, toHex } from "viem";
import {
  AUTHORIZATION_STATE_SELECTOR,
  AUTHORIZATION_USED_TOPIC,
  DEFAULT_BASE_RPCS,
  TRANSFER_TOPIC,
  checkPaymentState,
  marginOf,
  type PaymentRecord,
} from "../src/onchain";
import { _resetChainCache } from "../src/chain-cache";
import { createPaymentGuard } from "../src/payment-guard";
import { USDC } from "./helpers";

const FROM = "0x" + "a".repeat(40);
const PAYTO = "0x" + "b".repeat(40);
const NONCE = "0x" + "1".repeat(64);
const TX = "0x" + "c".repeat(64);
const NOW = 1_800_000_000;
const pad = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
const RPCS = ["https://rpc-one.example", "https://rpc-two.example"];
const READ_METHODS = new Set(["eth_chainId", "eth_call", "eth_getBlockByNumber", "eth_getLogs", "eth_getTransactionReceipt"]);

const rec = (o: Partial<PaymentRecord> = {}): PaymentRecord => ({
  network: "eip155:8453",
  asset: USDC,
  from: FROM,
  payTo: PAYTO,
  amount: "2000",
  nonce: NONCE,
  validBefore: NOW + 300,
  createdAt: NOW - 60,
  ...o,
});

const goodReceipt = (o: Record<string, unknown> = {}) => ({
  transactionHash: TX,
  status: "0x1",
  blockNumber: "0x64",
  logs: [
    { address: USDC, topics: [AUTHORIZATION_USED_TOPIC, pad(FROM), NONCE], data: "0x" },
    { address: USDC, topics: [TRANSFER_TOPIC, pad(FROM), pad(PAYTO)], data: toHex(2000n, { size: 32 }) },
  ],
  ...o,
});

interface View {
  chainId?: string;
  used?: Record<string, boolean>; // by tag
  receipt?: unknown;
  logs?: unknown[];
  fail?: boolean;
  /** Block timestamp per tag (default NOW). */
  ts?: Record<string, number>;
}

const BLOCK_OF: Record<string, string> = { safe: "0xc8", finalized: "0xb4", latest: "0xd2" };
const TAG_OF: Record<string, string> = Object.fromEntries(Object.entries(BLOCK_OF).map(([t, n]) => [n, t]));

function rpcFetch(views: Record<string, View>) {
  const methods: string[] = [];
  const urls: string[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(url);
    const v = views[url];
    const body = JSON.parse(String(init?.body));
    methods.push(body.method);
    if (!v || v.fail) throw new Error("connect failed");
    const result = (() => {
      switch (body.method) {
        case "eth_chainId":
          return v.chainId ?? "0x2105";
        case "eth_getBlockByNumber":
          return { number: BLOCK_OF[body.params[0]], timestamp: toHex(v.ts?.[body.params[0]] ?? NOW) };
        case "eth_call": {
          expect(body.params[0].to).toBe(USDC);
          expect(body.params[0].data).toBe(AUTHORIZATION_STATE_SELECTOR + pad(FROM).slice(2) + NONCE.slice(2));
          // The state is read at the exact block number returned for the tag, never at the moving tag.
          const tag = TAG_OF[body.params[1]];
          expect(tag, "eth_call must use a pinned block number").toBeDefined();
          return (v.used?.[tag] ?? false) ? toHex(1n, { size: 32 }) : toHex(0n, { size: 32 });
        }
        case "eth_getLogs":
          return v.logs ?? [{ transactionHash: TX }];
        case "eth_getTransactionReceipt":
          return v.receipt ?? goodReceipt();
      }
      throw new Error("unexpected method " + body.method);
    })();
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  });
  return { f, methods, urls };
}

const opts = (f: any, now = NOW) => ({ rpcs: RPCS, fetch: f, now: () => now });

beforeEach(() => _resetChainCache());

describe("on-chain constants", () => {
  it("selector and topics are the real keccak values", () => {
    expect(AUTHORIZATION_STATE_SELECTOR).toBe(toFunctionSelector("authorizationState(address,bytes32)"));
    expect(AUTHORIZATION_USED_TOPIC).toBe(keccak256(toHex("AuthorizationUsed(address,bytes32)")));
    expect(TRANSFER_TOPIC).toBe(keccak256(toHex("Transfer(address,address,uint256)")));
  });
  it("default RPCs are two different public Base operators", () => {
    expect(DEFAULT_BASE_RPCS).toEqual(["https://mainnet.base.org", "https://base-rpc.publicnode.com"]);
  });
});

describe("checkPaymentState: three answers only", () => {
  it("settled: both RPCs agree at the safe tag and the receipt proves the exact transfer", async () => {
    const { f, methods, urls } = rpcFetch({ [RPCS[0]]: { used: { safe: true } }, [RPCS[1]]: { used: { safe: true } } });
    const s = await checkPaymentState(rec(), opts(f));
    expect(s).toMatchObject({ state: "settled", txHash: TX, tag: "safe", rpcHosts: ["rpc-one.example", "rpc-two.example"] });
    expect(methods.every((m) => READ_METHODS.has(m))).toBe(true);
    expect(urls.every((u) => !u.includes("botsrated"))).toBe(true);
  });

  it("unknown (never 'not paid') before validBefore + margin", async () => {
    const { f } = rpcFetch({ [RPCS[0]]: {}, [RPCS[1]]: {} });
    const s = await checkPaymentState(rec(), opts(f));
    expect(s).toMatchObject({ state: "unknown", code: "payment_state_unknown", reason: "not_settled_yet", waitUntil: NOW + 300 + 60 });
    expect((s as any).message).toMatch(/Do not sign a new payment for this purchase before/);
  });

  it("expired_unsettled only after validBefore + margin and unused at a safe block past expiry on both RPCs", async () => {
    const { f, methods } = rpcFetch({ [RPCS[0]]: {}, [RPCS[1]]: {} });
    const s = await checkPaymentState(rec({ validBefore: NOW - 100 }), opts(f));
    expect(s).toMatchObject({ state: "expired_unsettled" });
    expect(methods.filter((m) => m === "eth_call").length).toBe(2); // safe on both (default expiryTag)
  });

  it("the margin is at least 30 s", async () => {
    const { f } = rpcFetch({ [RPCS[0]]: {}, [RPCS[1]]: {} });
    const s = await checkPaymentState(rec({ validBefore: NOW - 10 }), { ...opts(f), marginSeconds: 0 });
    expect(s.state).toBe("unknown");
  });

  it("RPCs disagree -> unknown", async () => {
    const { f } = rpcFetch({ [RPCS[0]]: { used: { safe: true } }, [RPCS[1]]: {} });
    expect(await checkPaymentState(rec(), opts(f))).toMatchObject({ state: "unknown", reason: "rpcs_disagree" });
  });

  it("one RPC fails -> unknown", async () => {
    const { f } = rpcFetch({ [RPCS[0]]: { used: { safe: true } }, [RPCS[1]]: { fail: true } });
    expect(await checkPaymentState(rec(), opts(f))).toMatchObject({ state: "unknown", reason: "rpc_error" });
  });

  it("wrong chain id -> unknown", async () => {
    const { f } = rpcFetch({ [RPCS[0]]: { chainId: "0x1", used: { safe: true } }, [RPCS[1]]: { used: { safe: true } } });
    expect(await checkPaymentState(rec(), opts(f))).toMatchObject({ state: "unknown", reason: "rpc_error" });
  });

  it("needs two RPCs on different hosts", async () => {
    const { f } = rpcFetch({});
    expect(await checkPaymentState(rec(), { rpcs: [RPCS[0]], fetch: f })).toMatchObject({ state: "unknown", reason: "need_two_rpcs_on_different_hosts" });
    expect(await checkPaymentState(rec(), { rpcs: [RPCS[0], RPCS[0] + "/v2"], fetch: f })).toMatchObject({ state: "unknown" });
    expect(f).not.toHaveBeenCalled();
  });

  it("only Base USDC is supported (pinned; never the seller's asset)", async () => {
    const { f } = rpcFetch({});
    expect(await checkPaymentState(rec({ network: "eip155:1" }), opts(f))).toMatchObject({ state: "unknown", reason: "unsupported_network_or_asset" });
    expect(await checkPaymentState(rec({ asset: "0x" + "9".repeat(40) }), opts(f))).toMatchObject({ state: "unknown" });
  });

  const badReceipts: Array<[string, unknown]> = [
    ["wrong amount", goodReceipt({ logs: [goodReceipt().logs[0], { ...goodReceipt().logs[1], data: toHex(2001n, { size: 32 }) }] })],
    ["transfer from another contract", goodReceipt({ logs: [goodReceipt().logs[0], { ...goodReceipt().logs[1], address: "0x" + "9".repeat(40) }] })],
    ["transfer to another payTo", goodReceipt({ logs: [goodReceipt().logs[0], { ...goodReceipt().logs[1], topics: [TRANSFER_TOPIC, pad(FROM), pad("0x" + "d".repeat(40))] }] })],
    ["no AuthorizationUsed", goodReceipt({ logs: [goodReceipt().logs[1]] })],
    ["reverted", goodReceipt({ status: "0x0" })],
    ["above the safe block", goodReceipt({ blockNumber: "0x1000" })],
  ];
  for (const [name, receipt] of badReceipts) {
    it(`used but ${name} -> unknown, not settled`, async () => {
      const { f } = rpcFetch({ [RPCS[0]]: { used: { safe: true }, receipt }, [RPCS[1]]: { used: { safe: true }, receipt } });
      expect((await checkPaymentState(rec(), opts(f))).state).toBe("unknown");
    });
  }

  it("a seller tx hash is only a hint: an invalid one is ignored and logs are searched", async () => {
    const { f, methods } = rpcFetch({ [RPCS[0]]: { used: { safe: true } }, [RPCS[1]]: { used: { safe: true } } });
    const s = await checkPaymentState(rec({ txHashHint: "0xnot-a-hash" }), opts(f));
    expect(s.state).toBe("settled");
    expect(methods).toContain("eth_getLogs");
  });

  it("a hint pointing at an unrelated tx does not make it settled", async () => {
    const other = goodReceipt({ logs: [] });
    const { f } = rpcFetch({ [RPCS[0]]: { used: { safe: true }, receipt: other }, [RPCS[1]]: { used: { safe: true }, receipt: other } });
    expect((await checkPaymentState(rec({ txHashHint: TX }), opts(f))).state).toBe("unknown");
  });
});

describe("H2-R1: expired_unsettled needs the blocks read to be past validBefore + margin", () => {
  const VB = NOW - 100; // clock is past validBefore + 60
  it("both RPCs' safe blocks before validBefore -> unknown (chain_not_past_expiry), never expired_unsettled", async () => {
    const { f } = rpcFetch({ [RPCS[0]]: { ts: { safe: VB - 43 } }, [RPCS[1]]: { ts: { safe: VB - 10 } } });
    const s = await checkPaymentState(rec({ validBefore: VB }), opts(f));
    expect(s).toMatchObject({ state: "unknown", code: "payment_state_unknown", reason: "chain_not_past_expiry" });
    expect((s as any).waitUntil).toBeGreaterThan(NOW);
    expect((s as any).waitUntil).toBe(NOW + (NOW - (VB - 43)));
  });

  it("a block past validBefore but inside the margin is not enough", async () => {
    const { f } = rpcFetch({ [RPCS[0]]: { ts: { safe: VB + 30 } }, [RPCS[1]]: { ts: { safe: VB + 30 } } });
    expect(await checkPaymentState(rec({ validBefore: VB }), opts(f))).toMatchObject({ state: "unknown", reason: "chain_not_past_expiry" });
  });

  it("one RPC lagging behind validBefore -> unknown", async () => {
    const { f } = rpcFetch({ [RPCS[0]]: { ts: { safe: NOW } }, [RPCS[1]]: { ts: { safe: VB - 104 } } });
    expect(await checkPaymentState(rec({ validBefore: VB }), opts(f))).toMatchObject({ state: "unknown", reason: "chain_not_past_expiry" });
  });

  it("both RPCs past validBefore + margin -> expired_unsettled", async () => {
    const { f } = rpcFetch({ [RPCS[0]]: { ts: { safe: VB + 60 } }, [RPCS[1]]: { ts: { safe: VB + 80 } } });
    expect(await checkPaymentState(rec({ validBefore: VB }), opts(f))).toMatchObject({ state: "expired_unsettled", validBefore: VB });
  });

  it("the margin is configurable and applies to the block timestamp", async () => {
    const { f } = rpcFetch({ [RPCS[0]]: { ts: { safe: VB + 80 } }, [RPCS[1]]: { ts: { safe: VB + 80 } } });
    expect(await checkPaymentState(rec({ validBefore: VB - 200 }), { ...opts(f), marginSeconds: 120 })).toMatchObject({ state: "expired_unsettled" });
    expect(await checkPaymentState(rec({ validBefore: VB }), { ...opts(f, NOW + 200), marginSeconds: 120 })).toMatchObject({ state: "unknown", reason: "chain_not_past_expiry" });
  });

  it("expiryTag 'finalized': a finalized head older than validBefore gives unknown even when safe is past", async () => {
    const lagging = { ts: { safe: NOW, finalized: NOW - 1400 } };
    const { f, methods } = rpcFetch({ [RPCS[0]]: lagging, [RPCS[1]]: lagging });
    const s = await checkPaymentState(rec({ validBefore: VB }), { ...opts(f), expiryTag: "finalized" });
    expect(s).toMatchObject({ state: "unknown", reason: "chain_not_past_expiry" });
    expect(methods.filter((m) => m === "eth_call").length).toBe(4); // safe + finalized on both
    const { f: f2 } = rpcFetch({ [RPCS[0]]: { ts: { finalized: NOW } }, [RPCS[1]]: { ts: { finalized: NOW } } });
    expect(await checkPaymentState(rec({ validBefore: VB }), { ...opts(f2), expiryTag: "finalized" })).toMatchObject({ state: "expired_unsettled" });
  });

  it("the old blind spot (finalized 1,400 s old, validBefore 61 s ago) is no longer expired_unsettled", async () => {
    const v = { ts: { safe: NOW - 104, finalized: NOW - 1400 } };
    const { f } = rpcFetch({ [RPCS[0]]: v, [RPCS[1]]: v });
    for (const expiryTag of ["safe", "finalized"] as const) {
      expect((await checkPaymentState(rec({ validBefore: NOW - 61 }), { ...opts(f), expiryTag })).state).toBe("unknown");
    }
  });
});

describe("optional third RPC: 2-of-3", () => {
  const THREE = [...RPCS, "https://rpc-three.example"];
  it("extraRpc adds a third RPC; one of three failing still allows an answer", async () => {
    const { f } = rpcFetch({ [THREE[0]]: { used: { safe: true } }, [THREE[1]]: { fail: true }, [THREE[2]]: { used: { safe: true } } });
    const s = await checkPaymentState(rec(), { ...opts(f), extraRpc: THREE[2] });
    expect(s).toMatchObject({ state: "settled", txHash: TX, rpcHosts: ["rpc-one.example", "rpc-two.example", "rpc-three.example"] });
  });
  it("2 of 3 past expiry and unused -> expired_unsettled; a lagging third is outvoted", async () => {
    const { f } = rpcFetch({ [THREE[0]]: {}, [THREE[1]]: { ts: { safe: NOW - 900 } }, [THREE[2]]: {} });
    expect(await checkPaymentState(rec({ validBefore: NOW - 100 }), { ...opts(f), rpcs: THREE })).toMatchObject({ state: "expired_unsettled" });
  });
  it("any RPC reporting the authorization used rules out expired_unsettled", async () => {
    const { f } = rpcFetch({ [THREE[0]]: {}, [THREE[1]]: { used: { safe: true }, receipt: goodReceipt({ logs: [] }) }, [THREE[2]]: {} });
    expect(await checkPaymentState(rec({ validBefore: NOW - 100 }), { ...opts(f), rpcs: THREE })).toMatchObject({ state: "unknown", reason: "rpcs_disagree" });
  });
  it("only one of three answering -> unknown", async () => {
    const { f } = rpcFetch({ [THREE[0]]: {}, [THREE[1]]: { fail: true }, [THREE[2]]: { fail: true } });
    expect(await checkPaymentState(rec({ validBefore: NOW - 100 }), { ...opts(f), rpcs: THREE })).toMatchObject({ state: "unknown", reason: "rpc_error" });
  });
  it("two of three past expiry needed: one past, two lagging -> unknown", async () => {
    const lag = { ts: { safe: NOW - 900 } };
    const { f } = rpcFetch({ [THREE[0]]: {}, [THREE[1]]: lag, [THREE[2]]: lag });
    expect(await checkPaymentState(rec({ validBefore: NOW - 100 }), { ...opts(f), rpcs: THREE })).toMatchObject({ state: "unknown", reason: "chain_not_past_expiry" });
  });
  it("three RPCs must be on three different hosts", async () => {
    const { f } = rpcFetch({});
    expect(await checkPaymentState(rec(), { ...opts(f), extraRpc: RPCS[0] + "/v2" })).toMatchObject({ state: "unknown", reason: "need_two_rpcs_on_different_hosts" });
    expect(f).not.toHaveBeenCalled();
  });
  it("more than three RPCs is rejected with a clear error (R2-L3), before any call", async () => {
    const { f } = rpcFetch({});
    await expect(checkPaymentState(rec(), { ...opts(f), rpcs: THREE, extraRpc: "https://rpc-four.example" })).rejects.toThrow(/at most 3 RPCs .*got 4/);
    await expect(checkPaymentState(rec(), { ...opts(f), rpcs: [...THREE, "https://rpc-four.example"] })).rejects.toThrow(RangeError);
    expect(() => createPaymentGuard({ hosted: false, onchain: { rpcs: [...THREE, "https://rpc-four.example"] } })).toThrow(/at most 3 RPCs/);
    expect(f).not.toHaveBeenCalled();
  });
  it("default stays the two public RPCs, both required", async () => {
    const { f } = rpcFetch({ [DEFAULT_BASE_RPCS[0]]: { used: { safe: true } }, [DEFAULT_BASE_RPCS[1]]: { fail: true } });
    expect(await checkPaymentState(rec(), { fetch: f, now: () => NOW })).toMatchObject({ state: "unknown", reason: "rpc_error", rpcHosts: ["mainnet.base.org", "base-rpc.publicnode.com"] });
  });
});

describe("guard.paymentState uses the local record and the configured RPCs", () => {
  it("passes the record through and never calls botsrated.com", async () => {
    const { f, urls } = rpcFetch({ [RPCS[0]]: { used: { safe: true } }, [RPCS[1]]: { used: { safe: true } } });
    const g = createPaymentGuard({ hosted: false, onchain: { rpcs: RPCS, fetch: f, now: () => NOW } });
    expect((await g.paymentState(rec())).state).toBe("settled");
    expect(urls.every((u) => RPCS.includes(u))).toBe(true);
  });
});

describe("marginSeconds clamping (R2-L2)", () => {
  it("clamps below 30 up to 30, above 1 day (or Infinity) down to 1 day; NaN or non-numbers give 60", () => {
    expect(marginOf(undefined)).toBe(60);
    expect(marginOf(Number.NaN)).toBe(60);
    expect(marginOf("90")).toBe(60);
    expect(marginOf(0)).toBe(30);
    expect(marginOf(-5)).toBe(30);
    expect(marginOf(Number.NEGATIVE_INFINITY)).toBe(30);
    expect(marginOf(90.2)).toBe(91);
    expect(marginOf(1e12)).toBe(86_400);
    expect(marginOf(Number.POSITIVE_INFINITY)).toBe(86_400);
  });
  it("Infinity does not throw and waits one day past validBefore", async () => {
    const { f } = rpcFetch({});
    const s = await checkPaymentState(rec({ validBefore: NOW - 10 }), { ...opts(f), marginSeconds: Number.POSITIVE_INFINITY });
    expect(s).toMatchObject({ state: "unknown", waitUntil: NOW - 10 + 86_400 });
  });
});
