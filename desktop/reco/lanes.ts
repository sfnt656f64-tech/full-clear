// Draft rangée par rôle (Top / Jungle / Mid / ADC / Support). Fonctions pures.
//
// - Ton équipe : postes assignés par le client.
// - En face : rôle le plus probable de chaque champion révélé, d'après la part de ses parties par rôle dans la
//   méta Émeraude+, en choisissant la répartition la plus probable de l'ensemble (deux adversaires ne peuvent
//   pas avoir le même rôle). Seuls les champions visibles par tous servent : rien de caché.
export const LANES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
export type Lane = (typeof LANES)[number];
export const LANE_LABELS: Record<Lane, string> = { TOP: "Top", JUNGLE: "Jungle", MIDDLE: "Mid", BOTTOM: "ADC", UTILITY: "Support" };
/** Postes du client (champ assignedPosition) → rôles. */
export const POSITION_LANE: Record<string, Lane> = { top: "TOP", jungle: "JUNGLE", middle: "MIDDLE", bottom: "BOTTOM", utility: "UTILITY" };

/** Parties par rôle pour chaque champion (méta). */
export type RoleShares = Map<number, Partial<Record<Lane, number>>>;

export function roleShares(parts: { championId: number; role: string }[]): RoleShares {
  const out: RoleShares = new Map();
  for (const p of parts) {
    if (!(LANES as readonly string[]).includes(p.role)) continue;
    const e = out.get(p.championId) ?? {};
    e[p.role as Lane] = (e[p.role as Lane] ?? 0) + 1;
    out.set(p.championId, e);
  }
  return out;
}

/** Probabilité (lissée) qu'un champion soit joué dans un rôle. */
export function roleProb(shares: RoleShares, championId: number, lane: Lane): number {
  const e = shares.get(championId) ?? {};
  const total = LANES.reduce((s, l) => s + (e[l] ?? 0), 0);
  return ((e[lane] ?? 0) + 0.2) / (total + 1); // un peu de lissage : un rôle jamais vu reste possible
}

/**
 * Répartition la plus probable des adversaires révélés (au plus 5) sur des rôles distincts.
 * Renvoie le rôle de chaque champion (même ordre que `enemies`).
 */
export function assignLanes(enemies: number[], shares: RoleShares): Lane[] {
  let best: Lane[] = [];
  let bestScore = -Infinity;
  const used = new Set<Lane>();
  const cur: Lane[] = [];
  const go = (i: number, score: number) => {
    if (score <= bestScore) return; // élagage : les log-probabilités ne font que baisser
    if (i === enemies.length) { best = [...cur]; bestScore = score; return; }
    for (const l of LANES) {
      if (used.has(l)) continue;
      used.add(l); cur.push(l);
      go(i + 1, score + Math.log(roleProb(shares, enemies[i], l)));
      used.delete(l); cur.pop();
    }
  };
  go(0, 0);
  return best;
}

export interface LaneRow<C> {
  lane: Lane;
  ally: C | null;
  /** C'est ton poste. */
  me: boolean;
  enemy: C | null;
  /** Rôle adverse déduit de la méta (jamais annoncé par le client). */
  probable: boolean;
}

/**
 * Lignes Top → Support. `allies` : tes alliés avec leur poste (toi compris, `me`) ; les alliés sans poste
 * (modes sans rôles) remplissent les lignes libres.
 */
export function laneRows<C>(
  allies: { champ: C | null; position: string; me?: boolean }[],
  enemies: { id: number; champ: C }[],
  shares: RoleShares,
): LaneRow<C>[] {
  const rows: LaneRow<C>[] = LANES.map((lane) => ({ lane, ally: null, me: false, enemy: null, probable: false }));
  const free: typeof allies = [];
  for (const a of allies) {
    const lane = POSITION_LANE[a.position];
    const row = lane && rows.find((r) => r.lane === lane);
    if (row && !row.ally && !row.me) { row.ally = a.champ; row.me = !!a.me; } else free.push(a);
  }
  for (const a of free) {
    const row = rows.find((r) => !r.ally && !r.me);
    if (row) { row.ally = a.champ; row.me = !!a.me; }
  }
  const lanes = assignLanes(enemies.map((e) => e.id), shares);
  enemies.forEach((e, i) => {
    const row = rows.find((r) => r.lane === lanes[i])!;
    row.enemy = e.champ;
    row.probable = true;
  });
  return rows;
}
