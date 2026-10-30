import { beforeEach } from "vitest";
import { resetHostedLookupCircuit } from "../../x402-client/src/payment-guard.ts";

beforeEach(() => {
  resetHostedLookupCircuit();
});
