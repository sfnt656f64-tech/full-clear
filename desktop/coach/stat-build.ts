// Build statistique pour un champion autre que Kayn (Kayn garde son modèle de dégâts). Fonctions pures.
//
// Base : la méta Émeraude+ des patchs récents (jamais les anciennes saisons), dans ton rôle.
//   - ordre du core : la suite des 3 premiers items terminés la plus fréquente (chronologies, champions de ton
//     pool) ; sinon, les items les plus présents en fin de partie ;
//   - bottes, familier (jungle) et items suivants : les plus joués.
// Adapté à la composition de la DRAFT (champions seulement, jamais ce qui se passe en jeu : règles Riot), parmi les
// items que les joueurs utilisent vraiment sur ce champion :
//   - anti-soins si l'équipe adverse se soigne ;
//   - bottes et item défensif selon les dégâts adverses (physiques / magiques).
// Plus des règles « si… alors… » écrites avant la partie, que tu appliques toi-même en jeu.
import itemIndex from "../../src/data/generated/item-index.json";
import { STARTERS } from "../../src/data/starters";
import type { Champion } from "../../src/data/types";
import { damageProfile, type DamageProfile } from "./compo.ts";
import type { MetaBuildRow, MetaPartRow } from "../meta/meta-stats.ts";
import type { Shop } from "../next-item.ts";

export interface StatBuild {
  /** Bottes puis items terminés, dans l'ordre d'achat conseillé (identifiants Data Dragon). */
  ids: string[];
  /** Familier de jungle (identifiant principal), ou null hors jungle. */
  starter: string | null;
  /** Parties de méta utilisées. */
  games: number;
  /** Ajustements à la composition, en clair. */
  reasons: string[];
  /** Règles écrites avant la partie (« si… alors… ») : c'est toi qui les appliques, l'appli ne lit rien en jeu. */
  rules: BuildRule[];
  /** Dégâts de la compo adverse (classification unique, coach/compo.ts). */
  profile: DamageProfile;
}

/**
 * Règle « si… alors… » de build : une condition que tu vois toi-même en jeu, et l'item à prendre (à la place d'un
 * autre, éventuellement). Le texte est composé à l'affichage, avec les noms dans la langue du client.
 */
export interface BuildRule { cond: string; id: string; instead?: string }

/** Items terminés pris en compte (au moins cette part des parties). */
export const MIN_SHARE = 0.05;
/** Parties de méta minimales pour proposer un build. */
export const MIN_GAMES = 20;
/** Items avec Blessures graves (anti-soins). */
export const ANTI_HEAL = new Set(["3033", "3075", "6609", "3165"]);
const BOOTS_ARMOR = "3047";
const BOOTS_MR = "3111";

type IndexEntry = { kind: string; baseBoots?: string };
const INDEX = itemIndex as Record<string, IndexEntry>;
const isLegendary = (id: string) => INDEX[id]?.kind === "legendary";
const isBoots = (id: string) => INDEX[id]?.kind === "boots";
const bootsBase = (id: string) => INDEX[id]?.baseBoots ?? id;
const STARTER_MAIN = new Map<string, string>(Object.values(STARTERS).flatMap((s) => s.ids.map((i) => [i, s.id] as const)));

function ranked(values: string[]): { id: string; n: number }[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
}

export interface StatBuildInput {
  /** Lignes de méta de ce champion dans ce rôle (patchs récents). */
  parts: MetaPartRow[];
  builds: MetaBuildRow[];
  role: string;
  enemies: (Champion | null)[];
  shop: Shop;
}

export function statBuild(input: StatBuildInput): StatBuild | null {
  const n = input.parts.length;
  if (n < MIN_GAMES) return null;
  const reasons: string[] = [];

  // Items terminés joués sur ce champion (fin de partie), par fréquence.
  const items = ranked(input.parts.flatMap((p) => [...new Set(p.items.map(String).filter(isLegendary))])).filter((x) => x.n / n >= MIN_SHARE);
  const bootsRank = ranked(input.parts.flatMap((p) => p.items.map(String).filter(isBoots).slice(0, 1).map(bootsBase)));
  const usedBoots = new Set(bootsRank.filter((x) => x.n / n >= MIN_SHARE).map((x) => x.id));

  // Ordre du core : suite des 3 premiers items terminés la plus fréquente (chronologies).
  const cores = ranked(input.builds.map((b) => b.items.map(String).filter(isLegendary).slice(0, 3)).filter((c) => c.length === 3).map((c) => c.join(",")));
  const core = cores[0] && cores[0].n >= 3 ? cores[0].id.split(",") : items.slice(0, 3).map((x) => x.id);
  const legend = [...core, ...items.map((x) => x.id).filter((id) => !core.includes(id))].slice(0, 5);

  // Composition adverse.
  const known = input.enemies.filter((c): c is Champion => !!c);
  // Même classification que partout ailleurs (coach/compo.ts).
  const profile = damageProfile(known);
  const healers = known.filter((c) => c.heals).length;

  // Anti-soins : seulement un item que les joueurs prennent sur ce champion.
  if (healers >= 2 && !legend.some((id) => ANTI_HEAL.has(id))) {
    const gw = items.find((x) => ANTI_HEAL.has(x.id));
    if (gw) {
      legend.splice(2, 0, gw.id);
      legend.length = Math.min(legend.length, 5);
      reasons.push(`anti-soins : ${healers} adversaire(s) se soignent`);
    }
  }

  // Défense selon les dégâts adverses : un item (armure ou résistance magique) déjà joué sur ce champion.
  const defensive = (stat: "armor" | "mr") => items.find((x) => (input.shop[x.id]?.[stat] ?? 0) >= 30 && !legend.slice(0, 3).includes(x.id));
  if (profile !== "mixed") {
    const stat = profile === "physical" ? "armor" : "mr";
    const d = defensive(stat);
    if (d && legend.indexOf(d.id) !== 3) {
      const at = legend.indexOf(d.id);
      if (at >= 0) legend.splice(at, 1);
      legend.splice(3, 0, d.id);
      legend.length = Math.min(legend.length, 5);
      reasons.push(`dégâts adverses surtout ${stat === "armor" ? "physiques" : "magiques"}`);
    }
  }

  // Bottes : les plus jouées, ou des bottes défensives si les joueurs les prennent sur ce champion.
  let boots = bootsRank[0]?.id ?? null;
  if (profile === "physical" && usedBoots.has(BOOTS_ARMOR) && boots !== BOOTS_ARMOR) { boots = BOOTS_ARMOR; reasons.push(`${input.shop[BOOTS_ARMOR]?.nameFr ?? "Coques en acier"} contre les dégâts physiques`); }
  else if (profile === "magic" && usedBoots.has(BOOTS_MR) && boots !== BOOTS_MR) { boots = BOOTS_MR; reasons.push(`${input.shop[BOOTS_MR]?.nameFr ?? "Sandales de Mercure"} contre les dégâts magiques`); }

  // Bottes après le premier item (le plus courant pour un jungler ou un mid).
  const ids = boots ? [legend[0], boots, ...legend.slice(1)].filter(Boolean) : legend;
  const starter = input.role === "JUNGLE"
    ? ranked(input.parts.flatMap((p) => p.items.map(String).filter((i) => STARTER_MAIN.has(i)).slice(0, 1).map((i) => STARTER_MAIN.get(i)!)))[0]?.id ?? null
    : null;
  // Si… alors… : alternatives jouées sur ce champion, à appliquer toi-même selon ce que tu vois en partie.
  const rules: BuildRule[] = [];
  const gw = items.find((x) => ANTI_HEAL.has(x.id));
  const arm = items.find((x) => (input.shop[x.id]?.armor ?? 0) >= 30 && !ids.includes(x.id));
  const mr = items.find((x) => (input.shop[x.id]?.mr ?? 0) >= 30 && !ids.includes(x.id));
  if (arm) rules.push({ cond: "Leur carry AD est fed", id: arm.id });
  if (mr) rules.push({ cond: "Leur carry AP est fed", id: mr.id });
  if (gw && !ids.includes(gw.id)) rules.push({ cond: "Leurs soins font la différence", id: gw.id });
  if (boots && boots !== BOOTS_ARMOR && usedBoots.has(BOOTS_ARMOR)) rules.push({ cond: "Beaucoup d'auto-attaques en face", id: BOOTS_ARMOR, instead: boots });
  if (boots && boots !== BOOTS_MR && usedBoots.has(BOOTS_MR)) rules.push({ cond: "Leurs contrôles te gênent", id: BOOTS_MR, instead: boots });
  return { ids, starter, games: n, reasons, rules: rules.slice(0, 3), profile };
}
