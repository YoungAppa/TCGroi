import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * App-level tests: catalog normalisation, pull-rate schema, data plumbing.
 * The EV engine's suite (and its strict coverage thresholds) lives with the
 * engine in packages/ev.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
