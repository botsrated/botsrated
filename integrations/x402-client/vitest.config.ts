import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup-circuit.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.parity.test.mjs"],
  },
});
