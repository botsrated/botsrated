/**
 * Copy-paste client halt sample.
 *
 * Absolute No-Grade: this record and the measured chips only. It does not score,
 * and it never calls a seller trusted, safe, a scam, or a ranking.
 *
 * strictModeHalt() aborts when the measurement shows "payTo changed" or
 * "probe failed". Omit haltOn and chip halt stays off. This file does not set
 * failOpen and does not change fail_mode. fail_mode stays "open".
 *
 * The customer owns the list. A different haltOn replaces this sample.
 * strictModeHalt() is not policies.strict, and it is not a closed fail_mode.
 */
import { guardAttach, strictModeHalt } from "@botsrated/x402-preflight/guard-attach";

const policy = {
  id: "pol_desk",
  version: "3",
  fail_mode: "open" as const,
  pay_to: ["0x1111111111111111111111111111111111111111"],
  networks: ["eip155:8453"],
  resource_hosts: ["seller.example"],
};

const now = "2026-11-04T12:30:00Z";

const payToChanged = {
  as_of: "2026-11-04T12:00:00Z",
  expires_at: "2026-11-04T13:00:00Z",
  pay_to_unchanged: false,
  valid_402: true,
};

const probeFailed = {
  as_of: "2026-11-04T12:00:00Z",
  probe_failed: true,
};

const payment = {
  paymentRequired: { resource: { url: "https://seller.example/api" } },
  selectedRequirements: {
    amount: "1000",
    payTo: "0x1111111111111111111111111111111111111111",
    network: "eip155:8453",
  },
};

/** Abort: measured chip "payTo changed". The policy verdict can still be pass. */
export const payToChangedHalt = guardAttach({
  policy,
  measured: payToChanged,
  now,
  haltOn: strictModeHalt(),
});

/** Abort: measured chip "probe failed". */
export const probeFailedHalt = guardAttach({
  policy,
  measured: probeFailed,
  now,
  haltOn: strictModeHalt(),
});

/** Omit haltOn. Chip halt stays off, including when the measurement shows a payTo change. */
export const omittedHalt = guardAttach({
  policy,
  measured: payToChanged,
  now,
});

export async function runStrictModeHaltSample() {
  const payToChangedAbort = await payToChangedHalt.onBeforePaymentCreation(payment);
  const probeFailedAbort = await probeFailedHalt.onBeforePaymentCreation(payment);
  const omittedContinues = await omittedHalt.onBeforePaymentCreation(payment);
  return {
    payToChangedAbort,
    probeFailedAbort,
    omittedContinues,
    failOpenDefault: payToChangedHalt.failOpenDefault && probeFailedHalt.failOpenDefault && omittedHalt.failOpenDefault,
    failMode: payToChangedHalt.lastVerdict()?.fail_mode,
    payToVerdict: payToChangedHalt.lastVerdict()?.verdict,
    probeVerdict: probeFailedHalt.lastVerdict()?.verdict,
    haltChips: payToChangedHalt.lastHalt()?.chips,
  };
}
