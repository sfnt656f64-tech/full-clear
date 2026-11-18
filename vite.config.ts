import { defineConfig } from "vitest/config";

export default defineConfig({
  // Chemins relatifs : la page fonctionne aussi sous https://<user>.github.io/kayn-sim/
  base: "./",
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
