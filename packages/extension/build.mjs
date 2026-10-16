import { build } from "esbuild";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { strToU8, zipSync } from "fflate";

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

// Release zips (decision 027). The Developer-mode zip keeps the manifest `key`, so its id is the
// pinned bnjlbmpmikpggohfhmfpddeeokbjpkbk the server already allows; jword serves it at
// /downloads/jword-capture.zip. The Chrome Web Store rejects a `key`, so the store zip drops it
// and gets a store-assigned id (add it to JWORD_EXTENSION_IDS).
const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
const files = {};
for (const name of readdirSync("dist", { recursive: true })) {
  const path = `dist/${name}`;
  if (statSync(path).isFile()) files[name.split("\\").join("/")] = readFileSync(path);
}
const { key: _key, ...storeManifest } = manifest;
mkdirSync("release", { recursive: true });
const devZip = zipSync(files);
writeFileSync(`release/jword-capture-${manifest.version}.zip`, devZip);
writeFileSync(
  `release/jword-capture-${manifest.version}-store.zip`,
  zipSync({ ...files, "manifest.json": strToU8(JSON.stringify(storeManifest, null, 2)) }),
);
mkdirSync("../../public/downloads", { recursive: true });
writeFileSync("../../public/downloads/jword-capture.zip", devZip);
