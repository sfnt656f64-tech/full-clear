// Fenêtre « Mes stats » : tableau par champion et par rôle, filtres et tri.
import { officialPatch } from "../../src/data/version";
import { CHAMPIONS, champByKey, findChamp } from "../../src/data/champions";
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

/** Marge à 95 % (Wilson) du win rate. */
const margin = (l: StatLine) => {
  const n = l.games, z = 1.96, p = l.winRate / 100, d = 1 + z * z / n;
  return n ? ((z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d) * 100 : 100;
};
/** Couleur seulement à partir de 20 parties, et si toute la marge est au-dessus (ou au-dessous) de 50 %. */
const wrClass = (l: StatLine) => (l.games < 20 ? "few" : l.winRate - margin(l) > 50 ? "good" : l.winRate + margin(l) < 50 ? "bad" : "");
/** Mesures qui dépendent de la saison (le jeu change) : pas de moyenne sur plusieurs saisons. */
const SEASON_DEPENDENT = new Set(["gold15", "cs15", "cspm", "vision", "vpm"]);
const columns = () => (filter.season === "all" ? COLUMNS.filter((c) => !SEASON_DEPENDENT.has(c.key)) : COLUMNS);

const COLUMNS: Column[] = [
  { key: "champ", label: "Champion", left: true, value: (l) => champName(l.championId), cell: champCell },
  { key: "role", label: "Rôle", left: true, value: (l) => l.role, cell: (l) => el("span", { class: "role" }, ROLE_LABELS[l.role] ?? l.role) },
  { key: "games", label: "Parties", value: (l) => l.games, cell: (l) => nf(l.games) },
  { key: "wr", label: "Win rate", value: (l) => l.winRate, cell: (l) => el("span", { class: wrClass(l), title: l.games < 20 ? "Moins de 20 parties : pas de conclusion" : "Marge d'erreur à 95 %" }, `${nf(l.winRate, 1)} %`, el("span", { class: "margin" }, ` ±${nf(margin(l), 0)}`)) },
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
/** Champions exclus (identifiants Data Dragon), d'après les réglages de l'appli. */
let excludedIds: string[] = [];

function applyExcluded(ids: string[]): void {
  excludedIds = ids;
  filter.excluded = ids.map((id) => findChamp(id)?.key).filter((k): k is number => k != null);
}

function renderExcluded(): void {
  $("ex-list").replaceChildren(...(excludedIds.length ? excludedIds.map((id) => {
    const b = el("button", { type: "button", title: `Réintégrer ${findChamp(id)?.name ?? id}` }, "×");
    b.addEventListener("click", () => void setExcluded(excludedIds.filter((x) => x !== id)));
    return el("span", { class: "chip" }, findChamp(id)?.name ?? id, b);
  }) : [el("span", { class: "muted" }, "aucun")]));
  const sel = $<HTMLSelectElement>("ex-add");
  sel.replaceChildren(el("option", { value: "" }, "+ Exclure…"),
    ...CHAMPIONS.filter((c) => c.id && !excludedIds.includes(c.id)).map((c) => el("option", { value: c.id! }, c.name)));
  sel.value = "";
}

async function setExcluded(ids: string[]): Promise<void> {
  const s = await window.kayn.setExcludedChampions(ids);
  applyExcluded(s.excludedChampions);
  renderExcluded();
  render();
}

function renderHead(): void {
  $("head").replaceChildren(...columns().map((c) => {
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
  if (!columns().some((c) => c.key === sort.key)) sort = { key: "games", asc: false };
  const col = columns().find((c) => c.key === sort.key)!;
  const lines = [...r.lines].sort((a, b) => {
    const va = col.value(a), vb = col.value(b);
    const d = typeof va === "string" ? va.localeCompare(String(vb), "fr") : va - (vb as number);
    return sort.asc ? d : -d;
  });
  $("body").replaceChildren(...lines.map((l) => el("tr", {}, ...columns().map((c) => el("td", c.left ? { class: "left" } : {}, c.cell(l))))));
  $("foot").replaceChildren(...(r.total ? [el("tr", {}, ...columns().map((c, i) =>
    el("td", c.left ? { class: "left" } : {}, i === 0 ? "Total" : i === 1 ? "" : c.cell(r.total!))))] : []));
  const empty = $("empty");
  empty.hidden = r.games > 0;
  empty.textContent = games.length ? "Aucune partie pour ces filtres." : "Pas encore de partie enregistrée : la collecte est peut-être en cours (voir la fenêtre principale).";
  $("summary").textContent = `${r.season ? `Saison ${r.season}` : "Toutes saisons (or, CS et vision masqués : le jeu change d'une saison à l'autre)"} · ${nf(r.games)} partie(s)`
    + `${r.remakes ? `, ${r.remakes} remake(s) exclu(s)` : ""}${r.excludedGames ? `, ${r.excludedGames} sur des champions exclus` : ""}`
    + ` · ${lines.length} ligne(s)${r.patch ? ` · dernier patch : ${officialPatch(r.patch)}` : ""}`;

  // Saisons présentes dans tes parties.
  const ss = $<HTMLSelectElement>("f-season");
  const sopts = ["current", ...r.seasons.slice(1).map(String), "all"];
  if (ss.options.length !== sopts.length) {
    ss.replaceChildren(...sopts.map((v) => el("option", { value: v }, v === "current" ? `En cours${r.seasons[0] ? ` (${r.seasons[0]})` : ""}` : v === "all" ? "Toutes" : v)));
    ss.value = String(filter.season);
  }

  // Comptes connus (dans la base) pour le filtre.
  const sel = $<HTMLSelectElement>("f-account");
  const opts = ["all", ...r.accounts];
  if (sel.options.length !== opts.length) {
    sel.replaceChildren(...opts.map((a) => el("option", { value: a }, a === "all" ? "Tous" : a)));
    sel.value = opts.includes(filter.account) ? filter.account : "all";
  }
}

async function reload(): Promise<void> {
  const [g, s] = await Promise.all([window.kayn.getMyGames(), window.kayn.getState()]);
  games = g;
  applyExcluded(s.excludedChampions);
  renderExcluded();
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
bind("f-season", (v) => { filter.season = v === "current" || v === "all" ? v : Number(v); });
$<HTMLSelectElement>("ex-add").addEventListener("change", (e) => {
  const id = (e.target as HTMLSelectElement).value;
  if (id) void setExcluded([...excludedIds, id]);
});
bind("f-min", (v) => { filter.minGames = Number(v); });

// Nouvelles parties enregistrées par la collecte : on recharge (au plus toutes les 10 s).
let pending = false;
window.kayn.onState((s: AppState) => {
  if (s.excludedChampions.join() !== excludedIds.join()) {
    applyExcluded(s.excludedChampions);
    renderExcluded();
    render();
  }
  const n = s.collector.kind === "on" && s.collector.status ? Object.values(s.collector.status.myGames).reduce((a, b) => a + b, 0) : knownCount;
  if (n !== knownCount && !pending) {
    pending = true;
    setTimeout(() => { pending = false; void reload(); }, 10_000);
  }
});
void reload();
