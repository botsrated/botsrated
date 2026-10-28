import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Guard tests resolve `@botsrated/x402-preflight/payment-guard` at the in-repo source
 * (0.3.0, which exports `normalizeRemotePolicy`). The package import stays that name.
 */
export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: {
      "@botsrated/x402-preflight/payment-guard": path.resolve(root, "../x402-client/src/payment-guard.ts"),
    },
  },
});
