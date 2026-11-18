// Messages entre le processus principal et le processus de collecte.
import type { CollectorStatus } from "./collector.ts";

export type ToCollector =
  /** La clé ne transite qu'en mémoire, du processus principal vers le processus de collecte. */
  | { type: "configure"; apiKey: string; accounts: string[] }
  | { type: "pause"; reason: string }
  | { type: "resume"; reason: string }
  | { type: "stop" };

export type FromCollector =
  | { type: "status"; status: CollectorStatus }
  | { type: "fatal"; message: string };
