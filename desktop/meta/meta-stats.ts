// Statistiques de méta par champion et par rôle, à partir des parties Émeraude+ collectées. Fonctions pures.
import itemIndex from "../../src/data/generated/item-index.json";
import { STARTERS } from "../../src/data/starters";

export interface MetaPartRow {
  matchId: string; championId: number; role: string; win: boolean; items: number[]; perks: RunePage | null;
  /** Pour le style de jeu (« À essayer ») : équipe, KDA, durée ; début de partie si la chronologie a été lue. */
  team?: number; kills?: number; deaths?: number; assists?: number; durationS?: number;
  kills15?: number | null; assists15?: number | null; teamKills15?: number | null; gold15?: number | null;
}
export interface MetaBuildRow { championId: number; role: string; win: boolean; items: number[] }
export interface MetaMasteryRow { championId: number; role: string; win: boolean; points: number }
export interface RunePage { primary: number; sub: number; selections: number[]; shards: number[] }

export interface MetaInput {
  /** Parties retenues (hors remakes) : base du pick rate. */
  matches: number;
  parts: MetaPartRow[];
  builds: MetaBuildRow[];
  mastery: MetaMasteryRow[];
  patches: string[];
}

export interface Rate { games: number; winRate: number }
export interface ItemRate extends Rate { id: number; share: number }

export interface MetaChampion {
  championId: number;
  role: string;
  games: number;
  wins: number;
  winRate: number;
  /** Demi-largeur de l'intervalle de confiance à 95 % sur le win rate (points de %). */
  margin: number;
  /** % des parties où le champion est joué dans ce rôle. */
  pickRate: number;
  /** Peu de parties : chiffres indicatifs. */
  provisional: boolean;
  /** Items terminés (hors bottes et familiers) les plus présents dans l'inventaire final. */
  items: ItemRate[];
  boots: ItemRate | null;
  /** Familier de jungle (identifiant principal) le plus joué. */
  starter: ItemRate | null;
  keystones: ItemRate[];
  /** Page de runes complète la plus jouée. */
  page: (RunePage & Rate) | null;
  /** Ordre des 3 premiers items (chronologie, champions de ton pool seulement). */
  core: ({ items: number[] } & Rate) | null;
  /** Win rate selon la maîtrise du joueur sur le champion (difficulté de prise en main). */
  mastery: { low: Rate; mid: Rate; high: Rate } | null;
}

/** En dessous : « provisoire ». */
export const PROVISIONAL_GAMES = 100;
/** Seuils de maîtrise (points) : découvre / connaît / maîtrise. */
export const MASTERY_BUCKETS = [20_000, 100_000] as const;

const BOOTS = new Set(Object.entries(itemIndex).filter(([, v]) => v.kind === "boots").map(([k]) => Number(k)));
const LEGENDARY = new Set(Object.entries(itemIndex).filter(([, v]) => v.kind === "legendary").map(([k]) => Number(k)));
/** Variante de familier → identifiant principal (1107 → 1101…). */
const STARTER_MAIN = new Map<number, number>(Object.values(STARTERS).flatMap((s) => s.ids.map((i) => [Number(i), Number(s.id)] as const)));
/** Bottes de niveau 3 ramenées à leurs bottes de niveau 2. */
const BOOTS_BASE = new Map<number, number>(Object.entries(itemIndex).flatMap(([k, v]) => ("baseBoots" in v && v.baseBoots ? [[Number(k), Number(v.baseBoots)] as const] : [])));

const pct = (w: number, n: number) => (n ? (w / n) * 100 : 0);
export const margin95 = (w: number, n: number): number => (n ? 1.96 * Math.sqrt((w / n) * (1 - w / n) / n) * 100 : 100);

function rates(values: { key: number; win: boolean }[], total: number, limit: number, minShare = 0): ItemRate[] {
  const m = new Map<number, { n: number; w: number }>();
  for (const v of values) {
    const e = m.get(v.key) ?? { n: 0, w: 0 };
    e.n++;
    if (v.win) e.w++;
    m.set(v.key, e);
  }
  return [...m.entries()]
    .map(([id, e]) => ({ id, games: e.n, winRate: pct(e.w, e.n), share: pct(e.n, total) }))
    .filter((r) => r.share >= minShare)
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.id - b.id)
    .slice(0, limit);
}

function bucket(rows: MetaMasteryRow[], lo: number, hi: number): Rate {
  const r = rows.filter((x) => x.points >= lo && x.points < hi);
  return { games: r.length, winRate: pct(r.filter((x) => x.win).length, r.length) };
}

export function metaStats(input: MetaInput): MetaChampion[] {
  const groups = new Map<string, MetaPartRow[]>();
  for (const p of input.parts) {
    if (!p.role) continue;
    const k = `${p.championId}|${p.role}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(p);
  }
  const buildsBy = new Map<string, MetaBuildRow[]>();
  for (const b of input.builds) {
    const k = `${b.championId}|${b.role}`;
    (buildsBy.get(k) ?? buildsBy.set(k, []).get(k)!).push(b);
  }
  const masteryBy = new Map<number, MetaMasteryRow[]>();
  for (const m of input.mastery) (masteryBy.get(m.championId) ?? masteryBy.set(m.championId, []).get(m.championId)!).push(m);

  const out: MetaChampion[] = [];
  for (const [k, rows] of groups) {
    const [championId, role] = [Number(k.split("|")[0]), k.split("|")[1]];
    const n = rows.length;
    const wins = rows.filter((r) => r.win).length;
    const legendary = rows.flatMap((r) => r.items.filter((i) => LEGENDARY.has(i)).map((i) => ({ key: i, win: r.win })));
    const boots = rows.flatMap((r) => r.items.filter((i) => BOOTS.has(i)).slice(0, 1).map((i) => ({ key: BOOTS_BASE.get(i) ?? i, win: r.win })));
    const starters = rows.flatMap((r) => r.items.filter((i) => STARTER_MAIN.has(i)).slice(0, 1).map((i) => ({ key: STARTER_MAIN.get(i)!, win: r.win })));
    const withPerks = rows.filter((r): r is MetaPartRow & { perks: RunePage } => !!r.perks);
    const keystones = rates(withPerks.map((r) => ({ key: r.perks.selections[0], win: r.win })), withPerks.length, 3);

    // Page complète la plus jouée (clé = arbres + runes + fragments).
    const pages = new Map<string, { page: RunePage; n: number; w: number }>();
    for (const r of withPerks) {
      const key = JSON.stringify(r.perks);
      const e = pages.get(key) ?? { page: r.perks, n: 0, w: 0 };
      e.n++;
      if (r.win) e.w++;
      pages.set(key, e);
    }
    const topPage = [...pages.values()].sort((a, b) => b.n - a.n || b.w - a.w)[0];

    // Ordre des 3 premiers items terminés (hors bottes et familiers), d'après la chronologie.
    const cores = new Map<string, { items: number[]; n: number; w: number }>();
    for (const b of buildsBy.get(k) ?? []) {
      const first = b.items.filter((i) => LEGENDARY.has(i)).slice(0, 3);
      if (first.length < 3) continue;
      const key = first.join(",");
      const e = cores.get(key) ?? { items: first, n: 0, w: 0 };
      e.n++;
      if (b.win) e.w++;
      cores.set(key, e);
    }
    const topCore = [...cores.values()].sort((a, b) => b.n - a.n || b.w - a.w)[0];

    const mrows = (masteryBy.get(championId) ?? []).filter((m) => m.role === role);
    out.push({
      championId,
      role,
      games: n,
      wins,
      winRate: pct(wins, n),
      margin: margin95(wins, n),
      pickRate: pct(n, input.matches),
      provisional: n < PROVISIONAL_GAMES,
      items: rates(legendary, n, 6, 5),
      boots: rates(boots, n, 1)[0] ?? null,
      starter: rates(starters, n, 1)[0] ?? null,
      keystones,
      page: topPage ? { ...topPage.page, games: topPage.n, winRate: pct(topPage.w, topPage.n) } : null,
      core: topCore && topCore.n >= 3 ? { items: topCore.items, games: topCore.n, winRate: pct(topCore.w, topCore.n) } : null,
      mastery: mrows.length
        ? { low: bucket(mrows, 0, MASTERY_BUCKETS[0]), mid: bucket(mrows, MASTERY_BUCKETS[0], MASTERY_BUCKETS[1]), high: bucket(mrows, MASTERY_BUCKETS[1], Infinity) }
        : null,
    });
  }
  return out.sort((a, b) => b.games - a.games || a.championId - b.championId);
}
