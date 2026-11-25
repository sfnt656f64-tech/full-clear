import { describe, expect, it } from "vitest";
import { guidePage, metaPage, validPage, MIN_PAGE_GAMES } from "../desktop/runes/rune-page";
import { importRunePage, type PerksApi } from "../desktop/runes/import";
import type { RunePage } from "../desktop/meta/meta-stats";

// Conqueror · Triumph · Legend: Alacrity · Last Stand / Resolve : Second Wind · Overgrowth
const CONQ: RunePage = { primary: 8000, sub: 8400, selections: [8010, 9111, 9104, 8299, 8444, 8451], shards: [5005, 5008, 5011] };
// Electrocute · Sudden Impact · Grisly Mementos · Treasure Hunter / Precision : Triumph · Last Stand
const ELEC: RunePage = { primary: 8100, sub: 8000, selections: [8112, 8143, 8140, 8135, 9111, 8299], shards: [5008, 5008, 5001] };

describe("page de runes", () => {
  it("valide la structure (une rune par ligne, secondaires sur 2 lignes différentes, fragments par ligne)", () => {
    expect(validPage(CONQ)).toBe(true);
    expect(validPage({ ...CONQ, selections: [8010, 9111, 9104, 8299, 8444, 8473] })).toBe(false); // 2 runes de la même ligne
    expect(validPage({ ...CONQ, selections: [8010, 9111, 9104, 8299, 8437, 8451] })).toBe(false); // rune principale en secondaire
    expect(validPage({ ...CONQ, shards: [5011, 5008, 5011] })).toBe(false);
    expect(validPage({ ...CONQ, sub: 8000 })).toBe(false);
  });

  it("méta : rune principale la plus jouée, puis le reste parmi ces parties", () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => ({ perks: CONQ, win: i < 17 })),
      ...Array.from({ length: 12 }, () => ({ perks: ELEC, win: true })),
      // Variante : une autre secondaire de Resolve (Bone Plating au lieu de Second Wind), minoritaire.
      ...Array.from({ length: 5 }, () => ({ perks: { ...CONQ, selections: [8010, 9111, 9104, 8299, 8473, 8451] }, win: false })),
      { perks: null, win: true },
    ];
    const p = metaPage(rows, "Viego")!;
    expect(p).toMatchObject({ primary: 8000, sub: 8400, selections: CONQ.selections, shards: CONQ.shards, source: "meta", games: 35, name: "FullClear Viego" });
    expect(p.winRate).toBeCloseTo((17 / 35) * 100);
    expect(validPage(p)).toBe(true);
  });

  it("méta : pas de page sous le minimum de parties", () => {
    expect(metaPage(Array.from({ length: MIN_PAGE_GAMES - 1 }, () => ({ perks: CONQ, win: true })), "X")).toBeNull();
  });

  it("Kayn : la page du guide, en identifiants, pour chaque forme", () => {
    const blue = guidePage("blue")!;
    expect(blue).toMatchObject({ primary: 8100, sub: 8300, selections: [8128, 8143, 8140, 8135, 8304, 8347], shards: [5008, 5008, 5001], source: "guide" });
    const red = guidePage("red")!;
    expect(red).toMatchObject({ primary: 8000, sub: 8200, selections: [8010, 9111, 9105, 8299, 8224, 8210] });
  });
});

function fakeApi(pages: { id: number; name: string; isDeletable: boolean }[], owned: number) {
  const calls: string[] = [];
  let body: unknown = null;
  const api: PerksApi = {
    pages: async () => pages,
    ownedPageCount: async () => owned,
    remove: async (id) => { calls.push(`delete ${id}`); },
    create: async (b) => { calls.push("create"); body = b; },
  };
  return { api, calls, body: () => body };
}

describe("import dans le client", () => {
  const page = { ...CONQ, name: "FullClear Viego", source: "meta" as const };

  it("remplace la page de l'ancienne version (KaynSim) et sélectionne la nouvelle", async () => {
    const f = fakeApi([{ id: 1, name: "Ma page", isDeletable: true }, { id: 2, name: "KaynSim Briar", isDeletable: true }, { id: 3, name: "Défaut", isDeletable: false }], 2);
    const r = await importRunePage(f.api, page);
    expect(r.ok).toBe(true);
    expect(f.calls).toEqual(["delete 2", "create"]);
    expect(f.body()).toEqual({ name: "FullClear Viego", primaryStyleId: 8000, subStyleId: 8400, selectedPerkIds: [...CONQ.selections, ...CONQ.shards], current: true });
  });

  it("ne supprime jamais une de tes pages : message si tout est plein", async () => {
    const f = fakeApi([{ id: 1, name: "A", isDeletable: true }, { id: 2, name: "B", isDeletable: true }], 2);
    const r = await importRunePage(f.api, page);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Toutes tes pages de runes sont utilisées");
    expect(f.calls).toEqual([]);
  });

  it("refuse une page incohérente", async () => {
    const f = fakeApi([], 5);
    expect((await importRunePage(f.api, { ...page, shards: [1, 2, 3] })).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });
});
