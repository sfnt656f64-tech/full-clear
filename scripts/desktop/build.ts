// Compile l'application de bureau dans desktop/dist (ignoré par git) :
//   main.cjs (processus principal), preload.cjs, renderer/ (fenêtre), icon.png.
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

const common = { bundle: true, sourcemap: "linked", logLevel: "warning", target: "es2023" } as const;

await Promise.all([
  build({ ...common, entryPoints: [resolve(SRC, "main.ts")], outfile: resolve(OUT, "main.cjs"), platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: [resolve(SRC, "preload.ts")], outfile: resolve(OUT, "preload.cjs"), platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: [resolve(SRC, "renderer/renderer.ts")], outfile: resolve(OUT, "renderer/renderer.js"), platform: "browser", format: "iife" }),
]);
for (const f of ["index.html", "style.css"]) copyFileSync(resolve(SRC, "renderer", f), resolve(OUT, "renderer", f));
writeFileSync(resolve(OUT, "icon.png"), iconPng(256));
console.log("Appli de bureau compilée dans desktop/dist.");
