// Page de runes recommandée, en identifiants du jeu (importable dans le client). Fonctions pures.
//
// - Champion quelconque : construite emplacement par emplacement à partir de la méta Émeraude+ (patchs récents
//   seulement : jamais les runes des anciennes saisons) — rune principale la plus jouée, puis, parmi les parties
//   avec cette rune, l'arbre secondaire, chaque rune et chaque fragment les plus joués. Plus robuste que la page
//   complète la plus jouée, éparpillée en de nombreuses variantes.
// - Kayn : la page du guide pour la forme recommandée (le modèle de dégâts reste celui de Kayn).
import { RUNE_TREES, RUNES_BY_ID } from "../../src/data/runes";
import { RUNES } from "../../src/data/guides";
import type { Form } from "../../src/data/types";
import type { RunePage as RuneIds } from "../meta/meta-stats.ts";

export interface RecommendedPage extends RuneIds {
  /** Nom de la page dans le client. */
  name: string;
  source: "meta" | "guide";
  /** Méta : parties avec cette rune principale, et leur win rate. */
  games?: number;
  winRate?: number;
}

/** Parties minimales pour proposer une page tirée de la méta. */
export const MIN_PAGE_GAMES = 20;
/** Fragments valides par ligne (offensif, flexible, défensif). */
export const SHARD_ROWS: number[][] = [[5008, 5005, 5007], [5008, 5010, 5001], [5011, 5013, 5001]];
export const PAGE_PREFIX = "FullClear";
/** Préfixe des pages importées par l'ancienne version (« Kayn Sim ») : remplacées elles aussi. */
export const LEGACY_PAGE_PREFIX = "KaynSim";
/** Page importée par l'appli (jamais une page à toi). */
export const isOurPage = (name: string) => name.startsWith(PAGE_PREFIX) || name.startsWith(LEGACY_PAGE_PREFIX);

function mostPlayed<T>(values: T[], key: (v: T) => string | number = (v) => String(v)): T | undefined {
  const m = new Map<string | number, { v: T; n: number }>();
  for (const v of values) {
    const k = key(v);
    const e = m.get(k) ?? { v, n: 0 };
    e.n++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n)[0]?.v;
}

/** Page cohérente ? (4 runes de l'arbre principal, une par ligne ; 2 de l'arbre secondaire, lignes différentes ; 3 fragments.) */
export function validPage(p: RuneIds): boolean {
  if (p.primary === p.sub || !RUNE_TREES[p.primary] || !RUNE_TREES[p.sub] || p.selections.length !== 6 || p.shards.length !== 3) return false;
  const info = p.selections.map((id) => RUNES_BY_ID[id]);
  if (info.some((r) => !r)) return false;
  const prim = info.slice(0, 4), sec = info.slice(4);
  if (prim.some((r, i) => r.tree !== p.primary || r.slot !== i)) return false;
  if (sec.some((r) => r.tree !== p.sub || r.slot === 0) || sec[0].slot === sec[1].slot) return false;
  return p.shards.every((s, i) => SHARD_ROWS[i].includes(s));
}

/** Page tirée de la méta (lignes d'un champion dans un rôle, patchs récents). */
export function metaPage(rows: { perks: RuneIds | null; win: boolean }[], championName: string): RecommendedPage | null {
  const pages = rows.flatMap((r) => (r.perks && validPage(r.perks) ? [{ p: r.perks, win: r.win }] : []));
  if (pages.length < MIN_PAGE_GAMES) return null;
  const keystone = mostPlayed(pages.map((x) => x.p.selections[0]))!;
  const withKs = pages.filter((x) => x.p.selections[0] === keystone);
  const primary = RUNES_BY_ID[keystone].tree;
  const sub = mostPlayed(withKs.map((x) => x.p.sub))!;
  const runes = [keystone];
  for (let slot = 1; slot <= 3; slot++) runes.push(mostPlayed(withKs.map((x) => x.p.selections[slot]))!);
  // Secondaire : les 2 runes les plus jouées de cet arbre, sur 2 lignes différentes.
  const secRows = withKs.filter((x) => x.p.sub === sub).flatMap((x) => x.p.selections.slice(4));
  const counts = new Map<number, number>();
  for (const id of secRows) counts.set(id, (counts.get(id) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const first = ranked[0];
  const second = ranked.find((id) => id !== first && RUNES_BY_ID[id]?.slot !== RUNES_BY_ID[first]?.slot);
  if (first == null || second == null) return null;
  // Garde l'ordre des lignes (comme le client).
  const secPair = [first, second].sort((a, b) => RUNES_BY_ID[a].slot - RUNES_BY_ID[b].slot);
  const shards = [0, 1, 2].map((i) => mostPlayed(withKs.map((x) => x.p.shards[i]))!);
  const page: RuneIds = { primary, sub, selections: [...runes, ...secPair], shards };
  if (!validPage(page)) return null;
  const wins = withKs.filter((x) => x.win).length;
  return { ...page, name: `${PAGE_PREFIX} ${championName}`, source: "meta", games: withKs.length, winRate: (wins / withKs.length) * 100 };
}

const byName = (name: string): number | undefined =>
  Number(Object.entries(RUNES_BY_ID).find(([, r]) => r.nameEn === name || r.name === name)?.[0]) || undefined;
const treeByName = (name: string): number | undefined =>
  Number(Object.entries(RUNE_TREES).find(([, t]) => t.nameEn === name || t.name === name)?.[0]) || undefined;

/** Fragments du guide (« Adaptive Force ×2, Health Scaling »). */
const GUIDE_SHARDS = [5008, 5008, 5001];

/** Page du guide de Kayn pour une forme, en identifiants ; null si un nom n'est plus reconnu (patch). */
export function guidePage(form: Form): RecommendedPage | null {
  const g = RUNES[form];
  const primary = treeByName(g.primary[0]);
  const sub = treeByName(g.secondary[0]);
  const prim = g.primary[1].split("·").map((s) => byName(s.trim()));
  const sec = g.secondary[1].split("·").map((s) => byName(s.trim()));
  if (!primary || !sub || [...prim, ...sec].some((x) => x == null)) return null;
  // Secondaires dans l'ordre des lignes (comme le client).
  const secIds = (sec as number[]).sort((a, b) => RUNES_BY_ID[a].slot - RUNES_BY_ID[b].slot);
  const page: RuneIds = { primary, sub, selections: [...(prim as number[]), ...secIds], shards: GUIDE_SHARDS };
  return validPage(page) ? { ...page, name: `${PAGE_PREFIX} Kayn ${form === "blue" ? "bleu" : "rouge"}`, source: "guide" } : null;
}
