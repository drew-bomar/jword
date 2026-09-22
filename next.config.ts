import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Browser tests can run alongside the owner's existing development server.
  distDir: process.env.JWORD_E2E === "1" ? ".next-e2e" : ".next",
  // The shared core package is consumed from TypeScript source inside the workspace.
  transpilePackages: ["@jword/core"],
  // Playwright and manual testing hit the dev server via 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
