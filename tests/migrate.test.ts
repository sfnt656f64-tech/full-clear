import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrateUserData } from "../desktop/migrate";

function legacyDir(): string {
  const appData = mkdtempSync(join(tmpdir(), "fc-mig-"));
  const old = join(appData, "kayn-sim");
  mkdirSync(join(old, "rapports"), { recursive: true });
  mkdirSync(join(old, "sauvegardes"), { recursive: true });
  writeFileSync(join(old, ".env"), "RIOT_ID=Pseudo#TAG\n");
  writeFileSync(join(old, "settings.json"), '{"refTier":"DIAMOND"}');
  writeFileSync(join(old, "rapports", "report.md"), "# Rapport\n");
  writeFileSync(join(old, "sauvegardes", "riot-2026-11-01.db"), "copie");
  const db = new DatabaseSync(join(old, "riot.db"));
  db.exec("pragma journal_mode = wal; create table t (x integer); insert into t values (1), (2), (3);");
  db.close();
  return appData;
}

describe("reprise du dossier de données (Kayn Sim → Full Clear)", () => {
  it("copie tout, base comprise, et garde l'ancien dossier", () => {
    const appData = legacyDir();
    const r = migrateUserData(appData);
    expect(r.status).toBe("migrated");
    const nu = join(appData, "full-clear");
    expect(readFileSync(join(nu, ".env"), "utf8")).toBe("RIOT_ID=Pseudo#TAG\n");
    expect(readFileSync(join(nu, "settings.json"), "utf8")).toContain("DIAMOND");
    expect(readFileSync(join(nu, "rapports", "report.md"), "utf8")).toBe("# Rapport\n");
    expect(existsSync(join(nu, "sauvegardes", "riot-2026-11-01.db"))).toBe(true);
    const db = new DatabaseSync(join(nu, "riot.db"), { readOnly: true });
    expect((db.prepare("select count(*) n from t").get() as { n: number }).n).toBe(3);
    db.close();
    expect(existsSync(join(nu, "migration.json"))).toBe(true);
    // Ancien dossier intact.
    expect(existsSync(join(appData, "kayn-sim", "riot.db"))).toBe(true);
    expect(existsSync(join(appData, "kayn-sim", ".env"))).toBe(true);
  });

  it("ne refait rien si le nouveau dossier a déjà des données", () => {
    const appData = legacyDir();
    expect(migrateUserData(appData).status).toBe("migrated");
    writeFileSync(join(appData, "kayn-sim", "settings.json"), "{}");
    expect(migrateUserData(appData).status).toBe("none");
    expect(readFileSync(join(appData, "full-clear", "settings.json"), "utf8")).toContain("DIAMOND");
  });

  it("sans ancien dossier : rien à faire", () => {
    expect(migrateUserData(mkdtempSync(join(tmpdir(), "fc-mig-"))).status).toBe("none");
  });
});

describe("ancienne appli encore active après la reprise", () => {
  it("détecte une ancienne base modifiée après la reprise", async () => {
    const { legacyChangedSince } = await import("../desktop/migrate");
    const appData = legacyDir();
    migrateUserData(appData);
    expect(legacyChangedSince(appData)).toBeNull();
    const { utimesSync } = await import("node:fs");
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(appData, "kayn-sim", "riot.db"), later, later);
    expect(legacyChangedSince(appData)).not.toBeNull();
  });
});
