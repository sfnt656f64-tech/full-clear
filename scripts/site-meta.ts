// Chiffres de méta du site (simulateur Kayn), tirés de la méta collectée par l'appli de bureau : Kayn en jungle,
// deux derniers patchs, toutes les parties collectées (Émeraude et au-dessus). Agrégats anonymes de parties
// publiques : aucun identifiant, aucun Riot ID, rien de tes propres parties.
//
// Usage : npm run site:meta [-- chemin/vers/riot.db]   (par défaut : %APPDATA%\full-clear\riot.db)
// Écrit src/data/generated/kayn-meta.json, à commiter avec la date de génération.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildKaynMeta, type MetaRow } from "../src/data/kayn-meta";

const file = process.argv[2] ?? join(process.env.APPDATA ?? "", "full-clear", "riot.db");
const db = new DatabaseSync(file, { readOnly: true });
const patches = (db.prepare("select patch from meta_games group by patch").all() as { patch: string }[])
  .map((r) => r.patch).sort((a, b) => { const [x, y] = a.split(".").map(Number), [u, v] = b.split(".").map(Number); return u - x || v - y; }).slice(0, 2);
const marks = patches.map(() => "?").join(",");
const rows = db.prepare(`select g.patch, p.win, p.perks from meta_parts p join meta_games g on g.match_id = p.match_id
  where g.remake = 0 and p.champion_id = 141 and p.role = 'JUNGLE' and g.patch in (${marks})`).all(...patches) as unknown as MetaRow[];
const out = buildKaynMeta(rows, patches, new Date().toISOString().slice(0, 10));
writeFileSync(join(process.cwd(), "src", "data", "generated", "kayn-meta.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`Kayn jungle : ${out.games} parties (${patches.join(", ")}), ${out.wins} victoires.`);
