// @vitest-environment jsdom
// Test de fumée : la page se monte, les onglets et la draft d'exemple fonctionnent.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const $ = (id: string) => document.getElementById(id)!;
const change = (id: string, value: string) => {
  const s = $(id) as HTMLSelectElement;
  s.value = value;
  s.dispatchEvent(new Event("change"));
};

beforeAll(async () => {
  const html = readFileSync(resolve(import.meta.dirname, "../index.html"), "utf8");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "");
  await import("../src/main");
});

describe("interface", () => {
  it("affiche les guides bleus, le simulateur et le benchmark", () => {
    expect($("guides").querySelectorAll(".grid .card")).toHaveLength(6);
    expect($("s-out").textContent).toContain("Dégâts du combo");
    expect($("bench").textContent).toContain("Serylda's Grudge");
    expect($("bench").textContent).toContain("65 %");
  });

  it("l'onglet Rhaast bascule guides, simulateur et benchmark", () => {
    (document.querySelector('[data-form="red"]') as HTMLElement).click();
    expect($("guides").querySelectorAll(".grid .card")).toHaveLength(5);
    expect($("s-out").textContent).toContain("DPS (combat de 6 s)");
    expect($("bench").textContent).toContain("PV eff. phys");
    expect($("hub-wrap").style.display).toBe("none");
  });

  it("draft d'exemple « Frontline lourde » → Rhaast, Cleaver en premier", () => {
    expect($("d-out").textContent).toContain("Ajoute au moins 3 adversaires");
    change("d-ex", "Frontline lourde");
    const out = $("d-out").textContent!;
    expect(out).toContain("Rhaast");
    expect(out).toContain("Black Cleaver → Voltaic Cyclosword");
    expect($("d-out").querySelectorAll(".erow")).toHaveLength(5);
  });

  it("choisir un champion via la fenêtre de sélection", () => {
    (document.querySelector('[data-team="al"][data-slot="0"]') as HTMLElement).click();
    expect($("picker").classList.contains("hide")).toBe(false);
    const q = $("pk-q") as HTMLInputElement;
    q.value = "zed";
    q.dispatchEvent(new Event("input"));
    const btn = $("pk-grid").querySelector('[data-name="Zed"]') as HTMLElement;
    expect(btn).not.toBeNull();
    btn.click();
    expect($("picker").classList.contains("hide")).toBe(true);
    expect($("slots-al").textContent).toContain("Zed");
  });
});
