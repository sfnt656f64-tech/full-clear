// Fenêtre « Champions recommandés » : mon pool (classé par score) et « À essayer », en jungle et au milieu.
import { champByKey } from "../../src/data/champions";
import { DDRAGON_VERSION } from "../../src/data/version";
import type { KaynApi, RecoView } from "../ipc.ts";
import type { PlayProfile, PoolPick, RoleReco, TryPick } from "../reco/recommend.ts";
import { learningLabel } from "../reco/recommend.ts";
import { ROLE_LABELS } from "../stats/my-stats.ts";
import type { PotentialEntry } from "../reco/potential.ts";
import { radarSvg } from "../ui/radar-svg.ts";

declare global {
  interface Window { kayn: KaynApi }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const CDN = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img`;
const nf = (n: number, d = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const champName = (id: number) => champByKey(id)?.name ?? `#${id}`;

function el(tag: string, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}
function portrait(id: number, cls = "portrait"): HTMLElement {
  const ch = champByKey(id);
  const i = el("img", { src: ch?.image ? `${CDN}/champion/${ch.image}` : "", alt: "", title: champName(id), class: cls }) as HTMLImageElement;
  i.addEventListener("error", () => { i.style.visibility = "hidden"; }, { once: true });
  return i;
}
const prov = (on: boolean) => (on ? [el("span", { class: "tag-prov", title: "Pas encore assez de parties de méta : à confirmer" }, "provisoire")] : []);
const reasons = (rs: string[]) => el("ul", {}, ...rs.map((r) => el("li", {}, r)));

const STYLE_LABEL: Record<PlayProfile["style"], string> = { early: "joueur d'early game", scaling: "joueur de fin de partie", balanced: "style équilibré" };

let view: RecoView | null = null;
let role = "JUNGLE";

function renderProfile(p: PlayProfile): void {
  const facts: (Node | string)[] = [];
  const fact = (label: string, value: string, title = "") => facts.push(el("span", title ? { title } : {}, `${label} `, el("b", {}, value)));
  if (p.kp15 != null) fact("Participation aux kills avant 15 min", `${nf(p.kp15)} %`, p.metaKp15 != null ? `Moyenne Émeraude+ du rôle : ${nf(p.metaKp15)} %` : "");
  if (p.kpLate != null) fact("après 15 min", `${nf(p.kpLate)} %`);
  if (p.kp15 == null && p.kp != null) fact("Participation aux kills", `${nf(p.kp)} %`);
  if (p.killShare != null) fact("Part des kills de l'équipe", `${nf(p.killShare)} %`);
  if (p.gold15 != null) fact("Or à 15 min", nf(p.gold15), p.metaGold15 != null ? `Moyenne Émeraude+ du rôle : ${nf(p.metaGold15)}` : "");
  if (p.short.games) fact("Parties courtes (< 25 min)", `${nf(p.short.winRate)} % sur ${p.short.games}`);
  if (p.long.games) fact("longues (≥ 32 min)", `${nf(p.long.winRate)} % sur ${p.long.games}`);
  $("profile").replaceChildren(
    el("h2", {}, `Ton profil ${role === "JUNGLE" ? "en jungle" : "au milieu"} (${p.games} parties, saison en cours et précédente)`, el("span", { class: "style-tag" }, STYLE_LABEL[p.style])),
    p.games ? el("div", { class: "facts" }, ...facts) : el("p", { class: "muted" }, "Pas de partie dans ce rôle sur les deux dernières saisons."),
  );
}

/** Carte d'un champion classé par potentiel : mini-radar, phrase d'explication, et score du pool s'il y est. */
function potentialCard(e: PotentialEntry, pick: PoolPick | undefined): HTMLElement {
  const facts = pick
    ? `${pick.games} parties · ${nf(pick.winRate)} % (lissé ${nf(pick.adjustedWinRate, 1)} %) · KDA ${nf(pick.kda, 1)}${pick.masteryPoints ? ` · ${nf(Math.round(pick.masteryPoints / 1000))} k pts` : ""}`
    : `${e.games} parties · ${nf(e.winRate ?? 0)} % de victoires`;
  const radar = e.radar
    ? el("div", { class: "mini-radar", title: `Stats de jeu : ${nf(e.radar.score ?? 0)} (50 = médiane Émeraude+), sur ${e.radar.games} parties` },
      radarSvg([{ values: e.radar.values, cls: "s-main", name: champName(e.championId) }], { size: 58, labels: false }))
    : el("div", { class: "mini-radar none", title: "Moins de 5 parties relues : pas encore de radar" }, "–");
  return el("li", { class: "card pcard" },
    portrait(e.championId),
    el("div", {},
      el("div", { class: "name" }, champName(e.championId), ...prov(e.provisional), ...(pick ? [el("span", { class: "pscore", title: "Score du pool (proche d'un win rate attendu)" }, ` · score ${nf(pick.score, 1)}`)] : [])),
      el("div", { class: "facts" }, facts)),
    radar,
    el("p", { class: "ptext" }, e.text),
    ...(pick ? [breakdown(pick)] : []));
}

/** Calcul du score en clair : la somme des 4 termes. */
function breakdown(p: PoolPick): HTMLElement {
  const b = p.breakdown;
  const sign = (x: number) => `${x < 0 ? "−" : "+"} ${nf(Math.abs(x), 1)}`;
  return el("p", { class: "calc", title: "Ton win rate lissé (saisons pondérées, ramené vers la méta) + force méta + bonus parties classées + bonus points de maîtrise" },
    `Score ${nf(p.score, 1)} = ${nf(b.winRate, 1)} ton WR lissé ${sign(b.meta)} méta ${sign(b.games)} parties ${sign(b.mastery)} maîtrise`);
}

function tryCard(t: TryPick, i: number): HTMLElement {
  const similar = t.similarTo.length
    ? [el("span", { class: "similar" }, " · proche de", ...t.similarTo.map((id) => portrait(id, "")))]
    : [];
  return el("li", { class: "card" },
    el("span", { class: "rank" }, String(i + 1)),
    portrait(t.championId),
    el("div", {},
      el("div", { class: "name" }, champName(t.championId), ...prov(t.provisional)),
      el("div", { class: "facts" }, `méta ${nf(t.meta.winRate, 1)} % (${nf(t.meta.games)}) · ${learningLabel(t.learning)}`, ...similar)),
    el("div", { class: "score", title: "Score de recommandation sur 100" }, nf(t.score), el("small", {}, "/ 100")),
    reasons(t.reasons));
}

function render(): void {
  if (!view) return;
  $("tabs").replaceChildren(...view.roles.map((r) => {
    const b = el("button", { type: "button", role: "tab", "aria-selected": String(r.role === role) }, ROLE_LABELS[r.role] ?? r.role);
    b.addEventListener("click", () => { role = r.role; render(); });
    return b;
  }));
  const r: RoleReco | undefined = view.roles.find((x) => x.role === role);
  if (!r) return;
  renderProfile(r.profile);
  const groups = view.potential?.[role] ?? { keep: [], potential: [], neutral: [], shelve: [] };
  const pickOf = new Map(r.pool.map((p) => [p.championId, p]));
  const EMPTY = { keep: "Aucun champion pour l'instant.", potential: "Aucun champion pour l'instant.", neutral: "Aucun.", shelve: "Aucun : rien à écarter." } as const;
  for (const g of ["keep", "potential", "neutral", "shelve"] as const) {
    $(`g-${g}`).replaceChildren(...(groups[g].length ? groups[g].map((e) => potentialCard(e, pickOf.get(e.championId))) : [el("li", { class: "empty" }, EMPTY[g])]));
  }
  // « À essayer » : sans les champions passés en « Potentiel à développer ».
  const moved = new Set(groups.potential.map((e) => e.championId));
  const tryList = r.tryList.filter((t) => !moved.has(t.championId));
  $("try").replaceChildren(...(tryList.length ? tryList.map(tryCard) : [el("li", { class: "empty" }, "Pas encore assez de méta pour proposer des champions : la collecte continue en arrière-plan.")]));
}

async function reload(): Promise<void> {
  view = await window.kayn.getRecommendations();
  $("summary").textContent = view.patches.length
    ? `Méta : ${nf(view.metaMatches)} partie(s) Émeraude+ en ${view.patches.join(" et ")}`
    : "Pas encore de méta";
  const warn = $("warn");
  warn.hidden = !view.provisional;
  warn.textContent = "Moins de 1 000 parties de méta : recommandations provisoires, elles s'affineront avec la collecte.";
  render();
}

void reload();
setInterval(() => void reload(), 60_000);
