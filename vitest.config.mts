import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: [
            "packages/*/src/**/*.test.ts",
            "packages/*/test/**/*.test.ts",
            "src/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Integration tests share one local database; run files serially.
          fileParallelism: false,
        },
      },
    ],
  },
});
