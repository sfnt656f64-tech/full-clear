import { defineConfig } from "vitest/config";

export default defineConfig({
  // Chemins relatifs : la page fonctionne aussi sous https://<user>.github.io/full-clear/
  base: "./",
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
