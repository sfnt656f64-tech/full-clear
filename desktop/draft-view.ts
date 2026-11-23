// Draft en direct → recommandation affichable (forme, runes, bottes, build), avec le moteur du site.
import { champByKey } from "../src/data/champions";
import { RUNES, type RunePage } from "../src/data/guides";
import { BOOTS_T3, ITEMS } from "../src/data/items";
import { STARTERS } from "../src/data/starters";
import type { Champion, Form, ItemKey, StarterKey } from "../src/data/types";
import { DDRAGON_VERSION } from "../src/data/version";
import { analyse, resolveForm } from "../src/engine/analyse";
import { draftReport, MIN_ENEMIES } from "../src/engine/draft";
import { encodeDraft } from "../src/engine/draft-link";
import type { DraftSnapshot } from "./champ-select.ts";
import type { DraftPicks } from "./reco/draft-pick.ts";
import type { RecommendedPage } from "./runes/rune-page.ts";
import type { LaneRow } from "./reco/lanes.ts";

export const KAYN_KEY = 141;
export const DDRAGON_IMG = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img`;

export interface ChampLite { id: string; name: string; icon: string }
export interface ItemLite { key: ItemKey; name: string; icon: string; cost: number }
export interface StarterLite { key: StarterKey; name: string; nameFr: string; icon: string; cost: number; why: string; effect: string }

export interface DraftView {
  timerPhase: string;
  timeLeftS: number;
  me: { champion: ChampLite | null; locked: boolean; position: string };
  /** Tu as (ou survoles) un autre champion que Kayn. */
  notKayn: boolean;
  /** Tu survoles ou as verrouillé Kayn : la section Kayn (forme, runes, build) s'affiche. */
  isKayn: boolean;
  allies: (ChampLite | null)[];
  enemies: (ChampLite | null)[];
  enemyCount: number;
  /** Champions non reconnus (données à resynchroniser). */
  unknown: number;
  /** null tant qu'aucun adversaire n'est connu. */
  form: null | {
    value: Form;
    /** Moins de 3 adversaires : seule la forme et les runes sont données. */
    provisional: boolean;
    /** Score > 0 bleu, < 0 rouge ; « serré » si |score| < 0,5. */
    score: number;
    close: boolean;
    why: string[];
  };
  runes: RunePage | null;
  /** À partir de 3 adversaires. */
  build: null | {
    /** Familier de jungle (item de départ) : recommandation puis alternatives. */
    starter: StarterLite[];
    boots: { name: string; t3: string; why: string }[];
    items: ItemLite[];
    /** Justifications : seul <b> est autorisé (texte produit par le moteur). */
    notes: string[];
  };
  /** Fragment #draft=… pour ouvrir la draft dans le simulateur complet. */
  link: string;
  /** Choix du champion (jungle, milieu) selon la draft ; ajouté par le processus principal. */
  picks?: DraftPicks | null;
  /** Les deux équipes rangées Top → Support (rôles adverses probables) ; ajouté par le processus principal. */
  lanes?: LaneRow<ChampLite>[] | null;
  /** Page de runes recommandée pour le champion survolé ou verrouillé (importable) ; ajoutée par le processus principal. */
  runePage?: (RecommendedPage & { championName: string }) | null;
}

const lite = (c: Champion): ChampLite => ({ id: c.id ?? c.name, name: c.name, icon: `${DDRAGON_IMG}/champion/${c.image ?? `${c.id}.png`}` });
const itemLite = (k: ItemKey): ItemLite => {
  const it = ITEMS[k];
  return { key: k, name: it.n, icon: it.image ? `${DDRAGON_IMG}/item/${it.image}` : "", cost: it.cost };
};

export function buildDraftView(s: DraftSnapshot): DraftView {
  let unknown = 0;
  const resolve = (id: number): Champion | null => {
    if (!id) return null;
    const c = champByKey(id);
    if (!c) unknown++;
    return c ?? null;
  };
  const enemies = s.enemies.slice(0, 5).map((e) => resolve(e.championId));
  while (enemies.length < 5) enemies.push(null);
  const allies = s.allies.slice(0, 4).map((a) => resolve(a.championId));
  while (allies.length < 4) allies.push(null);
  const meId = s.me.championId || s.me.intentId;
  const me = resolve(meId);

  const x = analyse(enemies, allies);
  const enemyCount = x.E.length;
  let form: DraftView["form"] = null;
  if (enemyCount) {
    const value = resolveForm(x, "auto");
    form = { value, provisional: enemyCount < MIN_ENEMIES, score: Math.round(x.sc * 10) / 10, close: x.form === "either", why: x.why };
  }
  const rep = enemyCount >= MIN_ENEMIES ? draftReport(enemies, allies, "mid", "auto") : null;

  return {
    timerPhase: s.timerPhase,
    timeLeftS: Math.ceil(s.timeLeftMs / 1000),
    me: { champion: me ? lite(me) : null, locked: !!s.me.championId, position: s.me.position },
    notKayn: !!meId && meId !== KAYN_KEY,
    isKayn: meId === KAYN_KEY,
    allies: allies.map((c) => (c ? lite(c) : null)),
    enemies: enemies.map((c) => (c ? lite(c) : null)),
    enemyCount,
    unknown,
    form,
    runes: form ? RUNES[form.value] : null,
    build: rep && {
      starter: rep.starter.map(([k, why]) => {
        const s = STARTERS[k];
        return { key: k, name: s.name, nameFr: s.nameFr, icon: `${DDRAGON_IMG}/item/${s.image}`, cost: s.cost, why, effect: s.effectFr };
      }),
      boots: rep.boots.map(([k, why]) => ({ name: ITEMS[k].n, t3: BOOTS_T3[k], why })),
      items: rep.build.map(itemLite),
      notes: rep.notes,
    },
    link: encodeDraft({ en: enemies.map((c) => c?.id ?? null), al: allies.map((c) => c?.id ?? null), src: "live" }),
  };
}
