import { beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toFunctionSelector, toHex } from "viem";
import {
  AUTHORIZATION_STATE_SELECTOR,
  AUTHORIZATION_USED_TOPIC,
  DEFAULT_BASE_RPCS,
  TRANSFER_TOPIC,
  _resetChainCache,
  checkPaymentState,
  type PaymentRecord,
} from "../src/onchain";
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
}

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
          return { number: "0xc8", timestamp: toHex(NOW) };
        case "eth_call": {
          expect(body.params[0].to).toBe(USDC);
          expect(body.params[0].data).toBe(AUTHORIZATION_STATE_SELECTOR + pad(FROM).slice(2) + NONCE.slice(2));
          return (v.used?.[body.params[1]] ?? false) ? toHex(1n, { size: 32 }) : toHex(0n, { size: 32 });
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

  it("expired_unsettled only after validBefore + margin and unused at finalized on both RPCs", async () => {
    const { f, methods } = rpcFetch({ [RPCS[0]]: {}, [RPCS[1]]: {} });
    const s = await checkPaymentState(rec({ validBefore: NOW - 100 }), opts(f));
    expect(s).toMatchObject({ state: "expired_unsettled" });
    expect(methods.filter((m) => m === "eth_call").length).toBe(4); // safe + finalized on both
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

describe("guard.paymentState uses the local record and the configured RPCs", () => {
  it("passes the record through and never calls botsrated.com", async () => {
    const { f, urls } = rpcFetch({ [RPCS[0]]: { used: { safe: true } }, [RPCS[1]]: { used: { safe: true } } });
    const g = createPaymentGuard({ hosted: false, onchain: { rpcs: RPCS, fetch: f, now: () => NOW } });
    expect((await g.paymentState(rec())).state).toBe("settled");
    expect(urls.every((u) => RPCS.includes(u))).toBe(true);
  });
});
