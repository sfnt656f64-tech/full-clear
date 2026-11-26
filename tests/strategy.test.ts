import { describe, expect, it } from "vitest";
import { remindersFrom, strategy, timing } from "../desktop/coach/strategy";
import { pairIndex } from "../desktop/reco/draft-pick";
import { champ } from "../src/data/champions";
import type { MetaPartRow } from "../desktop/meta/meta-stats";

const K = (id: string) => champ(id).key!;
/** Méta : un champion gagne plus en parties courtes (early) ou longues (late), sur 100 parties de chaque. */
function rows(id: string, role: string, shortWr: number, longWr: number): MetaPartRow[] {
  const mk = (n: number, wr: number, dur: number) => Array.from({ length: n }, (_, i) => ({ matchId: `${id}${dur}${i}`, championId: K(id), role, win: i < wr * n, team: 100, durationS: dur, items: [] }) as unknown as MetaPartRow);
  return [...mk(100, shortWr, 20 * 60), ...mk(100, longWr, 40 * 60)];
}

describe("plan de partie (draft)", () => {
  const meta = [...rows("Leona", "UTILITY", 0.62, 0.42), ...rows("Rengar", "JUNGLE", 0.42, 0.6), ...rows("Kayn", "JUNGLE", 0.5, 0.5)];
  const base = {
    me: { championId: K("Kayn"), lane: "JUNGLE" as const },
    allies: { JUNGLE: K("Kayn") }, enemies: { JUNGLE: K("Rengar"), UTILITY: K("Leona") },
    side: "blue" as const, metaParts: meta, index: pairIndex([]), plan: null, reminders: [], complete: true,
  };

  it("écart parties courtes − longues avec sa marge ; pas de mesure sous 20 parties de chaque", () => {
    const t = timing(meta, K("Leona"), "UTILITY", "UTILITY")!;
    expect(t.diff).toBeCloseTo(20, 5);
    expect(t.margin).toBeGreaterThan(0);
    expect(timing(rows("Leona", "UTILITY", 0.6, 0.4).slice(0, 10), K("Leona"), "UTILITY", "UTILITY")).toBeNull();
  });

  it("champions nettement marqués : des « si… alors… » concrets, sans genre supposé", () => {
    const s = strategy(base);
    expect(s.winCondition.ifThen.join(" ")).toMatch(/Leona \(Support, en face\) a son pic en début de partie/);
    expect(s.winCondition.ifThen.join(" ")).toMatch(/Rengar \(Jungle, en face\) monte en puissance en fin de partie : prends-lui des camps tôt/);
    expect(s.enemyJungler).toMatch(/^Rengar : plutôt fort en fin de partie/);
  });

  it("condition de victoire sans trou : début, fin, ou pas d'écart net", () => {
    for (const [a, b] of [[0.7, 0.3], [0.3, 0.7], [0.5, 0.5]] as const) {
      const s = strategy({ ...base, metaParts: [...rows("Kayn", "JUNGLE", a, b), ...rows("Rengar", "JUNGLE", 0.5, 0.5)], enemies: { JUNGLE: K("Rengar") } });
      expect(s.winCondition.summary).toMatch(/plus forte en début de partie|Leur équipe est plus forte|Pas d'écart net/);
    }
    expect(strategy({ ...base, metaParts: [] }).winCondition.summary).toMatch(/Pas assez de parties/);
  });

  it("rappels personnels : valeur récente et cible", () => {
    const r = remindersFrom([{ key: "cs10", label: "CS à 10 min", unit: "", better: "+", target: 72, value: 68.6, n: 20 }]);
    expect(r[0].text).toMatch(/68,6 sur tes 20 dernières parties, cible ≥ 72/);
  });
});
