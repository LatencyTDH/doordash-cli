import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["vitest/node-suite.test.mjs"],
    testTimeout: 300_000,
  },
});
