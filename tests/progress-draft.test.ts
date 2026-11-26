import { describe, expect, it } from "vitest";
import { progressPriority } from "../desktop/reco/progress-draft";
import type { Stage } from "../desktop/reco/progression";

const t = (championId: number, stage: Stage) => ({ championId, stage, text: "…" });
const comfort = (championId: number, flag: "notForMe" | "progress" | null = null) => ({ championId, games: 80, wins: 44, stats: 55, margin: 5, reason: "", flag });
const P = { tracking: [t(1, "learning"), t(2, "readyToTest"), t(3, "backToNormal"), t(4, "toConfirm"), t(5, "confirmed"), t(6, "keepPracticing")], comfort: [comfort(9)], notForMe: [7] };

describe("draft « Progresser » selon la file", () => {
  it("normale (400) : tous les champions de progression d'abord, jamais « Pas pour moi »", () => {
    const r = progressPriority(400, P);
    expect(r.priority!.map((x) => x.championId)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.blocked).toEqual([7]);
    expect(r.rule).toMatch(/^Normale en draft \(file lue dans le client\) : tes champions de progression d'abord \(les 3 que cette draft favorise le plus, sur 6\)/);
  });

  it("classée (420, 440) : seulement « Prêt à tester », « À confirmer », « Confirmé » ; les autres jamais proposés", () => {
    for (const q of [420, 440]) {
      const r = progressPriority(q, P);
      expect(r.priority!.map((x) => x.championId)).toEqual([2, 4, 5]);
      expect(new Set(r.blocked)).toEqual(new Set([7, 1, 3, 6]));
    }
  });

  it("classée sans champion prêt : ton champion de confort ; file inconnue : règles de la classée", () => {
    const r = progressPriority(420, { ...P, tracking: [t(1, "learning"), t(3, "backToNormal")] });
    expect(r.priority).toEqual([expect.objectContaining({ championId: 9, tag: "Confort" })]);
    expect(progressPriority(0, P).rule).toMatch(/^File inconnue : règles de la classée/);
    expect(progressPriority(0, P).priority!.map((x) => x.championId)).toEqual([2, 4, 5]);
  });

  it("confort marqué « Pas pour moi » jamais proposé", () => {
    const r = progressPriority(420, { tracking: [], comfort: [comfort(9, "notForMe"), comfort(8)], notForMe: [9] });
    expect(r.priority!.map((x) => x.championId)).toEqual([8]);
  });
});
