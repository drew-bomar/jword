import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

// Bundles the unpacked Chrome extension into dist/. Load dist/ via chrome://extensions.
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
const common = { bundle: true, target: "chrome120", logLevel: "warning" };
await build({
  ...common,
  entryPoints: ["src/background.ts"],
  format: "esm",
  outfile: "dist/background.js",
});
await build({
  ...common,
  entryPoints: ["src/content.ts"],
  format: "iife",
  outfile: "dist/content.js",
});
await build({
  ...common,
  entryPoints: ["src/options.ts"],
  format: "iife",
  outfile: "dist/options.js",
});
await build({
  ...common,
  entryPoints: ["src/panel.ts"],
  format: "iife",
  outfile: "dist/panel.js",
});
cpSync("static", "dist", { recursive: true });
