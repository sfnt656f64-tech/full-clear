// « Pool conseillé » : 2 ou 3 champions sur lesquels te concentrer, choisis parmi « À garder » et « Potentiel » pour
// être complémentaires (type de dégâts, style early ou fin de partie, compositions adverses où ils sont bons).
// Sans assez de parties dans le rôle : proposés d'après la méta et leur ressemblance avec tes meilleurs champions.
// Fonctions pures.
import { champByKey } from "../../src/data/champions";
import type { Champion } from "../../src/data/types";
import type { MetaPartRow } from "../meta/meta-stats.ts";
import type { PotentialGroups, PotentialEntry } from "./potential.ts";
import type { PoolPick, TryPick } from "./recommend.ts";

/** Types de compositions adverses (champions visibles en draft). */
export type CompoKind = "tanks" | "poke" | "engage";
export const COMPO_LABEL: Record<CompoKind, string> = { tanks: "compos avec 2 tanks ou plus", poke: "compos à distance (3 mages ou tireurs ou plus)", engage: "compos avec beaucoup de contrôle" };
/** Écart de win rate (points) et parties minimales pour dire qu'un champion est bon contre un type de compo. */
const COMPO_DELTA = 2;
const COMPO_MIN = 30;

export function compoKinds(enemies: (Champion | undefined)[]): CompoKind[] {
  const en = enemies.filter((c): c is Champion => !!c);
  const out: CompoKind[] = [];
  if (en.filter((c) => c.profile === "tank").length >= 2) out.push("tanks");
  if (en.filter((c) => (c.profile === "mage" || c.profile === "marksman") && c.range === "ranged").length >= 3) out.push("poke");
  if (en.reduce((s, c) => s + c.cc, 0) >= 9) out.push("engage");
  return out;
}

export interface CompoStrength { kind: CompoKind; delta: number; games: number; winRate: number }

/** Méta : win rate de chaque champion (dans un rôle) selon la compo adverse, comparé à son win rate habituel. */
export function compoStrengths(parts: MetaPartRow[], role: string): Map<number, CompoStrength[]> {
  const byMatch = new Map<string, MetaPartRow[]>();
  for (const p of parts) (byMatch.get(p.matchId) ?? byMatch.set(p.matchId, []).get(p.matchId)!).push(p);
  const stats = new Map<number, { n: number; w: number; by: Record<CompoKind, { n: number; w: number }> }>();
  for (const rows of byMatch.values()) {
    for (const p of rows) {
      if (p.role !== role) continue;
      const kinds = compoKinds(rows.filter((x) => x.team !== p.team).map((x) => champByKey(x.championId)));
      const e = stats.get(p.championId) ?? { n: 0, w: 0, by: { tanks: { n: 0, w: 0 }, poke: { n: 0, w: 0 }, engage: { n: 0, w: 0 } } };
      e.n++; if (p.win) e.w++;
      for (const k of kinds) { e.by[k].n++; if (p.win) e.by[k].w++; }
      stats.set(p.championId, e);
    }
  }
  const out = new Map<number, CompoStrength[]>();
  for (const [id, e] of stats) {
    const base = (e.w / e.n) * 100;
    out.set(id, (Object.keys(e.by) as CompoKind[]).filter((k) => e.by[k].n >= COMPO_MIN).map((k) => {
      const wr = (e.by[k].w / e.by[k].n) * 100;
      return { kind: k, delta: wr - base, games: e.by[k].n, winRate: wr };
    }));
  }
  return out;
}

export interface AdvicePick { championId: number; why: string[]; fromMeta: boolean; provisional: boolean; /** Une ligne courte, sans chiffre. */ short: string }

/** « Dégâts magiques, différents des autres » : fragments courts, 12 mots au plus. */
function oneLine(parts: string[]): string {
  let out = "";
  for (const p of parts) {
    const next = out ? `${out}, ${p}` : p;
    if (next.split(/\s+/).length > 12) break;
    out = next;
  }
  return out ? `${out[0].toUpperCase()}${out.slice(1)}.` : "";
}

export interface PoolAdvice {
  picks: AdvicePick[];
  /** Part de tes parties du rôle (saison en cours) sur ces champions, et win rate dessus / ailleurs. */
  coverage: { games: number; total: number; champions: number; inPool: { w: number; n: number }; outside: { w: number; n: number } } | null;
  /** Pas assez de champions joués dans le rôle : proposés d'après la méta et la ressemblance avec tes meilleurs champions. */
  fromMeta: boolean;
  text: string;
}

const nf = (n: number) => Math.round(n).toLocaleString("fr-FR");
export const wilson = (w: number, n: number): number => {
  if (!n) return 100;
  const z = 1.96, p = w / n, d = 1 + z * z / n;
  return ((z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d) * 100;
};
const damageLabel = (c: Champion) => (c.damage === "magic" ? "dégâts magiques" : c.damage === "mixed" ? "dégâts mixtes" : "dégâts physiques");
const styleOf = (c: Champion, early: number | undefined): "early" | "scaling" | "balanced" => (early != null ? (early > 2 ? "early" : early < -2 ? "scaling" : "balanced") : c.early ? "early" : "balanced");
const STYLE_LABEL = { early: "fort en début de partie", scaling: "monte en puissance", balanced: "équilibré" } as const;

export interface AdviceInput {
  role: string;
  groups: PotentialGroups;
  pool: PoolPick[];
  tryList: TryPick[];
  /** Tes parties du rôle sur la saison en cours (jamais deux saisons mélangées) : champion et victoire. */
  myGames: { championId: number; win: boolean }[];
  /** Style des champions dans la méta (écart de win rate parties courtes − longues, en points). */
  earlyIndex: Map<number, number>;
  compo: Map<number, CompoStrength[]>;
}

export function poolAdvice(input: AdviceInput): PoolAdvice {
  const candidates: PotentialEntry[] = [...input.groups.keep, ...input.groups.potential].filter((e) => input.pool.some((p) => p.championId === e.championId));
  const fromMeta = candidates.length < 2;
  const chosen: AdvicePick[] = [];
  const traits = (id: number) => {
    const c = champByKey(id)!;
    const strong = (input.compo.get(id) ?? []).filter((x) => x.delta >= COMPO_DELTA).map((x) => x.kind);
    return { c, style: styleOf(c, input.earlyIndex.get(id)), strong };
  };

  if (!fromMeta) {
    // Base : le score du pool (« À garder » avant « Potentiel ») ; bonus de complémentarité avec les champions déjà choisis.
    // Complémentarité : des dégâts différents valent environ 5 points de score (un champion de plus du même type
    // apporte peu à la draft) ; un style différent ou une compo couverte en plus, 2 points.
    // On se concentre sur ce qui est établi : moins de 20 parties fortement pénalisé, bonus aux parties jouées
    // (jusqu'à 4,5 points à 150 parties). Les stats comptent un peu.
    const base = (e: PotentialEntry) => (e.score ?? 50) + (e.group === "keep" ? 1 : 0) + 0.2 * ((e.radar?.score ?? 50) - 50) + (e.provisional ? -6 : 0) + 0.03 * Math.min(e.games, 150);
    const left = [...candidates];
    while (chosen.length < 3 && left.length) {
      const scored = left.map((e) => {
        const t = traits(e.championId);
        const why: string[] = [];
        let bonus = 0;
        if (chosen.length) {
          const prev = chosen.map((x) => traits(x.championId));
          if (prev.every((p) => p.c.damage !== t.c.damage)) { bonus += 5; why.push(`${damageLabel(t.c)}, différents des autres`); }
          if (prev.every((p) => p.style !== t.style)) { bonus += 2; why.push(`style ${STYLE_LABEL[t.style]}`); }
          const covered = new Set(prev.flatMap((p) => p.strong));
          const extra = t.strong.filter((k) => !covered.has(k));
          if (extra.length) { bonus += 2; why.push(`bon contre les ${extra.map((k) => COMPO_LABEL[k]).join(" et les ")}`); }
        }
        return { e, t, v: base(e) + bonus, why };
      }).sort((a, b) => b.v - a.v);
      const best = scored[0];
      // Au-delà de 2 champions, seulement si le 3ᵉ apporte quelque chose de différent.
      if (chosen.length >= 2 && !best.why.length) break;
      const head = best.e.group === "keep" ? `À garder (${best.e.games} parties)` : `Potentiel (${best.e.games} parties)`;
      const tail = chosen.length ? best.why : [`ton meilleur choix : ${damageLabel(best.t.c)}, style ${STYLE_LABEL[best.t.style]}`];
      chosen.push({ championId: best.e.championId, fromMeta: false, provisional: best.e.provisional, why: [head, ...tail], short: oneLine(tail) || best.e.short });
      left.splice(left.indexOf(best.e), 1);
    }
  } else {
    for (const t of input.tryList.slice(0, 3)) chosen.push({ championId: t.championId, fromMeta: true, provisional: t.provisional, why: t.reasons.slice(0, 2), short: t.short });
  }

  const ids = new Set(chosen.map((c) => c.championId));
  const total = input.myGames.length;
  const inPool = input.myGames.filter((g) => ids.has(g.championId));
  const outside = input.myGames.filter((g) => !ids.has(g.championId));
  const coverage = total ? {
    games: inPool.length, total, champions: new Set(input.myGames.map((g) => g.championId)).size,
    inPool: { w: inPool.filter((g) => g.win).length, n: inPool.length }, outside: { w: outside.filter((g) => g.win).length, n: outside.length },
  } : null;

  let text: string;
  if (fromMeta) {
    text = `Pas assez de parties dans ce rôle pour choisir parmi tes champions : proposés d'après la méta Émeraude+ et leur ressemblance avec tes meilleurs champions${input.role === "MIDDLE" ? " de jungle" : ""}. À essayer en parties normales d'abord.`;
  } else if (coverage) {
    const share = (coverage.games / coverage.total) * 100;
    const wr = (x: { w: number; n: number }) => (x.n ? `${nf((x.w / x.n) * 100)} % ± ${nf(wilson(x.w, x.n))} (${x.n} parties)` : "–");
    const enough = coverage.inPool.n >= 20 && coverage.outside.n >= 20;
    const pi = coverage.inPool.n ? (coverage.inPool.w / coverage.inPool.n) * 100 : 0, po = coverage.outside.n ? (coverage.outside.w / coverage.outside.n) * 100 : 0;
    const clear = enough && Math.abs(pi - po) > wilson(coverage.inPool.w, coverage.inPool.n) + wilson(coverage.outside.w, coverage.outside.n);
    // Compos couvertes : seulement celles où un champion choisi est nettement meilleur dans la méta.
    const kinds = new Set(chosen.flatMap((c) => (input.compo.get(c.championId) ?? []).filter((x) => x.delta >= COMPO_DELTA).map((x) => x.kind)));
    text = `Ce pool couvre ${nf(share)} % de tes parties du rôle sur la saison en cours (${coverage.games} sur ${coverage.total}, réparties sur ${coverage.champions} champions). `
      + `Victoires sur ces champions : ${wr(coverage.inPool)} ; sur les autres : ${wr(coverage.outside)}${!enough ? " (moins de 20 parties d'un côté : pas de conclusion)" : clear ? "" : " (écart dans la marge d'erreur)"}. `
      + `Le resserrer concentre tes parties : ta maîtrise monte (bonus du score) et tes stats deviennent plus fiables`
      + (kinds.size ? `, avec un champion nettement meilleur que la moyenne contre les ${[...kinds].map((k) => COMPO_LABEL[k]).join(" et les ")}.` : ".");
  } else {
    text = "Pas encore de parties dans ce rôle.";
  }
  return { picks: chosen, coverage, fromMeta, text };
}
