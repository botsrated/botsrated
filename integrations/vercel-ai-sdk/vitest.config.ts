import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Published `@botsrated/x402-preflight` 0.2.1 has PaymentGuard and does not accept `remotePolicy`
 * (that behavior is in this repo, publish HOLD). Guard tests that need a remote decision resolve
 * the payment-guard subpath at the in-repo source. The package import stays the published name.
 */
export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: {
      "@botsrated/x402-preflight/payment-guard": path.resolve(root, "../x402-client/src/payment-guard.ts"),
    },
  },
});
