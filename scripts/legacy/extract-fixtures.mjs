// Exécute le JavaScript de la page d'origine (kayn-simulator.html) dans une VM Node
// et enregistre ses résultats dans tests/fixtures/legacy.json.
// Ces résultats servent de référence : le portage TypeScript doit les reproduire
// à l'identique (voir tests/legacy.test.ts).
//
// Usage : npm run fixtures:legacy
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(root, "kayn-simulator.html"), "utf8");
const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));

// --- DOM minimal : juste ce que le script touche au chargement ---
const values = { "s-build": "0", "s-stage": "mid", "s-tgt": "adc", "s-hub": "4", "d-stage": "mid", "d-form": "auto" };
const el = (id) => ({
  id, innerHTML: "", className: "", value: values[id] ?? "", style: {}, dataset: {},
  classList: { toggle() {}, add() {}, remove() {} },
});
const document = {
  getElementById: el,
  querySelector: () => el("q"),
  querySelectorAll: () => [],
};
const ctx = vm.createContext({ document, console });
vm.runInContext(
  script + "\n;globalThis.__L={ITEMS,TARGETS,PROF,CHAMPS,SC,EX,T3,stats,ranks,blueCombo,redFight,analyse,chooseBoots,chooseBuild,targetFor,cut,initials};",
  ctx,
);
const L = ctx.__L;

const r1 = (x) => Math.round(x * 1e6) / 1e6;
const blueKeys = (r) => ({ total: r.total, pct: r.pct, kill: r.kill, log: r.log, totalAD: r1(r.s.totalAD), leth: r.s.leth, cost: r.s.cost });
const redKeys = (r) => ({ total: r.total, dps: r.dps, pct: r.pct, heal: r.heal, ehpPhys: r.ehpPhys, ehpMag: r.ehpMag, parts: r.parts, nQ: r.nQ, nW: r.nW, nAA: r.nAA });

// --- 1. Stats brutes et rangs des sorts ---
const ranks = Array.from({ length: 18 }, (_, i) => L.ranks(i + 1));
const stats = [];
for (const k of Object.keys(L.ITEMS)) for (const lvl of [1, 9, 13, 14, 18]) for (const hub of [undefined, -1, 0, 4, 8]) {
  const s = L.stats([k], lvl, hub === undefined ? {} : { hubrisStacks: hub });
  stats.push({ build: [k], lvl, hub: hub ?? null,
    v: { baseAD: r1(s.baseAD), bonusAD: r1(s.bonusAD), totalAD: r1(s.totalAD), maxHP: r1(s.maxHP), armorT: r1(s.armorT), mrT: r1(s.mrT), cdr: r1(s.cdr), cost: s.cost } });
}

// --- 2. Simulateur : chaque guide × moment × cible ---
const sims = [];
for (const form of ["blue", "red"]) L.SC[form].forEach((sc, i) => {
  for (const stage of ["mid", "late"]) for (const tgt of Object.keys(L.TARGETS[stage])) {
    const lvl = stage === "mid" ? 13 : 18, b = L.cut(sc.b, stage), t = L.TARGETS[stage][tgt];
    if (form === "blue") for (const hub of [-1, 2, 4, 8]) sims.push({ form, i, stage, tgt, hub, build: b, r: blueKeys(L.blueCombo(b, lvl, t, { hubrisStacks: hub })) });
    else sims.push({ form, i, stage, tgt, build: b, r: redKeys(L.redFight(b, lvl, t)) });
  }
});

// --- 3. Benchmark du 4ᵉ item (identique au tableau de la page) ---
const benchBlue = ["axiom", "serylda", "edge", "serpent", "youmuu", "bastion", "profane"].map((k) => ({
  k, v: ["adc", "shield", "bruiser", "tank"].map((t) => L.blueCombo(["voltaic", "hubris", "lucidity", k], 14, L.TARGETS.mid[t], { hubrisStacks: 4 }).pct),
}));
const benchRed = ["dd", "sterak", "serylda", "hubris", "axiom", "edge", "ga"].map((k) => {
  const t = L.redFight(["voltaic", "cleaver", "steelcaps", k], 14, L.TARGETS.mid.tank);
  const b = L.redFight(["voltaic", "cleaver", "steelcaps", k], 14, L.TARGETS.mid.bruiser);
  return { k, v: [t.dps, b.dps, t.heal, t.ehpPhys, t.ehpMag] };
});

// --- 4. Valeur brute des items (fonction gold() de la page) ---
const gv = { ad: 35, leth: 30, ah: 50, hp: 2.67, armor: 20, mr: 18 };
const gold = ["voltaic", "hubris", "axiom", "edge", "serylda", "serpent", "youmuu", "bastion", "cleaver", "dd", "sterak"]
  .map((k) => { const it = L.ITEMS[k]; let s = 0; for (const f in gv) s += (it[f] || 0) * gv[f]; return { k, s: Math.round(s), e: Math.round((100 * s) / it.cost) }; })
  .sort((a, b) => b.e - a.e);

// --- 5. Moteur de draft : exemples + drafts pseudo-aléatoires (graine fixe) ---
let seed = 20261118;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pool = L.CHAMPS.filter((c) => c.n !== "Kayn");
const draw = (n, used) => { const out = []; while (out.length < n) { const c = pool[Math.floor(rnd() * pool.length)]; if (!used.has(c.n)) { used.add(c.n); out.push(c.n); } } return out; };
const drafts = Object.entries(L.EX).map(([name, [en, al]]) => ({ name, en, al }));
for (let i = 0; i < 80; i++) {
  const used = new Set();
  const en = draw(3 + Math.floor(rnd() * 3), used), al = draw(Math.floor(rnd() * 5), used);
  drafts.push({ name: `random-${i}`, en, al });
}
const byName = Object.fromEntries(L.CHAMPS.map((c) => [c.n, c]));
// Réplique fidèle de run() sans le HTML.
const runDraft = (enNames, alNames, stage, fsel) => {
  const x = L.analyse(enNames.map((n) => byName[n]), alNames.map((n) => byName[n]));
  if (x.E.length < 3) return null;
  const lvl = stage === "mid" ? 13 : 18;
  const f = fsel !== "auto" ? fsel : x.form === "either" ? (x.sc >= 0 ? "blue" : "red") : x.form;
  const boots = L.chooseBoots(x, f);
  const { b, notes } = L.chooseBuild(x, f);
  const bb = stage === "mid" ? [...b.filter((k) => !L.ITEMS[k].boots).slice(0, 3), b.find((k) => L.ITEMS[k].boots)] : b;
  const vs = x.E.map((c) => {
    const t = L.targetFor(c, stage, x);
    if (f === "blue") { const r = L.blueCombo(bb, lvl, t, { hubrisStacks: 4 }); return { n: c.n, shield: t.shield, pct: r.pct, kill: r.kill }; }
    const r = L.redFight(bb, lvl, t); return { n: c.n, shield: t.shield, ttk: r1((t.hp + (t.shield || 0)) / r.dps) };
  });
  const analysis = { ...x, E: undefined, A: undefined, sc: r1(x.sc), shields: r1(x.shields), adShare: r1(x.adShare), apShare: r1(x.apShare) };
  delete analysis.E; delete analysis.A;
  let res = null;
  if (f === "red") { const r0 = L.redFight(bb, lvl, L.targetFor(x.E[0], stage, x)); res = { ehpPhys: r0.ehpPhys, ehpMag: r0.ehpMag }; }
  return { analysis, form: f, boots, build: b, notes, simBuild: bb, vs, res };
};
const draftResults = [];
for (const d of drafts) for (const stage of ["mid", "late"]) for (const fsel of ["auto", "blue", "red"])
  draftResults.push({ ...d, stage, fsel, out: runDraft(d.en, d.al, stage, fsel) });

const initials = L.CHAMPS.map((c) => [c.n, L.initials(c.n)]);

const out = { source: "kayn-simulator.html", ranks, stats, sims, benchBlue, benchRed, gold, drafts: draftResults, initials };
const file = resolve(root, "tests/fixtures/legacy.json");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(JSON.parse(JSON.stringify(out))) + "\n");
console.log(`legacy.json : ${sims.length} simulations, ${draftResults.length} drafts, ${stats.length} jeux de stats`);
