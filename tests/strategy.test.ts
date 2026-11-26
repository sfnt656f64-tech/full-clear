import { describe, expect, it } from "vitest";
import { earlyDuel, remindersFrom, strategy, timing } from "../desktop/coach/strategy";
import { pairIndex } from "../desktop/reco/draft-pick";
import { champ } from "../src/data/champions";
import type { MetaPartRow } from "../desktop/meta/meta-stats";

const K = (id: string) => champ(id).key!;
let seq = 0;
/**
 * Méta : un champion dans un rôle, 100 parties courtes et 100 longues (win rates donnés), face à un vis-à-vis du même
 * rôle ; son or à 15 min dépasse celui du vis-à-vis de `gold` po (± 200 de bruit alterné).
 */
function rows(id: string, role: string, shortWr: number, longWr: number, gold: number, opp = "Garen"): MetaPartRow[] {
  const out: MetaPartRow[] = [];
  const mk = (n: number, wr: number, dur: number) => {
    for (let i = 0; i < n; i++) {
      const m = `M${seq++}`, noise = i % 2 ? 200 : -200;
      out.push({ matchId: m, championId: K(id), role, team: 100, win: i < wr * n, durationS: dur, gold15: 5000 + gold + noise, items: [], perks: null });
      out.push({ matchId: m, championId: K(opp), role, team: 200, win: !(i < wr * n), durationS: dur, gold15: 5000, items: [], perks: null });
    }
  };
  mk(100, shortWr, 20 * 60); mk(100, longWr, 40 * 60);
  return out;
}

describe("plan de partie : début ou fin de partie", () => {
  it("classé seulement si l'or à 15 min ET le win rate courtes − longues sont nets et dans le même sens", () => {
    const early = timing(rows("LeBlanc", "MIDDLE", 0.62, 0.42, 400), K("LeBlanc"), "MIDDLE", "MIDDLE")!;
    expect(early.verdict).toBe("early");
    expect(early.gold).toBeCloseTo(400, 5);
    expect(early.goldMargin).toBeGreaterThan(0);
    // Win rate « fin de partie » mais aucune avance d'or nette : mesure confondue, pas de classement.
    expect(timing(rows("Veigar", "MIDDLE", 0.4, 0.6, 0), K("Veigar"), "MIDDLE", "MIDDLE")!.verdict).toBeNull();
    // Les deux mesures se contredisent : pas de classement.
    expect(timing(rows("Veigar", "MIDDLE", 0.4, 0.6, 400), K("Veigar"), "MIDDLE", "MIDDLE")!.verdict).toBeNull();
    expect(timing(rows("Veigar", "MIDDLE", 0.4, 0.6, -400), K("Veigar"), "MIDDLE", "MIDDLE")!.verdict).toBe("late");
  });

  it("garde-fous : support jamais classé, champion connu pour son début de partie jamais « fin de partie »", () => {
    expect(timing(rows("Leona", "UTILITY", 0.62, 0.42, 400), K("Leona"), "UTILITY", "UTILITY")!.verdict).toBeNull();
    expect(timing(rows("Rengar", "JUNGLE", 0.4, 0.6, -400), K("Rengar"), "JUNGLE", "JUNGLE")!.verdict).toBeNull();
  });

  it("pas de mesure sous 20 parties", () => {
    expect(timing(rows("LeBlanc", "MIDDLE", 0.6, 0.4, 400).slice(0, 30), K("LeBlanc"), "MIDDLE", "MIDDLE")).toBeNull();
  });
});

describe("plan de partie (draft)", () => {
  const base = {
    me: { championId: K("Shyvana"), lane: "JUNGLE" as const },
    allies: { JUNGLE: K("Shyvana") }, enemies: { JUNGLE: K("Karthus"), MIDDLE: K("LeBlanc") },
    side: "blue" as const, index: pairIndex([]), plan: null, reminders: [], complete: true,
  };
  const meta = [...rows("LeBlanc", "MIDDLE", 0.62, 0.42, 400), ...rows("Karthus", "JUNGLE", 0.4, 0.6, -400), ...rows("Shyvana", "JUNGLE", 0.5, 0.5, 0)];

  it("champions nettement classés : des « si… alors… » concrets", () => {
    const s = strategy({ ...base, metaParts: meta });
    expect(s.winCondition.ifThen.join(" ")).toMatch(/LeBlanc \(Mid, en face\) a son pic en début de partie/);
    expect(s.enemyJungler).toMatch(/^Karthus : plutôt fort en fin de partie \(écart d'or à 15 min/);
  });

  it("jamais d'invade sans duel de début de partie mesuré et favorable", () => {
    const s = strategy({ ...base, metaParts: meta });
    const txt = s.winCondition.ifThen.join(" ") + s.enemyJungler;
    expect(txt).not.toMatch(/prends-lui des camps/);
    expect(txt).toMatch(/pas d'invade : ton duel en début de partie contre lui n'est pas mesurable/);
    // Duel mesuré et favorable (Shyvana contre Karthus, +500 po à 15 min) : l'invade peut être conseillée.
    const duel = rows("Shyvana", "JUNGLE", 0.5, 0.5, 500, "Karthus");
    expect(earlyDuel([...meta, ...duel], K("Shyvana"), K("Karthus"), "JUNGLE")!.net).toBe(true);
    const s2 = strategy({ ...base, metaParts: [...meta, ...duel] });
    expect(s2.winCondition.ifThen.join(" ")).toMatch(/prends-lui des camps tôt.*ton duel en début de partie contre lui : \+500 po/);
  });

  it("condition de victoire sans trou : début, fin, ou pas d'écart net", () => {
    for (const [a, b, g] of [[0.7, 0.3, 600], [0.3, 0.7, -600], [0.5, 0.5, 0]] as const) {
      const s = strategy({ ...base, enemies: { JUNGLE: K("Karthus") }, metaParts: [...rows("Shyvana", "JUNGLE", a, b, g), ...rows("Karthus", "JUNGLE", 0.5, 0.5, 0)] });
      expect(s.winCondition.summary).toMatch(/plus forte en début de partie|Leur équipe est plus forte|Pas d'écart net/);
    }
    expect(strategy({ ...base, metaParts: [] }).winCondition.summary).toMatch(/Pas assez de parties/);
  });

  it("rappels personnels : valeur récente et cible", () => {
    const r = remindersFrom([{ key: "cs10", label: "CS à 10 min", unit: "", better: "+", target: 72, value: 68.6, n: 20 }]);
    expect(r[0].text).toMatch(/68,6 sur tes 20 dernières parties, cible ≥ 72/);
  });
});
