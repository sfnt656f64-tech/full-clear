// Ce qu'une partie t'apprend : le récit de CETTE partie, appuyé sur ses faits précis (minutes, morts, objectifs),
// puis des repères face aux joueurs Diamant+ (ou Émeraude+) sur le même champion, et ton build. Fonctions pures.
//
// Ce que la chronologie permet : positions une fois par minute, kills et morts avec leur position et les joueurs
// impliqués, objectifs, achats, niveaux, or. Ce qu'elle ne permet pas : le nombre d'alliés présents dans un combat
// (seulement ceux qui ont tué, aidé ou sont morts), la vision, les sorts. Quand une information manque, l'analyse le dit.
import { champByKey } from "../../src/data/champions";
import itemIndex from "../../src/data/generated/item-index.json";
import { SHOP } from "../next-item.ts";
import type { Detail } from "../collector/detail.ts";
import { compensated } from "./goals.ts";

const MIN = 60_000;
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const mmss = (ms: number) => `${Math.floor(ms / MIN)}:${String(Math.floor((ms % MIN) / 1000)).padStart(2, "0")}`;
const name = (id: number) => champByKey(id)?.name ?? "un adversaire";
const fmtGold = (g: number) => `${g >= 0 ? "+" : "−"}${(Math.round(Math.abs(g) / 100) * 100).toLocaleString("fr-FR")}`;
const INDEX = itemIndex as Record<string, { kind: string }>;
const itemName = (id: string) => SHOP[id]?.nameFr ?? SHOP[id]?.name ?? id;

const OBJ: Record<string, string> = { DRAGON: "dragon", HORDE: "larves du Néant", RIFTHERALD: "Héraut", BARON_NASHOR: "Nashor", ATAKHAN: "Atakhan" };
const BIG = new Set(["DRAGON", "BARON_NASHOR", "RIFTHERALD", "ATAKHAN", "ELDER_DRAGON"]);

/** Zone d'une position : lane, rivière, ta jungle ou la jungle adverse (carte de 14 700 unités, équipe bleue en bas à gauche). */
export function zone(x: number, y: number, team: number): "lane" | "river" | "ownJungle" | "enemyJungle" {
  const top = x < 2600 || y > 12200, bot = x > 12200 || y < 2600, mid = Math.abs(x - y) < 1400;
  if (top || bot || mid) return "lane";
  if (Math.abs(x + y - 14_700) < 1600) return "river";
  const blueHalf = x + y < 14_700;
  return blueHalf === (team === 100) ? "ownJungle" : "enemyJungle";
}

export interface DeathFact {
  t: number; killer: number; enemies: number;
  /** Un allié a tué, aidé ou est mort à moins de 15 s : il était dans le combat. Sinon : mort seul. */
  allyInFight: boolean;
  /** Objectif adverse dans la minute qui suit. */
  objAfter: { t: number; label: string } | null;
  zone: ReturnType<typeof zone>;
}
export interface GameFacts {
  win: boolean; durationMs: number; me: number; team: number; championId: number; opponent: number | null;
  /** Écart d'or d'équipe à chaque minute (ton équipe − l'autre). */
  teamGold: number[];
  deaths: DeathFact[];
  kills: { t: number; victim: number; solo: boolean; objAfter: { t: number; label: string } | null }[];
  objectives: { t: number; ours: boolean; type: string; label: string; byMe: boolean; uncompensated: boolean }[];
  /** Premier achat après 1:30 (retour en base), et l'or gagné à ce moment (approché à la minute). */
  firstBack: { t: number; gold: number } | null;
  /** Tes camps et sbires par minute (0 à 15), et ceux du jungler adverse. */
  cs: number[]; oppCs: number[];
  /** Or à 15 min, toi et le jungler adverse. */
  gold15: number | null; oppGold15: number | null;
  /** Objets terminés, dans l'ordre d'achat. */
  items: { t: number; id: string }[];
}

export function gameFacts(d: Detail): GameFacts | null {
  if (!d.timeline) return null;
  const meP = d.match.parts.find((p) => p.me);
  if (!meP) return null;
  const me = n(meP.participantId), team = n(meP.teamId);
  const teamOf = new Map(d.match.parts.map((p) => [n(p.participantId), n(p.teamId)]));
  const champOf = new Map(d.match.parts.map((p) => [n(p.participantId), n(p.championId)]));
  const opp = d.match.parts.find((p) => n(p.teamId) !== team && p.teamPosition === meP.teamPosition);
  const fr = d.timeline.frames;
  const ev = fr.flatMap((f) => f.e).sort((a, b) => n(a.timestamp) - n(b.timestamp));
  const pf = (i: number, id: number) => (fr[i]?.p[String(id)] ?? {}) as Record<string, unknown>;
  const teamGold = fr.map((_, i) => [...teamOf].reduce((s, [id, t]) => s + (t === team ? 1 : -1) * n(pf(i, id).totalGold), 0));
  const elite = ev.filter((e) => e.type === "ELITE_MONSTER_KILL" && n(e.killerTeamId) > 0);
  const objAfter = (t: number, ours: boolean) => {
    const o = elite.find((x) => (n(x.killerTeamId) === team) === ours && n(x.timestamp) > t && n(x.timestamp) - t <= MIN && BIG.has(String(x.monsterType)));
    return o ? { t: n(o.timestamp), label: OBJ[String(o.monsterType)] ?? "un objectif" } : null;
  };
  const kills = ev.filter((e) => e.type === "CHAMPION_KILL");
  const involved = (e: Record<string, unknown>) => [n(e.killerId), n(e.victimId), ...(((e.assistingParticipantIds as number[] | undefined) ?? []))];
  const deaths: DeathFact[] = kills.filter((e) => n(e.victimId) === me).map((e) => {
    const t = n(e.timestamp);
    const enemies = 1 + ((e.assistingParticipantIds as number[] | undefined) ?? []).length;
    const allyInFight = kills.some((x) => x !== e && Math.abs(n(x.timestamp) - t) <= 15_000 && involved(x).some((id) => id !== me && teamOf.get(id) === team));
    const pos = (e.position ?? {}) as Record<string, unknown>;
    return { t, killer: champOf.get(n(e.killerId)) ?? 0, enemies, allyInFight, objAfter: objAfter(t, false), zone: zone(n(pos.x), n(pos.y), team) };
  });
  const myKills = kills.filter((e) => n(e.killerId) === me).map((e) => ({ t: n(e.timestamp), victim: champOf.get(n(e.victimId)) ?? 0, solo: !((e.assistingParticipantIds as number[] | undefined) ?? []).length, objAfter: objAfter(n(e.timestamp), true) }));
  let lastGrub = -Infinity;
  const objectives: GameFacts["objectives"] = [];
  for (const e of elite) {
    const t = n(e.timestamp), type = String(e.monsterType), ours = n(e.killerTeamId) === team;
    if (type === "HORDE") { if (t - lastGrub < 90_000) continue; lastGrub = t; }
    objectives.push({ t, ours, type, label: OBJ[type] ?? type.toLowerCase(), byMe: n(e.killerId) === me || ((e.assistingParticipantIds as number[] | undefined) ?? []).includes(me), uncompensated: !ours && !compensated(ev, t, team, teamOf) });
  }
  const buys = ev.filter((e) => e.type === "ITEM_PURCHASED" && n(e.participantId) === me);
  const back = buys.find((e) => n(e.timestamp) > 90_000);
  const items = buys.filter((e) => INDEX[String(e.itemId)]?.kind === "legendary").map((e) => ({ t: n(e.timestamp), id: String(e.itemId) }));
  const cs = (id: number) => fr.slice(0, 16).map((_, i) => n(pf(i, id).minionsKilled) + n(pf(i, id).jungleMinionsKilled));
  return {
    win: !!meP.win, durationMs: d.match.duration * 1000, me, team, championId: n(meP.championId), opponent: opp ? n(opp.championId) : null,
    teamGold, deaths, kills: myKills, objectives,
    firstBack: back ? { t: n(back.timestamp), gold: n(pf(Math.floor(n(back.timestamp) / MIN), me).totalGold) } : null,
    cs: cs(me), oppCs: opp ? cs(n(opp.participantId)) : [],
    gold15: fr[15] ? n(pf(15, me).totalGold) : null, oppGold15: fr[15] && opp ? n(pf(15, n(opp.participantId)).totalGold) : null,
    items,
  };
}

/** Erreurs qui reviennent (thème de la semaine) : comptées dans une partie. */
export const ERRORS = {
  deathBeforeObjective: { label: "Morts juste avant un objectif adverse", short: "Avant un objectif, reste groupé ou recule.", exercise: "Une minute avant un dragon ou un Nashor : place ta vision, regroupe-toi, ou recule." },
  aloneOutnumbered: { label: "Morts seul face à 3 adversaires ou plus", short: "Seul et sans vision, ne t'avance pas.", exercise: "Avant d'avancer seul, compte les adversaires visibles sur la carte ; s'il en manque 3, recule." },
  enemyJungleDeath: { label: "Morts dans la jungle adverse", short: "N'entre dans leur jungle qu'avec vision et appui.", exercise: "N'envahis que si une lane proche peut te suivre, et avec une balise posée avant." },
  freeObjective: { label: "Objectifs laissés sans contrepartie", short: "Objectif perdu : prends tout de suite l'autre côté.", exercise: "Quand un objectif ne peut pas être disputé, prends le côté opposé (objectif, tour ou camps) et préviens ton équipe." },
} as const;
export type ErrorKey = keyof typeof ERRORS;

export function countErrors(f: GameFacts): Record<ErrorKey, { t: number; text: string }[]> {
  return {
    deathBeforeObjective: f.deaths.filter((d) => d.objAfter).map((d) => ({ t: d.t, text: `mort, puis ${d.objAfter!.label} adverse à ${mmss(d.objAfter!.t)}` })),
    aloneOutnumbered: f.deaths.filter((d) => !d.allyInFight && d.enemies >= 3).map((d) => ({ t: d.t, text: `mort seul face à ${d.enemies} adversaires` })),
    enemyJungleDeath: f.deaths.filter((d) => d.zone === "enemyJungle").map((d) => ({ t: d.t, text: "mort dans la jungle adverse" })),
    freeObjective: f.objectives.filter((o) => o.uncompensated).map((o) => ({ t: o.t, text: `${o.label} adverse sans contrepartie` })),
  };
}

export interface Reference {
  label: string; games: number;
  /** Quartiles (Q1, médiane, Q3) par mesure, et les valeurs (percentile). */
  cs4: number[]; cs10: number[]; firstItem: number[]; gold15diff: number[];
  /** Objets terminés par compo adverse (part des parties, nombre de parties). */
  builds: Record<"physical" | "magic" | "mixed", { games: number; share: Record<string, number> }>;
  tags?: TagShares;
}

export interface LessonLine { text: string; detail?: string }
export interface Lesson {
  turning: string[];
  well: LessonLine[];
  fix: LessonLine[];
  replay: string[];
  reference: { label: string; lines: LessonLine[]; notes: string[] };
  build: { mine: string[]; lines: LessonLine[] };
  theme: { key: ErrorKey; label: string; respected: boolean; text: string } | null;
}

const quart = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.floor(p * (s.length - 1))];
  return { q1: q(0.25), med: q(0.5), q3: q(0.75), n: s.length, pct: (v: number) => Math.round(((s.filter((x) => x < v).length + s.filter((x) => x === v).length / 2) / s.length) * 100) };
};

/** Le tournant de cette partie : deux phrases, avec ses faits et ses minutes. */
export function turningPoint(f: GameFacts): string[] {
  const g = f.teamGold;
  const early = f.objectives.filter((o) => o.t < 15 * MIN);
  const ours = early.filter((o) => o.ours).length;
  const objText = !early.length ? "" : ours === early.length ? "tous les objectifs avant 15 min" : ours === 0 ? "aucun objectif avant 15 min" : `${ours} objectif${ours > 1 ? "s" : ""} sur ${early.length} avant 15 min`;
  let peak = 0, peakAt = 0, low = 0, lowAt = 0;
  g.forEach((v, i) => { if (v > peak) { peak = v; peakAt = i; } if (v < low) { low = v; lowAt = i; } });
  const out: string[] = [];
  // Début de partie : l'or d'équipe à 15 min et les objectifs avant 15 min.
  const g15 = g[Math.min(15, g.length - 1)] ?? 0;
  const half = early.length ? ours / early.length : 0.5;
  const goldText = `${fmtGold(g15)} d'or d'équipe à 15 min`;
  if (g15 >= 1500 || (g15 >= 0 && half > 0.5)) out.push(`${g15 >= 3000 && half === 1 ? "Excellent" : "Bon"} début : ${[objText, goldText].filter(Boolean).join(", ")}.`);
  else if (g15 <= -1500 || (g15 < 0 && half < 0.5)) out.push(`Début difficile : ${[objText, goldText].filter(Boolean).join(", ")}.`);
  else out.push(`Début équilibré : ${[objText, goldText].filter(Boolean).join(", ")}.`);
  void low; void lowAt;
  const afterPeak = f.deaths.filter((d) => d.t >= peakAt * MIN);
  const beforeObj = afterPeak.filter((d) => d.objAfter).length;
  const deathsText = (ds: DeathFact[]) => `${ds.length} mort${ds.length > 1 ? "s" : ""}${ds.filter((d) => d.objAfter).length ? `, dont ${ds.filter((d) => d.objAfter).length} juste avant un dragon ou un Nashor adverse` : ""}`;
  if (!f.win && peak >= 2000) {
    const lost = g.findIndex((v, i) => i > peakAt && v <= 0);
    out.push(lost > 0 ? `Avance perdue entre ${peakAt} et ${lost} min ; depuis ${peakAt} min, ${deathsText(afterPeak)}.` : `Avance gardée longtemps ; depuis ${peakAt} min, ${deathsText(afterPeak)}.`);
    void beforeObj;
  } else if (!f.win) {
    const behind = g.findIndex((v) => v <= -2000);
    out.push(behind > 0 ? `En retard dès ${behind} min, puis ${deathsText(f.deaths.filter((d) => d.t >= behind * MIN))}.` : `Partie serrée, perdue avec ${deathsText(f.deaths)}.`);
  } else if (peak >= 2000) {
    const late = f.objectives.filter((o) => o.ours && o.t >= peakAt * MIN).length;
    out.push(`Avance prise vers ${peakAt} min et gardée : ${late} objectif${late > 1 ? "s" : ""} pris ensuite.`);
  } else {
    const back = g.findIndex((v, i) => i > lowAt && v >= 0 && g.slice(i).every((w) => w >= -500));
    out.push(back > 0 ? `Retour gagné à partir de ${back} min.` : "Victoire serrée, sans grand écart d'or.");
  }
  return out;
}

const TODO: Record<string, string> = {
  objAfter: "une minute avant l'objectif, regroupe-toi ou recule.",
  alone: "seul et sans vision, ne t'avance pas vers eux.",
  enemyJungle: "n'entre dans leur jungle qu'avec vision et une lane proche.",
  outnumbered: "attends ton équipe avant de combattre à plusieurs contre toi.",
};

const wilson = (k: number, n: number) => {
  if (!n) return 100;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  return ((z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d) * 100;
};
export type CompoProfile = "physical" | "magic" | "mixed";
const PROFILE_FR: Record<CompoProfile, string> = { physical: "surtout physique", magic: "surtout magique", mixed: "mixte" };

/**
 * Ton build face aux joueurs de référence contre une compo du même type (dégâts adverses surtout physiques, surtout
 * magiques, ou mixtes), avec la marge : objets que tu as pris rarement pris par eux, objets pris par la plupart que tu
 * n'as pas pris, et objets qui dépendent nettement de la compo.
 */
export function buildLines(mine: string[], profile: CompoProfile, ref: Reference["builds"], plan: string[]): LessonLine[] {
  const g = ref[profile];
  const out: LessonLine[] = [];
  if (!g || g.games < 20) return [{ text: "Pas assez de parties de référence contre ce type de compo pour comparer ton build." }];
  const share = (id: string) => g.share[id] ?? 0;
  const pm = (id: string) => `${Math.round(share(id) * 100)} % ± ${Math.round(wilson(Math.round(share(id) * g.games), g.games))} des ${g.games} parties contre une compo ${PROFILE_FR[profile]}`;
  for (const id of mine) {
    const s = share(id) * 100, m = wilson(Math.round(share(id) * g.games), g.games);
    if (s + m < 15) out.push({ text: `${itemName(id)} : rarement pris contre une compo ${PROFILE_FR[profile]}.`, detail: pm(id) });
  }
  for (const [id, s] of Object.entries(g.share)) {
    if (mine.includes(id)) continue;
    if (s * 100 - wilson(Math.round(s * g.games), g.games) > 50) out.push({ text: `${itemName(id)} : pris par la plupart, absent de ton build.`, detail: pm(id) });
  }
  // Objets situationnels : nettement plus pris contre ce type de compo que contre les autres.
  const others = (Object.keys(ref) as CompoProfile[]).filter((p) => p !== profile && ref[p].games >= 20);
  for (const [id, s] of Object.entries(g.share)) {
    for (const o of others) {
      const so = ref[o].share[id] ?? 0;
      const m = Math.hypot(wilson(Math.round(s * g.games), g.games), wilson(Math.round(so * ref[o].games), ref[o].games));
      if ((s - so) * 100 > m && s >= 0.15) {
        out.push({ text: `${itemName(id)} : pris plus souvent contre une compo ${PROFILE_FR[profile]} comme celle-ci${mine.includes(id) ? ", et tu l'as pris" : ""}.`, detail: `${pm(id)}, contre ${Math.round(so * 100)} % contre une compo ${PROFILE_FR[o]} (écart au-delà de la marge ± ${Math.round(m)})` });
        break;
      }
    }
  }
  const diff = mine.filter((id) => !plan.includes(id));
  if (plan.length && diff.length) out.push({ text: `Hors du build conseillé : ${diff.map(itemName).join(", ")}.` });
  return out.length ? out : [{ text: "Ton build suit ce que font les joueurs contre ce type de compo." }];
}

export function lesson(f: GameFacts, ref: Reference | null, planBuild: string[], themeKey: ErrorKey | null, profile: CompoProfile = "mixed"): Lesson {
  // Bien joué : kills suivis d'un objectif, objectifs pris par toi, kills seul.
  const good: { t: number; w: number; text: string }[] = [];
  for (const k of f.kills) {
    if (k.objAfter) good.push({ t: k.t, w: 3, text: `kill sur ${name(k.victim)}, puis ${k.objAfter.label} pour ton équipe à ${mmss(k.objAfter.t)}.` });
    else if (k.solo) good.push({ t: k.t, w: 2, text: `kill seul sur ${name(k.victim)}.` });
  }
  for (const o of f.objectives) if (o.ours && o.byMe) good.push({ t: o.t, w: o.type === "BARON_NASHOR" ? 3 : 1.5, text: `${o.label} pris${o.label.endsWith("s") ? "es" : ""} avec toi.` });
  const well = pickSpread(good, 2).map((x) => ({ text: `${mmss(x.t)} — ${x.text}` }));

  // À corriger : morts avant un objectif adverse, seul face à plusieurs, dans la jungle adverse.
  const bad: { t: number; w: number; text: string; todo: string }[] = f.deaths.map((d) => {
    const who = `tué par ${name(d.killer)}${d.enemies > 1 ? ` avec ${d.enemies - 1} autre${d.enemies > 2 ? "s" : ""}` : ""}${d.allyInFight ? "" : ", seul"}`;
    if (d.objAfter) return { t: d.t, w: 3, text: `${who} ; ${d.objAfter.label} adverse à ${mmss(d.objAfter.t)}.`, todo: TODO.objAfter };
    if (!d.allyInFight && d.enemies >= 3) return { t: d.t, w: 2.5, text: `${who}.`, todo: TODO.alone };
    if (d.zone === "enemyJungle") return { t: d.t, w: 2, text: `${who}, dans leur jungle.`, todo: TODO.enemyJungle };
    return { t: d.t, w: d.enemies >= 3 ? 1 : 0.5, text: `${who}.`, todo: TODO.outnumbered };
  });
  const fixes = pickSpread(bad.filter((b) => b.w >= 1), 3).sort((a, b) => a.t - b.t);
  const fix = fixes.map((x) => ({ text: `${mmss(x.t)} — ${x.text} À faire : ${x.todo}` }));

  // À revoir en replay : la fenêtre du tournant, puis les moments à corriger.
  const g = f.teamGold;
  let peak = 0, peakAt = 0; g.forEach((v, i) => { if (v > peak) { peak = v; peakAt = i; } });
  const lost = !f.win && peak >= 2000 ? g.findIndex((v, i) => i > peakAt && v <= 0) : -1;
  const replay = [
    ...(lost > 0 ? [`${peakAt}:00 → ${lost}:30 (l'avance s'efface)`] : []),
    ...fixes.filter((x) => lost <= 0 || x.t > (lost + 1) * MIN || x.t < peakAt * MIN).slice(0, 3 - (lost > 0 ? 1 : 0)).map((x) => `${mmss(Math.max(0, x.t - 30_000))} → ${mmss(x.t + 15_000)}`),
  ];

  // Repères face aux joueurs de référence (une ligne par écart net : hors de la moitié centrale de leurs parties).
  const refLines: LessonLine[] = [];
  const notes: string[] = [];
  if (ref) {
    const line = (xs: number[], v: number | null, good: string, bad: string, unit: (x: number) => string, betterHigh = true) => {
      if (v == null || xs.length < 20) return;
      const q = quart(xs);
      const detail = `toi ${unit(v)} · médiane ${unit(q.med)} (moitié centrale ${unit(q.q1)} à ${unit(q.q3)}) · ${q.n} parties · mieux que ${betterHigh ? q.pct(v) : 100 - q.pct(v)} %`;
      if (betterHigh ? v > q.q3 : v < q.q1) refLines.push({ text: good, detail });
      else if (betterHigh ? v < q.q1 : v > q.q3) refLines.push({ text: bad, detail });
      else notes.push(`${good.split(" :")[0].replace(/ parmi.*| plus.*/, "")} : dans la moitié centrale (${detail}).`);
    };
    line(ref.cs4, f.cs[4] ?? null, "Premier tour de camps parmi les plus rapides.", `Premier tour de camps plus lent que la plupart${f.firstBack && f.firstBack.t < 4.5 * MIN ? `, après un retour à ${mmss(f.firstBack.t)}` : ""}.`, (x) => `${x} camps et sbires à 4 min`);
    line(ref.cs10, f.cs[10] ?? null, "Camps à 10 min : parmi les meilleurs.", "Camps à 10 min : en dessous de la plupart.", (x) => `${x}`);
    if (f.gold15 != null && f.oppGold15 != null) line(ref.gold15diff, f.gold15 - f.oppGold15, `Avance sur ${f.opponent ? name(f.opponent) : "ton vis-à-vis"} à 15 min : parmi les meilleures.`, `Retard sur ${f.opponent ? name(f.opponent) : "ton vis-à-vis"} à 15 min : plus grand que la plupart.`, (x) => `${fmtGold(x)} d'or`);
    if (f.items[0]) line(ref.firstItem, f.items[0].t / MIN, "Premier objet terminé plus tôt que la plupart.", "Premier objet terminé plus tard que la plupart.", (x) => mmss(x * MIN), false);
    notes.push("Présence aux apparitions d'objectifs et premier retour en base : pas de comparaison, la méta ne contient pas assez de chronologies complètes (positions) de ce champion.");
  } else notes.push("Pas assez de parties de référence sur ce champion pour comparer.");
  const mine = f.objectives.filter((o) => o.t < 20 * MIN && o.ours);
  const theirsLate = f.objectives.filter((o) => o.t >= 20 * MIN && !o.ours);
  notes.push(`Objectifs : ${mine.filter((o) => o.byMe).length} sur ${mine.length} de ton équipe avant 20 min avec toi ; ${theirsLate.length} objectifs adverses après 20 min${theirsLate.length ? `, dont ${theirsLate.filter((o) => f.deaths.some((d) => d.t < o.t && o.t - d.t <= MIN)).length} juste après une de tes morts` : ""}.`);
  if (f.firstBack) notes.push(`Premier retour en base vers ${mmss(f.firstBack.t)}, avec environ ${Math.round(f.firstBack.gold / 50) * 50} d'or gagné.`);

  // Ton build face à ce que les joueurs de référence achètent contre une compo du même type.
  const myItems = f.items.map((i) => i.id);
  const builds: LessonLine[] = ref ? buildLines(myItems, profile, ref.builds, planBuild) : [{ text: "Pas assez de parties de référence pour comparer ton build." }];

  // Thème de la semaine : respecté dans cette partie ?
  let theme: Lesson["theme"] = null;
  if (themeKey) {
    const occ = countErrors(f)[themeKey];
    theme = { key: themeKey, label: ERRORS[themeKey].label, respected: !occ.length, text: occ.length ? `Pas respecté : ${occ.length} fois (${occ.map((o) => mmss(o.t)).join(", ")}).` : "Respecté dans cette partie." };
  }
  return { turning: turningPoint(f), well, fix, replay, reference: { label: ref?.label ?? "", lines: refLines, notes }, build: { mine: myItems.map(itemName), lines: builds }, theme };
}

/** Les meilleurs moments, espacés d'au moins 2 minutes (pas deux fois le même combat). */
function pickSpread<T extends { t: number; w: number }>(xs: T[], k: number): T[] {
  const out: T[] = [];
  for (const x of [...xs].sort((a, b) => b.w - a.w || a.t - b.t)) {
    if (out.length >= k) break;
    if (out.some((o) => Math.abs(o.t - x.t) < 2 * MIN)) continue;
    out.push(x);
  }
  return out;
}

/** Type de compo adverse d'après les dégâts de ses champions : 3 physiques ou plus, 3 magiques ou plus, ou mixte. */
export function compoProfile(enemyKeys: number[]): CompoProfile {
  const cs = enemyKeys.map((k) => champByKey(k)).filter((c): c is NonNullable<typeof c> => !!c);
  if (cs.filter((c) => c.damage === "physical").length >= 3) return "physical";
  if (cs.filter((c) => c.damage === "magic").length >= 3) return "magic";
  return "mixed";
}

/** Une erreur sur tes dernières parties : fréquence par partie (marge comprise) et exemples récents. */
export interface ErrorStat {
  key: ErrorKey; label: string; games: number; withError: number; perGame: number; margin: number;
  examples: { matchId: string; startMs: number; championId: number; t: number; text: string }[];
}

/** Thème de la semaine : l'erreur personnelle la plus fréquente (parties concernées, puis fréquence), sur 20 parties. */
export const THEME_GAMES = 20;
export function pickTheme(stats: ErrorStat[]): ErrorStat | null {
  // « Objectifs laissés sans contrepartie » est déjà un objectif de la semaine (et une erreur d'équipe) : pas un thème.
  const c = stats.filter((s) => s.key !== "freeObjective" && s.games >= THEME_GAMES && s.withError >= 3);
  return c.sort((a, b) => b.withError - a.withError || b.perGame - a.perGame)[0] ?? null;
}

/** Bilan d'une semaine : fréquence par partie avant / pendant le thème, avec la marge ; conclusion seulement si nette. */
export function themeReview(before: { perGame: number; margin: number; games: number }, since: { perGame: number; margin: number; games: number }): string {
  const f = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const base = `${f(before.perGame)} ± ${f(before.margin)} par partie avant (${before.games} parties), ${f(since.perGame)} ± ${f(since.margin)} depuis (${since.games} parties)`;
  if (since.games < 5) return `${base} : pas encore assez de parties cette semaine pour conclure.`;
  const gap = since.perGame - before.perGame, m = Math.hypot(before.margin, since.margin);
  return `${base} : ${Math.abs(gap) <= m ? "pas d'écart net (marge comprise)" : gap < 0 ? "progrès net" : "recul net"}${since.games < THEME_GAMES ? `, sur moins de ${THEME_GAMES} parties : à confirmer` : ""}.`;
}

/** Traits d'une compo adverse qui changent les achats : dégâts surtout physiques ou magiques, soins, tanks, contrôles. */
export type CompoTag = "physical" | "magic" | "healers" | "tanks" | "cc";
const TAG_FR: Record<CompoTag, string> = { physical: "leurs dégâts physiques", magic: "leurs dégâts magiques", healers: "leurs soins", tanks: "leurs tanks", cc: "leurs contrôles" };
export function compoTags(enemyKeys: number[]): { tag: CompoTag; who: string[] }[] {
  const cs = enemyKeys.map((k) => champByKey(k)).filter((c): c is NonNullable<typeof c> => !!c);
  const out: { tag: CompoTag; who: string[] }[] = [];
  const phys = cs.filter((c) => c.damage === "physical"), mag = cs.filter((c) => c.damage === "magic");
  if (phys.length >= 3) out.push({ tag: "physical", who: phys.map((c) => c.name) });
  if (mag.length >= 3) out.push({ tag: "magic", who: mag.map((c) => c.name) });
  const heal = cs.filter((c) => c.heals); if (heal.length >= 2) out.push({ tag: "healers", who: heal.map((c) => c.name) });
  const tanks = cs.filter((c) => c.tags?.includes("Tank")); if (tanks.length >= 2) out.push({ tag: "tanks", who: tanks.map((c) => c.name) });
  const cc = cs.filter((c) => c.cc >= 2); if (cc.length >= 3) out.push({ tag: "cc", who: cc.map((c) => c.name) });
  return out;
}

/** Part des objets terminés dans les parties de référence avec et sans ce trait de compo adverse. */
export type TagShares = Record<CompoTag, { with: { games: number; share: Record<string, number> }; without: { games: number; share: Record<string, number> } }>;

/**
 * Objets situationnels pour cette compo : ceux que les joueurs de référence prennent nettement plus souvent contre ce
 * trait (écart au-delà de la marge, au moins 15 % des parties, 20 parties de chaque côté). Une ligne : l'objet, contre
 * quoi et contre qui ; les chiffres dans le détail.
 */
export function situationalItems(tags: TagShares | undefined, enemyKeys: number[], label: string): { id: string; line: string; detail: string }[] {
  if (!tags) return [];
  const out: { id: string; line: string; detail: string; gap: number }[] = [];
  for (const { tag, who } of compoTags(enemyKeys)) {
    const t = tags[tag];
    if (!t || t.with.games < 20 || t.without.games < 20) continue;
    for (const [id, s] of Object.entries(t.with.share)) {
      const so = t.without.share[id] ?? 0;
      const m = Math.hypot(wilson(Math.round(s * t.with.games), t.with.games), wilson(Math.round(so * t.without.games), t.without.games));
      if (s < 0.15 || (s - so) * 100 <= m || out.some((o) => o.id === id)) continue;
      out.push({ id, gap: s - so, line: `${itemName(id)} : contre ${TAG_FR[tag]} (${who.slice(0, 2).join(", ")}).`,
        detail: `${itemName(id)} : ${Math.round(s * 100)} % des ${t.with.games} parties ${label} contre ${TAG_FR[tag]}, ${Math.round(so * 100)} % sans (écart au-delà de la marge ± ${Math.round(m)}).` });
    }
  }
  return out.sort((a, b) => b.gap - a.gap).slice(0, 3).map(({ id, line, detail }) => ({ id, line, detail }));
}
