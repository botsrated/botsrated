/**
 * Shared, side-effect-free helpers. This module never signs, never pays and never imports a signer.
 */

/** Package version. Kept equal to package.json by a test. */
export const VERSION = "0.3.0";
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

/** Largest decoded x402 header (PAYMENT-REQUIRED / PAYMENT-RESPONSE) we parse. */
export const MAX_HEADER_BYTES = 16 * 1024;
