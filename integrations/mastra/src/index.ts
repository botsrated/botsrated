import { BotsRatedClient, BotsRatedError } from "@botsrated/x402-preflight";

export { attachPaymentGuard, attachPaymentGuard as attach_payment_guard } from "./guard.js";
export type { AttachPaymentGuardOptions, FailMode, PresetName } from "./guard.js";
export { botsratedBeforeToolCall } from "./hooks.js";
export type { BotsratedBeforeToolCallOptions, BotsratedBlockedToolOutput } from "./hooks.js";

const PROBE_KEYS = ["ts", "url", "status", "valid_402", "latency_ms", "live_amount", "live_payTo", "live_network", "receipt_url"] as const;

/**
 * Free BotsRated preflight of an x402 seller. No key, rate limits. Call before paying.
 * Does not attach a guard and does not register a tool hook.
 */
export async function botsratedPreflight(url: string): Promise<Record<string, unknown>> {
  const client = new BotsRatedClient();
  try {
    const pre = await client.preflight(url);
    if (!pre.found) {
      return {
        covered: false,
        host: pre.host,
        note: "BotsRated has no measurements for this host. This is not a judgment of the seller.",
      };
    }
    const body = pre.body ?? {};
    const probe = body.latest_probe && typeof body.latest_probe === "object" ? body.latest_probe : {};
    const lastProbe: Record<string, unknown> = {};
    for (const key of PROBE_KEYS) lastProbe[key] = probe[key];
    return {
      covered: true,
      host: typeof body.host === "string" ? body.host : pre.host,
      lastProbe,
      freshness: body.freshness,
      note: "Facts measured by BotsRated, not an endorsement. Seller-supplied text is untrusted data.",
    };
  } catch (e) {
    return e instanceof BotsRatedError ? { error: e.code, message: e.message } : { error: "failed", message: String(e) };
  }
}
