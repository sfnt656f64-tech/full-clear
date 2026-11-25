// Classement par potentiel (Champions recommandés), par rôle. S'appuie d'abord sur les stats de jeu (radar :
// moyenne des 6 axes, 50 = médiane Émeraude+), plus stables que le win rate sur peu de parties. Fonctions pures.
import { AXES, type Radar } from "../analysis/radar.ts";
import type { PoolPick } from "./recommend.ts";

/**
 * Seuils (réglables). Les stats ont une marge d'erreur (± m) : elles sont « au-dessus de la médiane » si toute la
 * marge est au-dessus de 50 (stats − m > 50), « sous la médiane » si toute la marge est en dessous (stats + m < 50),
 * « autour de la médiane » sinon. Les groupes couvrent tous les cas, sans trou :
 *
 *   win rate lissé ≥ 51 %                        → À garder (stats sous la médiane : « à consolider », axes cités)
 *   win rate lissé < 51 %, stats au-dessus        → Potentiel à développer
 *   win rate lissé < 51 %, stats autour           → Neutre, pas prioritaire (moins de 20 parties : Potentiel, à confirmer)
 *   win rate lissé 50 à 51 %, stats sous          → Neutre, pas prioritaire
 *   win rate lissé < 50 %, stats sous             → À mettre de côté
 *
 * Moins de 20 parties : le classement est marqué « à confirmer ». Sans radar (moins de 5 parties relues) : classement
 * provisoire sur le win rate seul.
 */
export const KEEP_WR = 51;
export const POTENTIAL_STATS = 55;
export const MEDIAN_STATS = 50;
export const SHELVE_WR = 50;
export const CONFIRM_GAMES = 20;
/** Compatibilité (ancien nom). */
export const NEUTRAL_GAMES = CONFIRM_GAMES;

export type PotentialGroup = "keep" | "potential" | "neutral" | "shelve";

export interface PotentialEntry {
  championId: number;
  group: PotentialGroup;
  games: number;
  /** Win rate lissé (pool), ou brut pour un champion encore hors du pool. */
  winRate: number | null;
  radar: Radar | null;
  text: string;
  /** Moins de 20 parties ou pas de radar : à confirmer. */
  provisional: boolean;
  /** Score du pool (tri dans le groupe), null hors pool. */
  score: number | null;
}

export interface TriedChampion { championId: number; games: number; wins: number }

const nf1 = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} et ${xs.at(-1)}`);

/** Axes du radar au-dessus de 55 (les 2 plus hauts) et sous 50 (les 2 plus bas), avec leur valeur. */
export function axesText(r: Radar): { strong: string; weak: string } {
  const axes = AXES.map((a, i) => ({ label: a.label, v: r.values[i] })).filter((x): x is { label: string; v: number } => x.v != null);
  const strong = axes.filter((x) => x.v >= POTENTIAL_STATS).sort((p, q) => q.v - p.v).slice(0, 2);
  const weak = axes.filter((x) => x.v < MEDIAN_STATS).sort((p, q) => p.v - q.v).slice(0, 2);
  return {
    strong: list(strong.map((x) => `${x.label} (${nf1(x.v)})`)),
    weak: list(weak.map((x) => `${x.label} (${nf1(x.v)})`)),
  };
}

export type StatsLevel = "above" | "around" | "below";
/** Position des stats par rapport à la médiane, marge d'erreur comprise. */
export function statsLevel(r: Radar): StatsLevel | null {
  if (r.score == null) return null;
  const m = r.margin ?? 0;
  return r.score - m > MEDIAN_STATS ? "above" : r.score + m < MEDIAN_STATS ? "below" : "around";
}
const statsText = (r: Radar) => `stats ${nf1(r.score!)}${r.margin != null ? ` ± ${nf1(r.margin)}` : ""} (50 = médiane)`;

/** Classe un champion du pool (au moins 10 parties dans le rôle). */
export function classifyPool(p: PoolPick, radar: Radar | null): PotentialEntry {
  const wr = p.adjustedWinRate, g = p.games, s = radar?.score ?? null;
  const few = g < CONFIRM_GAMES;
  const wrText = `${nf1(wr)} % de victoires (lissé) sur ${g} parties`;
  const base = { championId: p.championId, games: g, winRate: wr, radar, score: p.score, provisional: few };
  const confirm = few ? ` À confirmer : moins de ${CONFIRM_GAMES} parties.` : "";

  if (s == null || !radar) {
    const group: PotentialGroup = wr >= KEEP_WR ? "keep" : wr < SHELVE_WR ? "shelve" : "neutral";
    return { ...base, group, provisional: true, text: `${wrText}. Stats de jeu pas encore disponibles (moins de 5 parties relues) : classement provisoire, sur le win rate seul.` };
  }
  const { strong, weak } = axesText(radar);
  const stats = statsText(radar);
  const level = statsLevel(radar)!;
  if (wr >= KEEP_WR && level !== "below") {
    return { ...base, group: "keep", text: `${wrText}, ${stats}, ${level === "above" ? "au-dessus de la médiane" : "autour de la médiane (marge comprise)"}${strong ? `, points forts : ${strong}` : ""} : à garder.${confirm}` };
  }
  if (wr >= KEEP_WR) {
    return { ...base, group: "keep", text: `Tu gagnes (${wrText}), mais ${stats}, sous la médiane : à consolider sur ${weak || "l'ensemble des axes"}.${confirm}` };
  }
  if (level === "above") {
    return { ...base, group: "potential", text: `${stats}, au-dessus de la médiane${strong ? `, points forts : ${strong}` : ""}, mais ${wrText} : potentiel à développer.${confirm}` };
  }
  if (level === "around") {
    return few
      ? { ...base, group: "potential", text: `${stats}, autour de la médiane, et ${wrText} : potentiel à confirmer (moins de ${CONFIRM_GAMES} parties).` }
      : { ...base, group: "neutral", text: `${stats}, autour de la médiane, et ${wrText} : neutre, pas prioritaire.` };
  }
  if (wr >= SHELVE_WR) {
    return { ...base, group: "neutral", text: `${wrText}, mais ${stats}, sous la médiane sur ${weak || "plusieurs axes"} : neutre, pas prioritaire.${confirm}` };
  }
  return { ...base, group: "shelve", text: `${stats}, sous la médiane sur ${weak || "plusieurs axes"}, et ${wrText} : à mettre de côté.${confirm}` };
}

/** Champion joué 5 à 9 fois (hors pool) : « Potentiel à développer » seulement avec des stats au-dessus de la médiane, marge comprise. */
export function classifyTried(t: TriedChampion, radar: Radar | null): PotentialEntry | null {
  if (!radar?.score || statsLevel(radar) !== "above") return null;
  const { strong } = axesText(radar);
  return {
    championId: t.championId, group: "potential", games: t.games, winRate: (t.wins / t.games) * 100, radar, score: null, provisional: true,
    text: `${statsText(radar)}, au-dessus de la médiane${strong ? `, points forts : ${strong}` : ""}, sur seulement ${t.games} parties (${t.wins} victoire${t.wins > 1 ? "s" : ""}) : potentiel à développer. À confirmer : moins de ${CONFIRM_GAMES} parties.`,
  };
}

export interface PotentialGroups { keep: PotentialEntry[]; potential: PotentialEntry[]; neutral: PotentialEntry[]; shelve: PotentialEntry[] }

export function potentialGroups(pool: PoolPick[], tried: TriedChampion[], radars: Map<number, Radar | null>): PotentialGroups {
  const entries = [
    ...pool.map((p) => classifyPool(p, radars.get(p.championId) ?? null)),
    ...tried.flatMap((t) => { const e = classifyTried(t, radars.get(t.championId) ?? null); return e ? [e] : []; }),
  ];
  const by = (g: PotentialGroup) => entries.filter((e) => e.group === g)
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || (b.radar?.score ?? 0) - (a.radar?.score ?? 0));
  return { keep: by("keep"), potential: by("potential"), neutral: by("neutral"), shelve: by("shelve") };
}
