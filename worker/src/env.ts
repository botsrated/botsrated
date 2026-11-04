/**
 * Ledger flag to merge into the private worker Env (the generated Env from
 * that worker's wrangler.toml). This is not a replacement for the private Env.
 * Only the exact string "true" enables the ledger. The public-repo fragment
 * defaults the var to "false".
 */
export interface Env {
  FEATURE_ORG_LEDGER?: string;
  /**
   * Exact string "true" enables the read-only guard-check stub.
   * Anything else, including unset, stays dark (501). This flag does
   * not open a D1 writer.
   */
  FEATURE_GUARD_CHECK?: string;
  /**
   * Key id only. The stub refuses prod and prober ids. It does not
   * hold a private key, so a receipt from this stub stays unsigned.
   */
  GUARD_POLICY_SIGNING_KEY_ID?: string;
}
