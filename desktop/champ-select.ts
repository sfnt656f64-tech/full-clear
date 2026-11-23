// Session de sélection des champions (LCU /lol-champ-select/v1/session), réduite au strict nécessaire.
//
// Confidentialité : la réponse du client contient les pseudos, PUUID et identifiants des autres joueurs.
// toDraftSnapshot() n'en recopie AUCUN : uniquement des numéros de champion, des postes et le chrono.
// Le JSON brut n'est jamais conservé, journalisé ni envoyé à la fenêtre.

/** Ce qui sort de la session : rien d'autre ne circule dans l'appli. */
export interface DraftSnapshot {
  /** BAN_PICK, PLANNING, FINALIZATION, GAME_STARTING… */
  timerPhase: string;
  /** Temps restant dans la phase, en ms. */
  timeLeftMs: number;
  me: {
    /** Champion verrouillé (0 si aucun). */
    championId: number;
    /** Champion survolé avant verrouillage (0 si aucun). */
    intentId: number;
    position: string;
  };
  /** Tes 4 alliés : champion verrouillé, ou 0. */
  allies: { championId: number; position: string }[];
  /** Adversaires : champion révélé, ou 0. */
  enemies: { championId: number }[];
  /** C'est à toi de choisir (ton pick est en cours). */
  myTurn: boolean;
  /** Champions bannis ou déjà pris (des deux côtés) : impossibles à choisir. */
  unavailable: number[];
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
const str = (v: unknown): string => (typeof v === "string" && /^[A-Za-z_]{0,20}$/.test(v) ? v : "");
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);

/**
 * Champions verrouillés, d'après les actions de pick terminées (plus fiable que championId des équipes,
 * qui peut refléter un survol selon les modes).
 */
function lockedByCell(actions: unknown): Map<number, number> {
  const out = new Map<number, number>();
  for (const turn of Array.isArray(actions) ? actions : []) {
    for (const a of arr(turn)) {
      if (a.type === "pick" && a.completed === true && num(a.championId)) out.set(Number(a.actorCellId), num(a.championId));
    }
  }
  return out;
}

/** Ton pick est-il en cours ? */
function isMyTurn(actions: unknown, myCell: number): boolean {
  for (const turn of Array.isArray(actions) ? actions : []) {
    for (const a of arr(turn)) if (a.type === "pick" && a.actorCellId === myCell && a.isInProgress === true && a.completed !== true) return true;
  }
  return false;
}

/** Bans terminés et picks verrouillés (numéros de champion seulement). */
function unavailableIds(actions: unknown, bans: unknown): number[] {
  const out = new Set<number>();
  for (const turn of Array.isArray(actions) ? actions : []) {
    for (const a of arr(turn)) if ((a.type === "ban" || a.type === "pick") && a.completed === true && num(a.championId)) out.add(num(a.championId));
  }
  const b = (bans && typeof bans === "object" ? bans : {}) as Record<string, unknown>;
  for (const list of [b.myTeamBans, b.theirTeamBans]) for (const id of Array.isArray(list) ? list : []) if (num(id)) out.add(num(id));
  return [...out].sort((x, y) => x - y);
}

export function toDraftSnapshot(raw: unknown): DraftSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const myTeam = arr(s.myTeam);
  const theirTeam = arr(s.theirTeam);
  if (!myTeam.length) return null;
  const myCell = typeof s.localPlayerCellId === "number" ? s.localPlayerCellId : -1;
  const locked = lockedByCell(s.actions);
  const hasActions = Array.isArray(s.actions) && s.actions.length > 0;
  // Avec des actions (draft, blind) : seul un pick terminé compte. Sans actions (certains modes) : championId.
  const champOf = (p: Record<string, unknown>) => (hasActions ? locked.get(Number(p.cellId)) ?? 0 : num(p.championId));

  const meRaw = myTeam.find((p) => p.cellId === myCell);
  const timer = (s.timer && typeof s.timer === "object" ? s.timer : {}) as Record<string, unknown>;
  return {
    timerPhase: str(timer.phase),
    timeLeftMs: num(timer.adjustedTimeLeftInPhase),
    me: {
      championId: meRaw ? champOf(meRaw) : 0,
      intentId: meRaw ? num(meRaw.championPickIntent) || num(meRaw.championId) : 0,
      position: meRaw ? str(meRaw.assignedPosition) : "",
    },
    allies: myTeam.filter((p) => p !== meRaw).map((p) => ({ championId: champOf(p), position: str(p.assignedPosition) })),
    // Côté adverse, championId n'est rempli par le client qu'une fois le champion révélé.
    enemies: theirTeam.map((p) => ({ championId: hasActions ? locked.get(Number(p.cellId)) ?? num(p.championId) : num(p.championId) })),
    myTurn: isMyTurn(s.actions, myCell),
    unavailable: unavailableIds(s.actions, s.bans),
  };
}
