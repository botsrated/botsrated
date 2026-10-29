/**
 * Ledger flag to merge into the private worker Env (the generated Env from
 * that worker's wrangler.toml). This is not a replacement for the private Env.
 * Only the exact string "true" enables the ledger. The public-repo fragment
 * defaults the var to "false".
 */
export interface Env {
  FEATURE_ORG_LEDGER?: string;
}
