// Règles d'écriture de la vue principale : 12 mots au plus, pas de chiffre hors minute de jeu (et la valeur → cible
// des rappels, affichée à part), pas de pourcentage, de marge ni de parenthèse, noms dans la langue du client.
import { describe, expect, it } from "vitest";
import { lineIssues } from "../desktop/coach/plain-lint";
import { mainLines, plainPlan } from "../desktop/coach/plain";
import { remindersFrom, strategy } from "../desktop/coach/strategy";
import { buildPlanView, SHOP } from "../desktop/next-item";
import { statBuild } from "../desktop/coach/stat-build";
import { pairIndex } from "../desktop/reco/draft-pick";
import { habitLine, plainTop, type Moment, type VsLine } from "../desktop/analysis/postgame";
import type { AnalysisGame } from "../desktop/analysis/analysis";
import { progressPriority } from "../desktop/reco/progress-draft";
import { champ } from "../src/data/champions";
import type { MetaPartRow } from "../desktop/meta/meta-stats";
import type { GamePlan } from "../desktop/coach/game-plan";

const K = (id: string) => champ(id).key!;
const ok = (lines: string[]) => expect(lines.flatMap((l) => lineIssues(l).map((i) => `${l} → ${i}`))).toEqual([]);

let seq = 0;
function rows(id: string, role: string, shortWr: number, longWr: number, gold: number, dmg: number, opp = "Garen"): MetaPartRow[] {
  const out: MetaPartRow[] = [];
  const mk = (n: number, wr: number, dur: number) => {
    for (let i = 0; i < n; i++) {
      const m = `P${seq++}`, noise = i % 2 ? 200 : -200;
      const damage = Math.round(20000 * Math.exp((dur >= 32 * 60 ? dmg : 0) + (i % 2 ? 0.1 : -0.1)));
      out.push({ matchId: m, championId: K(id), role, team: 100, win: i < wr * n, durationS: dur, gold15: 5000 + gold + noise, damage, items: [], perks: null });
      out.push({ matchId: m, championId: K(opp), role, team: 200, win: !(i < wr * n), durationS: dur, gold15: 5000, damage: 20000, items: [], perks: null });
    }
  };
  mk(100, shortWr, 20 * 60); mk(100, longWr, 40 * 60);
  return out;
}
const plan = (pro: boolean): GamePlan => ({
  lanes: [{ lane: "BOTTOM", chance: 60, reasons: [], factors: pro ? [{ text: "Thresh a beaucoup de contrôle", sign: 1 }] : [] }, { lane: "TOP", chance: 40, reasons: [], factors: [] }, { lane: "MIDDLE", chance: 40, reasons: [], factors: [] }],
  firstGank: "BOTTOM", start: { side: "top", buff: "Red Buff", topShare: 39 }, objectives: [], games: 100, provisional: false,
} as GamePlan);
const reminders = remindersFrom([
  { key: "uncompensatedEarly", label: "Objectifs cédés", unit: " %", better: "-", target: 35, value: 57, n: 16 },
  { key: "deathsBeforeObj", label: "Morts avant un objectif", unit: "", better: "-", target: 0.9, value: 1.5, n: 20 },
  { key: "cs10", label: "CS à 10 min", unit: "", better: "+", target: 72, value: 68.6, n: 20 },
]);

describe("vue principale du plan de partie : règles d'écriture", () => {
  const meta = [...rows("LeBlanc", "MIDDLE", 0.62, 0.42, 400, -0.3), ...rows("Karthus", "JUNGLE", 0.4, 0.6, -400, 0.3), ...rows("Smolder", "BOTTOM", 0.4, 0.6, -400, 0.3), ...rows("Shyvana", "JUNGLE", 0.5, 0.5, 0, 0)];
  const cases = [
    { me: "Shyvana", enemies: { JUNGLE: K("Karthus"), MIDDLE: K("LeBlanc"), BOTTOM: K("Smolder"), TOP: K("Darius"), UTILITY: K("Leona") }, pro: true },
    { me: "Kayn", enemies: { JUNGLE: K("Zac"), MIDDLE: K("Sylas"), TOP: K("Garen") }, pro: false },
  ];
  for (const c of cases) {
    it(`${c.me} : chaque ligne respecte les règles`, () => {
      const s = strategy({ me: { championId: K(c.me), lane: "JUNGLE" }, allies: { JUNGLE: K(c.me), UTILITY: K("Thresh"), TOP: K("Illaoi") }, enemies: c.enemies, side: "red", metaParts: meta, index: pairIndex([]), plan: plan(c.pro), reminders, complete: true });
      const b = buildPlanView({ me: c.me, allies: ["Illaoi", "Akali", "Caitlyn", "Thresh"], enemies: ["Darius", "Rengar", "Sylas", "Kaisa", "Leona"] }, "auto", SHOP, null);
      const p = plainPlan(s, b);
      expect(p.retain.length).toBeLessThanOrEqual(3);
      expect(p.ifThen.length).toBeLessThanOrEqual(3);
      expect(p.reminders.length).toBe(3);
      ok(mainLines(p).map((l) => l.text));
      ok(p.build.map((i) => i.name));
    });
  }

  it("exemple : invade jamais conseillée sans duel mesuré, et dit qu'on ne sait pas", () => {
    const s = strategy({ me: { championId: K("Shyvana"), lane: "JUNGLE" }, allies: { JUNGLE: K("Shyvana") }, enemies: { JUNGLE: K("Zac") }, side: "red", metaParts: [], index: pairIndex([]), plan: plan(true), reminders, complete: true });
    expect(s.plain.retain).toEqual(["Commence en haut, gank bot après ton premier tour de camps.", "Premier dragon en priorité : tu seras déjà côté bot.", "Pas d'invade : duel inconnu contre Zac, joue tes camps."]);
  });

  it("rappels : consigne courte, valeur → cible à part (seule exception chiffrée)", () => {
    expect(reminders.map((r) => [r.short, r.value])).toEqual([
      ["Ne laisse pas d'objectif gratuit avant 15 min.", "57 % → cible 35 %"],
      ["Ne meurs pas juste avant un objectif adverse.", "1,5 → cible 0,9"],
      ["Finis tes camps entre deux actions.", "CS à 10 min : 68,6 → cible 72"],
    ]);
  });

  it("build : règles « si… alors… » avec les noms du client", () => {
    const parts = Array.from({ length: 40 }, (_, i) => ({ matchId: `B${i}`, championId: K("Vi"), role: "JUNGLE", win: true,
      items: i < 30 ? [6610, 3047, 3071, 3053, 6333, 3156] : [6610, 3111, 3071, 3026, 3065, 3075], perks: null }) as MetaPartRow);
    const sb = statBuild({ parts, builds: [], role: "JUNGLE", enemies: [], shop: SHOP })!;
    const p = plainPlan(null, buildPlanView({ me: "Vi", allies: [], enemies: [] }, "auto", SHOP, sb));
    expect(p.ifThen.length).toBeGreaterThan(0);
    ok(p.ifThen);
    expect(p.ifThen.join(" ")).toMatch(/Ange gardien|Sandales de Mercure|Coques en acier|Force de la nature/);
  });
});

describe("règles d'écriture : la vérification elle-même", () => {
  it("refuse chiffres techniques, parenthèses, noms anglais et lignes trop longues ; accepte une minute de jeu", () => {
    expect(lineIssues("Pas d'invade : duel inconnu contre Zac, joue tes camps.")).toEqual([]);
    expect(lineIssues("À 12 min, tu meurs juste avant leur dragon.")).toEqual([]);
    expect(lineIssues("Thresh gank réussi 85 % du temps")).not.toEqual([]);
    expect(lineIssues("Écart d'or +70 po")).not.toEqual([]);
    expect(lineIssues("Départ côté top (Red Buff)")).not.toEqual([]);
    expect(lineIssues("Leur carry AD est fed → Guardian Angel")).toContain("nom anglais : Guardian Angel");
    expect(lineIssues("un deux trois quatre cinq six sept huit neuf dix onze douze treize")[0]).toMatch(/plus de 12 mots/);
  });
});

describe("vue principale de l'après-partie et de la draft", () => {
  const vs = (key: string, better: boolean | null, mine = 1): VsLine => ({ key, label: key, unit: "", mine, opp: 2, better, outcomeLinked: false, diff: false });
  const moments: Moment[] = [
    { t: 9 * 60_000, time: "9:00", kind: "objective-theirs", label: "larve du Néant", uncompensated: true, text: "" },
    { t: 12 * 60_000, time: "12:00", kind: "death", killer: K("Rengar"), solo: true, objAfter: "dragon", text: "" },
  ];
  for (const key of ["unc15", "deaths15", "solo15", "cs10", "gd15", "kp15", "obj15", null]) {
    it(`haut de l'analyse (${key ?? "aucun point net"}) : 3 lignes aux règles`, () => {
      const t = plainTop([vs("gd10", true), vs("cs10", false), vs("kp15", false), vs("gd15", false)], moments, key, "Rengar");
      ok([...(t.well ? [t.well] : []), t.point, ...(t.moment ? [t.moment] : []), t.next]);
    });
  }
  it("le moment illustre le point de cette partie", () => {
    expect(plainTop([], moments, "deaths15", "Rengar").moment).toBe("À 12 min, tu meurs juste avant leur dragon.");
    expect(plainTop([], moments, "unc15", "Rengar").moment).toBe("À 9 min, ils prennent les larves sans contrepartie.");
  });
  it("draft « Progresser » : lignes courtes", () => {
    const r = progressPriority(420, { tracking: [{ championId: 1, stage: "readyToTest", text: "x" }], comfort: [], notForMe: [] });
    ok([r.ruleShort!, ...r.priority!.map((x) => x.short!)]);
    ok([progressPriority(400, { tracking: [{ championId: 1, stage: "learning", text: "x" }], comfort: [], notForMe: [] }).ruleShort!]);
  });
});

describe("ligne « Bien » : adversaire, sinon ton habitude (si net), sinon retirée", () => {
  // CS à 10 min : 20 parties précédentes autour de 60 (± 4).
  const prev = Array.from({ length: 20 }, (_, i) => ({ cs10: 60 + (i % 2 ? 4 : -4) }) as unknown as AnalysisGame);
  it("rien de mieux que l'adversaire, mais nettement mieux que d'habitude", () => {
    const habit = habitLine({ cs10: 80 } as unknown as AnalysisGame, prev);
    expect(habit).toBe("Mieux que d'habitude : plus de camps à 10 min.");
    expect(plainTop([], [], null, "Zac", habit).well).toBe(habit);
    ok([habit!]);
  });
  it("écart dans ta plage habituelle : pas de ligne « Bien »", () => {
    expect(habitLine({ cs10: 66 } as unknown as AnalysisGame, prev)).toBeNull();
    expect(plainTop([], [], null, "Zac", null).well).toBeNull();
  });
  it("moins de 20 parties précédentes : pas de comparaison", () => {
    expect(habitLine({ cs10: 90 } as unknown as AnalysisGame, prev.slice(0, 19))).toBeNull();
  });
  it("l'adversaire reste prioritaire", () => {
    expect(plainTop([{ key: "gd15", label: "", unit: "", mine: 300, opp: null, better: true, outcomeLinked: false, diff: true }], [], null, "Zac", "Mieux que d'habitude : x.").well).toBe("Plus d'or que Zac à 15 min.");
  });
});

describe("0.4.0 : nouvelles lignes de la vue principale", () => {
  it("thème de la semaine, recommandations du pool, parts sans chiffre", async () => {
    const { ERRORS, shareText } = await import("../desktop/analysis/lesson");
    ok(Object.values(ERRORS).map((e) => e.short));
    ok([shareText(11, 20), shareText(3, 20), shareText(16, 20)].map((t) => `Revient dans ${t}.`));
    const { candidateLine } = await import("../desktop/reco/pool-view");
    ok([candidateLine({ force: { adjusted: 55, margin: 2 }, fit: { value: 3, margin: 1 }, difficulty: 3 } as never), candidateLine({ force: { adjusted: 50, margin: 2 }, fit: { value: 0, margin: 1 }, difficulty: 6 } as never)]);
  });
});
