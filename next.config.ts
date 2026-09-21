import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared core package is consumed from TypeScript source inside the workspace.
  transpilePackages: ["@jword/core"],
  // Playwright and manual testing hit the dev server via 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
