import { describe, expect, it } from "vitest";
import { MAX_PROGRESS, poolView } from "../desktop/reco/pool-view";
import type { ProgressEntry } from "../desktop/reco/progression";

const cand = (championId: number): ProgressEntry => ({ championId, score: { total: 55 } as never, force: { adjusted: 52, margin: 1, raw: 52, games: 100, equal: 52, mixMeasured: true } as never, fit: { value: 1, margin: 2 } as never, ceiling: {} as never, difficulty: 5, flag: null });
const comfort = (championId: number, games: number) => ({ championId, games, wins: games / 2, stats: 50, margin: 5, reason: "x", flag: null });
const keep = (championId: number) => ({ championId, group: "keep" as const, games: 40, winRate: 55, radar: null, text: "t", short: "Tu gagnes.", provisional: false, score: 55 });

describe("Mon pool : un seul système", () => {
  const base = { role: "JUNGLE", pool: [], tryList: [], tracking: [{ championId: 5, stage: "learning" as const, text: "5/20 parties" }] };
  it("« Pas pour moi » n'apparaît nulle part, même s'il est ton plus joué", () => {
    const flags = new Map([[1, "notForMe" as const], [5, "progress" as const]]);
    const v = poolView({ ...base, flags, comfort: [comfort(1, 300), comfort(2, 80)], keep: [keep(1), keep(3)], candidates: [cand(1), cand(5), cand(4), cand(6)] });
    const all = [...v.progress, ...v.comfort, ...v.toTry].map((e) => e.championId);
    expect(all).not.toContain(1);
    expect(v.progress.map((e) => e.championId)).toEqual([5]);
    expect(v.progress[0].line).toBe("En apprentissage : joue-le en normale.");
    expect(v.comfort.map((e) => e.championId)).toEqual([2, 3]);
    // Un champion n'est que dans un groupe.
    expect(v.toTry.map((e) => e.championId)).toEqual([4, 6]);
    expect(v.notForMe).toEqual([1]);
  });
  it(`plus de ${MAX_PROGRESS} champions de progression : signalé`, () => {
    const flags = new Map([[5, "progress" as const], [6, "progress" as const], [7, "progress" as const]]);
    expect(poolView({ ...base, flags, comfort: [], keep: [], candidates: [] }).tooMany).toBe(true);
  });
});
