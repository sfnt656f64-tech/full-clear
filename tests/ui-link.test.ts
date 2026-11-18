// @vitest-environment jsdom
// La page ouverte par npm run live (lien #draft=…) pré-remplit le simulateur de draft.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const $ = (id: string) => document.getElementById(id)!;

beforeAll(async () => {
  const html = readFileSync(resolve(import.meta.dirname, "../index.html"), "utf8");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "");
  history.replaceState(null, "", "/kayn-sim/#draft=en-Ornn.Sejuani.Galio.Aphelios.Braum~al-Jax.Orianna.Ezreal.Inconnu~src-live");
  await import("../src/main");
});

describe("lien de draft", () => {
  it("pré-remplit les deux équipes et lance l'analyse", () => {
    expect($("slots-en").textContent).toContain("Sejuani");
    expect($("slots-al").textContent).toContain("Orianna");
    expect($("slots-al").textContent).toContain("Toi");
    expect($("d-out").textContent).toContain("Rhaast");
  });

  it("signale la provenance et les champions inconnus", () => {
    expect($("d-src").textContent).toContain("ta partie en cours");
    expect($("d-src").textContent).toContain("Inconnu");
  });

  it("une modification manuelle met le lien à jour (partage)", () => {
    (document.querySelector('[data-team="al"][data-slot="3"]') as HTMLElement).click();
    const q = $("pk-q") as HTMLInputElement;
    q.value = "karma";
    q.dispatchEvent(new Event("input"));
    ($("pk-grid").querySelector('[data-name="Karma"]') as HTMLElement).click();
    expect(location.hash).toBe("#draft=en-Ornn.Sejuani.Galio.Aphelios.Braum~al-Jax.Orianna.Ezreal.Karma");
    expect($("d-src").classList.contains("hide")).toBe(true);
  });

  it("un nouveau lien (hashchange) remplace la draft", () => {
    location.hash = "#draft=en-Ahri.Zed...~al-";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect($("slots-en").textContent).toContain("Zed");
    expect($("d-out").textContent).toContain("Ajoute au moins 3 adversaires");
  });
});
