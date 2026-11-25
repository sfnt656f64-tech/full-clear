import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../desktop/data/engine";
import { CollectorStore, type MyGame } from "../desktop/collector/store";
import { cleanDetail, packDetail } from "../desktop/collector/detail";

const MIN = 60_000;
function detail(matchId: string) {
  const parts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((pid) => ({ puuid: pid === 2 ? "moi" : `p${pid}`, participantId: pid, teamId: pid <= 5 ? 100 : 200,
    championId: 100 + pid, teamPosition: ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"][(pid - 1) % 5], win: pid <= 5, kills: 2, deaths: 1, assists: 3 }));
  const frames = [0, 5, 10, 15].map((m) => ({ timestamp: m * MIN + 10, participantFrames: Object.fromEntries(parts.map((p) => [String(p.participantId), { totalGold: 500 * m, minionsKilled: 0, jungleMinionsKilled: 6 * m, position: { x: 7000, y: 7000 } }])),
    events: m === 5 ? [{ type: "CHAMPION_KILL", timestamp: 4 * MIN, killerId: 2, victimId: 7, position: { x: 7000, y: 7000 } }] : [] }));
  return packDetail(cleanDetail("Moi#EUW", { metadata: { matchId }, info: { gameDuration: 1800, gameCreation: 1, gameStartTimestamp: 2, gameVersion: "16.23.1", queueId: 420, teams: [], participants: parts } }, { info: { frames } }, "moi"));
}
const game = (id: string): MyGame => ({ matchId: id, account: "Moi#EUW", startMs: 1, durationS: 1800, patch: "16.23", season: 2026, championId: 102, role: "JUNGLE", win: true, remake: false,
  kills: 2, deaths: 1, assists: 3, cs: 100, vision: 10, gold15: 7500, cs15: 90, teamKills: 10, kills15: 1, assists15: 0, teamKills15: 1, items: [], perks: null,
  cs10: 60, objTeam: 0, objMine: 0, events: [{ t: 4 * MIN, kind: "kill", x: 7000, y: 7000, otherChamp: 107 }] });

describe("moteur de données (worker)", () => {
  it("garde ses résultats tant que la base ne change pas, et suit les nouvelles parties", () => {
    const file = join(mkdtempSync(join(tmpdir(), "kayn-engine-")), "riot.db");
    const store = new CollectorStore(file);
    store.putGame(game("G1"));
    store.putDetail("G1", "Moi#EUW", detail("G1"));
    const engine = new Engine(file);
    const a = engine.goals(0, {}, []);
    expect(engine.goals(0, {}, [])).toBe(a); // même version : rien n'est recalculé
    expect(a.sinceGames).toBe(1);
    store.putGame(game("G2"));
    store.putDetail("G2", "Moi#EUW", detail("G2"));
    // La version est relue au plus toutes les 500 ms.
    const later = Date.now() + 600;
    while (Date.now() < later) { /* attente active courte */ }
    const b = engine.goals(0, {}, []);
    expect(b).not.toBe(a);
    expect(b.sinceGames).toBe(2);
    store.close();
  });

  it("carte de chaleur déjà regroupée par case, adversaire direct attaché", () => {
    const file = join(mkdtempSync(join(tmpdir(), "kayn-engine-")), "riot.db");
    const store = new CollectorStore(file);
    store.putGame(game("G1"));
    store.putDetail("G1", "Moi#EUW", detail("G1"));
    const v = new Engine(file).overview({ championId: null, role: null, period: { kind: "all" }, account: null }, null, []);
    expect(v.heat.kills.early).toEqual([50 * 96 + 45, 1]); // (7 000 ; 7 000) → colonne 45, ligne 50 (y inversé pour l'écran)
    expect(v.heat.kills.late).toEqual([]);
    expect(v.heat.deaths.early).toEqual([]);
    expect(v.overview.refs.opponent + v.overview.refs.meta).toBe(1);
    store.close();
  });
});
