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
    expect($("bench").textContent).toContain("Rembourse 21,5 % du CD du R");
    expect($("s-out").textContent).toContain("Dark Harvest");
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

describe("réglages des runes", () => {
  it("désactiver Dark Harvest le retire du simulateur", () => {
    (document.querySelector('[data-form="blue"]') as HTMLElement).click();
    const cb = $("st-dh") as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event("change"));
    expect($("s-out").textContent).not.toContain("Dark Harvest");
    expect(($("st-souls") as HTMLSelectElement).disabled).toBe(true);
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
    expect($("s-out").textContent).toContain("Dark Harvest");
  });
});

describe("icônes et mention légale", () => {
  it("les icônes pointent vers Data Dragon, à la version synchronisée", async () => {
    const { DDRAGON_VERSION } = await import("../src/data/version");
    const img = document.querySelector("#guides .it img.dd") as HTMLImageElement;
    expect(img.src).toBe(`https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/item/6699.png`);
    expect(document.querySelector("#logo img.dd")).not.toBeNull();
  });

  it("une image qui ne charge pas est retirée, le pictogramme de secours reste", () => {
    const tile = document.querySelector("#guides .it") as HTMLElement;
    tile.querySelector("img.dd")!.dispatchEvent(new Event("error"));
    expect(tile.querySelector("img.dd")).toBeNull();
    expect(tile.querySelector("svg")).not.toBeNull();
  });

  it("affiche la mention légale de Riot Games", () => {
    expect($("legal").textContent).toContain("isn't endorsed by Riot Games");
    expect($("legal").textContent).toContain("trademarks or registered trademarks of Riot Games, Inc.");
  });
});
