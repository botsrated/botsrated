// Offline check of one receipt for wallets, routers, and MCP clients.
// vendor/verify-core.mjs is a byte copy of spec/verify-core.mjs.
// vendor/verify-node.mjs is a byte copy of spec/verify-node.mjs.
// Parity tests keep those copies byte-identical with spec/.
// Status is signature valid, signature invalid, key unknown, or redacted copy.
// A match is this record only. It is not a rating of the seller.
// No network. This file does not fetch, and it does not mount a hosted route.
import { verifyReceipt as verifyReceiptCore } from "./vendor/verify-core.mjs";
import { nodeDeps } from "./vendor/verify-node.mjs";

/** Claim ceiling for a match: this record only. */
export const RECEIPT_CHECK_CLAIM = "this record only";

export const RECEIPT_CHECK_STATUSES = Object.freeze(["signature valid", "signature invalid", "key unknown", "redacted copy"]);

export function receiptNodeDeps() {
  return nodeDeps();
}

/**
 * Check one receipt. `deps` defaults to Node sha256 and Ed25519.
 * The return value is the spec/verify-core.mjs result, unchanged.
 */
export async function verifyReceipt(raw, keyset, deps = nodeDeps()) {
  return verifyReceiptCore(raw, keyset, deps);
}
