/**
 * Read-only, on-chain "did this payment land once?" check for an EIP-3009 USDC payment on Base.
 *
 * - Reads only: eth_chainId, eth_call (authorizationState), eth_getBlockByNumber, eth_getLogs, eth_getTransactionReceipt.
 * - Never signs, never sends a transaction, never resends a payment, never calls botsrated.com.
 * - Three answers only: "settled", "unknown" (until validBefore + margin, or when the RPCs fail or disagree), and
 *   "expired_unsettled". There is no "not paid" answer before the authorization has expired.
 */
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
  /** At least two RPC URLs on different hosts (ideally different operators). Default {@link DEFAULT_BASE_RPCS}. */
  rpcs?: readonly string[];
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Per RPC request. Default 5000 ms. */
  timeoutMs?: number;
  /** Block tag a "settled" answer must be visible at. Default "safe". */
  confirmTag?: "safe" | "finalized";
  /** Seconds after validBefore before "expired_unsettled" is possible. Default 60, minimum 30. */
  marginSeconds?: number;
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

const chainChecked = new Map<string, boolean>();

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
  tx?: { hash: string; blockNumber: number };
  windowExceeded?: boolean;
}

async function viewAt(url: string, rec: PaymentRecord, tag: string, o: OnchainOptions): Promise<RpcView> {
  await ensureChain(url, o);
  const block = await rpc(url, "eth_getBlockByNumber", [tag, false], o);
  if (!block || typeof block.number !== "string") throw new RpcError("no block at tag");
  const tagBlock = BigInt(block.number);
  const tagTs = Number(BigInt(block.timestamp ?? "0x0"));
  const used = await authorizationUsed(url, rec, tag, o);
  if (!used) return { used };
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
      return { used, tx: { hash: h, blockNumber: Number(BigInt(receipt.blockNumber)) } };
    }
  }
  return { used, windowExceeded };
}

function validRecord(rec: PaymentRecord): string | undefined {
  if (!rec || typeof rec !== "object") return "no_record";
  if (rec.network !== BASE_MAINNET || !eqHex(rec.asset, BASE_USDC)) return "unsupported_network_or_asset";
  if (!isAddress(rec.from) || !isAddress(rec.payTo) || !isBytes32(rec.nonce) || !isAtomicAmount(rec.amount)) return "invalid_record";
  if (!Number.isSafeInteger(rec.validBefore) || rec.validBefore <= 0) return "invalid_record";
  return undefined;
}

/**
 * Read-only check of whether one EIP-3009 payment settled. Needs two RPCs on different hosts; both must agree.
 * - "settled": both RPCs show the authorization used at the confirm tag (default "safe") and a receipt with
 *   AuthorizationUsed(from, nonce) plus Transfer(from, payTo, amount) from the pinned USDC contract.
 * - "expired_unsettled": now > validBefore + margin and both RPCs show it unused at "finalized".
 * - otherwise "unknown" with `waitUntil`; never retry or sign a new payment for the purchase on "unknown".
 */
export async function checkPaymentState(rec: PaymentRecord, options: OnchainOptions = {}): Promise<PaymentState> {
  const margin = Math.max(MIN_MARGIN_SECONDS, options.marginSeconds ?? 60);
  const waitUntil = Number.isSafeInteger(rec?.validBefore) ? rec.validBefore + margin : Number.NaN;
  const rpcs = (options.rpcs ?? DEFAULT_BASE_RPCS).slice(0, 2);
  const hosts = rpcs.map((u) => tryHostOf(u) ?? "invalid");
  try {
    const bad = validRecord(rec);
    if (bad) return unknown(bad, waitUntil, hosts);
    if (rpcs.length < 2 || hosts.includes("invalid") || hosts[0] === hosts[1]) return unknown("need_two_rpcs_on_different_hosts", waitUntil, hosts);
    const tag = options.confirmTag ?? "safe";
    let views: RpcView[];
    try {
      views = await Promise.all(rpcs.map((u) => viewAt(u, rec, tag, options)));
    } catch {
      return unknown("rpc_error", waitUntil, hosts);
    }
    const [a, b] = views;
    if (a.used !== b.used) return unknown("rpcs_disagree", waitUntil, hosts);
    if (a.used) {
      if (a.tx && b.tx && a.tx.hash === b.tx.hash) {
        return { state: "settled", txHash: a.tx.hash, blockNumber: Math.min(a.tx.blockNumber, b.tx.blockNumber), tag, rpcHosts: hosts };
      }
      return unknown(a.windowExceeded || b.windowExceeded ? "log_window_exceeded_pass_tx_hash" : "used_but_transfer_not_matched", waitUntil, hosts);
    }
    const now = (options.now ?? nowSec)();
    if (now <= waitUntil) return unknown("not_settled_yet", waitUntil, hosts);
    let fin: RpcView[];
    try {
      fin = tag === "finalized" ? views : await Promise.all(rpcs.map((u) => viewAt(u, rec, "finalized", options)));
    } catch {
      return unknown("rpc_error", waitUntil, hosts);
    }
    if (!fin[0].used && !fin[1].used) return { state: "expired_unsettled", validBefore: rec.validBefore, rpcHosts: hosts };
    return unknown(fin[0].used !== fin[1].used ? "rpcs_disagree" : "used_but_not_confirmed", waitUntil, hosts);
  } catch {
    return unknown("check_error", waitUntil, hosts);
  }
}

/** For tests only: forget which RPC URLs passed the chain-id check. */
export function _resetChainCache(): void {
  chainChecked.clear();
}
