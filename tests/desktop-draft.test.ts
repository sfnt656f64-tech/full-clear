import { describe, expect, it } from "vitest";
import { toDraftSnapshot } from "../desktop/champ-select";
import { buildDraftView, KAYN_KEY } from "../desktop/draft-view";
import { champ } from "../src/data/champions";

const key = (id: string) => champ(id).key!;
const player = (cellId: number, championId: number, extra: Record<string, unknown> = {}) => ({
  cellId, championId, championPickIntent: 0, assignedPosition: "", summonerId: 1000 + cellId,
  puuid: `puuid-secret-${cellId}`, gameName: `Pseudo${cellId}`, tagLine: `TAG${cellId}`, nameVisibilityType: "VISIBLE",
  obfuscatedPuuid: `obf-${cellId}`, obfuscatedSummonerId: 9, ...extra,
});
const pick = (actorCellId: number, championId: number, completed = true) =>
  ({ actorCellId, championId, completed, type: "pick", isInProgress: !completed, isAllyAction: actorCellId < 5 });

/** Session LCU réaliste : toi (cellule 2) sur Kayn survolé, 2 alliés et 3 adversaires verrouillés. */
function session() {
  return {
    localPlayerCellId: 2,
    isSpectating: false,
    myTeam: [
      player(0, key("Ornn"), { assignedPosition: "top" }),
      player(1, key("Syndra"), { assignedPosition: "middle" }),
      player(2, 0, { championPickIntent: KAYN_KEY, assignedPosition: "jungle" }),
      player(3, 0, { assignedPosition: "bottom" }),
      player(4, 0, { assignedPosition: "utility" }),
    ],
    theirTeam: [5, 6, 7, 8, 9].map((c) => player(c, 0)),
    actions: [
      [{ actorCellId: 0, championId: key("Zed"), completed: true, type: "ban" }],
      [pick(0, key("Ornn")), pick(5, key("Ahri"))],
      [pick(6, key("Jinx")), pick(1, key("Syndra"))],
      [pick(7, key("Lulu")), pick(2, KAYN_KEY, false)],
    ],
    timer: { phase: "BAN_PICK", adjustedTimeLeftInPhase: 23456, totalTimeInPhase: 30000 },
    chatDetails: { mucJwtDto: { jwt: "secret-jwt" } },
    bans: { myTeamBans: [], theirTeamBans: [] },
  };
}

describe("session de draft (LCU)", () => {
  it("ne garde que les champions, les postes et le chrono : aucun pseudo, PUUID ni jeton", () => {
    const snap = toDraftSnapshot(session())!;
    const json = JSON.stringify(snap);
    for (const secret of ["Pseudo", "TAG", "puuid", "obf-", "secret", "summoner", "gameName"]) expect(json).not.toContain(secret);
    expect(snap).toEqual({
      timerPhase: "BAN_PICK",
      timeLeftMs: 23456,
      me: { championId: 0, intentId: KAYN_KEY, position: "jungle" },
      allies: [
        { championId: key("Ornn"), position: "top" },
        { championId: key("Syndra"), position: "middle" },
        { championId: 0, position: "bottom" },
        { championId: 0, position: "utility" },
      ],
      enemies: [{ championId: key("Ahri") }, { championId: key("Jinx") }, { championId: key("Lulu") }, { championId: 0 }, { championId: 0 }],
      myTurn: true,
      side: null,
      unavailable: [key("Zed"), key("Ahri"), key("Jinx"), key("Lulu"), key("Ornn"), key("Syndra")].sort((a, b) => a - b),
      queueId: 0,
    });
  });

  it("ignore un pick non verrouillé et les champions bannis", () => {
    const s = session();
    s.actions.push([pick(8, key("Thresh"), false)]);
    const snap = toDraftSnapshot(s)!;
    expect(snap.enemies[3].championId).toBe(0);
    expect(snap.allies.map((a) => a.championId)).not.toContain(key("Zed"));
  });

  it("refuse une réponse vide ou malformée", () => {
    expect(toDraftSnapshot(null)).toBeNull();
    expect(toDraftSnapshot({})).toBeNull();
    expect(toDraftSnapshot({ myTeam: "x" })).toBeNull();
  });

  it("ne recopie pas une chaîne arbitraire dans les postes", () => {
    const s = session();
    s.myTeam[0].assignedPosition = "Pseudo0 <script>";
    expect(toDraftSnapshot(s)!.allies[0].position).toBe("");
  });
});

describe("recommandation de draft", () => {
  it("donne forme et runes dès le premier adversaire, le build à partir de 3", () => {
    const s = toDraftSnapshot(session())!;
    const v = buildDraftView(s);
    expect(v.enemyCount).toBe(3);
    expect(v.form?.provisional).toBe(false);
    expect(v.runes?.title).toMatch(/Runes/);
    expect(v.build?.items).toHaveLength(6);
    expect(v.me).toMatchObject({ champion: { id: "Kayn" }, locked: false, position: "jungle" });
    expect(v.notKayn).toBe(false);
    expect(v.isKayn).toBe(true);
    expect(v.timeLeftS).toBe(24);
    expect(v.link).toBe("draft=en-Ahri.Jinx.Lulu..~al-Ornn.Syndra..~src-live");

    const early = buildDraftView({ ...s, enemies: [{ championId: key("Ahri") }] });
    expect(early.form?.provisional).toBe(true);
    expect(early.runes).not.toBeNull();
    expect(early.build).toBeNull();
    expect(early.enemies).toHaveLength(5);

    expect(buildDraftView({ ...s, enemies: [] }).form).toBeNull();
  });

  it("donne le même résultat que le simulateur du site pour la même draft", async () => {
    const { draftReport } = await import("../src/engine/draft");
    const s = toDraftSnapshot(session())!;
    const rep = draftReport(["Ahri", "Jinx", "Lulu"].map(champ), ["Ornn", "Syndra"].map(champ), "mid", "auto")!;
    const v = buildDraftView(s);
    expect(v.form?.value).toBe(rep.form);
    expect(v.build?.items.map((i) => i.key)).toEqual(rep.build);
  });

  it("signale un champion autre que Kayn et un champion inconnu", () => {
    const s = toDraftSnapshot(session())!;
    const v = buildDraftView({ ...s, me: { championId: key("Ahri"), intentId: 0, position: "" }, enemies: [{ championId: 999999 }] });
    expect(v.notKayn).toBe(true);
    expect(v.isKayn).toBe(false);
    expect(v.unknown).toBe(1);
  });
});

describe("file de la partie (lue dans le client)", () => {
  it("lit gameData.queue.id de la session de jeu, 0 sinon", async () => {
    const { queueOf } = await import("../desktop/champ-select");
    expect(queueOf({ gameData: { queue: { id: 420, description: "x" } }, playerChampionSelections: [{ summonerInternalName: "Pseudo" }] })).toBe(420);
    expect(queueOf({})).toBe(0);
    expect(queueOf(null)).toBe(0);
  });
});
