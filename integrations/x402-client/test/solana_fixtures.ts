// Local fixtures for the Solana guard tests: a /v1/preflight-shaped body with quotes_by_network. No network.
const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (bytes: number[]) => {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let o = "";
  while (n > 0n) {
    o = ALPHA[Number(n % 58n)] + o;
    n /= 58n;
  }
  let z = 0;
  while (z < bytes.length && bytes[z] === 0) z++;
  return "1".repeat(z) + o;
};
const key = (seed: number) => b58(Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 7 + 1) & 0xff));
const secret = (seed: number) => b58(Array.from({ length: 64 }, (_, i) => (seed * 17 + i * 3 + 1) & 0xff));
const SOL_NET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const BASE_NET = "eip155:8453";
const SOL_PAY = key(1);
const SOL_OTHER = key(2);
const FEE = key(3);
const SECRET = secret(4);
const EVM = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const q = (net: string, payTo: string, extra: Record<string, unknown> = {}) => ({
  chain: net.startsWith("solana") ? "solana" : "eip155",
  asset: null,
  asset_label: "USDC",
  amount_atomic: "10000",
  price_usd: 0.01,
  payTo,
  payto_shape: net.startsWith("solana") ? "base58" : "evm",
  distinct_payto_seen: 1,
  payto_pattern: "single_address",
  probes_with_quote: 5,
  first_seen: "2026-11-01T00:00:00Z",
  last_seen: "2026-11-07T00:00:00Z",
  last_receipt_id: "r1",
  ...extra,
});
const preflightBody = {
  found: true,
  latest_probe: { live_network: BASE_NET, live_payTo: EVM, live_amount: "10000", url: "https://seller.example/api" },
  measured: { last_quoted_payTo: EVM, last_quoted_amount_atomic: "10000" },
  listing: {},
  freshness: { stale: false },
  quotes_by_network: {
    [BASE_NET]: q(BASE_NET, EVM),
    [SOL_NET]: q(SOL_NET, SOL_PAY, { fee_payer: FEE, fee_payer_note: "facilitator fee payer from extra.feePayer; not the seller's payTo" }),
  },
};
const rotatingBody = {
  ...preflightBody,
  quotes_by_network: {
    ...preflightBody.quotes_by_network,
    [SOL_NET]: q(SOL_NET, SOL_PAY, { payto_pattern: "rotating_per_request", distinct_payto_seen: 40 }),
  },
};
export const SOLANA_FIXTURES = { SOL_NET, BASE_NET, SOL_PAY, SOL_OTHER, FEE, SECRET, EVM, preflightBody, rotatingBody };
