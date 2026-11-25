// Worker du moteur de données : reçoit { id, fn, args }, renvoie { id, ok, value | error, ms }.
// Il tourne à côté du processus principal : un calcul long ne bloque ni l'appli ni ses fenêtres.
import { parentPort, workerData } from "node:worker_threads";
import { Engine } from "./engine.ts";

const engine = new Engine((workerData as { dbFile: string }).dbFile);
type Fn = keyof typeof calls;
const calls = {
  overview: (filter: Parameters<Engine["overview"]>[0], compare: number | null, excluded: number[]) => engine.overview(filter, compare, excluded),
  analysis: (key: string | null, filter: Parameters<Engine["analysis"]>[1], excluded: number[]) => engine.analysis(key, filter, excluded),
  goals: (startMs: number, targets: Record<string, number>, excluded: number[]) => engine.goals(startMs, targets, excluded),
  reco: (excluded: number[]) => engine.reco(excluded),
  metaView: (scope: number) => engine.metaView(scope),
  myGames: () => engine.myGames(),
  draftExtras: (...a: Parameters<Engine["draftExtras"]>) => engine.draftExtras(...a),
  statBuild: (...a: Parameters<Engine["statBuild"]>) => engine.statBuild(...a),
};
export type EngineCalls = typeof calls;

parentPort!.on("message", (m: { id: number; fn: Fn; args: unknown[] }) => {
  const t0 = performance.now();
  try {
    const value = (calls[m.fn] as (...a: unknown[]) => unknown)(...m.args);
    parentPort!.postMessage({ id: m.id, ok: true, value, ms: performance.now() - t0 });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e), ms: performance.now() - t0 });
  }
});
