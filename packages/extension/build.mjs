import { build } from "esbuild";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

// Bundles the unpacked Chrome extension into dist/. Load dist/ via chrome://extensions.
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
const common = { bundle: true, minify: true, target: "chrome120", logLevel: "warning" };
await build({
  ...common,
  entryPoints: ["src/background.ts"],
  format: "esm",
  outfile: "dist/background.js",
});
for (const name of ["content", "options"]) {
  await build({
    ...common,
    entryPoints: [`src/${name}.ts`],
    format: "iife",
    outfile: `dist/${name}.js`,
  });
}
// The overlay reuses jword's React review component and UI kit from ../../src (decision 017).
// esbuild resolves their "@/..." imports through the root tsconfig paths.
await build({
  ...common,
  entryPoints: ["src/overlay/main.tsx"],
  format: "iife",
  outfile: "dist/overlay.js",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const css = "src/overlay/overlay.css";
const styles = await postcss([tailwind({ optimize: true })]).process(readFileSync(css, "utf8"), {
  from: css,
});
writeFileSync("dist/overlay.css", styles.css);
cpSync("static", "dist", { recursive: true });
