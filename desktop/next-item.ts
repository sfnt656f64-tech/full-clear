// Build de la partie affiché dans l'overlay : décidé à partir des CHAMPIONS de la partie (ceux de la draft, que tout
// le monde voit), jamais de ce qui se passe en jeu (or, inventaire, items adverses, kills, objectifs) : règles Riot,
// aucun conseil qui réagit à l'état de la partie. Des règles « si… alors… » écrites avant la partie complètent le
// build : c'est toi qui les appliques. L'appli n'achète jamais rien.
import shopJson from "../src/data/generated/shop.json";
import { findChamp } from "../src/data/champions";
import { ITEMS } from "../src/data/items";
import { STARTERS } from "../src/data/starters";
import type { Form } from "../src/data/types";
import { analyse, resolveForm } from "../src/engine/analyse";
import { chooseBuild, chooseStarter } from "../src/engine/build";
import { DDRAGON_IMG } from "./draft-view.ts";
import type { BuildRule, StatBuild } from "./coach/stat-build.ts";

export interface ShopItem {
  /** Nom anglais ; nameFr : nom affiché (langue du client, Data Dragon fr_FR). */
  name: string; nameFr?: string; cost: number; from?: string[];
  ad?: number; ap?: number; armor?: number; mr?: number; hp?: number; heal?: true; boots?: true;
}
export type Shop = Record<string, ShopItem>;
export const SHOP = shopJson as Shop;

const icon = (id: string) => `${DDRAGON_IMG}/item/${id}.png`;

export interface ItemLite { id: string; name: string; icon: string; cost: number }

/** Champions de la partie (identifiants Data Dragon) : toi, tes alliés, tes adversaires. */
export interface MatchChampions { me: string | null; allies: (string | null)[]; enemies: (string | null)[] }

export interface OverlayView {
  form: Form;
  formForced: boolean;
  notKayn: boolean;
  /** D'où vient le build : modèle de Kayn, méta Émeraude+ (autres champions), ou rien (pas assez de données). */
  source: "kayn" | "meta" | "none";
  /** Ton champion (nom affiché). */
  champion: string | null;
  /** Familier de jungle (item de départ) et sa justification, ou null. */
  starter: (ItemLite & { why: string }) | null;
  /** Le build complet, dans l'ordre d'achat (bottes comprises). */
  build: ItemLite[];
  /** Ajustements à la composition (décidés en draft). */
  reasons: string[];
  /** Règles « si… alors… » écrites avant la partie : à appliquer toi-même (texte : ruleText). */
  rules: BuildRule[];
  /** Méta : parties utilisées pour le build. */
  buildGames?: number;
  /** Dégâts de la compo adverse (classification unique, la même que l'analyse). */
  profile?: import("./coach/compo.ts").DamageProfile;
  /** Plan écrit en draft (vue simple), ajouté par le processus principal au début de la partie ; rien ne change ensuite. */
  plan?: import("./coach/plain.ts").PlainPlan | null;
}

/** Paires nom anglais → nom français des items (les plus longs d'abord), pour les textes venus du modèle de Kayn. */
const EN_FR = Object.values(SHOP).filter((i) => i.nameFr && i.nameFr !== i.name).map((i) => [i.name, i.nameFr!] as const).sort((a, b) => b[0].length - a[0].length);
/** Remplace les noms anglais d'items par ceux du client (français). */
export function frenchify(text: string): string {
  let out = text;
  for (const [en, fr] of EN_FR) if (out.includes(en)) out = out.split(en).join(fr);
  return out;
}

/** Nom affiché d'un item : celui du client (français), sinon l'anglais. */
export const itemName = (id: string, shop: Shop = SHOP): string => shop[id]?.nameFr ?? shop[id]?.name ?? id;
const lite = (id: string, shop: Shop): ItemLite => ({ id, name: itemName(id, shop), icon: icon(id), cost: shop[id]?.cost ?? 0 });

/**
 * « Leur carry AD est fed → Ange gardien » (noms dans la langue du client). « au lieu de … » seulement si la ligne
 * reste courte (12 mots au plus).
 */
export function ruleText(r: BuildRule, shop: Shop = SHOP): string {
  const base = `${r.cond} → ${itemName(r.id, shop)}`;
  if (!r.instead) return base;
  const other = itemName(r.instead, shop);
  const full = `${base} au lieu ${/^[aeiouyéèêàh]/i.test(other) ? "d'" : "de "}${other}`;
  return full.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length <= 12 ? full : base;
}
const plain = (html: string) => html.replace(/<[^>]+>/g, "");

/** Règles « si… alors… » de Kayn, écrites avant la partie (mêmes situations que les guides du simulateur). */
function kaynRules(form: Form, build: string[]): BuildRule[] {
  const id = (k: string) => ITEMS[k as keyof typeof ITEMS]?.id ?? k;
  const out: BuildRule[] = [];
  if (form === "blue") {
    if (!build.includes("serylda")) out.push({ cond: "Leurs tanks empilent l'armure", id: id("serylda") });
    if (build.includes("hubris")) out.push({ cond: "Peu de kills tôt", id: id("youmuu"), instead: id("hubris") });
    out.push({ cond: "Tu domines sans finir", id: id("bastion") });
  } else {
    if (!build.includes("dd")) out.push({ cond: "Leurs dégâts physiques prennent l'avance", id: id("dd") });
    if (!build.includes("sterak")) out.push({ cond: "Leurs dégâts magiques prennent l'avance", id: id("sterak") });
    out.push({ cond: "Tu es devant, ils empilent l'armure", id: id("serylda") });
  }
  return out.slice(0, 3);
}

/** Build de la partie, à partir des champions seulement (aucune donnée de l'état de la partie). */
export function buildPlanView(m: MatchChampions, formChoice: Form | "auto", shop: Shop = SHOP, stat?: StatBuild | null): OverlayView {
  const enemies = m.enemies.map((e) => (e ? findChamp(e) ?? null : null));
  const allies = m.allies.map((a) => (a ? findChamp(a) ?? null : null));
  const base = analyse(enemies, allies);
  const form = resolveForm(base, formChoice);
  const meChamp = m.me ? findChamp(m.me) ?? null : null;
  const isKayn = !m.me || m.me === "Kayn";
  const common = { form, formForced: formChoice !== "auto", notKayn: !isKayn, champion: meChamp?.name ?? null };

  if (!isKayn) {
    if (!stat) return { ...common, source: "none", starter: null, build: [], reasons: [], rules: [] };
    const pet = stat.starter ? Object.values(STARTERS).find((p) => p.id === stat.starter) : undefined;
    return {
      ...common, source: "meta", buildGames: stat.games, profile: stat.profile,
      starter: pet ? { ...lite(pet.id, shop), name: pet.nameFr, cost: pet.cost, why: "Le plus joué en Émeraude+ sur ce champion." } : null,
      build: stat.ids.map((id) => lite(id, shop)), reasons: stat.reasons, rules: stat.rules,
    };
  }
  const choice = chooseBuild(base, form);
  const [key, why] = chooseStarter(base)[0];
  const pet = STARTERS[key];
  return {
    ...common, source: "kayn",
    starter: { ...lite(pet.id, shop), name: pet.nameFr, cost: pet.cost, why },
    build: choice.b.map((k) => ITEMS[k].id!).filter(Boolean).map((id) => lite(id, shop)),
    reasons: choice.notes.map(plain), rules: kaynRules(form, choice.b),
  };
}
