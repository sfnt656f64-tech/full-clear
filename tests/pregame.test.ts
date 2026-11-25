import { describe, expect, it } from "vitest";
import { pregameTips, tipsAt, MAX_TIPS } from "../desktop/coach/pregame";
import type { LaneRow } from "../desktop/reco/lanes";

type Row = LaneRow<{ id: string }>;
const row = (lane: Row["lane"], ally: string | null, enemy: string | null, me = false): Row =>
  ({ lane, ally: ally ? { id: ally } : null, me, enemy: enemy ? { id: enemy } : null, probable: !!enemy });

const LANES: Row[] = [
  row("TOP", "Ornn", "Aatrox"),
  row("JUNGLE", "Kayn", "LeeSin", true),
  row("MIDDLE", "Syndra", "Ahri"),
  row("BOTTOM", "Jinx", "Draven"),
  row("UTILITY", "Leona", "Lulu"),
];

describe("conseils d'avant-partie", () => {
  it("Kayn bleu : cibles fragiles ; jungle : lanes alliées avec du contrôle", () => {
    const tips = pregameTips({ lanes: LANES, form: "blue" });
    expect(tips[0]).toMatch(/^Kayn bleu : cibles fragiles en face, .*Ahri \(Mid\)/);
    expect(tips[0]).not.toContain("Aatrox");
    expect(tips.join(" ")).toMatch(/Lanes alliées avec du contrôle pour tes ganks : .*Leona \(Support\)/);
    expect(tips.length).toBeLessThanOrEqual(MAX_TIPS);
  });

  it("Kayn rouge : le front adverse", () => {
    expect(pregameTips({ lanes: LANES, form: "red" })[0]).toMatch(/^Kayn rouge : .*Aatrox \(Top\)/);
  });

  it("jamais d'ordre ni de nom de joueur : seulement des champions et des rôles", () => {
    for (const t of pregameTips({ lanes: LANES, form: "blue" })) {
      expect(t).not.toMatch(/\b(va|vas|gank maintenant|tu dois)\b/i);
    }
  });

  it("rien sans ton champion", () => {
    expect(pregameTips({ lanes: LANES.map((r) => ({ ...r, me: false })) })).toEqual([]);
  });

  it("défilement deux par deux, puis plus rien", () => {
    const t = ["a", "b", "c"];
    expect(tipsAt(t, 0)).toEqual(["a", "b"]);
    expect(tipsAt(t, 12_500)).toEqual(["c"]);
    expect(tipsAt(t, 25_000)).toEqual([]);
  });
});
