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
import type { StatBuild } from "./coach/stat-build.ts";

export interface ShopItem {
  name: string; cost: number; from?: string[];
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
  /** Règles « si… alors… » écrites avant la partie : à appliquer toi-même. */
  ifThen: string[];
  /** Méta : parties utilisées pour le build. */
  buildGames?: number;
  /** Conseils d'avant-partie affichés en ce moment (deux au plus), ajoutés par le processus principal. */
  tips?: string[];
}

const lite = (id: string, shop: Shop): ItemLite => ({ id, name: shop[id]?.name ?? id, icon: icon(id), cost: shop[id]?.cost ?? 0 });
const plain = (html: string) => html.replace(/<[^>]+>/g, "");

/** Règles « si… alors… » de Kayn, écrites avant la partie (mêmes situations que les guides du simulateur). */
function kaynIfThen(form: Form, build: string[]): string[] {
  const out: string[] = [];
  if (form === "blue") {
    if (!build.includes("serylda")) out.push("Si leur frontline empile l'armure : Serylda's Grudge plus tôt (4ᵉ).");
    if (build.includes("hubris")) out.push("Si tu n'as pas de kills : Youmuu's Ghostblade à la place d'Hubris (son passif demande des kills).");
    out.push("Si tu domines mais n'arrives pas à fermer : Bastionbreaker en 6ᵉ pour prendre les tours.");
  } else {
    if (!build.includes("dd")) out.push("Si leurs dégâts physiques prennent l'avance : Death's Dance plus tôt.");
    if (!build.includes("sterak")) out.push("Si leurs dégâts magiques prennent l'avance : Mercury's Treads et Sterak's Gage.");
    out.push("Si tu es devant et qu'ils empilent l'armure : Serylda's Grudge après Black Cleaver.");
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
    if (!stat) return { ...common, source: "none", starter: null, build: [], reasons: [], ifThen: [] };
    const pet = stat.starter ? Object.values(STARTERS).find((p) => p.id === stat.starter) : undefined;
    return {
      ...common, source: "meta", buildGames: stat.games,
      starter: pet ? { ...lite(pet.id, shop), name: pet.name, cost: pet.cost, why: "Le plus joué en Émeraude+ sur ce champion." } : null,
      build: stat.ids.map((id) => lite(id, shop)), reasons: stat.reasons, ifThen: stat.ifThen,
    };
  }
  const choice = chooseBuild(base, form);
  const [key, why] = chooseStarter(base)[0];
  const pet = STARTERS[key];
  return {
    ...common, source: "kayn",
    starter: { ...lite(pet.id, shop), name: pet.name, cost: pet.cost, why },
    build: choice.b.map((k) => ITEMS[k].id!).filter(Boolean).map((id) => lite(id, shop)),
    reasons: choice.notes.map(plain), ifThen: kaynIfThen(form, choice.b),
  };
}
