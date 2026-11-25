// Fenêtre « Champions recommandés » : mon pool (classé par score) et « À essayer », en jungle et au milieu.
import { champByKey } from "../../src/data/champions";
import { DDRAGON_VERSION } from "../../src/data/version";
import type { KaynApi, MetaTrend, RecoView } from "../ipc.ts";
import { wilson } from "../reco/pool-advice.ts";
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
/** Saison du profil affiché (la saison en cours par défaut). */
let profileKey: string | null = null;

/** « 57 % ± 13 » : win rate et marge à 95 %. */
const wrPm = (wr: number, games: number) => `${nf(wr)} % ± ${nf(wilson(Math.round((wr / 100) * games), games))}`;
/** Tendance entre les deux derniers patchs, avec la marge : flèche, et « dans la marge » si l'écart n'est pas net. */
function trendEl(t: MetaTrend | undefined): HTMLElement {
  if (!t) return el("span", { class: "trend muted", title: "Moins de 30 parties sur l'un des deux derniers patchs" }, " · tendance : –");
  const m = Math.hypot(wilson(Math.round((t.latest.winRate / 100) * t.latest.games), t.latest.games), wilson(Math.round((t.previous.winRate / 100) * t.previous.games), t.previous.games));
  const sure = Math.abs(t.delta) > m;
  const arrow = t.delta >= 0.5 ? "↑" : t.delta <= -0.5 ? "↓" : "→";
  return el("span", { class: `trend${sure ? (t.delta > 0 ? " up" : " down") : " muted"}`, title: `${t.latest.patch} : ${nf(t.latest.winRate, 1)} % sur ${t.latest.games} parties · ${t.previous.patch} : ${nf(t.previous.winRate, 1)} % sur ${t.previous.games} parties · marge de l'écart ± ${nf(m, 1)}` },
    ` · ${arrow} ${t.delta >= 0 ? "+" : "−"}${nf(Math.abs(t.delta), 1)} pt${sure ? "" : " (dans la marge)"}`);
}

function renderProfile(r: RoleReco): void {
  const opts = r.profiles;
  const sel = opts.find((o) => o.key === profileKey) ?? opts[0];
  if (!sel) { $("profile").replaceChildren(el("p", { class: "muted" }, "Pas de partie dans ce rôle.")); return; }
  const p = sel.profile;
  const facts: (Node | string)[] = [];
  const fact = (label: string, value: string, title = "") => facts.push(el("span", title ? { title } : {}, `${label} `, el("b", {}, value)));
  if (p.kp15 != null) fact("Participation aux kills avant 15 min", `${nf(p.kp15)} %`, p.metaKp15 != null ? `Moyenne Émeraude+ du rôle : ${nf(p.metaKp15)} %` : "");
  if (p.kpLate != null) fact("après 15 min", `${nf(p.kpLate)} %`);
  if (p.kp15 == null && p.kp != null) fact("Participation aux kills", `${nf(p.kp)} %`);
  if (p.killShare != null) fact("Part des kills de l'équipe", `${nf(p.killShare)} %`);
  if (p.gold15 != null) fact("Or à 15 min", nf(p.gold15), p.metaGold15 != null ? `Moyenne Émeraude+ du rôle : ${nf(p.metaGold15)}` : "");
  if (p.short.games) fact("Parties courtes (< 25 min)", `${nf(p.short.winRate)} % sur ${p.short.games}`);
  if (p.long.games) fact("longues (≥ 32 min)", `${nf(p.long.winRate)} % sur ${p.long.games}`);
  const picker = el("span", { class: "season-pick" }, ...opts.map((o) => {
    const b = el("button", { type: "button", "aria-pressed": String(o === sel) }, o.label);
    b.addEventListener("click", () => { profileKey = o.key; render(); });
    return b;
  }));
  $("profile").replaceChildren(
    el("h2", {}, `Ton profil ${role === "JUNGLE" ? "en jungle" : "au milieu"} · ${sel.label} (${p.games} parties)`, p.games >= 20 ? el("span", { class: "style-tag" }, STYLE_LABEL[p.style]) : el("span", { class: "style-tag" }, "style : moins de 20 parties")),
    picker,
    p.games ? el("div", { class: "facts" }, ...facts) : el("p", { class: "muted" }, "Pas de partie dans ce rôle sur cette saison."),
  );
}

/** Carte d'un champion classé par potentiel : mini-radar, phrase d'explication, et score du pool s'il y est. */
function potentialCard(e: PotentialEntry, pick: PoolPick | undefined): HTMLElement {
  const facts = pick
    ? `${pick.games} parties · ${wrPm(pick.winRate, pick.games)} (lissé ${nf(pick.adjustedWinRate, 1)} %) · KDA ${nf(pick.kda, 1)}${pick.masteryPoints ? ` · ${nf(Math.round(pick.masteryPoints / 1000))} k pts` : ""}`
    : `${e.games} parties · ${wrPm(e.winRate ?? 0, e.games)} de victoires`;
  const radar = e.radar
    ? el("div", { class: "mini-radar", title: `Stats de jeu : ${nf(e.radar.score ?? 0)} (50 = médiane Émeraude+), sur ${e.radar.games} parties` },
      radarSvg([{ values: e.radar.values, cls: "s-main", name: champName(e.championId) }], { size: 58, labels: false }))
    : el("div", { class: "mini-radar none", title: "Moins de 5 parties relues : pas encore de radar" }, "–");
  return el("li", { class: "card pcard" },
    portrait(e.championId),
    el("div", {},
      el("div", { class: "name" }, champName(e.championId), ...prov(e.provisional), ...(pick ? [el("span", { class: "pscore", title: "Score du pool (proche d'un win rate attendu)" }, ` · score ${nf(pick.score, 1)}`)] : [])),
      el("div", { class: "facts" }, facts, el("span", { class: "muted" }, " · méta"), trendEl(view?.trends?.[role]?.[e.championId]))),
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
      el("div", { class: "facts" }, `méta ${wrPm(t.meta.winRate, t.meta.games)} (${nf(t.meta.games)} parties)`, trendEl(view?.trends?.[role]?.[t.championId]), ` · ${learningLabel(t.learning)}`, ...similar)),
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
  renderProfile(r);
  renderAdvice();
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

/** Pool conseillé : 2 ou 3 champions complémentaires, la part de tes parties qu'ils couvrent, et pourquoi le resserrer. */
function renderAdvice(): void {
  const a = view?.advice?.[role];
  if (!a || !a.picks.length) { $("advice").replaceChildren(); $("advice").hidden = true; return; }
  $("advice").hidden = false;
  $("advice").replaceChildren(
    el("h2", {}, "Pool conseillé", a.fromMeta ? el("span", { class: "tag-prov" }, "d'après la méta") : ""),
    el("ol", { class: "advice-list" }, ...a.picks.map((p) => el("li", {}, portrait(p.championId, "advice-ic"), el("div", {}, el("b", {}, champName(p.championId)), ...prov(p.provisional), el("div", { class: "small muted" }, p.why.join(" · ")))))),
    el("p", { class: "small" }, a.text));
}

async function reload(): Promise<void> {
  // Premier chargement : indicateur pendant le calcul (dans le moteur, la fenêtre reste utilisable).
  if (!view) $("summary").textContent = "Calcul des recommandations…";
  const v = await window.kayn.getRecommendations().catch((e) => { console.error(e); return null; });
  if (!v) return;
  view = v;
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
