import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envCandidates, loadDesktopConfig } from "../desktop/config";
import { iconPng } from "../desktop/icon";

describe("configuration de l'appli de bureau", () => {
  const repo = join("C:", "repo");
  const appData = join("C:", "Users", "x", "AppData", "Roaming", "kayn-sim");

  it("cherche le .env du dépôt puis celui de %APPDATA%", () => {
    expect(envCandidates(repo, appData)).toEqual([join(repo, ".env"), join(appData, ".env")]);
    expect(envCandidates(null, appData)).toEqual([join(appData, ".env")]);
  });

  it("prend le premier .env existant et n'en lit que le Riot ID", () => {
    const files: Record<string, string> = { [join(appData, ".env")]: "RIOT_API_KEY=RGAPI-secret\r\nRIOT_ID=Mon Nom#EUW\r\n" };
    const c = loadDesktopConfig(envCandidates(repo, appData), (f) => f in files, (f) => files[f]);
    expect(c.envFile).toBe(join(appData, ".env"));
    expect(c.riotId).toEqual({ gameName: "Mon Nom", tagLine: "EUW" });
    expect(c.problems).toEqual([]);
    expect(JSON.stringify(c)).not.toContain("RGAPI");
  });

  it("signale un .env absent ou un Riot ID invalide", () => {
    expect(loadDesktopConfig(["a/.env"], () => false).problems).toHaveLength(1);
    const c = loadDesktopConfig(["a/.env"], () => true, () => "RIOT_ID=SansTag\n");
    expect(c.riotId).toBeNull();
    expect(c.problems[0]).toMatch(/RIOT_ID/);
  });
});

describe("icône", () => {
  it("produit un PNG RGBA valide, transparent dans les coins", () => {
    const png = iconPng(32);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png[25]).toBe(6);
    const idatLen = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe((32 * 4 + 1) * 32);
    expect(raw[1 + 3]).toBe(0); // pixel (0,0) transparent
    expect(raw[16 * (32 * 4 + 1) + 1 + 16 * 4 + 3]).toBe(255); // centre opaque
  });
});
