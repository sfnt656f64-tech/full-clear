import { $ } from "./html";

/** Patch des valeurs actuelles (reprises de la page d'origine). Remplacé par Data Dragon à l'étape 2. */
export const PATCH = "26.22";

export function renderHeader(): void {
  $("patch-line").textContent = `Patch ${PATCH} · Émeraude+ · stats des items reprises de la première version (non synchronisées)`;
  $("pills").innerHTML = `<span class="pill">WR jungle <b>52 %</b> (LoLalytics É+)</span><span class="pill">Tier A</span><span class="pill">Ordre des sorts : Q &gt; W &gt; E</span>`;
}

export function renderMethod(): void {
  $("method").innerHTML = `<b>Méthode & limites.</b> Kayn : stats et ratios du patch ${PATCH} (Q bleu 75–195 +85 % AD bonus par coup ; Q rouge 65 % AD +6 % PV max +3,5 % par 100 AD bonus par coup ; R rouge 15 % PV max +10 % par 100 AD bonus ; passif Assassin 20→40 % de dégâts magiques bonus pendant 3 s). Ordre des sorts Q›W›E, R aux niveaux 6/11/16. Fragments : 2× adaptatif (+10,8 AD). Armure effective = armure × (1 − réduction Cleaver) × (1 − % pén) − létha. Les runes clés (Dark Harvest, Conqueror) ne sont pas modélisées. <b>Cibles</b> = profils types estimés (PV et armure moyens), pas des champions précis. <b>Non vérifié :</b> les items marqués ≈ (GA, bottes), la réduction de bouclier de Serpent's (~50 %), le passif de Hubris, le soin de Rhaast et les ratios de Kayn seront confrontés au wiki officiel et à Data Dragon. Le combat de Rhaast suppose environ 65 % du temps passé à auto-attaquer et Cleaver à 5 stacks. Win rates : Skill Capped (patch ${PATCH}), Mobalytics, LoLalytics (Émeraude+). <b>Draft :</b> chaque champion est classé par profil (tank, combattant, assassin, mage, tireur, enchanteur), portée, type de dégâts, niveau de CC, boucliers, soins et ralentissements. C'est une simplification : la recommandation donne une tendance, pas une vérité absolue. Les icônes sont des pictogrammes originaux, pas les visuels officiels.`;
}
