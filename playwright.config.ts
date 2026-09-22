import { defineConfig, devices } from "@playwright/test";
import { loadTestEnv } from "./tests/test-env";

loadTestEnv();

const PORT = 3100;
// Use localhost (not 127.0.0.1): the dev server rebuilds absolute URLs with "localhost", and
// auth cookies are host-specific.
const baseURL = `http://localhost:${PORT}`;

/**
 * Local runs use `next dev` for fast iteration. In CI (CI=1) the production build is used
 * so the smoke flows exercise the same code path that ships.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: process.env.CI
      ? `pnpm exec next build && pnpm exec next start -p ${PORT}`
      : `pnpm exec next dev -p ${PORT}`,
    url: baseURL + "/sign-in",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
