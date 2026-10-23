// Live smoke test against https://botsrated.com using only free routes. No wallet, no payment.
import { BotsRatedClient, createPrePaymentGuard, BASE_MAINNET, BASE_USDC } from "../dist/index.js";

const client = new BotsRatedClient();
const pre = await client.preflight("https://blockrun.ai/api/v1/chat/completions");
console.log("preflight found:", pre.found, "host:", pre.host, "last probe:", pre.body.freshness?.last_probe_at);
const nc = await client.preflight("https://not-covered.example");
console.log("uncovered found:", nc.found);
const guard = createPrePaymentGuard({ client });
const req = { scheme: "exact", network: BASE_MAINNET, asset: BASE_USDC, payTo: pre.body.latest_probe.live_payTo, amount: pre.body.latest_probe.live_amount };
console.log("matching payTo:", (await guard.decide(pre.body.latest_probe.url, req)).action);
console.log("unseen payTo:", (await guard.decide(pre.body.latest_probe.url, { ...req, payTo: "0x000000000000000000000000000000000000dEaD" })).action);
