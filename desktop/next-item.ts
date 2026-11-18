// Prochain item recommandé en jeu : build du moteur (ajusté aux items adverses), inventaire et or.
// Ne fait que suggérer : l'appli n'achète jamais rien (interdit par Riot, et impossible sans injection).
import shopJson from "../src/data/generated/shop.json";
import { findChamp } from "../src/data/champions";
import { ITEMS } from "../src/data/items";
import { STARTER_ITEM_IDS, STARTERS } from "../src/data/starters";
import type { Champion, Form, ItemKey } from "../src/data/types";
import { analyse, resolveForm, type Analysis } from "../src/engine/analyse";
import { chooseBuild, chooseStarter } from "../src/engine/build";
import { DDRAGON_IMG } from "./draft-view.ts";
import type { LiveSnapshot } from "./live-client.ts";

export interface ShopItem {
  name: string; cost: number; from?: string[];
  ad?: number; ap?: number; armor?: number; mr?: number; hp?: number; heal?: true; boots?: true;
}
export type Shop = Record<string, ShopItem>;
export const SHOP = shopJson as Shop;

/** Armure apportée par les items à partir de laquelle un adversaire non-tank compte comme « armuré ». */
export const ARMOR_STACKER = 80;
/** Or (estimé) en stats offensives adverses à partir duquel on tient compte des items pour AD/AP. */
const DAMAGE_GOLD_MIN = 2500;
const AD_GOLD = 35;
const AP_GOLD = 20;

const icon = (id: string) => `${DDRAGON_IMG}/item/${id}.png`;

/** Multiset d'identifiants (inventaire), consommé au fil du calcul. */
type Bag = Map<string, number>;
const bagOf = (ids: number[]): Bag => {
  const b: Bag = new Map();
  for (const id of ids) b.set(String(id), (b.get(String(id)) ?? 0) + 1);
  return b;
};
const take = (b: Bag, id: string): boolean => {
  const n = b.get(id) ?? 0;
  if (!n) return false;
  b.set(id, n - 1);
  return true;
};

/** Item (ou une de ses améliorations directes, ex. bottes de niveau 3) dans l'inventaire. */
export function owns(bag: Bag, id: string, shop: Shop = SHOP): boolean {
  if ((bag.get(id) ?? 0) > 0) return true;
  return Object.entries(shop).some(([up, it]) => it.from?.includes(id) && (bag.get(up) ?? 0) > 0 && (it.boots ?? false));
}

/**
 * Or nécessaire pour finir `id`, en utilisant les composants déjà possédés (consommés dans `bag`).
 * Renvoie aussi les composants manquants (feuilles et intermédiaires) pour proposer un achat partiel.
 */
export function remainingCost(id: string, bag: Bag, shop: Shop = SHOP): { gold: number; missing: string[] } {
  if (take(bag, id)) return { gold: 0, missing: [] };
  const it = shop[id];
  if (!it) return { gold: 0, missing: [] };
  const from = it.from ?? [];
  const recipe = it.cost - from.reduce((s, f) => s + (shop[f]?.cost ?? 0), 0);
  let gold = recipe;
  const missing: string[] = [];
  for (const f of from) {
    const r = remainingCost(f, bag, shop);
    gold += r.gold;
    if (r.gold > 0) missing.push(f, ...r.missing);
  }
  return { gold, missing };
}

/** Lecture des items adverses : qui stacke l'armure, qui se soigne, part AD/AP réelle. */
export interface EnemyItems {
  armorStackers: number;
  healers: number;
  /** Part des dégâts physiques d'après les items, ou null si trop peu d'items offensifs. */
  adShare: number | null;
}

export function readEnemyItems(enemies: LiveSnapshot["enemies"], champs: (Champion | null)[], shop: Shop = SHOP): EnemyItems {
  let armorStackers = 0, healers = 0, adGold = 0, apGold = 0;
  enemies.forEach((e, i) => {
    const its = e.items.map((id) => shop[String(id)]).filter((x): x is ShopItem => !!x);
    const armor = its.reduce((s, x) => s + (x.armor ?? 0), 0);
    const c = champs[i];
    if (armor >= ARMOR_STACKER && c?.profile !== "tank") armorStackers++;
    if (its.some((x) => x.heal) && !c?.heals) healers++;
    adGold += its.reduce((s, x) => s + (x.ad ?? 0), 0) * AD_GOLD;
    apGold += its.reduce((s, x) => s + (x.ap ?? 0), 0) * AP_GOLD;
  });
  const total = adGold + apGold;
  return { armorStackers, healers, adShare: total >= DAMAGE_GOLD_MIN ? adGold / total : null };
}

/** Analyse de la draft corrigée par les items adverses. Renvoie les raisons des corrections. */
export function adjustAnalysis(x: Analysis, it: EnemyItems): { x: Analysis; reasons: string[] } {
  const reasons: string[] = [];
  const y = { ...x };
  if (it.armorStackers) {
    y.tanks += it.armorStackers;
    reasons.push(`${it.armorStackers} adversaire(s) avec ${ARMOR_STACKER}+ d'armure en items`);
  }
  if (it.healers) {
    y.heals += it.healers;
    reasons.push(`${it.healers} adversaire(s) avec vol de vie / omnivampirisme`);
  }
  if (it.adShare !== null) {
    const ad = (x.adShare + it.adShare) / 2;
    if (Math.abs(ad - x.adShare) >= 0.1) reasons.push(`items adverses : ${Math.round(it.adShare * 100)} % de stats physiques`);
    y.adShare = ad;
    y.apShare = 1 - ad;
  }
  return { x: y, reasons };
}

export interface ItemLite { id: string; name: string; icon: string; cost: number }

export interface OverlayView {
  gold: number;
  form: Form;
  formForced: boolean;
  /** null : build terminé. */
  next: null | {
    item: ItemLite;
    /** Position dans le build (1 à 6), 0 pour le familier de jungle (item de départ). */
    rank: number;
    /** Justification (familier de jungle). */
    why?: string;
    /** Or manquant pour le finir (0 : achetable maintenant). */
    missingGold: number;
    /** Composant le plus cher achetable maintenant, si l'item complet ne l'est pas. */
    component: ItemLite | null;
  };
  /** Les items suivants du build (aperçu). */
  then: ItemLite[];
  owned: number;
  reasons: string[];
  notKayn: boolean;
}

const lite = (id: string, shop: Shop): ItemLite => ({ id, name: shop[id]?.name ?? id, icon: icon(id), cost: shop[id]?.cost ?? 0 });

export function buildOverlayView(s: LiveSnapshot, formChoice: Form | "auto", shop: Shop = SHOP): OverlayView {
  const enemies = s.enemies.map((e) => (e.champion ? findChamp(e.champion) ?? null : null));
  const allies = s.allies.map((a) => (a ? findChamp(a) ?? null : null));
  const base = analyse(enemies, allies);
  const { x, reasons } = adjustAnalysis(base, readEnemyItems(s.enemies, enemies, shop));
  const form = resolveForm(base, formChoice);
  const build: ItemKey[] = chooseBuild(x, form).b;
  const ids = build.map((k) => ITEMS[k].id!).filter(Boolean);

  const bag = bagOf(s.me.items);
  const ownedFlags = ids.map((id) => owns(bag, id, shop));
  const idx = ownedFlags.indexOf(false);
  let next: OverlayView["next"] = null;
  // Début de partie : ni familier ni item du build → le familier d'abord.
  const petOwned = s.me.items.some((id) => STARTER_ITEM_IDS.has(String(id)));
  const starterFirst = !petOwned && !ownedFlags.some(Boolean);
  if (starterFirst) {
    const [key, why] = chooseStarter(base)[0];
    const pet = STARTERS[key];
    next = {
      item: { id: pet.id, name: pet.nameFr, icon: icon(pet.id), cost: pet.cost },
      rank: 0,
      why,
      missingGold: Math.max(0, pet.cost - s.gold),
      component: null,
    };
  } else if (idx >= 0) {
    const id = ids[idx];
    const r = remainingCost(id, bagOf(s.me.items), shop);
    const missingGold = Math.max(0, r.gold - s.gold);
    let component: ItemLite | null = null;
    if (missingGold > 0) {
      // Composant manquant le plus cher qu'on peut payer (prix de recette compris pour un intermédiaire).
      const affordable = [...new Set(r.missing)]
        .map((c) => ({ c, cost: remainingCost(c, bagOf(s.me.items), shop).gold }))
        .filter((o) => o.cost > 0 && o.cost <= s.gold)
        .sort((a, b) => b.cost - a.cost)[0];
      if (affordable) component = { ...lite(affordable.c, shop), cost: affordable.cost };
    }
    next = { item: { ...lite(id, shop), cost: r.gold }, rank: idx + 1, missingGold, component };
  }
  return {
    gold: s.gold,
    form,
    formForced: formChoice !== "auto",
    next,
    then: ids.filter((_, i) => !ownedFlags[i] && (starterFirst || i !== idx)).slice(0, 2).map((id) => lite(id, shop)),
    owned: ownedFlags.filter(Boolean).length,
    reasons,
    notKayn: !!s.me.champion && s.me.champion !== "Kayn",
  };
}
