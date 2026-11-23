// Fenêtre « Méta » : stats Émeraude+ par champion et par rôle, avec builds, runes et familier.
import shop from "../../src/data/generated/shop.json";
import { champByKey, matchesQuery } from "../../src/data/champions";
import { runeIconUrl, runeName, RUNES_BY_ID } from "../../src/data/runes";
import { DDRAGON_VERSION } from "../../src/data/version";
import type { KaynApi } from "../ipc.ts";
import type { ItemRate, MetaChampion } from "../meta/meta-stats.ts";
import { ROLE_LABELS, ROLES } from "../stats/my-stats.ts";

declare global {
  interface Window { kayn: KaynApi }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const CDN = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img`;
const SHOP = shop as Record<string, { name: string }>;
const nf = (n: number, d = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const champName = (id: number) => champByKey(id)?.name ?? `#${id}`;

function el(tag: string, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}
function img(src: string, title: string): HTMLElement {
  const i = el("img", { src, alt: "", title }) as HTMLImageElement;
  i.addEventListener("error", () => { i.style.visibility = "hidden"; }, { once: true });
  return i;
}
const itemTitle = (r: ItemRate) => `${SHOP[r.id]?.name ?? r.id} · ${nf(r.share)} % des parties · ${nf(r.winRate, 1)} % de victoires`;
const itemIcons = (rs: ItemRate[]) => el("span", { class: "icons" }, ...rs.map((r) => img(`${CDN}/item/${r.id}.png`, itemTitle(r))));

interface Column { key: string; label: string; left?: boolean; title?: string; value: (c: MetaChampion) => number | string; cell: (c: MetaChampion) => Node | string }

const COLUMNS: Column[] = [
  {
    key: "champ", label: "Champion", left: true, value: (c) => champName(c.championId),
    cell: (c) => {
      const ch = champByKey(c.championId);
      return el("span", { class: "champ-cell" }, img(ch?.image ? `${CDN}/champion/${ch.image}` : "", ""), champName(c.championId),
        ...(c.provisional ? [el("span", { class: "tag-prov", title: "Moins de 100 parties : chiffres indicatifs" }, "provisoire")] : []));
    },
  },
  { key: "role", label: "Rôle", left: true, value: (c) => c.role, cell: (c) => el("span", { class: "role" }, ROLE_LABELS[c.role] ?? c.role) },
  { key: "games", label: "Parties", value: (c) => c.games, cell: (c) => nf(c.games) },
  { key: "wr", label: "Win rate", value: (c) => c.winRate, cell: (c) => el("span", {}, `${nf(c.winRate, 1)} %`, el("span", { class: "margin" }, `±${nf(c.margin, 1)}`)) },
  { key: "pr", label: "Pick rate", title: "% des parties où le champion est joué dans ce rôle", value: (c) => c.pickRate, cell: (c) => `${nf(c.pickRate, 1)} %` },
  {
    key: "rune", label: "Rune principale", left: true, value: (c) => c.keystones[0]?.id ?? 0,
    cell: (c) => {
      const k = c.keystones[0];
      if (!k) return "–";
      const info = RUNES_BY_ID[k.id];
      return el("span", { class: "rune", title: `${nf(k.share)} % des parties · ${nf(k.winRate, 1)} % de victoires` }, info ? img(runeIconUrl(info.icon), "") : "", runeName(k.id));
    },
  },
  { key: "items", label: "Items les plus joués", left: true, value: (c) => c.items[0]?.id ?? 0, cell: (c) => (c.items.length ? itemIcons(c.items.slice(0, 4)) : "–") },
  { key: "core", label: "Ordre du core", left: true, title: "3 premiers items terminés (chronologie)", value: (c) => c.core?.games ?? 0,
    cell: (c) => (c.core ? el("span", { title: `${c.core.games} parties · ${nf(c.core.winRate, 1)} % de victoires` }, itemIcons(c.core.items.map((id) => ({ id, games: 0, winRate: c.core!.winRate, share: 0 })))) : "–") },
  { key: "boots", label: "Bottes", left: true, value: (c) => c.boots?.id ?? 0, cell: (c) => (c.boots ? itemIcons([c.boots]) : "–") },
  { key: "pet", label: "Familier", left: true, value: (c) => c.starter?.id ?? 0, cell: (c) => (c.starter ? itemIcons([c.starter]) : "–") },
];

let rows: MetaChampion[] = [];
let sort = { key: "games", asc: false };
const filter = { role: "JUNGLE", scope: 1, min: 50, q: "" };

function render(): void {
  $("head").replaceChildren(...COLUMNS.map((c) => {
    const th = el("th", { class: [c.left ? "left" : "", sort.key === c.key ? "sorted" : "", sort.key === c.key && sort.asc ? "asc" : ""].join(" ").trim(), ...(c.title ? { title: c.title } : {}) }, c.label);
    th.addEventListener("click", () => { sort = sort.key === c.key ? { key: c.key, asc: !sort.asc } : { key: c.key, asc: !!c.left }; render(); });
    return th;
  }));
  const col = COLUMNS.find((c) => c.key === sort.key)!;
  const list = rows
    .filter((r) => (filter.role === "all" || r.role === filter.role) && r.games >= filter.min)
    .filter((r) => { const ch = champByKey(r.championId); return !filter.q || (ch ? matchesQuery(ch, filter.q) : false); })
    .sort((a, b) => {
      const va = col.value(a), vb = col.value(b);
      const d = typeof va === "string" ? va.localeCompare(String(vb), "fr") : va - (vb as number);
      return sort.asc ? d : -d;
    });
  $("body").replaceChildren(...list.map((r) => el("tr", {}, ...COLUMNS.map((c) => el("td", c.left ? { class: "left" } : {}, c.cell(r))))));
  const empty = $("empty");
  empty.hidden = list.length > 0;
  empty.textContent = rows.length ? "Aucun champion pour ces filtres (baisse le minimum de parties)." : "Pas encore de données de méta : la collecte tourne en arrière-plan (voir la fenêtre principale).";
}

async function reload(): Promise<void> {
  const r = await window.kayn.getMeta(filter.scope);
  rows = r.champions;
  $("summary").textContent = r.selected.length
    ? `${nf(r.matches)} partie(s) · patch${r.selected.length > 1 ? "s" : ""} ${r.selected.join(", ")}${r.patches.length ? ` · en base : ${r.patches.map((p) => `${p.patch} (${nf(p.games)})`).join(", ")}` : ""}`
    : "Aucune donnée pour l'instant";
  render();
}

$<HTMLSelectElement>("f-role").replaceChildren(el("option", { value: "all" }, "Tous"), ...ROLES.map((r) => el("option", { value: r }, ROLE_LABELS[r])));
$<HTMLSelectElement>("f-role").value = filter.role;
$<HTMLSelectElement>("f-role").addEventListener("change", (e) => { filter.role = (e.target as HTMLSelectElement).value; render(); });
$<HTMLSelectElement>("f-scope").addEventListener("change", (e) => { filter.scope = Number((e.target as HTMLSelectElement).value); void reload(); });
$<HTMLSelectElement>("f-min").addEventListener("change", (e) => { filter.min = Number((e.target as HTMLSelectElement).value); render(); });
$<HTMLInputElement>("f-search").addEventListener("input", (e) => { filter.q = (e.target as HTMLInputElement).value; render(); });

void reload();
setInterval(() => void reload(), 60_000);
