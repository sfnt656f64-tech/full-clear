// Conseils d'avant-partie (overlay), tirés uniquement de la draft terminée : champions visibles par tous,
// rôles (alliés : postes du client ; adversaires : rôle probable) et données fixes des champions.
//
// Règles Riot respectées : rien pendant la partie selon son état (pas d'alerte de pic de puissance, pas
// d'ordre du type « va ganker »), aucune information cachée ; des options et des repères, jamais une décision.
import { findChamp } from "../../src/data/champions";
import type { Champion, Form } from "../../src/data/types";
import { LANE_LABELS, type Lane, type LaneRow } from "../reco/lanes.ts";

export interface PregameInput {
  /** Lignes Top → Support de la draft (identifiants Data Dragon des champions). */
  lanes: LaneRow<{ id: string }>[];
  /** Forme de Kayn retenue (si tu joues Kayn). */
  form?: Form | null;
}

/** Nombre maximal de conseils (ils défilent deux par deux). */
export const MAX_TIPS = 4;

const FRAGILE = new Set(["marksman", "mage", "enchanter"]);
const label = (lane: Lane) => LANE_LABELS[lane];
const list = (xs: { c: Champion; lane: Lane }[]) => xs.map((x) => `${x.c.name} (${label(x.lane)})`).join(", ");

export function pregameTips(input: PregameInput): string[] {
  const meRow = input.lanes.find((r) => r.me);
  const me = meRow?.ally ? findChamp(meRow.ally.id) : undefined;
  if (!meRow || !me) return [];
  const allies = input.lanes.flatMap((r) => (!r.me && r.ally && findChamp(r.ally.id) ? [{ c: findChamp(r.ally.id)!, lane: r.lane }] : []));
  const enemies = input.lanes.flatMap((r) => (r.enemy && findChamp(r.enemy.id) ? [{ c: findChamp(r.enemy.id)!, lane: r.lane }] : []));
  const tips: string[] = [];

  // Cibles selon ton champion (Kayn : selon la forme).
  const kayn = me.id === "Kayn";
  const fragile = enemies.filter((e) => FRAGILE.has(e.c.profile) || (e.c.profile === "assassin" && e.c.range === "ranged"));
  const front = enemies.filter((e) => e.c.profile === "tank" || e.c.profile === "fighter");
  if (kayn && input.form === "blue" && fragile.length) tips.push(`Kayn bleu : cibles fragiles en face, ${list(fragile)}.`);
  else if (kayn && input.form === "red" && front.length) tips.push(`Kayn rouge : ton soin est le plus fort contre le front adverse, ${list(front)}.`);
  else if (!kayn && me.profile === "assassin" && fragile.length) tips.push(`Cibles fragiles en face : ${list(fragile)}.`);
  else {
    const carries = enemies.filter((e) => e.c.profile === "marksman" || e.c.profile === "mage");
    if (carries.length) tips.push(`Principales sources de dégâts en face : ${list(carries)}.`);
  }

  // Jungle : lanes alliées avec du contrôle (options de gank, pas un ordre).
  if (meRow.lane === "JUNGLE") {
    const cc = allies.filter((a) => a.c.cc >= 2);
    if (cc.length) tips.push(`Lanes alliées avec du contrôle pour tes ganks : ${list(cc)}.`);
  }

  // Adversaires réputés forts en début de partie (donnée fixe des champions).
  const early = enemies.filter((e) => e.c.early);
  if (early.length) tips.push(`Forts en début de partie en face : ${list(early)}.`);

  // Profil de dégâts adverse (pour tes défenses).
  if (enemies.length >= 4) {
    const phys = enemies.filter((e) => e.c.damage === "physical").length;
    const mag = enemies.filter((e) => e.c.damage === "magic").length;
    if (phys >= 4) tips.push(`Dégâts adverses surtout physiques (${phys} sur ${enemies.length}).`);
    else if (mag >= 4) tips.push(`Dégâts adverses surtout magiques (${mag} sur ${enemies.length}).`);
  }
  return tips.slice(0, MAX_TIPS);
}

/** Défilement : deux conseils à la fois, chaque paire affichée `pairMs`, puis plus rien. */
export function tipsAt(tips: string[], elapsedMs: number, pairMs = 12_000): string[] {
  const i = Math.floor(elapsedMs / pairMs) * 2;
  return tips.slice(i, i + 2);
}
