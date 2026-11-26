// Mode « Progresser sur de nouveaux champions » : classement des champions de jungle par potentiel, champions de
// confort, tes choix par champion, et repère « prêt pour la classée ». Fonctions pures.
import type { Radar } from "../analysis/radar.ts";
import {
  ceiling, forceAtEqualMastery, learningCurve, potentialScore, strengthFit, axisImpact, difficultyGroup,
  type AxisGame, type Ceiling, type Fit, type Force, type MasteryRow, type PotentialScore,
} from "./progress.ts";

/** « Déjà beaucoup joué » : confort (sauf si tu veux progresser dessus). */
export const COMFORT_GAMES = 50;
export const COMFORT_POINTS = 150_000;
/** Candidat : assez de parties de méta pour une force, ou des parties à toi sur le champion. */
export const CANDIDATE_META_MIN = 30;
export const CANDIDATE_MINE_MIN = 5;

export type ChampionFlag = "notForMe" | "progress";
export const FLAG_LABEL: Record<ChampionFlag, string> = { notForMe: "Pas pour moi", progress: "Je veux progresser dessus" };

/** Files aux règles standard de la Faille : seules leurs parties comptent dans les stats (Solo/Duo, flexible, draft). */
export const STANDARD_QUEUES = new Set([400, 420, 440]);
/** Parties sur la Faille, toutes files (expérience sur le champion, y compris parties rapides et accélérées). */
export const RIFT_QUEUES = new Set([400, 420, 430, 440, 480, 490, 700]);

export interface ProgressInputs {
  metaRates: Map<number, { n: number; w: number }>;
  mastery: MasteryRow[];
  difficulty: (championId: number) => number;
  /** Parties de méta (référence choisie) avec leur position sur chaque axe, par champion. */
  axisGames: Map<number, AxisGame[]>;
  /** Ton radar en jungle (saison en cours) : tes axes forts. */
  myRadar: Radar | null;
  /** Tes résultats en jungle par champion (saison en cours et précédente). */
  mine: Map<number, { games: number; wins: number; radar: Radar | null }>;
  /** Tes parties classées par champion (deux saisons, tous rôles) et tes points de maîtrise (comptes cumulés). */
  played: Map<number, number>;
  points: Map<number, number>;
  excluded: Set<number>;
  flags: Map<number, ChampionFlag>;
  tau: number;
  ratio?: number;
}

export interface ProgressEntry {
  championId: number;
  score: PotentialScore;
  force: Force;
  fit: Fit;
  ceiling: Ceiling;
  difficulty: number;
  flag: ChampionFlag | null;
}
export interface ComfortEntry { championId: number; games: number; wins: number; stats: number | null; margin: number | null; reason: string; flag: ChampionFlag | null }
export interface Progression { candidates: ProgressEntry[]; comfort: ComfortEntry[]; notForMe: number[] }

export const isComfort = (c: number, played: Map<number, number>, points: Map<number, number>) => (played.get(c) ?? 0) >= COMFORT_GAMES || (points.get(c) ?? 0) >= COMFORT_POINTS;

export function progression(inp: ProgressInputs): Progression {
  const all = [...inp.axisGames.values()].flat();
  const allImpact = axisImpact(all, inp.myRadar?.values.length ?? 6);
  const champs = new Set([...inp.metaRates.keys(), ...inp.mine.keys()]);
  const candidates: ProgressEntry[] = [], comfort: ComfortEntry[] = [], notForMe: number[] = [];
  for (const c of champs) {
    if (inp.excluded.has(c)) continue;
    const flag = inp.flags.get(c) ?? null;
    if (flag === "notForMe") { notForMe.push(c); continue; }
    const my = inp.mine.get(c);
    // Confort (jungle) : seulement des champions que tu as joués en jungle ; sinon, candidat comme les autres.
    if (isComfort(c, inp.played, inp.points) && flag !== "progress" && (my?.games ?? 0) > 0) {
      const games = inp.played.get(c) ?? 0, pts = inp.points.get(c) ?? 0;
      comfort.push({ championId: c, games: my?.games ?? 0, wins: my?.wins ?? 0, stats: my?.radar?.score ?? null, margin: my?.radar?.margin ?? null, flag,
        reason: games >= COMFORT_GAMES ? `${games} parties classées sur deux saisons` : `${Math.round(pts / 1000)} k points de maîtrise` });
      continue;
    }
    const meta = inp.metaRates.get(c) ?? { n: 0, w: 0 };
    if (meta.n < CANDIDATE_META_MIN && (my?.games ?? 0) < CANDIDATE_MINE_MIN) continue;
    const g = difficultyGroup(inp.difficulty(c));
    const groupRows = inp.mastery.filter((r) => difficultyGroup(inp.difficulty(r.championId)) === g);
    const champRows = inp.mastery.filter((r) => r.championId === c);
    const force = forceAtEqualMastery(meta, champRows, groupRows);
    const fit = strengthFit(inp.myRadar?.values ?? [], axisImpact(inp.axisGames.get(c) ?? [], inp.myRadar?.values.length ?? 6), allImpact);
    const parts = { force, fit, curve: learningCurve(champRows, groupRows), ceiling: ceiling(champRows, inp.mastery.filter((r) => r.championId !== c)) };
    const mine = my?.radar?.score != null ? { stats: my.radar.score, margin: my.radar.margin ?? 20, games: my.games } : null;
    candidates.push({ championId: c, score: potentialScore(parts, mine, { tau: inp.tau, ratio: inp.ratio }), force, fit, ceiling: parts.ceiling, difficulty: inp.difficulty(c), flag });
  }
  // « Je veux progresser dessus » d'abord (il prend une des 2 places du pool de progression, même classé plus bas),
  // puis le score.
  candidates.sort((a, b) => (b.flag === "progress" ? 1 : 0) - (a.flag === "progress" ? 1 : 0) || b.score.total - a.score.total);
  comfort.sort((a, b) => b.games - a.games);
  return { candidates, comfort, notForMe };
}

// ---------- Repère « prêt pour la classée » ----------

export type Stage = "learning" | "keepPracticing" | "readyToTest" | "confirmed" | "backToNormal" | "toConfirm";
export const STAGE_LABEL: Record<Stage, string> = {
  learning: "En apprentissage", keepPracticing: "Continuer en normale", readyToTest: "Prêt à tester en classée",
  confirmed: "Confirmé", backToNormal: "Retour en normale conseillé", toConfirm: "À confirmer",
};
export const READY_GAMES = 20;

/**
 * Deux temps, sans trou :
 *   - au moins 20 parties classées sur le champion : score en classée ≥ 50 → Confirmé ; score + marge < 50 → Retour
 *     en normale conseillé ; sinon À confirmer ;
 *   - sinon, au moins 20 parties sur la Faille (normales comprises) et score ≥ 50 sur les parties aux règles standard
 *     (classées et normales en draft), sans compter la marge → Prêt à tester en classée ;
 *   - sinon, 20 parties ou plus mais score < 50 → Continuer en normale ; moins de 20 parties → En apprentissage.
 * L'estimation tirée des courbes de la méta n'est qu'un point de départ : dès que tu as des parties, c'est ce repère
 * sur tes stats qui décide.
 */
export function readiness(x: { experience: number; standard: Radar | null; ranked: Radar | null; rankedGames: number }): { stage: Stage; text: string } {
  const f1 = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const st = (r: Radar | null) => (r?.score != null ? `stats ${f1(r.score)}${r.margin != null ? ` ± ${f1(r.margin)}` : ""}` : "stats pas encore disponibles");
  if (x.rankedGames >= READY_GAMES && x.ranked?.score != null) {
    const s = x.ranked.score, m = x.ranked.margin ?? 0;
    if (s >= 50) return { stage: "confirmed", text: `${x.rankedGames} parties classées, ${st(x.ranked)} (≥ 50) : confirmé en classée.` };
    if (s + m < 50) return { stage: "backToNormal", text: `${x.rankedGames} parties classées, ${st(x.ranked)} : nettement sous la médiane, retour en normale conseillé.` };
    return { stage: "toConfirm", text: `${x.rankedGames} parties classées, ${st(x.ranked)} : sous 50, mais dans la marge ; à confirmer.` };
  }
  if (x.experience >= READY_GAMES && x.standard?.score != null && x.standard.score >= 50) {
    return { stage: "readyToTest", text: `${x.experience} parties sur la Faille, ${st(x.standard)} (≥ 50) : prêt à tester en classée.` };
  }
  if (x.experience >= READY_GAMES) return { stage: "keepPracticing", text: `${x.experience} parties sur la Faille, ${st(x.standard)} (< 50) : continuer en normale.` };
  return { stage: "learning", text: `${x.experience}/${READY_GAMES} parties sur la Faille (normales comprises), ${st(x.standard)}.` };
}

// ---------- Pool conseillé en mode « Progresser » ----------

export interface AdviceLite { picks: { championId: number; why: string[]; fromMeta: boolean; provisional: boolean; short: string }[]; coverage: null; fromMeta: boolean; text: string }

/**
 * 2 champions de progression (les mieux classés, hors confort et « Pas pour moi ») et 1 champion de confort : ton
 * meilleur « À garder » (par score du pool), même sous le seuil « déjà beaucoup joué ».
 */
export function progressAdvice(p: Progression, keep: { championId: number; games: number }[], firstPool: number | null): AdviceLite {
  const f1 = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const banned = new Set(p.notForMe);
  const prog = p.candidates.slice(0, 2);
  const used = new Set(prog.map((e) => e.championId));
  const comfortId = keep.find((k) => !banned.has(k.championId) && !used.has(k.championId))?.championId ?? (firstPool != null && !used.has(firstPool) && !banned.has(firstPool) ? firstPool : null);
  const picks = prog.map((e) => ({
    championId: e.championId, fromMeta: false, provisional: !e.force.mixMeasured || (e.score.mine?.games ?? 0) < 20,
    // Une ligne : seulement ce qui est net (force et accord au-delà de leur marge).
    short: `À faire progresser${[...(e.force.adjusted - e.force.margin > 50 ? ["fort en ce moment"] : []), ...(e.fit.value - e.fit.margin > 0 ? ["colle à tes points forts"] : [])].map((x, i) => (i ? `, ${x}` : ` : ${x}`)).join("")}.`,
    why: [
      `Progression · potentiel ${f1(e.score.total)}`,
      `force à maîtrise égale ${f1(e.force.adjusted)} %${e.force.mixMeasured ? "" : " (à confirmer)"}`,
      `accord avec tes axes forts ${e.fit.value >= 0 ? "+" : "−"}${f1(Math.abs(e.fit.value))} ± ${f1(e.fit.margin)} pts`,
      ...(e.score.mine ? [`tes stats ${f1(e.score.mine.stats)} sur ${e.score.mine.games} parties (poids ${Math.round(e.score.mine.weight * 100)} %)`] : []),
      ...(e.flag === "progress" ? ["choisi par toi"] : []),
    ],
  }));
  if (comfortId != null) {
    const k = keep.find((x) => x.championId === comfortId);
    picks.push({ championId: comfortId, fromMeta: false, provisional: false, short: "Confort : pour les parties où tu veux gagner.", why: [`Confort · ton meilleur « À garder »${k ? ` (${k.games} parties)` : ""}`, "pour les parties où tu veux gagner tout de suite"] });
  }
  return {
    picks, coverage: null, fromMeta: false,
    text: "Objectif « Progresser » : deux champions à fort potentiel pour toi (force à maîtrise égale 55 %, accord avec tes axes forts 45 % ; tes stats sur le champion y comptent de plus en plus avec tes parties, moitié-moitié à 20 parties) et un champion de confort. Joue les champions de progression en normale jusqu'au repère « Prêt à tester en classée » (Progresser).",
  };
}
