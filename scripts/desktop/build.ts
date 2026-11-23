// Compile l'application de bureau dans desktop/dist (ignoré par git) :
//   main.cjs (processus principal), preload.cjs, renderer/ (fenêtre), overlay/ (en jeu), icon.png.
// npm run desktop:build   compile seulement
// npm run desktop         compile puis lance l'appli
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { iconPng } from "../../desktop/icon.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = resolve(ROOT, "desktop");
const OUT = resolve(SRC, "dist");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(resolve(OUT, "renderer"), { recursive: true });
mkdirSync(resolve(OUT, "overlay"), { recursive: true });
mkdirSync(resolve(OUT, "stats-window"), { recursive: true });
mkdirSync(resolve(OUT, "meta-window"), { recursive: true });
mkdirSync(resolve(OUT, "reco-window"), { recursive: true });

const common = { bundle: true, sourcemap: "linked", logLevel: "warning", target: "es2023" } as const;

await Promise.all([
  build({ ...common, entryPoints: [resolve(SRC, "main.ts")], outfile: resolve(OUT, "main.cjs"), platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: [resolve(SRC, "preload.ts")], outfile: resolve(OUT, "preload.cjs"), platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: [resolve(SRC, "collector/collector-main.ts")], outfile: resolve(OUT, "collector.cjs"), platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: [resolve(SRC, "preload-overlay.ts")], outfile: resolve(OUT, "preload-overlay.cjs"), platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: [resolve(SRC, "renderer/renderer.ts")], outfile: resolve(OUT, "renderer/renderer.js"), platform: "browser", format: "iife" }),
  build({ ...common, entryPoints: [resolve(SRC, "meta-window/meta.ts")], outfile: resolve(OUT, "meta-window/meta.js"), platform: "browser", format: "iife" }),
  build({ ...common, entryPoints: [resolve(SRC, "reco-window/reco.ts")], outfile: resolve(OUT, "reco-window/reco.js"), platform: "browser", format: "iife" }),
  build({ ...common, entryPoints: [resolve(SRC, "stats-window/stats.ts")], outfile: resolve(OUT, "stats-window/stats.js"), platform: "browser", format: "iife" }),
  build({ ...common, entryPoints: [resolve(SRC, "overlay/overlay.ts")], outfile: resolve(OUT, "overlay/overlay.js"), platform: "browser", format: "iife" }),
]);
for (const f of ["index.html", "style.css"]) copyFileSync(resolve(SRC, "renderer", f), resolve(OUT, "renderer", f));
for (const f of ["index.html", "overlay.css"]) copyFileSync(resolve(SRC, "overlay", f), resolve(OUT, "overlay", f));
for (const f of ["index.html", "stats.css"]) copyFileSync(resolve(SRC, "stats-window", f), resolve(OUT, "stats-window", f));
for (const f of ["index.html", "meta.css"]) copyFileSync(resolve(SRC, "meta-window", f), resolve(OUT, "meta-window", f));
for (const f of ["index.html", "reco.css"]) copyFileSync(resolve(SRC, "reco-window", f), resolve(OUT, "reco-window", f));
writeFileSync(resolve(OUT, "icon.png"), iconPng(256));
console.log("Appli de bureau compilée dans desktop/dist.");
