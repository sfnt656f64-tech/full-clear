// Messages entre le processus principal et le processus de collecte.
import type { CollectorStatus } from "./collector.ts";

export type ToCollector =
  /** La clé ne transite qu'en mémoire, du processus principal vers le processus de collecte. */
  | { type: "configure"; apiKey: string; accounts: string[]; excluded: number[] }
  | { type: "pause"; reason: string }
  | { type: "resume"; reason: string }
  /** Fin de partie : chercher tout de suite la nouvelle partie (analyse d'après-partie). */
  | { type: "checkNewGames" }
  | { type: "stop" };

export type FromCollector =
  | { type: "status"; status: CollectorStatus }
  | { type: "fatal"; message: string };
