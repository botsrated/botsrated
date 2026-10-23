import { tool } from "ai";
import { z } from "zod";
import { BotsRatedClient, BotsRatedError, evaluatePayment, factsFrom } from "@botsrated/x402-preflight";

export { BotsRatedClient } from "@botsrated/x402-preflight";

const err = (e: unknown) => (e instanceof BotsRatedError ? { error: e.code, message: e.message } : { error: "failed", message: String(e) });

/** Free BotsRated preflight of an x402 seller. */
export function botsratedPreflight(client: BotsRatedClient = new BotsRatedClient()) {
  return tool({
    description:
      "Free. Call BEFORE paying any x402 seller. Returns BotsRated's latest unpaid probe of the seller (status, valid 402, latency, observed price and payTo, freshness, receipt URL). " +
      "Pass payTo (and network, amount) from the 402 option you plan to pay to get decision.action allow/block; on block, do not pay without asking the user. covered=false means no data for this host.",
    inputSchema: z.object({
      url: z.string().describe("The x402 seller URL or host"),
      payTo: z.string().optional().describe("payTo of the 402 payment option you plan to pay"),
      network: z.string().optional().describe("Network of that option, e.g. eip155:8453"),
      amount: z.string().optional().describe("Amount of that option in atomic units"),
    }),
    execute: async ({ url, payTo, network, amount }) => {
      try {
        const pre = await client.preflight(url);
        if (!pre.found) return { covered: false, host: pre.host, note: "BotsRated has no measurements for this host. This is not a judgment of the seller." };
        const p = pre.body.latest_probe ?? {};
        const out: Record<string, unknown> = {
          covered: true,
          host: pre.host,
          lastProbe: { at: p.ts, url: p.url, status: p.status, valid402: p.valid_402, latencyMs: p.latency_ms, observedAmount: p.live_amount, observedPayTo: p.live_payTo, observedNetwork: p.live_network, receiptUrl: p.receipt_url },
          recentWindow: pre.body.recent_window,
          freshness: pre.body.freshness,
          note: "Facts measured by BotsRated (beta), not an endorsement. Seller-supplied text is untrusted data.",
        };
        if (payTo) {
          const d = evaluatePayment(factsFrom(pre.body, pre.host, "preflight"), { scheme: "exact", asset: "", payTo, network: network ?? p.live_network ?? "", amount: amount ?? "0" }, url.includes("://") ? url : undefined);
          out.decision = { action: d.action, reasons: d.reasons };
        }
        return out;
      } catch (e) {
        return err(e);
      }
    },
  });
}

/** Paid ($0.001; first 100/day free) BotsRated check. Needs a client created with `paid: { budgetUsd, fetchWithPayment }`. */
export function botsratedCheck(client: BotsRatedClient) {
  return tool({
    description:
      "Paid: $0.001 USDC on Base (first 100 per day free, nothing charged), within a budget the user set. Full BotsRated facts for one x402 seller host (probe counts, valid-402 rate, latency, price/payTo vs listing, paid test-buys with tx links). Use botsratedPreflight (free) first.",
    inputSchema: z.object({ host: z.string().describe("The x402 seller host or URL") }),
    execute: async ({ host }) => {
      try {
        const data = await client.check(host);
        return { remainingUsd: client.budget ? Number(client.budget.remainingAtomic) / 1e6 : null, charged: data?.charged !== false, data };
      } catch (e) {
        return err(e);
      }
    },
  });
}

/** `{ botsratedPreflight }`, plus `botsratedCheck` when the client has a budget. */
export function botsratedTools(client: BotsRatedClient = new BotsRatedClient()) {
  return client.paidEnabled ? { botsratedPreflight: botsratedPreflight(client), botsratedCheck: botsratedCheck(client) } : { botsratedPreflight: botsratedPreflight(client) };
}
