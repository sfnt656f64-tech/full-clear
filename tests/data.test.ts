// Données synchronisées avec Data Dragon : script, cohérence, écarts avec la première version.
import { describe, expect, it } from "vitest";
import { parseStatBlock, patchFromVersion } from "../scripts/sync-ddragon";
import generatedChampions from "../src/data/generated/champions.json";
import { CHAMPIONS, OVERRIDES, champ, matchesQuery } from "../src/data/champions";
import { BOOTS_T3, ITEMS } from "../src/data/items";
import { KAYN_CORRECTIONS } from "../src/data/kayn";
import { DDRAGON_VERSION, PATCH } from "../src/data/version";
import type { Item, ItemKey } from "../src/data/types";
import { KAYN_BASE } from "../src/model/constants";
import { LEGACY_ITEMS } from "./fixtures/legacy-data";

describe("script de synchronisation", () => {
  it("lit le bloc <stats> d'une description d'item", () => {
    const serylda = "<mainText><stats><attention>45</attention> Attack Damage<br><attention>35%</attention> Armor Penetration<br><attention>15</attention> Ability Haste</stats><br><br>…</mainText>";
    expect(parseStatBlock(serylda)).toEqual({ stats: { ad: 45, pen: 35, ah: 15 }, unknown: [] });
  });

  it("distingue une vitesse en % d'une vitesse fixe", () => {
    expect(parseStatBlock("<stats><attention>55</attention> Attack Damage<br><attention>4%</attention> Move Speed</stats>").stats)
      .toEqual({ ad: 55, msPct: 4 });
    expect(parseStatBlock("<stats><attention>45</attention> Move Speed</stats>").stats).toEqual({ ms: 45 });
  });

  it("signale les stats inconnues au lieu de les ignorer", () => {
    expect(parseStatBlock("<stats><attention>20%</attention> Critical Strike Chance</stats>").unknown).toEqual(["Critical Strike Chance"]);
  });

  it("numéro de patch : Data Dragon 16.x → patch 26.x", () => {
    expect(patchFromVersion("16.23.1")).toBe("26.23");
    expect(patchFromVersion("15.1.1")).toBe("25.1");
    expect(patchFromVersion("14.24.1")).toBe("14.24");
  });

  it("version cohérente dans les fichiers générés", () => {
    expect(patchFromVersion(DDRAGON_VERSION)).toBe(PATCH);
  });
});

describe("cohérence des données", () => {
  it("chaque champion Data Dragon a une entrée dans overrides.json, et inversement", () => {
    const ids = generatedChampions.map((c) => c.id);
    expect(ids.filter((id) => !OVERRIDES[id])).toEqual([]);
    expect(Object.keys(OVERRIDES).filter((id) => !ids.includes(id))).toEqual([]);
    expect(CHAMPIONS.filter((c) => c.unverified)).toEqual([]);
  });

  it("le nom de chaque override correspond au nom anglais Data Dragon", () => {
    for (const c of generatedChampions) expect(OVERRIDES[c.id].name, c.id).toBe(c.nameEn);
  });

  it("portée : mêlée si ≤ 325, sauf les 3 champions forcés dans overrides.json", () => {
    const forced = Object.entries(OVERRIDES).filter(([, o]) => o.range).map(([id]) => id);
    expect(forced.sort()).toEqual(["Gnar", "Jayce", "Kayle"]);
    for (const g of generatedChampions) {
      if (forced.includes(g.id)) continue;
      expect(champ(g.id).range, g.id).toBe(g.attackRange <= 325 ? "melee" : "ranged");
    }
  });

  it("recherche par nom français, anglais, sans accents", () => {
    expect(champ("MonkeyKing").name).toBe("Wukong");
    expect(champ("Master Yi").name).toBe("Maître Yi");
    expect(matchesQuery(champ("MasterYi"), "maitre")).toBe(true);
    expect(matchesQuery(champ("MasterYi"), "master")).toBe(true);
    expect(matchesQuery(champ("KSante"), "ksante")).toBe(true);
    expect(matchesQuery(champ("Seraphine"), "séra")).toBe(true);
  });

  it("bottes de niveau 3 nommées", () => {
    expect(BOOTS_T3).toEqual({ lucidity: "Crimson Lucidity", steelcaps: "Armored Advance", mercury: "Chainlaced Crushers", swiftness: "Swiftmarch" });
  });
});

describe("écarts avec la première version (patch 26.22, valeurs non vérifiées)", () => {
  const STATS = ["ad", "leth", "ah", "hp", "armor", "mr", "pen", "shred", "cost"] as const;
  const diff = (a: Item, b: Item) => STATS.filter((f) => (a[f] ?? 0) !== (b[f] ?? 0)).map((f) => `${f}: ${a[f] ?? 0} → ${b[f] ?? 0}`);

  it("stats d'items : seul Mercury's Treads change (25 → 20 RM ; 25 est la RM de Chainlaced Crushers)", () => {
    const changes = Object.fromEntries(
      (Object.keys(ITEMS) as ItemKey[]).map((k) => [k, diff(LEGACY_ITEMS[k], ITEMS[k])]).filter(([, d]) => d.length),
    );
    expect(changes).toEqual({ mercury: ["mr: 25 → 20"] });
  });

  it("stats de base de Kayn identiques (croissance d'AD corrigée par le wiki)", () => {
    expect(KAYN_BASE).toEqual({ ad: 68, adGrowth: 3.3, hp: 655, hpGrowth: 103, armor: 38, armorGrowth: 4.5, mr: 32, mrGrowth: 2.05, attackSpeed: 0.669, attackSpeedGrowth: 0.027 });
    expect(Object.keys(KAYN_CORRECTIONS)).toEqual(["attackdamageperlevel"]);
  });
});
