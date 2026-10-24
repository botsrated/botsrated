/**
 * Read-only, on-chain "did this payment land once?" check for an EIP-3009 USDC payment on Base.
 *
 * - Reads only: eth_chainId, eth_call (authorizationState), eth_getBlockByNumber, eth_getLogs, eth_getTransactionReceipt.
 * - Never signs, never sends a transaction, never resends a payment, never calls botsrated.com.
 * - Three answers only: "settled", "unknown" (until validBefore + margin, or when the RPCs fail, disagree or lag), and
 *   "expired_unsettled". There is no "not paid" answer before the authorization has expired, and "expired_unsettled"
 *   needs the block read on the RPCs to be at or after validBefore + margin (USDC accepts an authorization in any
 *   block with timestamp < validBefore, so "unused" is final only in a later block).
 */
import { chainChecked } from "./chain-cache.js";
import { BASE_CHAIN_ID_HEX, BASE_MAINNET, BASE_USDC, cleanText, isAddress, isAtomicAmount, isBytes32, isTxHash, tryHostOf } from "./util.js";

/**
 * Default public Base mainnet RPCs: two different operators (Coinbase's public endpoint and Allnodes' PublicNode).
 * Public RPCs see the wallet address, nonce and your IP when you run a check; pass your own with `rpcs`.
 */
export const DEFAULT_BASE_RPCS: readonly string[] = Object.freeze(["https://mainnet.base.org", "https://base-rpc.publicnode.com"]);
/** Minimum margin after `validBefore` before an unsettled authorization can be called expired. */
export const MIN_MARGIN_SECONDS = 30;

/** keccak256("authorizationState(address,bytes32)")[0..4] */
export const AUTHORIZATION_STATE_SELECTOR = "0xe94a0102";
/** keccak256("AuthorizationUsed(address,bytes32)") */
export const AUTHORIZATION_USED_TOPIC = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** What the guard keeps about one payment it saw being created. Never the signature. */
export interface PaymentRecord {
  network: string;
  asset: string;
  /** Payer (EIP-3009 `from`). */
  from: string;
  payTo: string;
  /** Atomic amount (string of digits). */
  amount: string;
  /** EIP-3009 nonce (bytes32 hex). */
  nonce: string;
  /** EIP-3009 validBefore, unix seconds. */
  validBefore: number;
  validAfter?: number;
  /** Seller host (local only). */
  host?: string;
  /** Unix seconds when the guard saw the payment created. */
  createdAt?: number;
  /** A tx hash reported by the seller or facilitator. A hint only: it is verified on chain before it counts. */
  txHashHint?: string;
}

export interface OnchainOptions {
  /**
   * Two or three RPC URLs on different hosts (ideally different operators). Default {@link DEFAULT_BASE_RPCS}.
   * With two, both must answer and agree. With three, at least two must answer and agree (2-of-3), and any RPC
   * that reports the authorization used rules out "expired_unsettled". Extra URLs beyond three are ignored.
   */
  rpcs?: readonly string[];
  /** An optional third RPC of your own, added to `rpcs` (or to the defaults); turns on the 2-of-3 rule. */
  extraRpc?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Per RPC request. Default 5000 ms. */
  timeoutMs?: number;
  /** Block tag a "settled" answer must be visible at. Default "safe". */
  confirmTag?: "safe" | "finalized";
  /**
   * Safety margin in seconds. "expired_unsettled" needs both the clock and the block read at `expiryTag` on the
   * agreeing RPCs to be at or after validBefore + margin. Default 60, minimum 30.
   */
  marginSeconds?: number;
  /**
   * Block tag whose timestamp must be past validBefore + margin before "expired_unsettled". Default "safe" (about
   * 1-2 min after expiry on Base). "finalized" is more conservative but usually needs 20+ min after expiry.
   */
  expiryTag?: "safe" | "finalized";
  /** Largest eth_getLogs block span searched when no valid tx hash hint is given. Default 9000 (~5 h on Base). */
  maxLogBlocks?: number;
  /** Clock override for tests (unix seconds). */
  now?: () => number;
}

export type PaymentState =
  | { state: "settled"; txHash: string; blockNumber: number; tag: string; rpcHosts: string[] }
  | { state: "unknown"; code: "payment_state_unknown"; reason: string; waitUntil: number; message: string; rpcHosts: string[] }
  | { state: "expired_unsettled"; validBefore: number; rpcHosts: string[] };

class RpcError extends Error {}

const pad32 = (hex: string) => "0x" + hex.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const eqHex = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const nowSec = () => Math.floor(Date.now() / 1000);

function unknown(reason: string, waitUntil: number, rpcHosts: string[]): PaymentState {
  const when = Number.isFinite(waitUntil) ? new Date(waitUntil * 1000).toISOString() : "the authorization's validBefore";
  return {
    state: "unknown",
    code: "payment_state_unknown",
    reason,
    waitUntil,
    rpcHosts,
    message: `Payment state unknown (${reason}). Do not sign a new payment for this purchase before ${when}; check again after that.`,
  };
}

async function rpc(url: string, method: string, params: unknown[], o: OnchainOptions): Promise<any> {
  const f = o.fetch ?? ((i: string, init?: RequestInit) => fetch(i, init));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 5000);
  try {
    const res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
      redirect: "error",
    });
    if (!res.ok) throw new RpcError(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 4_000_000) throw new RpcError("response too large");
    const body = JSON.parse(text);
    if (body?.error) throw new RpcError(cleanText(body.error?.message ?? "rpc error", 80));
    return body?.result;
  } catch (e) {
    throw e instanceof RpcError ? e : new RpcError(cleanText((e as Error)?.message ?? "rpc failed", 80));
  } finally {
    clearTimeout(t);
  }
}

async function ensureChain(url: string, o: OnchainOptions): Promise<void> {
  if (chainChecked.get(url)) return;
  const id = await rpc(url, "eth_chainId", [], o);
  if (!eqHex(id, BASE_CHAIN_ID_HEX)) throw new RpcError("wrong chain id");
  chainChecked.set(url, true);
}

async function authorizationUsed(url: string, rec: PaymentRecord, tag: string, o: OnchainOptions): Promise<boolean> {
  const data = AUTHORIZATION_STATE_SELECTOR + pad32(rec.from).slice(2) + rec.nonce.toLowerCase().slice(2);
  const out = await rpc(url, "eth_call", [{ to: BASE_USDC, data }, tag], o);
  if (typeof out !== "string" || !/^0x[0-9a-fA-F]*$/.test(out)) throw new RpcError("bad eth_call result");
  return BigInt(out === "0x" ? "0x0" : out) !== 0n;
}

/** True when the receipt proves exactly this payment: success, pinned USDC, AuthorizationUsed(from, nonce) and Transfer(from, payTo, amount). */
export function receiptProvesPayment(receipt: any, rec: PaymentRecord, maxBlock: bigint): boolean {
  if (!receipt || typeof receipt !== "object" || !eqHex(receipt.status, "0x1")) return false;
  let block: bigint;
  try {
    block = BigInt(receipt.blockNumber);
  } catch {
    return false;
  }
  if (block > maxBlock) return false;
  const logs: any[] = Array.isArray(receipt.logs) ? receipt.logs : [];
  const fromUsdc = (l: any) => eqHex(l?.address, BASE_USDC) && Array.isArray(l?.topics) && l.removed !== true;
  const used = logs.some(
    (l) => fromUsdc(l) && eqHex(l.topics[0], AUTHORIZATION_USED_TOPIC) && eqHex(l.topics[1], pad32(rec.from)) && eqHex(l.topics[2], rec.nonce),
  );
  const transfer = logs.some((l) => {
    if (!(fromUsdc(l) && eqHex(l.topics[0], TRANSFER_TOPIC) && eqHex(l.topics[1], pad32(rec.from)) && eqHex(l.topics[2], pad32(rec.payTo)))) return false;
    try {
      return BigInt(l.data) === BigInt(rec.amount);
    } catch {
      return false;
    }
  });
  return used && transfer;
}

interface RpcView {
  used: boolean;
  /** Timestamp of the block the state was read at. */
  blockTs: number;
  tx?: { hash: string; blockNumber: number };
  windowExceeded?: boolean;
}

async function viewAt(url: string, rec: PaymentRecord, tag: string, o: OnchainOptions): Promise<RpcView> {
  await ensureChain(url, o);
  const block = await rpc(url, "eth_getBlockByNumber", [tag, false], o);
  if (!block || typeof block.number !== "string") throw new RpcError("no block at tag");
  const tagBlock = BigInt(block.number);
  if (typeof block.timestamp !== "string") throw new RpcError("no block timestamp");
  const tagTs = Number(BigInt(block.timestamp));
  // Read the state at exactly the block whose timestamp we hold, not at the moving tag.
  const blockRef = "0x" + tagBlock.toString(16);
  const used = await authorizationUsed(url, rec, blockRef, o);
  if (!used) return { used, blockTs: tagTs };
  const candidates: string[] = [];
  if (isTxHash(rec.txHashHint)) candidates.push(rec.txHashHint.toLowerCase());
  let windowExceeded = false;
  if (!candidates.length) {
    const earliest = (rec.createdAt ?? rec.validAfter ?? rec.validBefore - 3600) - 120;
    const span = BigInt(Math.max(10, Math.ceil((tagTs - earliest) / 2) + 10));
    const max = BigInt(o.maxLogBlocks ?? 9000);
    if (span > max) windowExceeded = true;
    else {
      const fromBlock = tagBlock > span ? tagBlock - span : 0n;
      const logs = await rpc(
        url,
        "eth_getLogs",
        [{ address: BASE_USDC, topics: [AUTHORIZATION_USED_TOPIC, pad32(rec.from), rec.nonce.toLowerCase()], fromBlock: "0x" + fromBlock.toString(16), toBlock: "0x" + tagBlock.toString(16) }],
        o,
      );
      for (const l of Array.isArray(logs) ? logs : []) if (isTxHash(l?.transactionHash)) candidates.push(l.transactionHash.toLowerCase());
    }
  }
  for (const h of candidates.slice(0, 3)) {
    const receipt = await rpc(url, "eth_getTransactionReceipt", [h], o);
    if (receiptProvesPayment(receipt, rec, tagBlock) && eqHex(receipt.transactionHash ?? h, h)) {
      return { used, blockTs: tagTs, tx: { hash: h, blockNumber: Number(BigInt(receipt.blockNumber)) } };
    }
  }
  return { used, blockTs: tagTs, windowExceeded };
}

function validRecord(rec: PaymentRecord): string | undefined {
  if (!rec || typeof rec !== "object") return "no_record";
  if (rec.network !== BASE_MAINNET || !eqHex(rec.asset, BASE_USDC)) return "unsupported_network_or_asset";
  if (!isAddress(rec.from) || !isAddress(rec.payTo) || !isBytes32(rec.nonce) || !isAtomicAmount(rec.amount)) return "invalid_record";
  if (!Number.isSafeInteger(rec.validBefore) || rec.validBefore <= 0) return "invalid_record";
  return undefined;
}

/** The RPC URLs a check uses: `rpcs` (or the defaults) plus `extraRpc`, at most three. */
export function rpcListOf(options: OnchainOptions = {}): string[] {
  const base = [...(options.rpcs ?? DEFAULT_BASE_RPCS)];
  if (typeof options.extraRpc === "string" && options.extraRpc) base.push(options.extraRpc);
  return base.slice(0, 3);
}

async function viewsAt(rpcs: string[], rec: PaymentRecord, tag: string, o: OnchainOptions): Promise<RpcView[]> {
  const settled = await Promise.allSettled(rpcs.map((u) => viewAt(u, rec, tag, o)));
  return settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

/**
 * Read-only check of whether one EIP-3009 payment settled. Needs two (or three) RPCs on different hosts.
 * Quorum: both of two, or two of three, must answer and agree.
 * - "settled": a quorum shows the authorization used at the confirm tag (default "safe") and the same receipt with
 *   AuthorizationUsed(from, nonce) plus Transfer(from, payTo, amount) from the pinned USDC contract.
 * - "expired_unsettled": now > validBefore + margin, no answering RPC shows it used, and a quorum shows it unused at
 *   a block (at `expiryTag`, default "safe") whose timestamp is >= validBefore + margin.
 * - otherwise "unknown" with `waitUntil`; never retry or sign a new payment for the purchase on "unknown".
 */
export async function checkPaymentState(rec: PaymentRecord, options: OnchainOptions = {}): Promise<PaymentState> {
  const margin = Math.max(MIN_MARGIN_SECONDS, Number.isFinite(options.marginSeconds) ? Number(options.marginSeconds) : 60);
  const waitUntil = Number.isSafeInteger(rec?.validBefore) ? rec.validBefore + margin : Number.NaN;
  const rpcs = rpcListOf(options);
  const hosts = rpcs.map((u) => tryHostOf(u) ?? "invalid");
  try {
    const bad = validRecord(rec);
    if (bad) return unknown(bad, waitUntil, hosts);
    if (rpcs.length < 2 || hosts.includes("invalid") || new Set(hosts).size !== hosts.length) return unknown("need_two_rpcs_on_different_hosts", waitUntil, hosts);
    const quorum = 2;
    const tag = options.confirmTag ?? "safe";
    const expiryTag = options.expiryTag ?? "safe";
    const views = await viewsAt(rpcs, rec, tag, options);
    if (views.length < quorum) return unknown("rpc_error", waitUntil, hosts);
    const usedViews = views.filter((v) => v.used);
    if (usedViews.length) {
      const byHash = new Map<string, number[]>();
      for (const v of usedViews) if (v.tx) byHash.set(v.tx.hash, [...(byHash.get(v.tx.hash) ?? []), v.tx.blockNumber]);
      for (const [hash, blocks] of byHash) {
        if (blocks.length >= quorum) return { state: "settled", txHash: hash, blockNumber: Math.min(...blocks), tag, rpcHosts: hosts };
      }
      if (usedViews.length !== views.length) return unknown("rpcs_disagree", waitUntil, hosts);
      return unknown(usedViews.some((v) => v.windowExceeded) ? "log_window_exceeded_pass_tx_hash" : "used_but_transfer_not_matched", waitUntil, hosts);
    }
    const now = (options.now ?? nowSec)();
    if (now <= waitUntil) return unknown("not_settled_yet", waitUntil, hosts);
    const exp = expiryTag === tag ? views : await viewsAt(rpcs, rec, expiryTag, options);
    if (exp.length < quorum) return unknown("rpc_error", waitUntil, hosts);
    if (exp.some((v) => v.used)) return unknown(exp.every((v) => v.used) ? "used_but_not_confirmed" : "rpcs_disagree", waitUntil, hosts);
    const past = exp.filter((v) => Number.isFinite(v.blockTs) && v.blockTs >= waitUntil);
    if (past.length >= quorum) return { state: "expired_unsettled", validBefore: rec.validBefore, rpcHosts: hosts };
    // The blocks read are not yet past validBefore + margin: a late settlement could still be invisible to them.
    const lag = Math.max(0, ...exp.map((v) => now - v.blockTs).filter((x) => Number.isFinite(x)));
    return unknown("chain_not_past_expiry", Math.max(waitUntil, now) + Math.ceil(Math.min(lag, 86_400)), hosts);
  } catch {
    return unknown("check_error", waitUntil, hosts);
  }
}
