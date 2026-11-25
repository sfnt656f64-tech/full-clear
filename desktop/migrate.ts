// Changement de nom (Kayn Sim → Full Clear) : reprise du dossier de données %APPDATA%\kayn-sim dans
// %APPDATA%\full-clear, sans rien perdre et sans toucher à l'ancien dossier (gardé tant que tu n'as pas confirmé que
// tout fonctionne).
//
// - riot.db : copie cohérente par « vacuum into » (même si l'ancienne appli écrit encore dedans) ;
// - tout le reste (.env, settings.json, rapports, sauvegardes…) : copié tel quel ;
// - la copie est faite dans un dossier temporaire, vérifiée (mêmes fichiers, même taille, base lisible), puis
//   renommée : une copie interrompue n'est jamais prise pour le nouveau dossier.
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const LEGACY_DIR = "kayn-sim";
export const DATA_DIR = "full-clear";
export const MARKER = "migration.json";

export type MigrationResult =
  | { status: "none" }
  | { status: "migrated"; from: string; files: number; bytes: number }
  | { status: "failed"; from: string; error: string };

/** Fichiers (chemins relatifs) et tailles d'un dossier, sous-dossiers compris. */
function listFiles(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else out.set(relative(dir, p), statSync(p).size);
    }
  };
  walk(dir);
  return out;
}

/**
 * Ancienne base modifiée après la reprise : l'ancienne appli tourne encore (ses nouvelles parties ne sont pas dans la
 * copie). Renvoie la date de reprise dans ce cas, sinon null.
 */
export function legacyChangedSince(appData: string, from = LEGACY_DIR, to = DATA_DIR): string | null {
  try {
    const marker = JSON.parse(readFileSync(join(appData, to, MARKER), "utf8")) as { at: string };
    const at = Date.parse(marker.at);
    const changed = ["riot.db", "riot.db-wal", "settings.json", ".env"].some((f) => {
      const p = join(appData, from, f);
      return existsSync(p) && statSync(p).mtimeMs > at + 5_000;
    });
    return changed ? marker.at : null;
  } catch { return null; }
}

/**
 * Renommage du dossier copié, réessayé : sous Windows, un antivirus ou l'indexeur peut tenir un instant un fichier
 * qui vient d'être écrit (EPERM / EBUSY). Au-delà de ~2 s, l'erreur remonte (l'appli reste sur l'ancien dossier).
 */
function renameWithRetry(from: string, to: string): void {
  for (let i = 0; ; i++) {
    try { renameSync(from, to); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 10 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

const isDb = (rel: string) => /^riot\.db(-wal|-shm|-journal)?$/i.test(rel);

/**
 * Reprend l'ancien dossier s'il existe et que le nouveau n'existe pas encore (ou est vide).
 * Ne supprime jamais l'ancien dossier.
 */
export function migrateUserData(appData: string, from = LEGACY_DIR, to = DATA_DIR): MigrationResult {
  const legacy = join(appData, from);
  const target = join(appData, to);
  if (!existsSync(legacy)) return { status: "none" };
  if (existsSync(target) && readdirSync(target).length) return { status: "none" };
  const tmp = join(appData, `${to}.migration-tmp`);
  try {
    rmSync(tmp, { recursive: true, force: true });
    // Tout sauf la base, copiée à part.
    cpSync(legacy, tmp, { recursive: true, preserveTimestamps: true, filter: (src) => !isDb(relative(legacy, src)) });
    const db = join(legacy, "riot.db");
    if (existsSync(db)) {
      const src = new DatabaseSync(db, { readOnly: true });
      try {
        src.exec("pragma busy_timeout = 10000");
        src.exec(`vacuum into '${join(tmp, "riot.db").replace(/'/g, "''")}'`);
      } finally { src.close(); }
      // Base copiée lisible et complète.
      const check = new DatabaseSync(join(tmp, "riot.db"), { readOnly: true });
      try {
        const ok = (check.prepare("pragma integrity_check").get() as { integrity_check: string }).integrity_check;
        if (ok !== "ok") throw new Error(`base copiée invalide (${ok})`);
      } finally { check.close(); }
    }
    // Vérification : chaque fichier (hors base) présent avec la même taille.
    const before = listFiles(legacy), after = listFiles(tmp);
    for (const [rel, size] of before) {
      if (isDb(rel)) continue;
      if (after.get(rel) !== size) throw new Error(`fichier mal copié : ${rel}`);
    }
    let bytes = 0;
    for (const s of after.values()) bytes += s;
    writeFileSync(join(tmp, MARKER), JSON.stringify({ from: legacy, at: new Date().toISOString(), files: after.size, bytes }, null, 2));
    if (existsSync(target)) rmSync(target, { recursive: true, force: true }); // dossier vide
    renameWithRetry(tmp, target);
    return { status: "migrated", from: legacy, files: after.size, bytes };
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    return { status: "failed", from: legacy, error: e instanceof Error ? e.message : String(e) };
  }
}
