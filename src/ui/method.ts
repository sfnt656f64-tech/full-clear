import { DDRAGON_VERSION, PATCH } from "../data/version";
import { champ } from "../data/champions";
import { $ } from "./html";
import { ddImg } from "./icons";

/** Nom du projet, repris dans la mention légale de Riot. */
export const PRODUCT_NAME = "Kayn Sim";

/**
 * « Legal Jibber Jabber » : mention exigée par la politique de Riot Games pour les projets de fans
 * (https://developer.riotgames.com/policies/general), texte officiel en anglais + traduction.
 */
export const RIOT_LEGAL = `${PRODUCT_NAME} isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.`;

export function renderFooter(): void {
  $("legal").innerHTML = `<p>${RIOT_LEGAL}</p>`
    + `<p>${PRODUCT_NAME} n'est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de quiconque participe officiellement à la production ou à la gestion des propriétés de Riot Games. Riot Games et toutes les propriétés associées sont des marques commerciales ou des marques déposées de Riot Games, Inc.</p>`
    + `<p>Projet personnel et non commercial. Images et données du jeu : Data Dragon ${DDRAGON_VERSION}, fournies par Riot Games.</p>`;
}

export function renderHeader(): void {
  const kayn = champ("Kayn");
  if (kayn.image) $("logo").insertAdjacentHTML("beforeend", ddImg(`champion/${kayn.image}`, false));
  $("patch-line").innerHTML = `<b class="patch">Patch ${PATCH}</b> · stats des items et des champions : Data Dragon ${DDRAGON_VERSION}`;
  $("pills").innerHTML = `<span class="pill">WR jungle <b>52 %</b> (LoLalytics É+, 26.22)</span><span class="pill">Tier A</span><span class="pill">Ordre des sorts : Q &gt; W &gt; E</span>`;
}

export function renderMethod(): void {
  $("method").innerHTML = `<b>Méthode & limites.</b> <b>Données :</b> stats des items, stats de base de Kayn, liste et portée des champions synchronisées avec Data Dragon ${DDRAGON_VERSION} (patch ${PATCH}) ; la croissance d'AD de Kayn (3,3 / niveau) vient du wiki officiel, Data Dragon donnant 0. Kayn : ratios des sorts repris de la première version, non vérifiés (Q bleu 75–195 +85 % AD bonus par coup ; Q rouge 65 % AD +6 % PV max +3,5 % par 100 AD bonus par coup ; R rouge 15 % PV max +10 % par 100 AD bonus ; passif Assassin 20→40 % de dégâts magiques bonus pendant 3 s). Ordre des sorts Q›W›E, R aux niveaux 6/11/16. Fragments : 2× adaptatif (+10,8 AD). Armure effective = armure × (1 − réduction Cleaver) × (1 − % pén) − létha. Les runes clés (Dark Harvest, Conqueror) ne sont pas modélisées. <b>Cibles</b> = profils types estimés (PV et armure moyens), pas des champions précis. <b>Non vérifié :</b> les passifs d'items (réduction d'armure de Cleaver 30 %, réduction de bouclier de Serpent's ~50 %, Hubris, Voltaic), le soin de Rhaast et les ratios de Kayn seront confrontés au wiki officiel à l'étape suivante. Le combat de Rhaast suppose environ 65 % du temps passé à auto-attaquer et Cleaver à 5 stacks. Win rates : Skill Capped, Mobalytics, LoLalytics (Émeraude+, patch 26.22, non mis à jour automatiquement). <b>Draft :</b> profil, type de dégâts, CC, boucliers, soins et ralentissements viennent de <code>overrides.json</code> (édité à la main) ; un champion absent de ce fichier est marqué « ? ». Chaque champion est classé par profil (tank, combattant, assassin, mage, tireur, enchanteur), portée, type de dégâts, niveau de CC, boucliers, soins et ralentissements. C'est une simplification : la recommandation donne une tendance, pas une vérité absolue. Icônes : images officielles de Data Dragon ; si elles ne chargent pas, des pictogrammes originaux les remplacent.`;
}
