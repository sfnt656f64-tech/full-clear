// Journal de l'appli installée : une ligne par événement utile au diagnostic (analyse d'après-partie, notification),
// dans %APPDATA%\full-clear\journal.log. Local seulement ; aucun pseudo ni clé, seulement des identifiants de partie.
// Limité à environ 200 Ko : au-delà, la moitié la plus ancienne est retirée.
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";

const MAX_BYTES = 200_000;
let file: string | null = null;

export function openJournal(path: string): void { file = path; }

export function journal(event: string, detail = ""): void {
  if (!file) return;
  const line = `${new Date().toISOString()} ${event}${detail ? ` ${detail}` : ""}\n`;
  try {
    try {
      if (statSync(file).size > MAX_BYTES) {
        const text = readFileSync(file, "utf8");
        writeFileSync(file, text.slice(text.indexOf("\n", text.length / 2) + 1));
      }
    } catch { /* fichier absent : créé ci-dessous */ }
    appendFileSync(file, line);
  } catch { /* disque plein ou dossier inaccessible : le journal ne doit jamais gêner l'appli */ }
}
