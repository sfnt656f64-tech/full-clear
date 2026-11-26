// Plan de partie écrit en draft, pour n'importe quel champion : condition de victoire des deux compos, moments de
// force, jungler adverse, premier chemin et objectifs à prioriser, et tes rappels personnels. Tout est calculé AVANT
// la partie, à partir des champions visibles par tous et de la méta ; les « si… alors… » sont à appliquer toi-même.
// Rien ne réagit à ce qui se passe en jeu (règles Riot). Fonctions pures.
import { champByKey } from "../../src/data/champions";
import type { Champion } from "../../src/data/types";
import { mobility } from "../../src/data/mobility";
import type { MetaPartRow } from "../meta/meta-stats.ts";
import { pairEffects, type PairIndex } from "../reco/draft-pick.ts";
import { LANE_LABELS, type Lane } from "../reco/lanes.ts";
import type { GamePlan } from "./game-plan.ts";

/** Parties courtes (< 25 min) et longues (≥ 32 min), comme le profil de jeu. */
const SHORT_S = 25 * 60, LONG_S = 32 * 60;
/** Parties minimales pour citer un duel (pas de conclusion en dessous). */
const DUEL_MIN = 20;

const f1 = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sgn = (n: number) => `${n >= 0 ? "+" : "−"}${f1(Math.abs(n))}`;
const wilson = (w: number, n: number) => {
  if (!n) return 100;
  const z = 1.96, p = w / n, d = 1 + z * z / n;
  return ((z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d) * 100;
};

export interface Timing { champion: number; lane: Lane; games: number; diff: number; margin: number }

/** Écart de win rate parties courtes − longues d'un champion dans son rôle (méta), avec sa marge. */
export function timing(parts: MetaPartRow[], championId: number, role: string, lane: Lane): Timing | null {
  const rows = parts.filter((p) => p.championId === championId && p.role === role && (p.durationS ?? 0) > 0);
  const short = rows.filter((r) => r.durationS! < SHORT_S), long = rows.filter((r) => r.durationS! >= LONG_S);
  if (short.length < DUEL_MIN || long.length < DUEL_MIN) return null;
  const sw = short.filter((r) => r.win).length, lw = long.filter((r) => r.win).length;
  return { champion: championId, lane, games: rows.length, diff: (sw / short.length - lw / long.length) * 100, margin: Math.hypot(wilson(sw, short.length), wilson(lw, long.length)) };
}

export interface TeamProfile {
  /** Écart moyen parties courtes − longues (points), sa marge, et les champions mesurés. */
  early: number | null; earlyMargin: number; measured: number;
  /** Contrôle de foule cumulé (0–3 par champion) et champions capables d'engager (contrôle ≥ 2, mêlée). */
  cc: number; engagers: string[];
  /** Champions de split-push possibles (combattants mobiles en top). */
  splitters: string[];
  /** Champions les plus marqués « early » ou « fin de partie » (écart net, hors marge). */
  earlyChamps: string[]; lateChamps: string[];
  /** Les mêmes, avec leur rôle et leur écart (pour des « si… alors… » concrets). */
  marked: { name: string; lane: Lane; diff: number; margin: number }[];
}

export interface Reminder { key: string; text: string }

export interface StrategyInput {
  me: { championId: number; lane: Lane };
  /** Champions par rôle : tes alliés (toi compris) et tes adversaires (rôle probable). */
  allies: Partial<Record<Lane, number>>;
  enemies: Partial<Record<Lane, number>>;
  side: "blue" | "red" | null;
  metaParts: MetaPartRow[];
  index: PairIndex;
  /** Plan d'avant-partie du jungler (chance de gank, départ), si tu joues jungle. */
  plan: GamePlan | null;
  reminders: Reminder[];
  /** Tous les picks connus ? Sinon le plan est provisoire. */
  complete: boolean;
}

export interface Strategy {
  provisional: boolean;
  ours: TeamProfile; theirs: TeamProfile;
  /** Condition de victoire : une phrase de synthèse, puis des « si… alors… ». */
  winCondition: { summary: string; ifThen: string[] };
  /** Moments de force des deux équipes. */
  power: string[];
  /** Jungler adverse : fort en début de partie ou non, ton duel contre lui. */
  enemyJungler: string | null;
  /** Premier chemin et côté (jungle). */
  path: string[];
  /** Objectifs à prioriser. */
  objectives: string[];
  reminders: Reminder[];
}

/** « le top », « l'ADC »… (article compris). */
const THE: Record<Lane, string> = { TOP: "le top", JUNGLE: "le jungler", MIDDLE: "le mid", BOTTOM: "l'ADC", UTILITY: "le support" };
const YOUR: Record<Lane, string> = { TOP: "ton top", JUNGLE: "ton jungler", MIDDLE: "ton mid", BOTTOM: "ton ADC", UTILITY: "ton support" };
const ROLE: Record<Lane, string> = { TOP: "TOP", JUNGLE: "JUNGLE", MIDDLE: "MIDDLE", BOTTOM: "BOTTOM", UTILITY: "UTILITY" };
const name = (id: number) => champByKey(id)?.name ?? `#${id}`;

function team(parts: MetaPartRow[], byLane: Partial<Record<Lane, number>>): TeamProfile {
  const entries = (Object.entries(byLane) as [Lane, number][]).filter(([, id]) => id);
  const t = entries.map(([lane, id]) => timing(parts, id, ROLE[lane], lane)).filter((x): x is Timing => !!x);
  const champs = entries.map(([lane, id]) => ({ lane, id, c: champByKey(id) })).filter((x): x is { lane: Lane; id: number; c: Champion } => !!x.c);
  return {
    early: t.length ? t.reduce((s, x) => s + x.diff, 0) / t.length : null,
    earlyMargin: t.length ? Math.sqrt(t.reduce((s, x) => s + x.margin ** 2, 0)) / t.length : 0,
    measured: t.length,
    cc: champs.reduce((s, x) => s + x.c.cc, 0),
    engagers: champs.filter((x) => x.c.cc >= 2 && x.c.range === "melee").map((x) => x.c.name),
    splitters: champs.filter((x) => x.lane === "TOP" && x.c.profile === "fighter" && mobility(x.c.id) >= 2).map((x) => x.c.name),
    earlyChamps: t.filter((x) => x.diff - x.margin > 0).map((x) => name(x.champion)),
    lateChamps: t.filter((x) => x.diff + x.margin < 0).map((x) => name(x.champion)),
    marked: t.filter((x) => Math.abs(x.diff) > x.margin).map((x) => ({ name: name(x.champion), lane: x.lane, diff: x.diff, margin: x.margin })),
  };
}

/** Duel de lane en méta (au moins 20 parties, écart au-delà de la marge), ou null. */
function duel(index: PairIndex, ally: number | undefined, enemy: number | undefined, lane: Lane): { wr: number; n: number; margin: number; base: number } | null {
  if (!ally || !enemy) return null;
  const e = pairEffects(index, ally, ROLE[lane], [enemy], "enemy")[0];
  if (!e || e.games < DUEL_MIN) return null;
  const m = wilson(Math.round((e.winRate / 100) * e.games), e.games);
  return Math.abs(e.winRate - e.base) > m ? { wr: e.winRate, n: e.games, margin: m, base: e.base } : null;
}

export function strategy(inp: StrategyInput): Strategy {
  const ours = team(inp.metaParts, inp.allies), theirs = team(inp.metaParts, inp.enemies);
  const ifThen: string[] = [];
  // ----- Condition de victoire (sans trou : début de partie, fin de partie, ou pas d'écart net) -----
  let summary: string;
  if (ours.early != null && theirs.early != null) {
    const gap = ours.early - theirs.early, m = Math.hypot(ours.earlyMargin, theirs.earlyMargin);
    if (gap > m) {
      summary = `Ton équipe est plus forte en début de partie (écart parties courtes − longues ${sgn(ours.early)} contre ${sgn(theirs.early)} pts, marge ± ${f1(m)}) : gagne avant 25 min.`;
      ifThen.push("Si ton équipe prend l'avance avant 15 min : enchaîne les objectifs (dragon, larves, héraut) pendant qu'elle est forte.");
      ifThen.push("Si la partie traîne au-delà de 30 min sans avance : évite les combats à 5 contre 5 ouverts, cherche les picks.");
    } else if (gap < -m) {
      summary = `Leur équipe est plus forte en début de partie (${sgn(theirs.early)} contre ${sgn(ours.early)} pts, marge ± ${f1(m)}) : ton équipe gagne en fin de partie, sans se faire distancer avant.`;
      ifThen.push("Si ils prennent un objectif avant 15 min : prends une contrepartie (autre objectif, tour) plutôt qu'un combat perdu d'avance.");
      ifThen.push("Si tu arrives à 25 min sans grand retard : c'est ton équipe qui a l'avantage, joue les combats groupés.");
    } else {
      // Pas d'écart net entre les équipes : les champions nettement marqués donnent le plan.
      const keys = [...ours.marked.map((x) => ({ ...x, mine: true })), ...theirs.marked.map((x) => ({ ...x, mine: false }))];
      summary = `Pas d'écart net entre les deux équipes sur le début ou la fin de partie (${sgn(ours.early)} contre ${sgn(theirs.early)} pts, marge ± ${f1(m)})`
        + (keys.length ? ` : la partie se joue sur ${keys.map((x) => `${x.name} (${x.mine ? "chez toi" : "en face"}, pic ${x.diff > 0 ? "en début" : "en fin"} de partie)`).join(", ")}.` : " ni de champion nettement marqué : la partie se jouera sur l'exécution.");
    }
    // Champions nettement marqués : quoi faire, écrit à l'avance.
    for (const x of theirs.marked) {
      if (x.diff > 0) ifThen.push(`${x.name} (${LANE_LABELS[x.lane]}, en face) a son pic en début de partie : ${x.lane === inp.me.lane ? "pas de combat à niveau égal avant tes premiers items" : x.lane === "JUNGLE" ? "évite de le croiser seul avant 10 min" : `si ${YOUR[x.lane]} perd ses premiers échanges, couvre-le plutôt que de ganker ailleurs`}.`);
      else ifThen.push(`${x.name} (${LANE_LABELS[x.lane]}, en face) monte en puissance en fin de partie : ${x.lane === "JUNGLE" ? "prends-lui des camps tôt, du côté où tes laners ont la priorité" : `c'est la lane à faire tomber tôt : si ${THE[x.lane]} est gankable avant 10 min, priorise-la`}.`);
    }
    for (const x of ours.marked) {
      if (x.diff > 0) ifThen.push(`${x.name} (${LANE_LABELS[x.lane]}, chez toi) a son pic en début de partie : ${x.lane === inp.me.lane ? "joue agressif avant tes 2 premiers items" : `si ${YOUR[x.lane]} prend l'avance, joue autour de lui pour les premiers objectifs`}.`);
      else ifThen.push(`${x.name} (${LANE_LABELS[x.lane]}, chez toi) monte en puissance en fin de partie : ${x.lane === inp.me.lane ? "farme et évite les combats risqués avant tes items" : "protège-le en début de partie, c'est lui qui portera la fin"}.`);
    }
  } else {
    summary = "Pas assez de parties de méta pour comparer le début et la fin de partie des deux compos.";
  }
  if (ours.engagers.length > theirs.engagers.length) ifThen.push(`Si un combat groupé se prépare autour d'un objectif : ton équipe a plus d'engage (${ours.engagers.join(", ")}) ; c'est à elle de lancer.`);
  else if (theirs.engagers.length > ours.engagers.length) ifThen.push(`Si leur équipe se regroupe : elle a plus d'engage (${theirs.engagers.join(", ")}) ; évite de te placer devant sans vision.`);
  if (ours.splitters.length) ifThen.push(`Si la partie est bloquée en milieu de partie : ${ours.splitters.join(", ")} peut faire pression seul en side lane.`);
  if (theirs.splitters.length) ifThen.push(`Si ${theirs.splitters.join(", ")} part seul en side lane : ne le laisse pas prendre des tours gratuitement, mais n'y va pas seul.`);

  // ----- Moments de force -----
  const power: string[] = [];
  const pw = (t: TeamProfile, who: string) => {
    const parts = [
      t.earlyChamps.length ? `forts en début de partie : ${t.earlyChamps.join(", ")}` : "",
      t.lateChamps.length ? `forts en fin de partie : ${t.lateChamps.join(", ")}` : "",
    ].filter(Boolean);
    power.push(`${who} : ${parts.length ? parts.join(" ; ") : "aucun champion nettement marqué early ou fin de partie"} (${t.measured}/5 champions mesurés).`);
  };
  pw(ours, "Ton équipe"); pw(theirs, "Leur équipe");

  // ----- Jungler adverse -----
  let enemyJungler: string | null = null;
  const ej = inp.enemies.JUNGLE;
  if (ej) {
    const t = timing(inp.metaParts, ej, "JUNGLE", "JUNGLE");
    const d = inp.me.lane === "JUNGLE" ? duel(inp.index, inp.me.championId, ej, "JUNGLE") : null;
    const strong = t ? (t.diff - t.margin > 0 ? "fort en début de partie" : t.diff + t.margin < 0 ? "plutôt fort en fin de partie" : "sans pic net en début de partie") : "pas assez de parties de méta pour le dire";
    enemyJungler = `${name(ej)} : ${strong}${t ? ` (${sgn(t.diff)} ± ${f1(t.margin)} pts parties courtes − longues)` : ""}.`
      + (d ? ` Ton duel contre lui : ${f1(d.wr)} % ± ${f1(d.margin)} sur ${d.n} parties en Émeraude+ (contre ${f1(d.base)} % d'habitude) : ${d.wr > d.base ? "tu peux accepter le combat à niveau égal" : "évite le combat à niveau égal"}.` : inp.me.lane === "JUNGLE" ? " Ton duel contre lui : pas d'écart net en méta." : "")
      + (t && t.diff - t.margin > 0 ? " Si tu le perds de vue avant 6 min : surveille les lanes de ton côté et ton jungle." : "");
  }

  // ----- Premier chemin et côté (jungle) -----
  const path: string[] = [];
  if (inp.me.lane === "JUNGLE" && inp.plan) {
    const p = inp.plan, lane = p.firstGank;
    const sideOfLane = lane === "TOP" ? "top" : lane === "BOTTOM" ? "bot" : null;
    const g = p.lanes.find((l) => l.lane === lane);
    const majority = p.start.topShare != null ? (p.start.topShare >= 50 ? "top" : "bot") : null;
    const why = sideOfLane && sideOfLane !== p.start.side ? `pour finir ton premier tour de camps côté ${sideOfLane}, près de ton premier gank` : "";
    path.push(`Départ côté ${p.start.side}${p.start.buff ? ` (${p.start.buff})` : ""}${why ? `, ${why}` : ""}`
      + (p.start.topShare != null ? ` (${majority === p.start.side ? "comme" : "contrairement à"} la majorité : ${Math.round(majority === "top" ? p.start.topShare : 100 - p.start.topShare)} % des joueurs Émeraude+ de ton champion commencent côté ${majority}).` : "."));
    // Raisons du plan ; un « duel » n'est cité que s'il est net (au-delà de la marge, 20 parties), comme partout ailleurs.
    const netDuel = duel(inp.index, inp.allies[lane], inp.enemies[lane], lane);
    const reasons = (g?.reasons ?? []).filter((r) => !/ce duel/.test(r) || netDuel);
    path.push(`Premier gank visé : ${LANE_LABELS[lane]} (chance estimée ${Math.round(g?.chance ?? 0)} %${reasons.length ? ` : ${reasons.join(", ")}` : ""}), à la fin de ton premier tour de camps.`);
    path.push("Si la lane n'est pas gankable à ce moment-là (vague poussée vers leur tour, adversaire en pleine vie avec Flash) : ne force pas, prends tes camps ou va de l'autre côté.");
  }

  // ----- Objectifs à prioriser -----
  const objectives: string[] = [];
  const top = duel(inp.index, inp.allies.TOP, inp.enemies.TOP, "TOP");
  const bot = duel(inp.index, inp.allies.BOTTOM, inp.enemies.BOTTOM, "BOTTOM");
  const fmtDuel = (d: NonNullable<ReturnType<typeof duel>>, lane: Lane) => `${LANE_LABELS[lane]} ${d.wr > d.base ? "favorable" : "défavorable"} (${f1(d.wr)} % ± ${f1(d.margin)} sur ${d.n} parties, ${f1(d.base)} % d'habitude)`;
  if (bot && bot.wr > bot.base) objectives.push(`Dragons d'abord : ${fmtDuel(bot, "BOTTOM")}, ta bot lane peut t'accompagner.`);
  if (top && top.wr > top.base) objectives.push(`Larves et héraut : ${fmtDuel(top, "TOP")}, ton top peut t'y rejoindre.`);
  if (bot && bot.wr < bot.base) objectives.push(`Dragon : ${fmtDuel(bot, "BOTTOM")} ; si ils le prennent, prends une contrepartie de l'autre côté.`);
  if (top && top.wr < top.base) objectives.push(`Larves : ${fmtDuel(top, "TOP")} ; ne les conteste pas sans ton top.`);
  if (!objectives.length) {
    // Pas de duel net : l'objectif du côté de ton premier gank (tu y seras déjà), sinon celui de ta lane forte en début de partie.
    const side = inp.plan?.firstGank === "TOP" ? "les larves (côté top)" : inp.plan?.firstGank === "BOTTOM" ? "le premier dragon (côté bot)" : null;
    objectives.push(side ? `Aucun duel de lane net en méta (top et bot) : vise d'abord ${side}, du côté de ton premier gank, où tu seras déjà.` : "Aucun duel de lane net en méta : priorise l'objectif du côté où tes laners ont la priorité à ce moment-là.");
  }

  return { provisional: !inp.complete, ours, theirs, winCondition: { summary, ifThen: ifThen.slice(0, 5) }, power, enemyJungler, path, objectives: objectives.slice(0, 4), reminders: inp.reminders };
}

/** Tes rappels personnels, tirés de tes objectifs de la semaine (valeur récente et cible). */
export function remindersFrom(goals: { key: string; label: string; unit: string; better: "+" | "-"; target: number; value: number | null; n: number }[]): Reminder[] {
  const fmt = (v: number, unit: string) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: unit.trim() === "%" ? 0 : 1 })}${unit}`;
  const TEXT: Record<string, string> = {
    uncompensatedEarly: "Ne cède pas d'objectif avant 15 min sans contrepartie : s'ils prennent un dragon ou les larves, prends l'autre côté ou une tour.",
    deathsBeforeObj: "Ne meurs pas dans la minute avant un objectif adverse : place-toi avec vision, ou recule.",
    cs10: "CS à 10 min : finis tes camps entre deux actions plutôt que d'attendre.",
  };
  return goals.filter((g) => TEXT[g.key]).map((g) => ({
    key: g.key,
    text: `${TEXT[g.key]} (${g.label} : ${g.value != null ? `${fmt(g.value, g.unit)} sur tes ${g.n} dernières parties` : "pas encore de mesure"}, cible ${g.better === "-" ? "≤" : "≥"} ${fmt(g.target, g.unit)}.)`,
  }));
}
