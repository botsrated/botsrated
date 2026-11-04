import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@botsrated/x402-preflight/guard-attach": path.join(root, "src/guard-attach.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./test/setup-circuit.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.parity.test.mjs"],
  },
});
