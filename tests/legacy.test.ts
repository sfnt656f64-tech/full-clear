// Non-régression : le portage TypeScript doit reproduire à l'identique les résultats
// de la page d'origine (kayn-simulator.html), enregistrés par
// scripts/legacy/extract-fixtures.mjs dans tests/fixtures/legacy.json.
//
// Le modèle et le moteur reçoivent les données et les règles d'origine (items, champions et
// valeurs d'effets figés dans tests/fixtures/legacy-data.ts), pour tester la LOGIQUE indépendamment des mises à jour de Data Dragon.
// Quand le modèle est corrigé volontairement (étape 4), ces tests échoueront :
// c'est voulu, chaque écart doit être relu puis la référence mise à jour.
import { describe, expect, it } from "vitest";
import legacy from "./fixtures/legacy.json";
import { LEGACY_ITEMS as items, LEGACY_RULES as rules, legacyChamp } from "./fixtures/legacy-data";
import { GUIDES } from "../src/data/guides";
import { TARGETS, STAGE_LEVEL } from "../src/data/targets";
import type { Form, ItemKey, Stage, TargetKey } from "../src/data/types";
import { blueCombo } from "../src/model/blue";
import { redFight } from "../src/model/red";
import { ranks, stats } from "../src/model/stats";
import { benchBlue, benchRed, goldEfficiency } from "../src/model/benchmark";
import { buildAtStage, draftReport } from "../src/engine/draft";
import { initials } from "../src/ui/icons";

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

describe("modèle — identique à la page d'origine", () => {
  it("rangs des sorts niveaux 1 à 18", () => {
    expect(Array.from({ length: 18 }, (_, i) => ranks(i + 1))).toEqual(legacy.ranks);
  });

  it(`stats de Kayn (${legacy.stats.length} cas)`, () => {
    for (const c of legacy.stats) {
      const s = stats(c.build as ItemKey[], c.lvl, c.hub == null ? { items, rules } : { hubrisStacks: c.hub, items, rules });
      expect({ baseAD: r6(s.baseAD), bonusAD: r6(s.bonusAD), totalAD: r6(s.totalAD), maxHP: r6(s.maxHP), armorT: r6(s.armorT), mrT: r6(s.mrT), cdr: r6(s.cdr), cost: s.cost }, JSON.stringify(c)).toEqual(c.v);
    }
  });

  it(`simulateur : chaque guide × moment × cible (${legacy.sims.length} cas)`, () => {
    for (const c of legacy.sims) {
      const stage = c.stage as Stage, form = c.form as Form;
      const b = buildAtStage(GUIDES[form][c.i].b, stage);
      expect(b).toEqual(c.build);
      const tgt = TARGETS[stage][c.tgt as TargetKey], lvl = STAGE_LEVEL[stage];
      if (form === "blue") {
        const r = blueCombo(b, lvl, tgt, { hubrisStacks: c.hub, items, rules });
        expect({ total: r.total, pct: r.pct, kill: r.kill, log: r.log, totalAD: r6(r.s.totalAD), leth: r.s.leth, cost: r.s.cost }).toEqual(c.r);
      } else {
        const r = redFight(b, lvl, tgt, { items, rules });
        expect({ total: r.total, dps: r.dps, pct: r.pct, heal: r.heal, ehpPhys: r.ehpPhys, ehpMag: r.ehpMag, parts: r.parts, nQ: r.nQ, nW: r.nW, nAA: r.nAA }).toEqual(c.r);
      }
    }
  });

  it("benchmark du 4ᵉ item (bleu et rouge)", () => {
    expect(benchBlue({ items, rules })).toEqual(legacy.benchBlue);
    expect(benchRed({ items, rules })).toEqual(legacy.benchRed);
  });

  it("valeur brute des items", () => {
    expect(goldEfficiency(undefined, items)).toEqual(legacy.gold);
  });
});

describe("moteur de draft — identique à la page d'origine", () => {
  it(`${legacy.drafts.length} drafts (4 exemples + 80 aléatoires) × 2 moments × 3 choix de forme`, () => {
    for (const d of legacy.drafts) {
      const rep = draftReport(d.en.map(legacyChamp), d.al.map(legacyChamp), d.stage as Stage, d.fsel as Form | "auto", { items, rules });
      const ctx = `${d.name} ${d.stage} ${d.fsel}`;
      if (d.out === null) { expect(rep, ctx).toBeNull(); continue; }
      expect(rep, ctx).not.toBeNull();
      const { E: _e, A: _a, ...x } = rep!.analysis;
      expect({ ...x, sc: r6(x.sc), shields: r6(x.shields), adShare: r6(x.adShare), apShare: r6(x.apShare) }, ctx).toEqual(d.out.analysis);
      expect(rep!.form, ctx).toBe(d.out.form);
      expect(rep!.boots, ctx).toEqual(d.out.boots);
      expect(rep!.build, ctx).toEqual(d.out.build);
      expect(rep!.notes, ctx).toEqual(d.out.notes);
      expect(rep!.simBuild, ctx).toEqual(d.out.simBuild);
      const vs = rep!.vs.map((v) => v.form === "blue"
        ? { n: v.champion.name, shield: v.target.shield, pct: v.pct, kill: v.kill }
        : { n: v.champion.name, shield: v.target.shield, ttk: r6(v.ttk) });
      expect(vs, ctx).toEqual(d.out.vs);
      expect(rep!.resist ?? null, ctx).toEqual(d.out.res);
    }
  });
});

describe("interface — identique à la page d'origine", () => {
  it("initiales des champions (icônes de secours)", () => {
    for (const [name, ini] of legacy.initials) expect(initials(name), name).toBe(ini);
  });
});
