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
  $("method").innerHTML = `<b>Méthode & limites.</b>
    <p><b>Vérifié (18/11/2026, patch ${PATCH}).</b> Stats des items et stats de base de Kayn : Data Dragon ${DDRAGON_VERSION} (croissance d'AD de Kayn : 3,3 / niveau selon le wiki, Data Dragon donnant 0). Ratios de Kayn, passifs d'items, runes et fragments : wiki officiel (wiki.leagueoflegends.com). Q bleu 75–195 (+85 % AD bonus) par coup ; Q rouge 65 % AD (+6 % des PV max, +3,5 % par 100 AD bonus) par coup ; W 85–265 (+110 % AD bonus) ; R bleu 150–350 (+150 % AD bonus) ; R rouge 15 % des PV max (+10 % par 100 AD bonus), soin 11,25 % (+7,5 % par 100 AD bonus) ; passif Shadow Assassin 20 → 40 % de dégâts magiques bonus ; passif Rhaast : soin de 25 % (+0,5 % par 100 PV bonus) des dégâts physiques des sorts. Voltaic 8 % des PV actuels et +15 létha ; Hubris 15 AD + 3 par stack ; Serpent's −50 % de bouclier ; Black Cleaver −30 % d'armure ; Serylda 35 % de pénétration ; Death's Dance diffère 30 % des dégâts physiques et magiques ; Bastionbreaker 40 (+1,5 par létha) dégâts bruts ; Axiom rembourse 10 % (+0,25 % par létha) du CD du R. Dark Harvest 30 (+11 par âme, +10 % AD bonus) sous 50 % des PV ; Conqueror 12 stacks × 1,8 → 4 de force adaptative (× 0,6 AD), soin de 8 %. Fragments : 2 × 9 de force adaptative (+10,8 AD) et PV évolutifs (10 par niveau).</p>
    <p><b>Hypothèses du modèle</b> (choix, pas des valeurs de jeu) : combo bleu W › Q › AA › R › AA ; combat rouge de 6 s avec 65 % du temps passé à auto-attaquer, Cleaver à 5 stacks, 2 procs de Voltaic à 60 % des PV de la cible, 1 proc de Bastionbreaker, Conqueror à 12 stacks tout le combat (majorant) ; la moitié des dégâts différés par Death's Dance purgée par un kill ; Dark Harvest déclenché par le premier coup porté à une cible déjà sous 50 %. Ordre des sorts Q › W › E, R à 6/11/16. <b>Cibles</b> = profils types estimés (PV, armure, RM moyens), pas des champions précis.</p>
    <p><b>Non modélisé :</b> remboursement du R par Axiom, ralentissement de Serylda, bouclier anti-sort d'Edge of Night, Lifeline de Sterak, résurrection de GA, réduction des dégâts d'attaque de Steelcaps, actif de Profane, vitesse de Youmuu. Win rates : Skill Capped, Mobalytics, LoLalytics (Émeraude+, patch 26.22, non mis à jour automatiquement).</p>
    <p><b>Draft :</b> profil, type de dégâts, CC, boucliers, soins et ralentissements viennent de <code>overrides.json</code> (édité à la main) ; un champion absent de ce fichier est marqué « ? ». C'est une simplification : la recommandation donne une tendance, pas une vérité absolue. Icônes : images officielles de Data Dragon ; si elles ne chargent pas, des pictogrammes originaux les remplacent.</p>`;
}
