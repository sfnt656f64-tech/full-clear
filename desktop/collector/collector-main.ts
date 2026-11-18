// Point d'entrée du processus de collecte (utilityProcess d'Electron) : séparé de l'interface,
// en priorité basse pour ne jamais ralentir le PC ni le jeu.
//   argv[2] : chemin de la base (riot.db)
import { constants, setPriority } from "node:os";
import { Collector } from "./collector.ts";
import type { FromCollector, ToCollector } from "./protocol.ts";
import { RiotScheduler } from "./scheduler.ts";
import { CollectorStore } from "./store.ts";

interface ParentPort {
  on(event: "message", cb: (e: { data: ToCollector }) => void): void;
  postMessage(msg: FromCollector): void;
}
const port = (process as unknown as { parentPort: ParentPort }).parentPort;

try { setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* priorité inchangée */ }

const dbFile = process.argv[2];
let store: CollectorStore;
try {
  store = new CollectorStore(dbFile);
} catch (e) {
  port.postMessage({ type: "fatal", message: `Base de collecte illisible : ${(e as Error).message}` });
  process.exit(1);
}

const api = new RiotScheduler({ apiKey: "" });
const collector = new Collector({ store, api, onStatus: (status) => port.postMessage({ type: "status", status }) });
// Pas de clé tant que le processus principal n'a pas envoyé la configuration.
api.pause("config");
const timer = setInterval(() => collector.tick(), 5_000);

port.on("message", ({ data: m }) => {
  switch (m.type) {
    case "configure":
      api.setApiKey(m.apiKey);
      api.resume("config");
      collector.configure(m.accounts);
      collector.start();
      break;
    case "pause":
      collector.pause(m.reason);
      break;
    case "resume":
      collector.resume(m.reason);
      break;
    case "stop":
      clearInterval(timer);
      collector.stop();
      store.close();
      process.exit(0);
  }
});
