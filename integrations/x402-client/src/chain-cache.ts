/**
 * Internal: which RPC URLs passed the Base chain-id check. Not part of the public API (not in package.json
 * `exports` and not re-exported from the package entry points).
 */
export const chainChecked = new Map<string, boolean>();

/** For tests only: forget which RPC URLs passed the chain-id check. */
export function _resetChainCache(): void {
  chainChecked.clear();
}
