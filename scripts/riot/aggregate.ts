// Agrégats de tes parties : win rate par forme et par item, build réel contre build recommandé.
// Le build recommandé vient du moteur du site (src/engine), appliqué à la même compo.
import { champByKey } from "../../src/data/champions";
import { ITEMS } from "../../src/data/items";
import type { Champion, Form, ItemKey } from "../../src/data/types";
import { analyse, resolveForm } from "../../src/engine/analyse";
import { chooseBuild } from "../../src/engine/build";
import type { GameRecord, PlayedForm } from "./matches.ts";

export interface IndexedItem { name: string; nameFr: string; image: string; kind: "legendary" | "boots"; baseBoots?: string }
export type ItemIndex = Record<string, IndexedItem>;

export interface WinRate { n: number; wins: number }
/** Win rate en % (null sans partie). */
export const wr = (w: WinRate): number | null => (w.n ? Math.round((1000 * w.wins) / w.n) / 10 : null);
/** En dessous de ce nombre de parties, une stat est affichée comme peu fiable. */
export const MIN_GAMES = 5;

const add = (w: WinRate, win: boolean) => { w.n++; if (win) w.wins++; };
const empty = (): WinRate => ({ n: 0, wins: 0 });

/** Bottes de niveau 3 ramenées à leur niveau 2 (Crimson Lucidity → Ionian Boots of Lucidity). */
export const bootsBase = (id: number, index: ItemIndex): number => Number(index[id]?.baseBoots ?? id);

/** Items terminés dans l'ordre d'achat, sans doublons : légendaires et bottes (niveau 2). */
export function completedItems(ids: number[], index: ItemIndex): { legendaries: number[]; boots: number | null } {
  const legendaries: number[] = [];
  let boots: number | null = null;
  for (const id of ids) {
    const it = index[id];
    if (!it) continue;
    if (it.kind === "legendary" && !legendaries.includes(id)) legendaries.push(id);
    else if (it.kind === "boots" && boots == null) boots = bootsBase(id, index);
  }
  return { legendaries, boots };
}

const ddId = (k: ItemKey): number => Number(ITEMS[k].id);

export interface GameComparison {
  id: string;
  start: number;
  win: boolean;
  played: PlayedForm;
  recommendedForm: Form;
  /** Forme utilisée pour le build recommandé : la forme jouée, ou la recommandée si pas de transformation. */
  buildForm: Form;
  recommended: { core: number[]; boots: number };
  actual: { core: number[]; boots: number | null };
  firstMatch: boolean;
  /** Nombre d'items recommandés (3 premiers) parmi tes 3 premiers items. */
  coreOverlap: number;
  bootsMatch: boolean;
  /** Build suivi : au moins 2 des 3 premiers items recommandés. */
  followed: boolean;
  enemies: string[];
  allies: string[];
}

/** Compare une partie au build que le moteur recommande pour la même compo. Null si un champion est inconnu. */
export function compareGame(g: GameRecord, index: ItemIndex): GameComparison | null {
  const en = g.enemies.map(champByKey), al = g.allies.map(champByKey);
  if (en.some((c) => !c) || al.some((c) => !c) || en.length < 3) return null;
  const x = analyse(en as Champion[], al as Champion[]);
  const recommendedForm = resolveForm(x, "auto");
  const buildForm: Form = g.form === "none" ? recommendedForm : g.form;
  const rec = chooseBuild(x, buildForm).b;
  const recCore = rec.filter((k) => !ITEMS[k].boots).slice(0, 3).map(ddId);
  const recBoots = ddId(rec.find((k) => ITEMS[k].boots)!);
  const { legendaries, boots } = completedItems(g.purchases ?? g.finalItems, index);
  const core = legendaries.slice(0, 3);
  const coreOverlap = core.filter((id) => recCore.includes(id)).length;
  return {
    id: g.id, start: g.start, win: g.win, played: g.form, recommendedForm, buildForm,
    recommended: { core: recCore, boots: recBoots },
    actual: { core, boots },
    firstMatch: core[0] != null && core[0] === recCore[0],
    coreOverlap,
    bootsMatch: boots === recBoots,
    followed: coreOverlap >= 2,
    enemies: (en as Champion[]).map((c) => c.name),
    allies: (al as Champion[]).map((c) => c.name),
  };
}

export interface StatsReport {
  since: number;
  games: number;
  remakes: number;
  overall: WinRate;
  byForm: Record<PlayedForm, WinRate>;
  /** Win rate par item de l'inventaire final (légendaires et bottes), trié par nombre de parties. */
  byItem: { id: number; name: string; image: string; kind: "legendary" | "boots"; w: WinRate }[];
  /** Win rate selon ton 1er item. */
  byFirstItem: { id: number; name: string; image: string; w: WinRate }[];
  comparison: {
    compared: number;
    skipped: number;
    /** Chronologie absente : comparaison sur l'inventaire final (ordre approximatif). */
    withoutTimeline: number;
    formAgreed: WinRate;
    formDiffered: WinRate;
    firstMatched: WinRate;
    firstDiffered: WinRate;
    followed: WinRate;
    notFollowed: WinRate;
    bootsMatched: WinRate;
    bootsDiffered: WinRate;
    avgCoreOverlap: number | null;
    games: GameComparison[];
  };
}

export function aggregate(records: GameRecord[], index: ItemIndex, since: number): StatsReport {
  const played = records.filter((g) => !g.remake).sort((a, b) => b.start - a.start);
  const overall = empty();
  const byForm: Record<PlayedForm, WinRate> = { blue: empty(), red: empty(), none: empty() };
  const items = new Map<number, WinRate>(), firsts = new Map<number, WinRate>();
  const c = {
    formAgreed: empty(), formDiffered: empty(), firstMatched: empty(), firstDiffered: empty(),
    followed: empty(), notFollowed: empty(), bootsMatched: empty(), bootsDiffered: empty(),
  };
  const games: GameComparison[] = [];
  let skipped = 0, withoutTimeline = 0;

  for (const g of played) {
    add(overall, g.win);
    add(byForm[g.form], g.win);
    const seen = new Set<number>();
    for (const id of g.finalItems) {
      const it = index[id];
      if (!it) continue;
      const key = it.kind === "boots" ? bootsBase(id, index) : id;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!items.has(key)) items.set(key, empty());
      add(items.get(key)!, g.win);
    }
    const first = completedItems(g.purchases ?? g.finalItems, index).legendaries[0];
    if (first != null) { if (!firsts.has(first)) firsts.set(first, empty()); add(firsts.get(first)!, g.win); }

    const cmp = compareGame(g, index);
    if (!cmp) { skipped++; continue; }
    if (!g.purchases) withoutTimeline++;
    games.push(cmp);
    if (g.form !== "none") add(g.form === cmp.recommendedForm ? c.formAgreed : c.formDiffered, g.win);
    add(cmp.firstMatch ? c.firstMatched : c.firstDiffered, g.win);
    add(cmp.followed ? c.followed : c.notFollowed, g.win);
    if (cmp.actual.boots != null) add(cmp.bootsMatch ? c.bootsMatched : c.bootsDiffered, g.win);
  }

  const named = (m: Map<number, WinRate>) => [...m.entries()]
    .map(([id, w]) => ({ id, name: index[id]?.name ?? String(id), image: index[id]?.image ?? `${id}.png`, kind: index[id]?.kind ?? "legendary", w }))
    .sort((a, b) => b.w.n - a.w.n || b.w.wins - a.w.wins);

  return {
    since,
    games: played.length,
    remakes: records.length - played.length,
    overall,
    byForm,
    byItem: named(items),
    byFirstItem: named(firsts).map(({ kind: _k, ...r }) => r),
    comparison: {
      compared: games.length, skipped, withoutTimeline, ...c,
      avgCoreOverlap: games.length ? Math.round((100 * games.reduce((s, x) => s + x.coreOverlap, 0)) / games.length) / 100 : null,
      games,
    },
  };
}
