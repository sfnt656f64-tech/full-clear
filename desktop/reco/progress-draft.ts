// Draft en mode « Progresser » (jungle), selon la file lue dans le client. Fonction pure.
import { STAGE_LABEL, type ComfortEntry, type Stage } from "./progression.ts";
import type { DraftPickInput } from "./draft-pick.ts";

/** Files classées (Solo/Duo, flexible) et noms des files courantes. */
export const RANKED_QUEUES = new Set([420, 440]);
export const QUEUE_NAMES: Record<number, string> = { 420: "Classée Solo/Duo", 440: "Classée flexible", 400: "Normale en draft", 430: "Normale en aveugle", 490: "Partie rapide" };
/** Stades qui autorisent un champion de progression en classée. */
export const RANKED_READY = new Set<Stage>(["readyToTest", "toConfirm", "confirmed"]);

/**
 * - normale : tes champions de progression d'abord ;
 * - classée (ou file inconnue, par prudence) : seulement ceux au stade « Prêt à tester », « À confirmer » ou
 *   « Confirmé », sinon ton champion de confort ; jamais un champion « Retour en normale conseillé » ni un champion
 *   pas encore prêt ;
 * - jamais un champion « Pas pour moi ».
 */
export function progressPriority(
  queueId: number,
  p: { tracking: { championId: number; stage: Stage; text: string }[]; comfort: ComfortEntry[]; notForMe: number[] },
): Pick<DraftPickInput, "priority" | "blocked" | "rule"> {
  const blocked = [...p.notForMe];
  const label = (t: { stage: Stage; text: string }) => `${STAGE_LABEL[t.stage]} : ${t.text.replace(/\.$/, "")}`;
  const tracking = p.tracking.filter((t) => !blocked.includes(t.championId));
  if (queueId !== 0 && !RANKED_QUEUES.has(queueId)) {
    return {
      blocked, rule: `${QUEUE_NAMES[queueId] ?? "Partie hors classée"} (file lue dans le client) : tes champions de progression d'abord (les 3 que cette draft favorise le plus, sur ${tracking.length}), puis ton meilleur choix habituel.`,
      priority: tracking.map((t) => ({ championId: t.championId, group: 0, tag: "Progression", why: `Champion de progression (${STAGE_LABEL[t.stage]}) : en normale, c'est le moment de le jouer.` })),
    };
  }
  const ok = tracking.filter((t) => RANKED_READY.has(t.stage));
  blocked.push(...tracking.filter((t) => !RANKED_READY.has(t.stage)).map((t) => t.championId));
  const comfort = p.comfort.find((c) => c.flag !== "notForMe" && !blocked.includes(c.championId));
  const priority = ok.length
    ? ok.map((t) => ({ championId: t.championId, group: 0, tag: "Progression", why: `Prêt pour la classée (${label(t)}).` }))
    : comfort ? [{ championId: comfort.championId, group: 0, tag: "Confort", why: `Ton champion de confort (${comfort.games} parties) : aucun champion de progression au stade « Prêt à tester », « À confirmer » ou « Confirmé ».` }] : [];
  return {
    blocked, priority,
    rule: `${queueId ? `${QUEUE_NAMES[queueId]} (file lue dans le client)` : "File inconnue : règles de la classée, par prudence"} : seulement tes champions de progression prêts (« Prêt à tester », « À confirmer », « Confirmé »), sinon ton champion de confort ; jamais un champion « Retour en normale conseillé » ou pas encore prêt.`,
  };
}
