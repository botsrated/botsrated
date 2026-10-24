import { readFileSync } from "node:fs";
import { vi } from "vitest";

export const FOUND = JSON.parse(readFileSync(new URL("../../fixtures/preflight-found.json", import.meta.url), "utf8"));
export const SELLER_URL: string = FOUND.latest_probe.url; // https://blockrun.ai/api/v1/chat/completions
export const SELLER_PAYTO: string = FOUND.latest_probe.live_payTo;
export const OTHER_PAYTO = "0x000000000000000000000000000000000000dEaD";
export const BASE = "eip155:8453";
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Records every call; answers BotsRated preflight with the real fixture. */
export function recordingFetch(answer: (url: string) => Response = () => json(FOUND)) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return answer(url);
  });
  return { f, calls };
}

export const req = (o: Record<string, unknown> = {}) => ({
  scheme: "exact",
  network: BASE,
  asset: USDC,
  amount: FOUND.latest_probe.live_amount as string,
  payTo: SELLER_PAYTO,
  maxTimeoutSeconds: 60,
  extra: { name: "USD Coin", version: "2" },
  ...o,
});

export const pr = (resourceUrl: unknown, accepts = [req()], extensions?: Record<string, unknown>) => ({
  x402Version: 2,
  resource: { url: resourceUrl, description: "", mimeType: "application/json" },
  accepts,
  ...(extensions ? { extensions } : {}),
});

export const PAYMENT_IDENTIFIER_DECL = {
  info: { required: false },
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { required: { type: "boolean" }, id: { type: "string", minLength: 16, maxLength: 128 } },
    required: ["required"],
  },
};

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

/** Strings no decision, message or doc may contain (Legal M2). */
export const BANNED = /\b(safe|unsafe|suspicious|scam|scams|fraud|fraudulent|trusted|untrusted|prevent\w*|guarantee\w*)\b|verified seller/i;
