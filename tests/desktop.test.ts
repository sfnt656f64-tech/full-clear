import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envCandidates, loadDesktopConfig, riotIdText } from "../desktop/config";
import { iconPng } from "../desktop/icon";
import { commandLineArg, parseCommandLine, parseLockfile, phaseLabel, sameRiotId, toLocalAccount } from "../desktop/lcu";

describe("configuration de l'appli de bureau", () => {
  const repo = join("C:", "repo");
  const appData = join("C:", "Users", "x", "AppData", "Roaming", "kayn-sim");

  it("cherche le .env du dépôt puis celui de %APPDATA%", () => {
    expect(envCandidates(repo, appData)).toEqual([join(repo, ".env"), join(appData, ".env")]);
    expect(envCandidates(null, appData)).toEqual([join(appData, ".env")]);
  });

  it("prend le premier .env existant : comptes, clé pour la collecte", () => {
    const files: Record<string, string> = { [join(appData, ".env")]: "RIOT_API_KEY=RGAPI-secret\r\nRIOT_ID=Mon Nom#EUW\r\nRIOT_ID_2=Smurf#EUW2\r\n" };
    const c = loadDesktopConfig(envCandidates(repo, appData), (f) => f in files, (f) => files[f]);
    expect(c.envFile).toBe(join(appData, ".env"));
    expect(c.riotId).toEqual({ gameName: "Mon Nom", tagLine: "EUW" });
    expect(c.riotIds.map(riotIdText)).toEqual(["Mon Nom#EUW", "Smurf#EUW2"]);
    expect(c.apiKey).toBe("RGAPI-secret");
    expect(c.problems).toEqual([]);
  });

  it("ignore la clé d'exemple et signale un 2ᵉ Riot ID invalide", () => {
    const c = loadDesktopConfig(["a/.env"], () => true, () => "RIOT_API_KEY=RGAPI-xxxxxxxx-xxxx\nRIOT_ID=A#B\nRIOT_ID_2=SansTag\n");
    expect(c.apiKey).toBeNull();
    expect(c.riotIds).toHaveLength(1);
    expect(c.problems[0]).toMatch(/RIOT_ID_2/);
    expect(loadDesktopConfig(["a/.env"], () => true, () => "RIOT_ID=A#B\nRIOT_ID_2=\n").problems).toEqual([]);
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

describe("API locale du client (LCU)", () => {
  it("lit le port et le jeton dans la ligne de commande de LeagueClientUx.exe", () => {
    const cmd = String.raw`"C:/Riot Games/League of Legends/LeagueClientUx.exe" "--riotclient-auth-token=AAA" "--riotclient-app-port=50001" "--remoting-auth-token=Tok_en-123" "--app-port=61234" "--install-directory=C:\Riot Games\League of Legends" --app-name=LeagueClient`;
    expect(parseCommandLine(cmd)).toEqual({ port: 61234, token: "Tok_en-123", installDir: String.raw`C:\Riot Games\League of Legends` });
    // --riotclient-app-port ne doit pas être confondu avec --app-port
    expect(commandLineArg("--riotclient-app-port=1 --app-port=2", "app-port")).toBe("2");
    expect(parseCommandLine("LeagueClientUx.exe --app-port=abc")).toBeNull();
  });

  it("lit le lockfile", () => {
    expect(parseLockfile("LeagueClient:12345:61234:s3cr3t:https\n")).toEqual({ port: 61234, token: "s3cr3t" });
    expect(parseLockfile("")).toBeNull();
    expect(parseLockfile("LeagueClient:1:0:x:https")).toBeNull();
  });

  it("ne garde que le Riot ID du compte et le compare sans tenir compte de la casse", () => {
    const acc = toLocalAccount({ gameName: "Mon Nom", tagLine: "EUW", puuid: "p", summonerId: 1, displayName: "x" });
    expect(acc).toEqual({ gameName: "Mon Nom", tagLine: "EUW" });
    expect(sameRiotId(acc, { gameName: "mon nom", tagLine: "euw" })).toBe(true);
    expect(sameRiotId(acc, { gameName: "Autre", tagLine: "EUW" })).toBe(false);
    expect(sameRiotId(acc, null)).toBeNull();
    expect(toLocalAccount({})).toBeNull();
  });

  it("traduit les phases connues et garde les autres telles quelles", () => {
    expect(phaseLabel("ChampSelect")).toBe("Sélection des champions");
    expect(phaseLabel("Nouvelle")).toBe("Nouvelle");
  });
});
