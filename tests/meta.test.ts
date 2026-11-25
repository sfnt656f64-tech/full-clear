import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Collector } from "../desktop/collector/collector";
import { metaLeague, SAMPLE_PER_PAGE } from "../desktop/collector/meta-jobs";
import { buildOrders, summarizeMetaMatch, type MetaMatchV5, type TimelineEventsV5 } from "../desktop/collector/meta-parse";
import { RiotScheduler } from "../desktop/collector/scheduler";
import { CollectorStore } from "../desktop/collector/store";
import { margin95, metaStats, type MetaInput, type MetaPartRow } from "../desktop/meta/meta-stats";
import { readMeta, readMetaPatches } from "../desktop/meta/read";

const dirs: string[] = [];
const tmpDb = () => { const d = mkdtempSync(join(tmpdir(), "kayn-meta-")); dirs.push(d); return join(d, "riot.db"); };
afterEach(() => { for (const d of dirs.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* base encore ouverte */ } } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const FAST = [{ limit: 1000, ms: 1000 }];

const PERKS = { statPerks: { offense: 5008, flex: 5008, defense: 5011 }, styles: [{ style: 8100, selections: [{ perk: 8128 }, { perk: 8143 }, { perk: 8138 }, { perk: 8135 }] }, { style: 8300, selections: [{ perk: 8347 }, { perk: 8304 }] }] };
const CHAMPS = [141, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const ROLES = ["JUNGLE", "MIDDLE", "TOP", "BOTTOM", "UTILITY"];

function metaMatch(id: string, version = "16.23.1.1", winTeam = 100): MetaMatchV5 {
  return {
    metadata: { matchId: id },
    info: {
      gameCreation: 1, gameStartTimestamp: 2, gameDuration: 1700, gameVersion: version, queueId: 420,
      participants: CHAMPS.map((championId, i) => ({
        puuid: `puuid-${id}-${i}`, participantId: i + 1, teamId: i < 5 ? 100 : 200, championId, teamPosition: ROLES[i % 5],
        win: (i < 5 ? 100 : 200) === winTeam, kills: 3, deaths: 2, assists: 4,
        item0: championId === 141 ? 6699 : 3071, item1: 1101, item2: 3047, item3: 0, item4: 0, item5: 0, item6: 3364, perks: PERKS,
      })),
    },
  };
}

describe("réduction d'une partie de méta", () => {
  it("garde 10 lignes anonymes : champion, rôle, victoire, items, runes", () => {
    const g = summarizeMetaMatch(metaMatch("EUW1_1"));
    expect(g).toMatchObject({ matchId: "EUW1_1", patch: "16.23", remake: false });
    expect(g.parts).toHaveLength(10);
    expect(g.parts[0]).toEqual({
      participantId: 1, team: 100, championId: 141, role: "JUNGLE", win: true, kills: 3, deaths: 2, assists: 4, damage: null,
      items: [6699, 1101, 3047], perks: { primary: 8100, sub: 8300, selections: [8128, 8143, 8138, 8135, 8347, 8304], shards: [5008, 5008, 5011] },
    });
    expect(JSON.stringify(g)).not.toContain("puuid");
  });

  it("ordre d'achat : items terminés et familier, annulations retirées, sans doublon", () => {
    const ev = (type: string, participantId: number, x: Record<string, number>) => ({ type, participantId, timestamp: 0, ...x });
    const t: TimelineEventsV5 = { info: { frames: [
      { events: [ev("ITEM_PURCHASED", 1, { itemId: 1101 }), ev("ITEM_PURCHASED", 1, { itemId: 2003 }), ev("ITEM_PURCHASED", 2, { itemId: 3071 })] },
      { events: [ev("ITEM_PURCHASED", 1, { itemId: 3071 }), ev("ITEM_UNDO", 1, { beforeId: 3071, afterId: 0 }), ev("ITEM_PURCHASED", 1, { itemId: 6699 })] },
      { events: [ev("ITEM_PURCHASED", 1, { itemId: 3158 }), ev("ITEM_PURCHASED", 1, { itemId: 6697 }), ev("ITEM_PURCHASED", 1, { itemId: 6699 })] },
    ] } };
    expect(buildOrders(t, [1]).get(1)).toEqual([1101, 6699, 3158, 6697]);
    expect(buildOrders(t, [1]).has(2)).toBe(false);
  });
});

describe("statistiques de méta", () => {
  const part = (over: Partial<MetaPartRow>): MetaPartRow => ({ matchId: "m", championId: 141, role: "JUNGLE", win: true, items: [6699, 3047, 1101], perks: null, ...over });

  it("win rate, marge, pick rate, items, bottes (niveau 3 → niveau 2), familier, rune et page", () => {
    const page = { primary: 8100, sub: 8300, selections: [8128, 1, 2, 3, 4, 5], shards: [5008, 5008, 5011] };
    const parts = [
      ...Array.from({ length: 6 }, (_, i) => part({ matchId: `a${i}`, win: i < 4, perks: page })),
      part({ matchId: "b1", win: false, items: [6697, 3174, 1107], perks: { ...page, selections: [8112, 1, 2, 3, 4, 5] } }),
      part({ matchId: "b2", championId: 1, role: "MIDDLE", items: [3089] }),
      part({ matchId: "b3", role: "" }),
    ];
    const input: MetaInput = { matches: 10, parts, builds: [], mastery: [], patches: ["16.23"] };
    const kayn = metaStats(input).find((c) => c.championId === 141 && c.role === "JUNGLE")!;
    expect(kayn.games).toBe(7);
    expect(kayn.winRate).toBeCloseTo((4 / 7) * 100);
    expect(kayn.margin).toBeCloseTo(margin95(4, 7));
    expect(kayn.pickRate).toBe(70);
    expect(kayn.provisional).toBe(true);
    expect(kayn.items[0]).toMatchObject({ id: 6699, games: 6 });
    expect(kayn.boots).toMatchObject({ id: 3047, games: 7 }); // Armored Advance (3174) compté comme Plated Steelcaps
    expect(kayn.starter).toMatchObject({ id: 1101, games: 7 }); // 1107 = variante de 1101
    expect(kayn.keystones.map((k) => k.id)).toEqual([8128, 8112]);
    expect(kayn.page).toMatchObject({ selections: [8128, 1, 2, 3, 4, 5], games: 6 });
    expect(metaStats(input).some((c) => c.role === "")).toBe(false);
  });

  it("ordre du core (chronologie) et win rate selon la maîtrise", () => {
    const builds = [
      ...Array.from({ length: 4 }, (_, i) => ({ championId: 141, role: "JUNGLE", win: i < 3, items: [1101, 6699, 3158, 6697, 6696] })),
      { championId: 141, role: "JUNGLE", win: true, items: [6697, 6699, 6696] },
    ];
    const mastery = [
      ...Array.from({ length: 10 }, (_, i) => ({ championId: 141, role: "JUNGLE", win: i < 3, points: 5_000 })),
      ...Array.from({ length: 10 }, (_, i) => ({ championId: 141, role: "JUNGLE", win: i < 6, points: 250_000 })),
    ];
    const c = metaStats({ matches: 1, parts: [part({})], builds, mastery, patches: [] })[0];
    expect(c.core).toEqual({ items: [6699, 6697, 6696], games: 4, winRate: 75 });
    expect(c.mastery).toEqual({ low: { games: 10, winRate: 30 }, mid: { games: 0, winRate: 0 }, high: { games: 10, winRate: 60 } });
  });
});

describe("collecte de la méta", () => {
  it("tire au hasard des joueurs actifs, sans PUUID dans la clé, et enchaîne la page suivante", async () => {
    const store = new CollectorStore(tmpDb());
    const entries = Array.from({ length: 205 }, (_, i) => ({ puuid: `p${i}`, wins: i % 10 === 0 ? 5 : 30, losses: i % 10 === 0 ? 5 : 20, inactive: i === 1 }));
    const api = new RiotScheduler({ apiKey: "k", windows: FAST, fetch: (async () => json(entries)) as typeof fetch });
    const ctx = { store, api, now: () => 0, pool: () => new Set<number>() };
    await metaLeague(ctx, { tier: "EMERALD", division: "II", page: 1, week: 7 }, () => 0.5);
    const jobs = store.db.prepare("select kind, key, payload from jobs").all() as { kind: string; key: string; payload: string }[];
    const players = jobs.filter((j) => j.kind === "metaPlayer");
    expect(players).toHaveLength(SAMPLE_PER_PAGE);
    expect(players.every((j) => /^metaPlayer:[0-9a-f]{20}:7$/.test(j.key))).toBe(true);
    // Ni joueur inactif, ni joueur avec moins de 20 parties.
    const picked = players.map((j) => (JSON.parse(j.payload) as { puuid: string }).puuid);
    expect(picked).not.toContain("p1");
    expect(picked.some((x) => Number(x.slice(1)) % 10 === 0)).toBe(false);
    expect(jobs.filter((j) => j.kind === "metaLeague").map((j) => j.key)).toEqual(["metaLeague:EMERALD:II:2:7"]);
    store.close();
  });

  it("joueur → parties → maîtrise → ordre d'achat (pool), puis efface les PUUID", async () => {
    const file = tmpDb();
    const store = new CollectorStore(file);
    // Ton pool : Kayn (au moins 3 parties).
    for (let i = 0; i < 3; i++) store.putGame({ matchId: `M${i}`, account: "Moi#EUW", startMs: 1, durationS: 1800, patch: "16.23", season: 2026, championId: 141, role: "JUNGLE", win: true, remake: false, kills: 1, deaths: 1, assists: 1, cs: 1, vision: 1, gold15: null, cs15: null, teamKills: 10, kills15: null, assists15: null, teamKills15: null, items: [], perks: null });
    const calls: string[] = [];
    const f = (async (url: string) => {
      const u = new URL(url);
      calls.push(u.hostname.split(".")[0] + u.pathname);
      if (u.pathname.includes("/league/v4/entries/")) return json(u.searchParams.get("page") === "1" ? [{ puuid: "src-0", wins: 50, losses: 50 }] : []);
      if (u.pathname.includes("/league/v4/")) return json({ entries: [] });
      if (u.pathname.includes("by-puuid/src-0/ids")) return json(["EUW1_1", "EUW1_2"]);
      if (u.pathname.includes("/champion-mastery/")) return json({ championPoints: 123_456 });
      if (u.pathname.endsWith("/timeline")) return json({ info: { frames: [{ events: [{ type: "ITEM_PURCHASED", participantId: 1, itemId: 6699, timestamp: 1 }] }] } });
      const m = u.pathname.match(/matches\/(EUW1_\d)$/);
      if (m) {
        const mm = metaMatch(m[1], m[1] === "EUW1_2" ? "16.22.1.1" : "16.23.1.1");
        mm.info.participants[1].puuid = "src-0"; // le joueur source joue le 2ᵉ champion (MIDDLE)
        return json(mm);
      }
      return json([], 200);
    }) as typeof fetch;
    const api = new RiotScheduler({ apiKey: "k", windows: FAST, fetch: f });
    const col = new Collector({ store, api, sleep: () => new Promise((ok) => setTimeout(ok, 5)) });
    col.configure([]);
    col.start();
    const t = Date.now();
    while ((store.db.prepare("select count(*) n from meta_builds").get() as { n: number }).n < 2) {
      if (Date.now() - t > 5000) throw new Error("délai dépassé");
      await new Promise((ok) => setTimeout(ok, 10));
    }
    col.stop();
    await new Promise((ok) => setTimeout(ok, 50));

    expect(store.metaPatches()).toEqual([{ patch: "16.23", games: 1 }, { patch: "16.22", games: 1 }]);
    expect((store.db.prepare("select count(*) n from meta_parts").get() as { n: number }).n).toBe(20);
    expect(store.db.prepare("select champion_id, role, win, points from meta_mastery order by match_id").all()).toEqual([
      { champion_id: 1, role: "MIDDLE", win: 1, points: 123_456 }, { champion_id: 1, role: "MIDDLE", win: 1, points: 123_456 },
    ]);
    // Maîtrise des deux junglers de chaque partie (participants 1 et 6), lue à la collecte.
    expect(store.db.prepare("select match_id, participant_id, champion_id, win, points from meta_jungle_mastery order by match_id, participant_id").all()).toEqual([
      { match_id: "EUW1_1", participant_id: 1, champion_id: 141, win: 1, points: 123_456 }, { match_id: "EUW1_1", participant_id: 6, champion_id: 5, win: 0, points: 123_456 },
      { match_id: "EUW1_2", participant_id: 1, champion_id: 141, win: 1, points: 123_456 }, { match_id: "EUW1_2", participant_id: 6, champion_id: 5, win: 0, points: 123_456 },
    ]);
    // Par partie : joueur suivi (milieu) + 2 junglers.
    expect(calls.filter((c) => c.includes("/champion-mastery/"))).toHaveLength(6);
    // Ordre d'achat seulement pour Kayn (ton pool), pas pour les 9 autres.
    expect(store.db.prepare("select distinct champion_id c from meta_builds").all()).toEqual([{ c: 141 }]);
    expect(calls.filter((c) => c.endsWith("/timeline"))).toHaveLength(2);
    // Confidentialité : plus aucun PUUID nulle part une fois les travaux terminés.
    const dump = JSON.stringify(store.db.prepare("select key, payload from jobs where status = 'done'").all())
      + JSON.stringify(store.db.prepare("select * from meta_parts").all()) + JSON.stringify(store.db.prepare("select * from meta_jungle_mastery").all());
    expect(dump).not.toMatch(/src-0|puuid-/);

    // Lecture pour la fenêtre « Méta ».
    expect(readMetaPatches(file)).toEqual([{ patch: "16.23", games: 1 }, { patch: "16.22", games: 1 }]);
    const input = readMeta(file, ["16.23", "16.22"]);
    expect(input.matches).toBe(2);
    expect(metaStats(input).find((c) => c.championId === 141)).toMatchObject({ games: 2, pickRate: 100, starter: { id: 1101 } });
    store.close();
  });

  it("rattrapage de la maîtrise des junglers : seulement les parties de moins de 14 jours", async () => {
    const { scheduleMeta, metaJungleMastery } = await import("../desktop/collector/meta-jobs");
    const store = new CollectorStore(tmpDb());
    const DAY = 86_400_000, now = 100 * DAY;
    const recent = summarizeMetaMatch(metaMatch("R")), old = summarizeMetaMatch(metaMatch("O"));
    store.putMetaGame({ ...recent, startMs: now - 3 * DAY }, "EMERALD");
    store.putMetaGame({ ...old, startMs: now - 20 * DAY }, "EMERALD");
    const calls: string[] = [];
    const api = { get: async (_r: string, path: string) => {
      calls.push(path);
      if (path.includes("/champion-mastery/")) return { championPoints: 4_200 };
      const mm = metaMatch("R"); mm.info.gameCreation = now - 3 * DAY; return mm;
    } };
    const ctx = { store, api, now: () => now, pool: () => new Set<number>() } as never;
    scheduleMeta(ctx);
    const jobs = store.db.prepare("select key from jobs where kind = 'metaJungleMastery'").all() as { key: string }[];
    expect(jobs.map((j) => j.key)).toEqual(["metaJungleMastery:R"]);
    // Les plus récentes d'abord.
    const r2 = summarizeMetaMatch(metaMatch("N"));
    store.putMetaGame({ ...r2, startMs: now - 1 * DAY }, "EMERALD");
    scheduleMeta(ctx);
    const order = store.db.prepare("select key from jobs where kind = 'metaJungleMastery' order by priority, rank, id").all() as { key: string }[];
    expect(order.map((j) => j.key)).toEqual(["metaJungleMastery:N", "metaJungleMastery:R"]);
    await metaJungleMastery(ctx, { matchId: "R" });
    expect(store.db.prepare("select participant_id, champion_id, points from meta_jungle_mastery").all()).toEqual([
      { participant_id: 1, champion_id: 141, points: 4_200 }, { participant_id: 6, champion_id: 5, points: 4_200 },
    ]);
    expect(calls.filter((c) => c.includes("/champion-mastery/"))).toHaveLength(2);
    store.close();
  });

  it("ne garde que les patchs les plus récents", () => {
    const store = new CollectorStore(tmpDb());
    for (const [id, v] of [["A", "16.23.1"], ["B", "16.22.1"], ["C", "16.9.1"], ["D", "16.10.1"]]) store.putMetaGame(summarizeMetaMatch(metaMatch(id, v)), "EMERALD");
    expect(store.metaPatches().map((p) => p.patch)).toEqual(["16.23", "16.22", "16.10", "16.9"]);
    expect(store.purgeMeta(store.metaPatches().slice(0, 3).map((p) => p.patch))).toBe(1);
    expect(store.metaPatches().map((p) => p.patch)).toEqual(["16.23", "16.22", "16.10"]);
    expect((store.db.prepare("select count(*) n from meta_parts").get() as { n: number }).n).toBe(30);
    store.close();
  });
});
