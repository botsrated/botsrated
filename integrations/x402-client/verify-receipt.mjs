// Offline check of one receipt. Same verifyReceipt as spec/verify-core.mjs.
// Status is signature valid, signature invalid, or key unknown.
// A match is this record only. It is not a rating of the seller.
// No network. This file does not fetch, and it does not mount a hosted route.
import { verifyReceipt as verifyReceiptCore } from "../../spec/verify-core.mjs";
import { nodeDeps } from "../../spec/verify-node.mjs";

/** Claim ceiling for a match: this record only. */
export const RECEIPT_CHECK_CLAIM = "this record only";

export const RECEIPT_CHECK_STATUSES = Object.freeze(["signature valid", "signature invalid", "key unknown"]);

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
