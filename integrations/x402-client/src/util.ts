/**
 * Shared, side-effect-free helpers. This module never signs, never pays and never imports a signer.
 */

/** Package version. Kept equal to package.json by a test. */
export const VERSION = "0.3.2";
/** User-Agent sent on hosted BotsRated calls. No install id, wallet or other user identifier. */
export const USER_AGENT = `botsrated-x402-preflight/${VERSION}`;
export const BOTSRATED_BASE_URL = "https://botsrated.com";
/** Where a seller (or anyone) can dispute a BotsRated measurement. Included in every decision. */
export const DISPUTE_URL = "https://botsrated.com/disputes";
export const TERMS_URL = "https://botsrated.com/terms";
export const PRIVACY_URL = "https://botsrated.com/privacy";
export const BASE_MAINNET = "eip155:8453";
/** Base mainnet chain id (8453) as returned by eth_chainId. */
export const BASE_CHAIN_ID_HEX = "0x2105";
/** Native USDC on Base. Pinned: never taken from a seller's quote. */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export class BotsRatedError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BotsRatedError";
  }
}

/**
 * Returns the lowercase ASCII host of a URL or bare host string: punycode (IDNA) encoded by `URL`, trailing dot removed.
 * `http:`/`https:` URLs are parsed as URLs even without `//` (so `https:evil.example` is `evil.example`).
 * Throws `invalid_host`; use {@link tryHostOf} where a throw is not acceptable.
 */
export function hostOf(urlOrHost: string): string {
  const s = String(urlOrHost ?? "").trim();
  let host = "";
  try {
    host = new URL(s.includes("://") || /^https?:/i.test(s) ? s : `https://${s}`).hostname;
  } catch {
    host = "";
  }
  host = host.replace(/\.+$/, "").toLowerCase();
  if (!host || host.length > 253) throw new BotsRatedError(`not a URL or host: ${cleanText(s, 80)}`, "invalid_host");
  return host;
}

/** {@link hostOf} that returns undefined instead of throwing. */
export function tryHostOf(urlOrHost: unknown): string | undefined {
  if (typeof urlOrHost !== "string") return undefined;
  try {
    return hostOf(urlOrHost);
  } catch {
    return undefined;
  }
}

/** Host plus path of an http(s) URL (no query, no fragment), or undefined. Used locally only; never sent. */
export function hostAndPath(url: unknown): { host: string; path: string } | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    const host = u.hostname.replace(/\.+$/, "").toLowerCase();
    if (!host) return undefined;
    return { host, path: u.pathname.replace(/\/$/, "") || "/" };
  } catch {
    return undefined;
  }
}

/** True when two normalized hosts are equal or differ only by a leading `www.` (an apex <-> www redirect). */
export function sameSiteHost(a: string, b: string): boolean {
  return a === b || a === `www.${b}` || b === `www.${a}`;
}

// C0/C1 controls, bidi controls and zero-width / BOM characters.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/** Strips control, bidi and zero-width characters and caps length. For any seller- or network-supplied text. */
export function cleanText(value: unknown, max = 120): string {
  const s = String(value ?? "").replace(UNSAFE_CHARS, "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

export const isAddress = (v: unknown): v is string => typeof v === "string" && ADDRESS_RE.test(v);
export const isTxHash = (v: unknown): v is string => typeof v === "string" && TX_HASH_RE.test(v);
export const isBytes32 = (v: unknown): v is string => typeof v === "string" && BYTES32_RE.test(v);
export const isAtomicAmount = (v: unknown): v is string => typeof v === "string" && /^[0-9]{1,78}$/.test(v);

/**
 * x402 v1 network names for the two families this guard knows how to format-check.
 * `base` is eip155. `solana` is solana. CAIP-2 `eip155:<digits>` and `solana:<reference>` are the same families.
 * A v1 name is not rewritten to a CAIP-2 id: `base` and `eip155:8453` stay different network strings.
 */
const EVM_V1_NETWORKS = new Set([
  "base",
  "base-sepolia",
  "avalanche",
  "avalanche-fuji",
  "iotex",
  "sei",
  "sei-testnet",
  "polygon",
  "polygon-amoy",
  "peaq",
]);
const SOLANA_V1_NETWORKS = new Set(["solana", "solana-devnet", "solana-testnet"]);
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export type NetworkFamily = "eip155" | "solana";

/** `eip155` or `solana` when the network string is a known family. Anything else is unknown. */
export function networkFamily(network: unknown): NetworkFamily | undefined {
  if (typeof network !== "string") return undefined;
  const raw = network.trim();
  if (!raw || raw.length > 80) return undefined;
  const lower = raw.toLowerCase();
  if (lower.startsWith("eip155:")) return /^\d+$/.test(lower.slice("eip155:".length)) ? "eip155" : undefined;
  if (lower.startsWith("solana:")) {
    const ref = raw.slice(raw.indexOf(":") + 1);
    return ref.length > 0 && ref.length <= 64 && !/[\s/]/.test(ref) ? "solana" : undefined;
  }
  if (EVM_V1_NETWORKS.has(lower)) return "eip155";
  if (SOLANA_V1_NETWORKS.has(lower)) return "solana";
  return undefined;
}

/** Network string for a fact sentence. Capped. Not a translation of v1 names into CAIP-2. */
export function networkLabel(network: unknown): string {
  if (typeof network !== "string") return "this network";
  return cleanText(network, 40) || "this network";
}

/** Solana public key: base58, decodes to 32 bytes. A 64-byte secret key does not match. Case is kept. */
export function isBase58Pubkey(v: unknown): v is string {
  if (typeof v !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return false;
  let n = 0n;
  for (const c of v) {
    const i = BASE58_ALPHABET.indexOf(c);
    if (i < 0) return false;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.push(Number(n % 256n));
    n /= 256n;
  }
  let zeros = 0;
  while (zeros < v.length && v[zeros] === "1") zeros++;
  return zeros + bytes.length === 32;
}

/** Hex addresses are lower-cased. A base58 public key is returned unchanged. */
export function normalizePayTo(payTo: string): string {
  return isAddress(payTo) ? payTo.toLowerCase() : payTo;
}

/**
 * `ok` when payTo matches the network family. `invalid` when the family is known and the payTo does not match it.
 * `not_validated` when the network is not a known family (the payTo is not compared).
 */
export function payToFormatFor(network: unknown, payTo: unknown): "ok" | "invalid" | "not_validated" {
  const family = networkFamily(network);
  if (family === "eip155") return isAddress(payTo) ? "ok" : "invalid";
  if (family === "solana") return isBase58Pubkey(payTo) ? "ok" : "invalid";
  return "not_validated";
}

/** Fact sentence for `payto_invalid`. eip155 keeps the 20-byte hex sentence. */
export function payToInvalidFact(network: unknown): string {
  if (networkFamily(network) === "solana") return "the payTo in this payment request is not a base58 32-byte public key.";
  return "the payTo in this payment request is not a 20-byte hex address.";
}

/** Largest decoded x402 header (PAYMENT-REQUIRED / PAYMENT-RESPONSE) we parse. */
export const MAX_HEADER_BYTES = 16 * 1024;
