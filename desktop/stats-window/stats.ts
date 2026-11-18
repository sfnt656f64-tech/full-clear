// Fenêtre « Mes stats » : tableau par champion et par rôle, filtres et tri.
import { champByKey } from "../../src/data/champions";
import { DDRAGON_VERSION } from "../../src/data/version";
import type { AppState, KaynApi } from "../ipc.ts";
import { DEFAULT_FILTER, myStats, ROLE_LABELS, ROLES, type MyGameRow, type Period, type StatLine, type StatsFilter } from "../stats/my-stats.ts";

declare global {
  interface Window { kayn: KaynApi }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const IMG = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion`;
const nf = (n: number | null, d = 0) => (n == null ? "–" : n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const champName = (id: number) => champByKey(id)?.name ?? `#${id}`;

interface Column {
  key: string;
  label: string;
  title?: string;
  left?: boolean;
  value: (l: StatLine) => number | string;
  cell: (l: StatLine) => Node | string;
}

function el(tag: string, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

function champCell(l: StatLine): Node {
  const c = champByKey(l.championId);
  const img = el("img", { src: c?.image ? `${IMG}/${c.image}` : "", alt: "" }) as HTMLImageElement;
  img.addEventListener("error", () => { img.style.visibility = "hidden"; }, { once: true });
  return el("span", { class: "champ-cell" }, img, champName(l.championId));
}

const wrClass = (l: StatLine) => (l.games < 5 ? "few" : l.winRate >= 55 ? "good" : l.winRate < 45 ? "bad" : "");

const COLUMNS: Column[] = [
  { key: "champ", label: "Champion", left: true, value: (l) => champName(l.championId), cell: champCell },
  { key: "role", label: "Rôle", left: true, value: (l) => l.role, cell: (l) => el("span", { class: "role" }, ROLE_LABELS[l.role] ?? l.role) },
  { key: "games", label: "Parties", value: (l) => l.games, cell: (l) => nf(l.games) },
  { key: "wr", label: "Win rate", value: (l) => l.winRate, cell: (l) => el("span", { class: wrClass(l) }, `${nf(l.winRate, 1)} %`) },
  { key: "kda", label: "KDA", title: "(K + A) / M, et moyenne K / M / A par partie", value: (l) => l.kda, cell: (l) => `${nf(l.kda, 2)}  (${nf(l.kills, 1)} / ${nf(l.deaths, 1)} / ${nf(l.assists, 1)})` },
  { key: "gold15", label: "Or à 15 min", value: (l) => l.gold15 ?? -1, cell: (l) => nf(l.gold15) },
  { key: "cs15", label: "CS à 15 min", value: (l) => l.cs15 ?? -1, cell: (l) => nf(l.cs15, 1) },
  { key: "cspm", label: "CS/min", value: (l) => l.csPerMin, cell: (l) => nf(l.csPerMin, 1) },
  { key: "vision", label: "Vision", title: "Score de vision moyen par partie", value: (l) => l.vision, cell: (l) => nf(l.vision, 1) },
  { key: "vpm", label: "Vision/min", value: (l) => l.visionPerMin, cell: (l) => nf(l.visionPerMin, 2) },
  { key: "last", label: "Dernière", value: (l) => l.lastPlayed, cell: (l) => new Date(l.lastPlayed).toLocaleDateString("fr-FR") },
];

let games: MyGameRow[] = [];
let filter: StatsFilter = { ...DEFAULT_FILTER };
let sort = { key: "games", asc: false };
let knownCount = -1;

function renderHead(): void {
  $("head").replaceChildren(...COLUMNS.map((c) => {
    const th = el("th", { class: [c.left ? "left" : "", sort.key === c.key ? "sorted" : "", sort.key === c.key && sort.asc ? "asc" : ""].join(" ").trim(), ...(c.title ? { title: c.title } : {}) }, c.label);
    th.addEventListener("click", () => {
      sort = sort.key === c.key ? { key: c.key, asc: !sort.asc } : { key: c.key, asc: c.left === true };
      render();
    });
    return th;
  }));
}

function render(): void {
  renderHead();
  const r = myStats(games, filter);
  const col = COLUMNS.find((c) => c.key === sort.key)!;
  const lines = [...r.lines].sort((a, b) => {
    const va = col.value(a), vb = col.value(b);
    const d = typeof va === "string" ? va.localeCompare(String(vb), "fr") : va - (vb as number);
    return sort.asc ? d : -d;
  });
  $("body").replaceChildren(...lines.map((l) => el("tr", {}, ...COLUMNS.map((c) => el("td", c.left ? { class: "left" } : {}, c.cell(l))))));
  $("foot").replaceChildren(...(r.total ? [el("tr", {}, ...COLUMNS.map((c, i) =>
    el("td", c.left ? { class: "left" } : {}, i === 0 ? "Total" : i === 1 ? "" : c.cell(r.total!))))] : []));
  const empty = $("empty");
  empty.hidden = r.games > 0;
  empty.textContent = games.length ? "Aucune partie pour ces filtres." : "Pas encore de partie enregistrée : la collecte est peut-être en cours (voir la fenêtre principale).";
  $("summary").textContent = `${nf(r.games)} partie(s)${r.remakes ? `, ${r.remakes} remake(s) exclu(s)` : ""} · ${lines.length} ligne(s)${r.patch ? ` · dernier patch : ${r.patch}` : ""}`;

  // Comptes connus (dans la base) pour le filtre.
  const sel = $<HTMLSelectElement>("f-account");
  const opts = ["all", ...r.accounts];
  if (sel.options.length !== opts.length) {
    sel.replaceChildren(...opts.map((a) => el("option", { value: a }, a === "all" ? "Tous" : a)));
    sel.value = opts.includes(filter.account) ? filter.account : "all";
  }
}

async function reload(): Promise<void> {
  games = await window.kayn.getMyGames();
  knownCount = games.length;
  render();
}

$<HTMLSelectElement>("f-role").replaceChildren(
  el("option", { value: "all" }, "Tous"),
  ...ROLES.map((r) => el("option", { value: r }, ROLE_LABELS[r])),
);
const bind = (id: string, apply: (v: string) => void) =>
  $<HTMLSelectElement>(id).addEventListener("change", (e) => { apply((e.target as HTMLSelectElement).value); render(); });
bind("f-account", (v) => { filter.account = v; });
bind("f-role", (v) => { filter.role = v; });
bind("f-period", (v) => { filter.period = v as Period; });
bind("f-min", (v) => { filter.minGames = Number(v); });

// Nouvelles parties enregistrées par la collecte : on recharge (au plus toutes les 10 s).
let pending = false;
window.kayn.onState((s: AppState) => {
  const n = s.collector.kind === "on" && s.collector.status ? Object.values(s.collector.status.myGames).reduce((a, b) => a + b, 0) : knownCount;
  if (n !== knownCount && !pending) {
    pending = true;
    setTimeout(() => { pending = false; void reload(); }, 10_000);
  }
});
void reload();
