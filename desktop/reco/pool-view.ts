// Mon pool : un seul système de recommandation de champions, qui respecte partout « Pas pour moi » et « Je veux
// progresser dessus ». Trois groupes, une ligne par champion (le détail chiffré est replié) :
//   - À faire progresser : tes choix « Je veux progresser dessus » (2 au plus ; au-delà, l'appli te le signale) ;
//   - Confort : tes champions déjà maîtrisés, pour gagner tout de suite ;
//   - À essayer : les mieux classés pour toi (jungle : potentiel ; milieu : méta et ressemblance), hors des deux autres.
// Un champion « Pas pour moi » n'apparaît dans aucun groupe. Fonction pure.
import type { ChampionFlag, ComfortEntry, ProgressEntry, Stage } from "./progression.ts";
import type { PoolPick, TryPick } from "./recommend.ts";
import type { PotentialEntry } from "./potential.ts";

export const MAX_PROGRESS = 2;

export interface PoolEntry { championId: number; line: string; details: string[] }
export interface PoolView {
  role: string;
  progress: PoolEntry[];
  /** Plus de champions de progression que le maximum : à réduire. */
  tooMany: boolean;
  comfort: PoolEntry[];
  toTry: PoolEntry[];
  notForMe: number[];
}

const STAGE_LINE: Record<Stage, string> = {
  learning: "En apprentissage : joue-le en normale.",
  keepPracticing: "Continue en normale : tes stats ne suivent pas encore.",
  readyToTest: "Prêt à tester en classée.",
  confirmed: "Confirmé en classée.",
  toConfirm: "À confirmer en classée.",
  backToNormal: "Retour en normale conseillé.",
};

const f1 = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Une ligne : seulement ce qui est net (force et accord avec tes axes au-delà de leur marge), et la difficulté Riot. */
export function candidateLine(e: ProgressEntry): string {
  const parts = [
    ...(e.force.adjusted - e.force.margin > 50 ? ["fort en ce moment"] : []),
    ...(e.fit.value - e.fit.margin > 0 ? ["colle à tes points forts"] : []),
    ...(e.difficulty <= 4 ? ["facile à prendre en main"] : e.difficulty >= 8 ? ["difficile à prendre en main"] : []),
  ];
  const t = parts.length ? parts.join(", ") : "bien classé sur l'ensemble des critères, sans point net";
  return `${t[0].toUpperCase()}${t.slice(1)}.`;
}
const candidateDetails = (e: ProgressEntry): string[] => [
  `Potentiel ${f1(e.score.total)} · force à maîtrise égale ${f1(e.force.adjusted)} % (brut ${f1(e.force.raw)} % ± ${f1(e.force.margin)} sur ${e.force.games} parties) · accord avec tes axes forts ${e.fit.value >= 0 ? "+" : "−"}${f1(Math.abs(e.fit.value))} ± ${f1(e.fit.margin)} pts · difficulté Riot ${e.difficulty}/10.`,
  ...(e.score.mine ? [`Toi : ${e.score.mine.games} parties, stats ${f1(e.score.mine.stats)}.`] : []),
];

export interface PoolViewInput {
  role: string;
  flags: Map<number, ChampionFlag>;
  /** Jungle : repère des champions de progression, classement par potentiel et confort. */
  tracking?: { championId: number; stage: Stage; text: string }[];
  candidates?: ProgressEntry[];
  comfort?: ComfortEntry[];
  /** Tes champions « À garder » (classement par potentiel), en secours pour le confort. */
  keep: PotentialEntry[];
  pool: PoolPick[];
  /** Milieu : « À essayer » de la méta. */
  tryList: TryPick[];
}

export function poolView(x: PoolViewInput): PoolView {
  const notForMe = [...x.flags].filter(([, f]) => f === "notForMe").map(([c]) => c);
  const banned = new Set(notForMe);
  const progressIds = [...x.flags].filter(([, f]) => f === "progress").map(([c]) => c);
  const track = new Map((x.tracking ?? []).map((t) => [t.championId, t]));
  const progress: PoolEntry[] = progressIds.map((c) => {
    const t = track.get(c);
    return { championId: c, line: t ? STAGE_LINE[t.stage] : "Choisi par toi.", details: t ? [t.text] : [] };
  });
  const used = new Set([...banned, ...progressIds]);

  // Confort : tes plus joués (hors « Pas pour moi »), sinon ton meilleur « À garder », sinon ton meilleur du pool.
  const comfort: PoolEntry[] = [];
  for (const c of (x.comfort ?? []).filter((c) => !used.has(c.championId)).sort((a, b) => b.games - a.games).slice(0, 2)) {
    comfort.push({ championId: c.championId, line: "Tu le maîtrises : pour gagner tout de suite.", details: [`${c.games} parties en jungle · ${c.reason}${c.stats != null ? ` · stats ${f1(c.stats)}${c.margin != null ? ` ± ${f1(c.margin)}` : ""}` : ""}.`] });
    used.add(c.championId);
  }
  for (const k of x.keep) {
    if (comfort.length >= 2) break;
    if (used.has(k.championId)) continue;
    comfort.push({ championId: k.championId, line: k.short, details: [k.text] });
    used.add(k.championId);
  }
  for (const p of x.pool) {
    if (comfort.length >= 1) break;
    if (used.has(p.championId)) continue;
    comfort.push({ championId: p.championId, line: "Ton meilleur champion restant dans ce rôle.", details: p.reasons });
    used.add(p.championId);
  }

  // À essayer : jungle d'après le classement par potentiel ; milieu d'après « À essayer » de la méta.
  const toTry: PoolEntry[] = x.candidates
    ? x.candidates.filter((e) => !used.has(e.championId)).slice(0, 3).map((e) => ({ championId: e.championId, line: candidateLine(e), details: candidateDetails(e) }))
    : x.tryList.filter((t) => !used.has(t.championId)).slice(0, 3).map((t) => ({ championId: t.championId, line: t.short, details: t.reasons }));

  return { role: x.role, progress, tooMany: progress.length > MAX_PROGRESS, comfort, toTry, notForMe };
}
