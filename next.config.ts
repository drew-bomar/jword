import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared core package is consumed from TypeScript source inside the workspace.
  transpilePackages: ["@jword/core"],
};

export default nextConfig;
