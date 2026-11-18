import { ITEMS } from "../data/items";
import { PROFILE_STATS, STAGE_LEVEL } from "../data/targets";
import type { Champion, Form, ItemKey, Stage, Target } from "../data/types";
import { blueCombo } from "../model/blue";
import { redFight } from "../model/red";
import type { StatOptions } from "../model/stats";
import { analyse, resolveForm, type Analysis } from "./analyse";
import { chooseBoots, chooseBuild, chooseStarter, type BootChoice, type StarterChoice } from "./build";

/** Nombre minimal d'adversaires pour lancer l'analyse. */
export const MIN_ENEMIES = 3;

/** Profil de cible pour un champion adverse, bouclier des enchanteurs adverses inclus. */
export function targetFor(c: Champion, stage: Stage, x: Analysis): Target {
  const [hp, armor, mr] = PROFILE_STATS[stage][c.profile];
  const shieldSrc = x.E.filter((e) => e.shields && e.profile === "enchanter").length;
  const squishy = c.profile === "marksman" || c.profile === "mage" || c.profile === "assassin";
  const shield = squishy && shieldSrc ? (stage === "mid" ? 350 : 550) * Math.min(2, shieldSrc) : 0;
  return { n: c.name, hp, armor, mr, shield };
}

/** Build réduit au moment de la partie : 3 items + bottes en mi-partie, complet en fin de partie. */
export function buildAtStage(b: readonly ItemKey[], stage: Stage): ItemKey[] {
  if (stage === "late") return [...b];
  const boots = b.find((k) => ITEMS[k].boots);
  const items = b.filter((k) => !ITEMS[k].boots).slice(0, 3);
  return boots ? [...items, boots] : items;
}

export type VersusResult =
  | { champion: Champion; target: Target; form: "blue"; pct: number; kill: boolean }
  | { champion: Champion; target: Target; form: "red"; /** temps pour tuer, en s */ ttk: number };

export interface DraftReport {
  analysis: Analysis;
  form: Form;
  formChoice: Form | "auto";
  stage: Stage;
  level: number;
  /** Familier de jungle (item de départ), avant le build. */
  starter: StarterChoice[];
  boots: BootChoice[];
  build: ItemKey[];
  notes: string[];
  /** Build simulé au moment choisi. */
  simBuild: ItemKey[];
  vs: VersusResult[];
  /** Résistance de Kayn (rouge seulement). */
  resist?: { ehpPhys: number; ehpMag: number };
}

/** Analyse complète d'une draft. Renvoie null s'il y a moins de 3 adversaires. */
export function draftReport(
  enemies: (Champion | null)[],
  allies: (Champion | null)[],
  stage: Stage,
  formChoice: Form | "auto",
  /** Items, règles et runes passés au modèle. */
  opt: Omit<StatOptions, "hubrisStacks"> = {},
): DraftReport | null {
  const x = analyse(enemies, allies);
  if (x.E.length < MIN_ENEMIES) return null;
  const level = STAGE_LEVEL[stage];
  const form = resolveForm(x, formChoice);
  const boots = chooseBoots(x, form);
  const starter = chooseStarter(x);
  const { b, notes } = chooseBuild(x, form);
  // Comme la page d'origine : en mi-partie, 3 items + bottes.
  const simBuild = stage === "mid" ? buildAtStage(b, "mid") : b;
  const vs: VersusResult[] = x.E.map((c) => {
    const target = targetFor(c, stage, x);
    if (form === "blue") {
      const r = blueCombo(simBuild, level, target, { ...opt, hubrisStacks: 4 });
      return { champion: c, target, form, pct: r.pct, kill: r.kill };
    }
    const r = redFight(simBuild, level, target, opt);
    return { champion: c, target, form, ttk: (target.hp + (target.shield ?? 0)) / r.dps };
  });
  let resist: DraftReport["resist"];
  if (form === "red") {
    const r0 = redFight(simBuild, level, targetFor(x.E[0], stage, x), opt);
    resist = { ehpPhys: r0.ehpPhys, ehpMag: r0.ehpMag };
  }
  return { analysis: x, form, formChoice, stage, level, starter, boots, build: b, notes, simBuild, vs, resist };
}
