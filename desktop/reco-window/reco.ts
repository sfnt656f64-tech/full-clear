// Fenêtre « Champions recommandés » : mon pool (classé par score) et « À essayer », en jungle et au milieu.
import { officialPatch } from "../../src/data/version";
import { champByKey } from "../../src/data/champions";
import { DDRAGON_VERSION } from "../../src/data/version";
import type { KaynApi, MetaTrend, ProgressionView, RecoView } from "../ipc.ts";
import { AXES } from "../analysis/radar.ts";
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
/** Détails repliés par défaut (chiffres, marges, méthode). */
const details = (...kids: (Node | string)[]) => el("details", { class: "det" }, el("summary", { class: "small muted" }, "Détails"), ...kids);
/** La ligne courte qui dit pourquoi le champion est proposé. */
const why = (t: string) => el("p", { class: "why1" }, t);

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
  return el("span", { class: `trend${sure ? (t.delta > 0 ? " up" : " down") : " muted"}`, title: `${officialPatch(t.latest.patch)} : ${nf(t.latest.winRate, 1)} % sur ${t.latest.games} parties · ${officialPatch(t.previous.patch)} : ${nf(t.previous.winRate, 1)} % sur ${t.previous.games} parties · marge de l'écart ± ${nf(m, 1)}` },
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
    ? el("div", { class: "mini-radar", title: `Stats de jeu : ${nf(e.radar.score ?? 0, 1)}${e.radar.margin != null ? ` ± ${nf(e.radar.margin, 1)}` : ""} (50 = médiane ${refName()}), sur ${e.radar.games} parties` },
      radarSvg([{ values: e.radar.values, cls: "s-main", name: champName(e.championId) }], { size: 58, labels: false, refName: refName() }),
      el("div", { class: "mini-ref" }, `réf. ${refName()}`))
    : el("div", { class: "mini-radar none", title: "Moins de 5 parties relues : pas encore de radar" }, "–");
  return el("li", { class: "card pcard" },
    portrait(e.championId),
    el("div", {},
      el("div", { class: "name" }, champName(e.championId)),
      why(e.short),
      details(
        el("div", { class: "facts" }, facts, ...(pick ? [` · score ${nf(pick.score, 1)}`] : []), el("span", { class: "muted" }, " · méta"), trendEl(view?.trends?.[role]?.[e.championId]), ...(e.provisional ? [" · provisoire"] : [])),
        radar, el("p", { class: "ptext" }, e.text), ...(pick ? [breakdown(pick)] : []))));
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
      el("div", { class: "name" }, champName(t.championId)),
      why(t.short),
      details(
        el("div", { class: "facts" }, `méta ${wrPm(t.meta.winRate, t.meta.games)} (${nf(t.meta.games)} parties)`, trendEl(view?.trends?.[role]?.[t.championId]), ` · ${learningLabel(t.learning)}`, ` · score ${nf(t.score)}/100`, ...(t.provisional ? [" · provisoire"] : []), ...similar),
        el("ul", {}, ...t.reasons.map((r) => el("li", {}, r))))));
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
  renderProgression();
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
    el("ol", { class: "advice-list" }, ...a.picks.map((p) => el("li", {}, portrait(p.championId, "advice-ic"), el("div", {}, el("b", {}, champName(p.championId)), why(p.short))))),
    details(...a.picks.map((p) => el("p", { class: "small" }, `${champName(p.championId)} : ${p.why.join(" · ")}${p.provisional ? " · provisoire" : ""}`)), el("p", { class: "small" }, a.text)));
}

let prog: ProgressionView | null = null;
const f1 = (n: number) => nf(n, 1);
const sg = (n: number) => `${n >= 0 ? "+" : "−"}${f1(Math.abs(n))}`;

/** Bouton de choix par champion (« Pas pour moi », « Je veux progresser dessus », ou retirer le choix). */
function flagButton(championId: number, flag: "notForMe" | "progress" | null, label: string): HTMLElement {
  const b = el("button", { type: "button", class: "flag-btn" }, label);
  b.addEventListener("click", async () => {
    const id = champByKey(championId)?.id;
    if (!id) return;
    b.setAttribute("disabled", "");
    await window.kayn.setChampionFlag(id, flag);
    prog = null;
    await reload();
  });
  return b;
}

/** Mode « Progresser » (jungle) : classement, critères et poids, confort, champions écartés. */
function renderProgression(): void {
  const sec = $("progression");
  const p = prog;
  if (!p || view?.goal !== "progress" || role !== "JUNGLE") {
    sec.hidden = true;
    if (view?.goal === "progress" && role !== "JUNGLE") { sec.hidden = false; sec.replaceChildren(el("p", { class: "small muted" }, "Objectif « Progresser » : jungle seulement pour l'instant (la maîtrise des joueurs n'est collectée que pour les junglers). Au milieu, le pool conseillé reste celui de l'objectif « Gagner tout de suite »."));}
    return;
  }
  sec.hidden = false;
  const strong = p.myAxes.map((v, i) => ({ v, l: AXES[i]?.label })).filter((x) => x.v != null && x.v > 50).map((x) => `${x.l} (${f1(x.v!)})`).join(", ");
  const w = p.weights;
  // Une ligne : seulement ce qui est net (force au-delà de sa marge, accord avec tes axes au-delà de sa marge), et la
  // difficulté Riot quand elle est marquée.
  const oneLine = (e: ProgressionView["candidates"][number]) => {
    const parts = [
      ...(e.flag === "progress" ? ["choisi par toi"] : []),
      ...(e.force.adjusted - e.force.margin > 50 ? ["fort en ce moment"] : []),
      ...(e.fit.value - e.fit.margin > 0 ? ["colle à tes points forts"] : []),
      ...(e.difficulty <= 4 ? ["facile à prendre en main"] : e.difficulty >= 8 ? ["difficile à prendre en main"] : []),
    ].slice(0, 3);
    const t = parts.length ? parts.join(", ") : "rien de net : classé sur l'ensemble des critères";
    return `${t[0].toUpperCase()}${t.slice(1)}.`;
  };
  const row = (e: ProgressionView["candidates"][number], i: number) => el("li", { class: "card prog" },
    el("span", { class: "rank" }, String(i + 1)), portrait(e.championId),
    el("div", {},
      el("div", { class: "name" }, champName(e.championId)),
      why(oneLine(e)),
      details(el("div", { class: "facts" }, `potentiel ${f1(e.score.total)} · `,
        `force à maîtrise égale ${f1(e.force.adjusted)} % `, e.force.mixMeasured ? "" : el("span", { class: "tag-prov", title: "Part de débutants tirée de son groupe de difficulté : moins de 100 parties avec maîtrise sur ce champion" }, "à confirmer"),
        ` (brut ${f1(e.force.raw)} % ± ${f1(e.force.margin)} sur ${nf(e.force.games)} parties → corrigé de maîtrise ${f1(e.force.equal)} % → rapproché de 50 % selon les parties : ${f1(e.force.adjusted)} %) · accord avec tes axes forts ${sg(e.fit.value)} ± ${f1(e.fit.margin)} pts de win rate · difficulté Riot ${e.difficulty}/10`,
        e.ceiling.measurable ? ` · plafond ${sg(e.ceiling.delta)} ± ${f1(e.ceiling.margin)} (info)` : " · plafond non mesurable (info)"),
      el("div", { class: "small muted" }, e.score.mine
        ? `Toi : ${e.score.mine.games} parties, stats ${f1(e.score.mine.stats)} → ${f1(e.score.mine.shrunk)} rapprochées de 50 selon leur marge, poids ${Math.round(e.score.mine.weight * 100)} % (potentiel seul ${f1(e.score.potential)})${e.score.mine.games < 20 ? " · moins de 20 parties" : ""}`
        : `Toi : ${e.myGames ? `${e.myGames} partie${e.myGames > 1 ? "s" : ""} en jungle, pas encore de stats (moins de 5 parties)` : "jamais joué en jungle"}`)),
      el("div", { class: "row" }, e.flag === "progress" ? flagButton(e.championId, null, "Retirer le choix") : flagButton(e.championId, "progress", "Je veux progresser dessus"), flagButton(e.championId, "notForMe", "Pas pour moi"))));
  const comfort = p.comfort.map((c) => el("li", {}, portrait(c.championId, "advice-ic"),
    el("div", {}, el("b", {}, champName(c.championId)), why("Ton champion de confort : tu le joues beaucoup."), details(el("div", { class: "small muted" },
      `${c.games} parties en jungle (deux saisons) · ${c.games ? `${nf((c.wins / c.games) * 100)} % ± ${nf(wilson(c.wins, c.games))} de victoires` : "–"} · stats ${c.stats != null ? `${f1(c.stats)}${c.margin != null ? ` ± ${f1(c.margin)}` : ""}` : "–"} · confort : ${c.reason}`)),
      el("div", { class: "row" }, flagButton(c.championId, "progress", "Je veux progresser dessus"), flagButton(c.championId, "notForMe", "Pas pour moi")))));
  const banned = p.notForMe.map((c) => el("li", {}, champName(c), " ", flagButton(c, null, "Rétablir")));
  const ls = p.learningSpeed;
  sec.replaceChildren(
    el("h2", {}, "Progression (jungle)"),
    details(el("p", { class: "small" }, `Potentiel = ${Math.round(w.force * 100)} % force à maîtrise égale + ${Math.round(w.fit * 100)} % accord avec tes axes forts${w.learning ? ` + ${Math.round(w.learning * 100)} % durée d'apprentissage` : " (durée d'apprentissage : 0 % pour l'instant, difficulté Riot en information)"}. Tes axes forts : ${strong || "aucun au-dessus de la médiane"}. Tes stats sur un champion comptent de plus en plus avec tes parties (moitié-moitié à 20 parties), rapprochées de 50 selon leur marge.`)),
    el("ol", { class: "cards" }, ...p.candidates.slice(0, 10).map(row)),
    el("h3", { class: "grp keep" }, "Confort (déjà beaucoup joués) : tes résultats"),
    el("ol", { class: "advice-list" }, ...(comfort.length ? comfort : [el("li", { class: "empty" }, "Aucun.")])),
    ...(banned.length ? [el("h3", { class: "grp shelve" }, "Pas pour moi"), el("ul", { class: "small" }, ...banned)] : []),
    details(el("p", { class: "small muted" }, [
      `Méta : ${nf(p.masteryGames)} parties de jungle avec maîtrise (la collecte en ajoute à chaque partie).`,
      ls ? `Ta vitesse d'apprentissage : ${sg(ls.diff)} ± ${f1(ls.margin)} entre tes 10 premières parties et les suivantes (${ls.champions} champions)${Math.abs(ls.diff) > ls.margin ? "." : " : pas encore mesurable, vitesse moyenne utilisée."}` : "Ta vitesse d'apprentissage : pas encore mesurable.",
      p.calibration ? `Points de maîtrise par partie (tous modes) : ${nf(p.calibration.median)} (${nf(p.calibration.low)}–${nf(p.calibration.high)}, ${p.calibration.champions} champions).` : "Points par partie : en attente du comptage de toutes tes parties (collecte).",
    ].join(" "))));
}

async function reload(): Promise<void> {
  // Premier chargement : indicateur pendant le calcul (dans le moteur, la fenêtre reste utilisable).
  if (!view) $("summary").textContent = "Calcul des recommandations…";
  const v = await window.kayn.getRecommendations().catch((e) => { console.error(e); return null; });
  if (!v) return;
  view = v;
  prog = v.goal === "progress" ? await window.kayn.getProgression().catch((e) => { console.error(e); return null; }) : null;
  $<HTMLSelectElement>("ref-tier").value = view.reference.tier;
  $("summary").textContent = view.patches.length
    ? `Méta : ${nf(view.metaMatches)} partie(s) Émeraude+ en ${view.patches.map(officialPatch).join(" et ")} · radars comparés au niveau ${view.reference.short} (${nf(view.reference.games)} joueurs de méta en jungle et au milieu)`
    : "Pas encore de méta";
  const warn = $("warn");
  warn.hidden = !view.provisional;
  warn.textContent = "Moins de 1 000 parties de méta : recommandations provisoires, elles s'affineront avec la collecte.";
  render();
}

/** Niveau de référence des radars et du classement. */
function refName(): string { return view?.reference.short ?? "Émeraude"; }
$<HTMLSelectElement>("ref-tier").addEventListener("change", (e) => {
  const tier = (e.target as HTMLSelectElement).value as RecoView["reference"]["tier"];
  $("summary").textContent = "Recalcul avec la nouvelle référence…";
  void window.kayn.setRefTier(tier).then(() => reload());
});

void reload();
setInterval(() => void reload(), 60_000);
