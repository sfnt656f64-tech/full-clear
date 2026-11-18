// Résumé d'une partie match-v5 (+ chronologie) en un enregistrement compact, gardé dans le cache local.
// Fonctions pures : testées sur des parties inventées (tests/stats.test.ts).

/** Sous-ensemble utile de match-v5 (MatchDto). */
export interface MatchDto {
  metadata: { matchId: string };
  info: {
    gameCreation: number;
    gameDuration: number;
    gameVersion: string;
    queueId: number;
    participants: {
      puuid: string;
      participantId: number;
      teamId: number;
      championId: number;
      /** Kayn : 0 = pas de transformation, 1 = Rhaast (Darkin Slayer), 2 = Shadow Assassin. */
      championTransform?: number;
      win: boolean;
      gameEndedInEarlySurrender?: boolean;
      item0: number; item1: number; item2: number; item3: number; item4: number; item5: number; item6: number;
    }[];
  };
}

/** Sous-ensemble utile de la chronologie (TimelineDto). */
export interface TimelineDto {
  info: { frames: { events: { type: string; participantId?: number; itemId?: number; beforeId?: number; timestamp: number }[] }[] };
}

export type PlayedForm = "blue" | "red" | "none";

/** Version du format : un enregistrement d'une autre version est re-téléchargé. */
export const RECORD_VERSION = 1;

export interface GameRecord {
  v: number;
  id: string;
  kayn: true;
  /** Début de la partie (ms). */
  start: number;
  durationS: number;
  /** Patch (« 16.22 » pour la version 16.22.xxx). */
  patch: string;
  win: boolean;
  /** Partie écourtée par un remake (exclue des stats). */
  remake: boolean;
  form: PlayedForm;
  /** Identifiants de champions (clé numérique Riot). */
  allies: number[];
  enemies: number[];
  /** Inventaire final (hors trinket). */
  finalItems: number[];
  /** Tous les achats dans l'ordre (annulations retirées), null si la chronologie manque. */
  purchases: number[] | null;
}

export interface SkippedRecord { v: number; id: string; kayn: false }

export const KAYN_CHAMPION_ID = 141;

export const formFromTransform = (t: number | undefined): PlayedForm => (t === 1 ? "red" : t === 2 ? "blue" : "none");

/** Achats d'un participant dans l'ordre ; un ITEM_UNDO retire le dernier achat de l'item annulé. */
export function purchaseOrder(tl: TimelineDto, participantId: number): number[] {
  const out: number[] = [];
  for (const f of tl.info.frames) for (const e of f.events) {
    if (e.participantId !== participantId) continue;
    if (e.type === "ITEM_PURCHASED" && e.itemId) out.push(e.itemId);
    else if (e.type === "ITEM_UNDO" && e.beforeId) {
      const i = out.lastIndexOf(e.beforeId);
      if (i >= 0) out.splice(i, 1);
    }
  }
  return out;
}

/** Résume la partie du point de vue du joueur. Renvoie un SkippedRecord s'il ne jouait pas Kayn. */
export function summarizeMatch(m: MatchDto, timeline: TimelineDto | null, puuid: string): GameRecord | SkippedRecord {
  const id = m.metadata.matchId;
  const me = m.info.participants.find((p) => p.puuid === puuid);
  if (!me || me.championId !== KAYN_CHAMPION_ID) return { v: RECORD_VERSION, id, kayn: false };
  const others = m.info.participants.filter((p) => p !== me);
  return {
    v: RECORD_VERSION,
    id,
    kayn: true,
    start: m.info.gameCreation,
    durationS: m.info.gameDuration,
    patch: m.info.gameVersion.split(".").slice(0, 2).join("."),
    win: me.win,
    remake: !!me.gameEndedInEarlySurrender,
    form: formFromTransform(me.championTransform),
    allies: others.filter((p) => p.teamId === me.teamId).map((p) => p.championId),
    enemies: others.filter((p) => p.teamId !== me.teamId).map((p) => p.championId),
    finalItems: [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5].filter((x) => x > 0),
    purchases: timeline ? purchaseOrder(timeline, me.participantId) : null,
  };
}
