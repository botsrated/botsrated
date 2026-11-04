/** Claim ceiling for a match: this record only. Not a rating of the seller. */
export const RECEIPT_CHECK_CLAIM: "this record only";

export const RECEIPT_CHECK_STATUSES: readonly ["signature valid", "signature invalid", "key unknown", "not offline-verifiable"];

export type ReceiptCheckStatus = "signature valid" | "signature invalid" | "key unknown" | "not offline-verifiable";

export interface ReceiptSnapshotSig {
  sha256: string;
  key_id: string;
  public_key_b64: string;
  signature_b64: string;
  generated_at: string;
}

export interface ReceiptCheckDeps {
  sha256(data: string | Uint8Array): string | Promise<string>;
  ed25519(publicKeyB64: string, message: string | Uint8Array, sigB64: string): boolean | Promise<boolean>;
  loadSnapshot?(): Promise<{ bytes: Uint8Array; sig: ReceiptSnapshotSig }>;
}

/** Same fields spec/verify-core.mjs returns. `status` stays in the fixed vocabulary. */
export interface ReceiptCheckResult {
  ok: boolean;
  valid: boolean;
  status: ReceiptCheckStatus;
  lines: string[];
  errors: string[];
  id?: string;
  key_id: string | null;
  kind: string | null;
  ts: string | null;
  host: string | null;
  /** Present and false when the copy carries withheld markers. */
  offline_verifiable?: boolean;
  withheld_fields?: string[];
}

/** Node sha256 and Ed25519. Offline. */
export function receiptNodeDeps(): ReceiptCheckDeps;

/**
 * Check one receipt offline. Defaults to Node crypto when `deps` is omitted.
 * A match is this record only.
 */
export function verifyReceipt(raw: unknown, keyset: unknown, deps?: ReceiptCheckDeps): Promise<ReceiptCheckResult>;
