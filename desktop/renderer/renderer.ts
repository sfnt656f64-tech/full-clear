// Fenêtre d'état. Pas d'accès à Node : tout passe par window.kayn (preload.ts).
import type { AppState, DraftView, KaynApi } from "../ipc.ts";
import type { ChampionRow } from "../analysis/overview.ts";
import type { PostGame } from "../analysis/postgame.ts";
import { shareText } from "../analysis/lesson.ts";
import { radarSvg, type RadarSeries } from "../ui/radar-svg.ts";
import { frenchify, ruleText } from "../next-item.ts";
import { syncTargetInputs } from "../ui/goal-targets.ts";
import { acceleratorFromKey } from "../shortcuts.ts";
import { CHAMPIONS, champByKey, findChamp } from "../../src/data/champions";
import { DDRAGON_VERSION, officialPatch } from "../../src/data/version";
import { runeIconUrl, runeNameFr, RUNE_TREES, RUNES_BY_ID } from "../../src/data/runes";

declare global {
  interface Window { kayn: KaynApi }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function renderClient(s: AppState): void {
  const el = $("client");
  const acc = $("client-account");
  const c = s.client;
  if (c.kind === "closed") {
    el.textContent = "Client LoL fermé : lance-le, l'appli le détecte toute seule.";
    el.className = "status idle";
    acc.hidden = true;
    return;
  }
  el.textContent = `Client connecté · ${c.phaseLabel}`;
  el.className = `status ${c.matchesEnv === false ? "warn" : "ok"}`;
  acc.hidden = false;
  acc.textContent = !c.account ? "Compte : en cours de chargement…"
    : c.matchesEnv === false ? `${c.account} : ce compte n'est pas suivi (Avancé › Configuration).`
    : c.account;
}

// ---------- Draft ----------

type Child = Node | string | null | false | undefined;

/** Crée un élément ; le texte est toujours inséré comme texte (jamais comme HTML). */
function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}


function icon(src: string, title: string, cls = "ic"): HTMLElement {
  const img = h("img", { src, alt: "", title, class: cls, draggable: "false" }) as HTMLImageElement;
  img.addEventListener("error", () => img.classList.add("broken"), { once: true });
  return img;
}

const POSITIONS: Record<string, string> = { top: "Haut", jungle: "Jungle", middle: "Milieu", bottom: "Bas", utility: "Support" };
const TIMER_PHASES: Record<string, string> = { PLANNING: "Intentions", BAN_PICK: "Bans et picks", FINALIZATION: "Finalisation", GAME_STARTING: "Lancement" };

function slots(list: (DraftView["enemies"][number])[], side: "en" | "al"): HTMLElement {
  return h("div", { class: `slots ${side}` }, ...list.map((c) => (c ? icon(c.icon, c.name, "champ") : h("span", { class: "champ empty", title: "En attente" }))));
}

const CDN_CHAMP = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/`;
/** Marge à 95 % (Wilson) d'un win rate en %, sur n parties. */
const wilsonPm = (wr: number, n: number) => {
  if (!n) return 100;
  const z = 1.96, p = wr / 100, d = 1 + z * z / n;
  return ((z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d) * 100;
};
const sgn = (x: number) => `${x < 0 ? "−" : "+"}${Math.abs(x).toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`;

/** Bloc « Détails » replié par défaut : chiffres, marges, méthode. Une section sans rien de net = « Rien de net ». */
function detailsBlock(sections: { title: string; lines: (string | Node)[] }[], summary = "Détails"): HTMLElement {
  return h("details", { class: "details" }, h("summary", { class: "small muted" }, summary),
    ...sections.map((s) => h("div", { class: "det" }, h("p", { class: "small" }, h("b", {}, s.title)),
      h("ul", { class: "why small" }, ...(s.lines.length ? s.lines : ["Rien de net."]).map((l) => h("li", {}, l))))));
}

/** Liste à puces de consignes (vue principale). */
const bullets = (lines: string[], cls = "") => h("ul", { class: `plain-list ${cls}` }, ...lines.map((l) => h("li", {}, l)));

/**
 * Plan de partie écrit en draft, vue simple : À RETENIR, BUILD, SI… ALORS…, MES RAPPELS, puis « Détails » replié.
 * Rien ne réagit à la partie en cours (règles Riot).
 */
function renderPlain(p: NonNullable<DraftView["plain"]>, extra: { title: string; lines: (string | Node)[] }[]): HTMLElement {
  const build = [...(p.starter ? [p.starter] : []), ...p.build];
  return h("div", { class: "plan plain" },
    h("h3", {}, "Plan de partie", p.provisional ? h("span", { class: "small muted" }, " · provisoire, la draft n'est pas finie") : null),
    ...(p.retain.length ? [h("h4", {}, "À retenir"), bullets(p.retain)] : []),
    ...(p.theme ? [h("h4", {}, "Thème de la semaine"), bullets([p.theme])] : []),
    ...(build.length ? [h("h4", {}, "Build", p.form ? h("span", { class: "small muted" }, ` · ${p.form}`) : null),
      h("div", { class: "plain-build" }, ...build.flatMap((it, i) => [...(i ? [h("span", { class: "pb-arrow muted" }, "→")] : []), h("span", { class: "pb-item" }, icon(it.icon, it.name, "pb-ic"), h("span", { class: "small" }, it.name))])),
      ...(p.buildNotes.length ? [bullets(p.buildNotes, "small")] : [])] : []),
    ...(p.ifThen.length ? [h("h4", {}, "Si… alors…"), bullets(p.ifThen)] : []),
    ...(p.reminders.length ? [h("h4", {}, "Mes rappels"), h("ul", { class: "plain-list" }, ...p.reminders.map((r) => h("li", {}, r.text, r.value ? h("span", { class: "muted" }, ` (${r.value})`) : null)))] : []),
    detailsBlock([...p.details, ...extra]));
}

/** Page de runes recommandée : icônes et bouton d'import ; noms et source dans les détails. */
function renderRunePage(p: NonNullable<DraftView["runePage"]>, note: string | null): HTMLElement {
  const runeIcon = (id: number, cls: string) => {
    const r = RUNES_BY_ID[id];
    return r ? icon(runeIconUrl(r.icon), runeNameFr(id), cls) : h("span", { class: cls });
  };
  const tree = (id: number) => RUNE_TREES[id]?.name ?? String(id);
  const source = p.source === "guide"
    ? "Guide Kayn pour la forme recommandée."
    : `Page la plus jouée en Émeraude+ avec ${runeNameFr(p.selections[0])} : ${p.games} parties, ${Math.round(p.winRate ?? 0)} % ± ${Math.round(wilsonPm(p.winRate ?? 0, p.games ?? 0))} de victoires.`;
  const status = h("p", { class: "small muted", role: "status" });
  const btn = h("button", { type: "button" }, "Importer dans le client") as HTMLButtonElement;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.textContent = "Import…";
    const r = await window.kayn.importRunes();
    status.textContent = r.message;
    status.className = `small ${r.ok ? "ok-text" : "warn-text"}`;
    btn.disabled = false;
  });
  return h("div", { class: "rune-page" },
    h("h3", {}, `Runes · ${p.championName}`),
    h("div", { class: "rune-row" }, runeIcon(p.selections[0], "keystone"), ...p.selections.slice(1, 4).map((id) => runeIcon(id, "rune")),
      h("span", { class: "rune-sep" }), ...p.selections.slice(4).map((id) => runeIcon(id, "rune"))),
    h("div", { class: "row" }, btn),
    status,
    detailsBlock([{ title: "Page", lines: [
      `${tree(p.primary)} : ${p.selections.slice(0, 4).map(runeNameFr).join(" · ")}`,
      `${tree(p.sub)} : ${p.selections.slice(4).map(runeNameFr).join(" · ")}`,
      `Fragments : ${p.shards.map(runeNameFr).join(", ")}`,
      ...(note ? [frenchify(note.replace(/<[^>]+>/g, ""))] : []),
      source,
    ] }]));
}

/** Tes meilleurs choix pour cette draft : une ligne par champion, le détail replié. */
function renderPicks(p: NonNullable<DraftView["picks"]>): HTMLElement {
  const all = [...p.list, ...(p.offPool ? [p.offPool] : [])];
  const card = (x: NonNullable<DraftView["picks"]>["list"][number], i: number | null) => {
    const ch = champByKey(x.championId);
    return h("div", { class: `pick${i === 0 ? " best" : ""}${x.inPool ? "" : " off"}` },
      icon(ch?.image ? CDN_CHAMP + ch.image : "", ch?.name ?? "", "champ"),
      h("div", {},
        h("div", { class: "pick-name" }, `${i != null ? `${i + 1}. ` : ""}${ch?.name ?? `#${x.championId}`}`, x.tag ? h("span", { class: "tag-chip" }, x.tag) : null),
        h("p", { class: "small pick-why" }, x.short)));
  };
  return h("div", { class: `picks${p.myTurn ? " my-turn" : ""}` },
    h("h3", {}, p.myTurn ? "À toi de choisir" : `Tes meilleurs choix (${p.role === "JUNGLE" ? "jungle" : "milieu"})`),
    p.ruleShort ? h("p", { class: "small muted" }, p.ruleShort) : null,
    ...(p.list.length ? p.list.map((x, i) => card(x, i)) : [h("p", { class: "muted small" }, "Aucun champion de ton pool disponible.")]),
    ...(p.offPool ? [h("p", { class: "small muted" }, "À envisager :"), card(p.offPool, null)] : []),
    detailsBlock([
      ...(p.rule ? [{ title: "Règle du mode Progresser", lines: [p.rule] }] : []),
      ...all.map((x) => ({ title: `${champByKey(x.championId)?.name ?? x.championId} · ${sgn(x.score - x.base)} avec cette draft${x.provisional ? " · provisoire" : ""}`, lines: x.reasons })),
      { title: "Méthode", lines: ["Classés selon ton pool, les duels et associations en Émeraude+ et l'équilibre des dégâts. Mis à jour à chaque pick."] },
    ]));
}

// ---------- Draft par rôle ----------

const LANE_LABELS: Record<string, string> = { TOP: "Top", JUNGLE: "Jungle", MIDDLE: "Mid", BOTTOM: "ADC", UTILITY: "Support" };
/** Icônes de rôle dessinées ici (Data Dragon n'en fournit pas). */
const LANE_PATHS: Record<string, string> = {
  TOP: "M2 2h13l-4 4H6v5l-4 4z M9 9h5v5H9z",
  JUNGLE: "M10 1c-1 4-4 6-4 10 0 2 1 4 2 5l-3 3h3l2-2 2 2h3l-3-3c1-1 2-3 2-5 0-4-3-6-4-10z",
  MIDDLE: "M2 14 14 2h4v4L6 18H2z M2 2h5L2 7z M18 18h-5l5-5z",
  BOTTOM: "M18 18H5l4-4h5V9l4-4z M6 6h5v5H6z",
  UTILITY: "M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5z",
};
function laneIcon(lane: string): Element {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("class", "lane-ic");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", LANE_PATHS[lane] ?? "");
  svg.append(p);
  return svg;
}

function renderLanes(rows: NonNullable<DraftView["lanes"]>): HTMLElement {
  const cell = (c: DraftView["enemies"][number], side: "al" | "en", extra: Child) =>
    h("div", { class: `lane-cell ${side}` }, c ? icon(c.icon, c.name, "champ") : h("span", { class: "champ empty" }), h("span", { class: "lane-name" }, c?.name ?? "…", extra));
  return h("div", { class: "lanes" },
    h("div", { class: "lanes-head small muted" }, h("span", {}), h("span", { class: "blue" }, "Alliés"), h("span", { class: "red" }, "En face")),
    ...rows.map((r) => h("div", { class: `lane-row${r.me ? " me" : ""}` },
      h("span", { class: "lane-label", title: LANE_LABELS[r.lane] }, laneIcon(r.lane), h("span", { class: "small" }, LANE_LABELS[r.lane])),
      cell(r.ally, "al", r.me ? h("span", { class: "small muted" }, " (toi)") : null),
      cell(r.enemy, "en", r.enemy && r.probable ? h("span", { class: "small muted", title: r.games == null || r.games < 20 ? "Moins de 20 parties de méta" : `Rôle déduit de la méta Émeraude+ : ${Math.round(r.share ?? 0)} % de ses ${r.games.toLocaleString("fr-FR")} parties` },
        r.games == null || r.games < 20 ? " rôle incertain" : " probable") : null))));
}

let timerHandle: number | undefined;

function renderDraft(s: AppState): void {
  const d = s.draft;
  window.clearInterval(timerHandle);
  $("draft-dot").hidden = !s.draftLive;
  $("draft-empty").hidden = !!d;
  if (!d) {
    $("draft-title").textContent = "Draft";
    $("draft-body").replaceChildren();
    return;
  }
  const title = $("draft-title");
  const setTitle = () => {
    const left = Math.max(0, d.timeLeftS - Math.floor((Date.now() - s.draftAt) / 1000));
    title.textContent = s.draftLive
      ? `Draft en cours · ${TIMER_PHASES[d.timerPhase] ?? d.timerPhase}${left ? ` · ${left} s` : ""}`
      : "Dernière draft";
  };
  setTitle();
  if (s.draftLive) timerHandle = window.setInterval(setTitle, 1000);

  const body: Child[] = [];
  const me = d.me.champion;
  body.push(h("p", { class: "muted small" },
    `Toi : ${me ? `${me.name}${d.me.locked ? "" : " (survolé)"}` : "pas encore choisi"}${d.me.position ? ` · ${POSITIONS[d.me.position] ?? d.me.position}` : ""}`));
  if (d.lanes) body.push(renderLanes(d.lanes));
  else {
    body.push(h("div", { class: "team" }, h("span", { class: "tl red" }, "En face"), slots(d.enemies, "en")));
    body.push(h("div", { class: "team" }, h("span", { class: "tl blue" }, "Alliés"), slots(d.allies, "al")));
  }
  if (d.unknown) body.push(h("p", { class: "warn-text small" }, `${d.unknown} champion(s) inconnu(s) : relance npm run sync pour mettre les données à jour.`));
  // Choix du champion : inutile une fois le tien verrouillé.
  if (d.picks && !d.me.locked) body.push(renderPicks(d.picks));
  // Kayn : forme, familier, bottes et notes du modèle, dans les détails du plan.
  const kayn: { title: string; lines: (string | Node)[] }[] = [];
  if (d.isKayn && d.form) {
    const f = d.form;
    kayn.push({ title: `Kayn : forme ${f.value === "blue" ? "bleue (assassin)" : "rouge (Rhaast)"}, ${f.provisional ? `provisoire (${d.enemyCount}/5 adversaires)` : `${d.enemyCount}/5 adversaires`}${f.close ? ", c'est serré" : ""}, score ${f.score > 0 ? "+" : ""}${f.score}`, lines: f.why.map(frenchify) });
  }
  if (d.isKayn && d.build) {
    const b = d.build;
    kayn.push({ title: "Kayn : familier et bottes", lines: [
      ...b.starter.map((s, i) => `${i ? "Sinon " : ""}${s.nameFr} (${s.cost} po) : ${frenchify(s.why)}${i ? "" : ` Adulte : ${s.effect}`}`),
      ...b.boots.map((x, i) => `${i ? "Sinon " : ""}${x.name} (${frenchify(x.t3)}) : ${frenchify(x.why)}`),
      ...b.notes.map((n) => frenchify(n.replace(/<[^>]+>/g, ""))),
    ] });
  }
  if (d.plain) body.push(renderPlain(d.plain, kayn));
  else if (me) body.push(h("p", { class: "muted small" }, "Plan de partie en préparation…"));
  if (d.runePage) body.push(renderRunePage(d.runePage, d.isKayn && d.runes ? d.runes.note : null));
  if (d.isKayn) {
    const open = h("button", { type: "button" }, "Ouvrir dans le simulateur");
    open.addEventListener("click", () => void window.kayn.openDraftInSimulator());
    body.push(h("div", { class: "row" }, open));
  }
  $("draft-body").replaceChildren(...body.filter((c): c is Node | string => !!c));
}

// ---------- En jeu ----------

const WINDOW_MODES: Record<string, [string, string]> = {
  borderless: ["ok-text", "Jeu en mode « Sans bordure » : l'overlay peut s'afficher par-dessus."],
  windowed: ["ok-text", "Jeu en mode fenêtré : l'overlay s'affiche, mais « Sans bordure » est conseillé."],
  fullscreen: ["warn-text", "Jeu en plein écran : l'overlay sera invisible. Passe en « Sans bordure » (Options → Vidéo → Mode fenêtre)."],
  unknown: ["muted", "Mode d'affichage du jeu inconnu : choisis « Sans bordure » dans Options → Vidéo."],
};

function renderLive(s: AppState): void {
  const l = s.live;
  const st = $("live-status");
  st.className = `status ${l.inGame ? "ok" : "idle"}`;
  st.textContent = !l.inGame ? "Pas de partie en cours."
    : !l.overlayEnabled ? "En jeu · overlay désactivé"
    : l.overlayMoving ? "En jeu · overlay en déplacement"
    : l.hiddenByUser ? "En jeu · overlay masqué (raccourci)"
    : "En jeu · overlay affiché";
  const body: Child[] = [];
  const v = l.view;
  if (v && v.source !== "none") {
    body.push(h("div", { class: "next" }, ...v.build.map((t) => icon(t.icon, t.name))));
    body.push(h("p", { class: "small" }, [v.starter?.name, ...v.build.map((t) => t.name)].filter(Boolean).join(" → ")));
    for (const r of v.rules) body.push(h("p", { class: "muted small" }, `• ${ruleText(r)}`));
  }
  $("live-body").replaceChildren(...body.filter((c): c is Node | string => !!c));
  $<HTMLInputElement>("overlay-on").checked = l.overlayEnabled;
  $<HTMLInputElement>("tips-on").checked = l.tipsEnabled;
  $<HTMLSelectElement>("form-choice").value = l.formChoice;
  for (const name of ["toggle", "move"] as const) {
    const sc = l.shortcuts[name];
    if (capturing !== name) $(`sc-${name}`).textContent = sc.label;
    const badge = $(`sc-${name}-status`);
    const [cls, txt] = SHORTCUT_STATUS[sc.status];
    badge.className = `badge ${cls}`;
    badge.textContent = txt;
  }
  const [cls, msg] = WINDOW_MODES[l.windowMode] ?? WINDOW_MODES.unknown;
  const wm = $("window-mode");
  wm.className = `small ${cls}`;
  wm.textContent = msg;
}

const SHORTCUT_STATUS: Record<string, [string, string]> = {
  active: ["ok", "actif"],
  free: ["ok", "libre"],
  taken: ["warn", "déjà pris par une autre appli"],
  unknown: ["idle", "non testé"],
};

// Saisie d'un raccourci : le prochain appui (avec modificateurs) devient la combinaison.
let capturing: "toggle" | "move" | null = null;

function showShortcutError(msg: string | null): void {
  const el = $("sc-error");
  el.hidden = !msg;
  el.textContent = msg ?? "";
}

async function stopCapture(): Promise<void> {
  if (!capturing) return;
  const name = capturing;
  capturing = null;
  $(`sc-${name}`).classList.remove("capturing");
  await window.kayn.setCapturing(false);
  render(await window.kayn.getState());
}

for (const name of ["toggle", "move"] as const) {
  $(`sc-${name}`).addEventListener("click", async () => {
    if (capturing) await stopCapture();
    capturing = name;
    showShortcutError(null);
    const btn = $(`sc-${name}`);
    btn.classList.add("capturing");
    btn.textContent = "Appuie sur la combinaison…";
    await window.kayn.setCapturing(true);
  });
  $(`sc-${name}-reset`).addEventListener("click", async () => {
    await stopCapture();
    const r = await window.kayn.setShortcut(name, null);
    showShortcutError(r.error);
    render(r.state);
  });
}

window.addEventListener("keydown", async (e) => {
  if (!capturing) return;
  e.preventDefault();
  if (e.key === "Escape") { await stopCapture(); return; }
  if (["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(e.key)) return; // on attend la touche principale
  const acc = acceleratorFromKey(e);
  if (!acc) { showShortcutError("Combinaison non prise en charge : Ctrl, Alt et/ou Maj + une lettre, un chiffre ou F1–F24."); return; }
  const name = capturing;
  capturing = null;
  $(`sc-${name}`).classList.remove("capturing");
  await window.kayn.setCapturing(false);
  const r = await window.kayn.setShortcut(name, acc);
  showShortcutError(r.error);
  render(r.state);
});
window.addEventListener("blur", () => void stopCapture());

$<HTMLInputElement>("tips-on").addEventListener("change", async (e) => render(await window.kayn.setTipsEnabled((e.target as HTMLInputElement).checked)));
$<HTMLInputElement>("overlay-on").addEventListener("change", async (e) => render(await window.kayn.setOverlayEnabled((e.target as HTMLInputElement).checked)));
$<HTMLSelectElement>("form-choice").addEventListener("change", async (e) => render(await window.kayn.setFormChoice((e.target as HTMLSelectElement).value as "auto" | "blue" | "red")));
$("overlay-reset").addEventListener("click", async () => render(await window.kayn.resetOverlayPosition()));

// ---------- Collecte ----------

const PAUSE_LABELS: Record<string, string> = { game: "partie en cours", user: "pause manuelle", key: "clé refusée", config: "configuration" };

function renderCollector(s: AppState): void {
  const st = $("col-status");
  const body: Child[] = [];
  const summary: Child[] = [];
  let homeText = "";
  const c = s.collector;
  const btn = $<HTMLButtonElement>("col-pause");
  btn.textContent = s.collectorPaused ? "Reprendre la collecte" : "Mettre en pause";
  btn.hidden = c.kind === "off";
  let cls = "idle", text: string;
  if (c.kind === "off") text = c.reason === "no-key" ? "Arrêtée : pas de RIOT_API_KEY dans le .env." : "Arrêtée : pas de RIOT_ID dans le .env.";
  else if (c.kind === "starting" || (c.kind === "on" && !c.status)) text = "Démarrage…";
  else if (c.kind === "crashed") { cls = "warn"; text = c.message; }
  else {
    const x = c.status!;
    const reasons = x.pauseReasons.map((r) => PAUSE_LABELS[r] ?? r).join(", ");
    [cls, text] = x.state === "running" ? ["ok", "En cours"]
      : x.state === "idle" ? ["ok", "À jour (vérifie les nouvelles parties régulièrement)"]
      : x.state === "key-refused" ? ["warn", "Arrêtée : clé API refusée. Corrige RIOT_API_KEY, puis « Relire le .env »."]
      : x.state === "paused" ? ["idle", `En pause : ${reasons}`]
      : ["idle", "Arrêtée"];
    const games = Object.entries(x.myGames);
    for (const acc of s.riotIds) summary.push(h("p", { class: "small" }, `${acc} : ${x.myGames[acc] ?? 0} partie(s) Solo/Duo enregistrée(s)`));
    for (const [acc, n] of games) if (!s.riotIds.includes(acc)) summary.push(h("p", { class: "small muted" }, `${acc} (ancien compte) : ${n} partie(s)`));
    for (const j of x.jobs) {
      if (!j.pending && !j.done && !j.failed) continue;
      body.push(h("p", { class: "small muted" }, `${j.label} : ${j.done} fait(s)${j.pending ? `, ${j.pending} en attente` : ""}${j.failed ? `, ${j.failed} en échec` : ""}`));
    }
    if (x.meta.length) summary.push(h("p", { class: "small" }, `Méta Émeraude+ : ${x.meta.map((m) => `${m.games.toLocaleString("fr-FR")} partie(s) en ${officialPatch(m.patch)}`).join(", ")}`));
    if (x.poolSize) body.push(h("p", { class: "small muted" }, `Ordres d'achat suivis pour ${x.poolSize} champion(s) de ton pool`));
    const metaTotal = x.meta.reduce((n, m) => n + m.games, 0);
    homeText = metaTotal ? ` · méta ${metaTotal.toLocaleString("fr-FR")} parties` : "";
    body.push(h("p", { class: "small muted" }, `Requêtes sur 2 min : europe ${x.usage.europe}/${x.budget} · euw1 ${x.usage.euw1}/${x.budget}`));
    if (x.lastError && x.state !== "running") body.push(h("p", { class: "small warn-text" }, `Dernière erreur : ${x.lastError}`));
  }
  st.className = `status ${cls}`;
  st.textContent = text;
  $("col-summary").replaceChildren(...summary.filter((b): b is Node | string => !!b));
  $("col-body").replaceChildren(...body.filter((b): b is Node | string => !!b));
  void homeText;
  $("accounts").textContent = s.riotIds.length > 1 ? `Comptes suivis : ${s.riotIds.join(", ")}` : s.riotIds.length ? `Compte suivi : ${s.riotIds[0]} (ajoute RIOT_ID_2 pour un 2ᵉ compte)` : "";
}

$("col-pause").addEventListener("click", async () => {
  const s = await window.kayn.getState();
  render(await window.kayn.setCollectorPaused(!s.collectorPaused));
});

/** L'ancienne appli a écrit dans l'ancien dossier après la reprise : ses données récentes ne sont pas ici. */
const legacyWarning = (s: AppState) => s.data.changedAfter
  ? `L'ancien dossier ${s.data.legacyKept ?? "kayn-sim"} a été modifié après la reprise du ${new Date(s.data.changedAfter).toLocaleString("fr-FR")} : l'ancienne appli « Kayn Sim » tourne peut-être encore. Quitte-la (icône de notification → Quitter) ; rien n'est perdu, l'ancien dossier est intact.`
  : null;

function render(s: AppState): void {
  const goal = $<HTMLSelectElement>("pool-goal");
  if (document.activeElement !== goal) goal.value = s.poolGoal;
  const ref = $<HTMLSelectElement>("af-ref");
  if (document.activeElement !== ref) ref.value = s.refTier;
  renderClient(s);
  renderCollector(s);
  renderLive(s);
  renderDraft(s);
  $("version").textContent = `v${s.version}${s.dev ? " (dev)" : ""}`;
  const rid = $("riot-id");
  rid.textContent = s.riotId ? `Riot ID : ${s.riotId}` : "Riot ID non configuré";
  rid.className = `status ${s.riotId ? "ok" : "warn"}`;
  const ul = $("problems");
  ul.replaceChildren(...s.problems.map((p) => Object.assign(document.createElement("li"), { textContent: p })));
  if (!s.envFile) {
    const li = document.createElement("li");
    li.textContent = `Crée un .env (voir .env.example) dans l'un de ces emplacements : ${s.searched.join(" ou ")}`;
    ul.append(li);
  }
  $("env-file").textContent = s.envFile ?? "aucun";
  $("data-dir").textContent = [
    `Données (base, réglages, rapports) : ${s.data.dir}.`,
    s.data.legacyKept ? `Ancien dossier de Kayn Sim conservé tel quel : ${s.data.legacyKept}. Supprime-le à la main quand tout fonctionne.` : "",
    s.data.error ?? "",
    legacyWarning(s) ?? "",
  ].filter(Boolean).join(" ");
  const alerts = [...(s.data.error ? [s.data.error] : []), ...(legacyWarning(s) ? [legacyWarning(s)!] : []), ...s.problems, ...(s.envFile ? [] : ["Pas de fichier .env : voir Réglages."])];
  $("home-alert").hidden = !alerts.length;
  $("home-alert").textContent = alerts[0] ?? "";
  renderExcluded(s.excludedChampions);
  autoTab(s.draftLive);
  $<HTMLInputElement>("login").checked = s.openAtLogin;
  $("dev-note").hidden = !(s.dev && s.openAtLogin);
}

$("reload").addEventListener("click", async () => render(await window.kayn.reloadConfig()));
$("open-dir").addEventListener("click", () => void window.kayn.openUserDataDir());
$<HTMLInputElement>("login").addEventListener("change", async (e) => render(await window.kayn.setOpenAtLogin((e.target as HTMLInputElement).checked)));
// ---------- Onglets ----------

type Tab = "draft" | "after" | "analysis" | "settings" | "advanced";
const TABS: Tab[] = ["draft", "after", "analysis", "settings", "advanced"];

function selectTab(tab: Tab): void {
  for (const t of TABS) {
    $(`tab-${t}`).hidden = t !== tab;
    document.querySelector(`[data-tab="${t}"]`)!.setAttribute("aria-selected", String(t === tab));
  }
  try { localStorage.setItem("tab", tab); } catch { /* stockage indisponible */ }
  // Après l'initialisation du script (l'onglet peut être restauré au démarrage).
  if (tab === "analysis") queueMicrotask(() => { void loadAnalysis(null); void loadTheme(); void loadPool(); });
  if (tab === "after") queueMicrotask(() => void loadPostGames());
  if (tab === "advanced") selectSub(currentSub);
}

// ---------- Champions : vues intégrées (chargées à la première ouverture) ----------

type Sub = "analysis" | "stats" | "meta" | "reco" | "sim" | "config";
const SUBS: Sub[] = ["analysis", "stats", "meta", "reco", "sim", "config"];
const FRAME_SUBS = new Set<Sub>(["stats", "meta", "reco", "sim"]);
let currentSub: Sub = "analysis";
function selectSub(sub: Sub, hash?: string): void {
  currentSub = sub;
  for (const x of SUBS) {
    document.querySelector(`[data-sub="${x}"]`)!.setAttribute("aria-selected", String(x === sub));
    if (!FRAME_SUBS.has(x)) { $(`adv-${x}`).hidden = x !== sub; continue; }
    const fr = $<HTMLIFrameElement>(`frame-${x}`);
    fr.hidden = x !== sub;
    if (x === sub && (!fr.src || hash)) fr.src = fr.dataset.src! + (hash ? `#${hash}` : "");
  }
  if (sub === "analysis") void loadAnalysis(null);
  try { localStorage.setItem("sub", sub); } catch { /* stockage indisponible */ }
}
for (const x of SUBS) document.querySelector(`[data-sub="${x}"]`)!.addEventListener("click", () => selectSub(x));
try { const x = localStorage.getItem("sub") as Sub | null; if (x && SUBS.includes(x)) currentSub = x; } catch { /* idem */ }
// Menu de l'icône, simulateur avec la draft : le processus principal demande une vue.
// Anciennes destinations (menu de l'icône, notification) : ramenées aux nouveaux écrans.
window.kayn.onNavigate((n) => {
  if (n.hash?.startsWith("postgame:")) { openPostGame(n.hash.slice(9)); return; }
  if (n.tab === "champions" || n.sub) { if (n.sub && (SUBS as string[]).includes(n.sub)) currentSub = n.sub as Sub; selectTab("advanced"); if (n.sub) selectSub(n.sub as Sub, n.hash); return; }
  selectTab(n.tab === "home" ? "after" : (n.tab as Tab));
});
for (const t of TABS) document.querySelector(`[data-tab="${t}"]`)!.addEventListener("click", () => selectTab(t));
try { const t = localStorage.getItem("tab") as Tab | null; if (t && TABS.includes(t) && t !== "draft") selectTab(t); } catch { /* idem */ }

/** Onglet Draft ouvert tout seul au début de la sélection, Accueil à la fin (seulement aux changements). */
let wasLive: boolean | null = null;
function autoTab(live: boolean): void {
  if (wasLive !== null && live !== wasLive) selectTab(live ? "draft" : "after");
  else if (wasLive === null && live) selectTab("draft");
  wasLive = live;
}

// ---------- Analyse ----------

const MAP_SIZE = 14_900; // coordonnées de la Faille (0 à ~14 900)
const ROLE_SHORT: Record<string, string> = { TOP: "Top", JUNGLE: "Jungle", MIDDLE: "Mid", BOTTOM: "ADC", UTILITY: "Support" };
type AnFilter = Parameters<typeof window.kayn.getOverview>[0];
let anFilterSel: AnFilter = { championId: null, role: "JUNGLE", period: { kind: "all" }, account: null };
let anViewMode: "overview" | "game" = "overview";
let anKey: string | null = null;
let anFilter: "all" | "early" | "late" = "all";
let anView: Awaited<ReturnType<typeof window.kayn.getAnalysis>> | null = null;
let ov: Awaited<ReturnType<typeof window.kayn.getOverview>> | null = null;
/** Niveau de référence des données affichées (« Émeraude » ou « Diamant »). */
let refShort = "Émeraude";
let heatKinds: "both" | "kills" | "deaths" = "both";
let heatTime: "all" | "early" | "late" = "all";
let tableSort = { key: "games", asc: false };
let compareId: number | null = null;
const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
const fmtNum = (n: number | null, unit: string) => (n == null ? "–" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: unit === " %" || Math.abs(n) >= 100 ? 0 : 1 })}${unit}`);
const champName = (id: number) => champByKey(id)?.name ?? `#${id}`;

try { const saved = JSON.parse(localStorage.getItem("anFilter") ?? "null"); if (saved && typeof saved === "object") anFilterSel = { ...anFilterSel, ...saved }; } catch { /* rien */ }
for (const img of document.querySelectorAll<HTMLImageElement>(".an-map-bg")) img.src = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/map/map11.png`;

/** Recharge selon la vue choisie. Pendant le calcul : indicateur de chargement ; seule la dernière demande compte. */
let anRequest = 0;
async function loadAnalysis(key: string | null): Promise<void> {
  try { localStorage.setItem("anFilter", JSON.stringify(anFilterSel)); } catch { /* rien */ }
  $("an-overview").hidden = anViewMode !== "overview";
  $("an-game-view").hidden = anViewMode !== "game";
  const req = ++anRequest;
  const box = $("tab-analysis");
  box.classList.add("loading");
  try {
    if (anViewMode === "overview") {
      const v = await window.kayn.getOverview(anFilterSel, compareId);
      if (req !== anRequest) return; // une demande plus récente est partie entre-temps
      ov = v;
      refShort = v.reference.short;
      renderFilters();
      renderOverview();
    } else {
      const [o, a] = await Promise.all([ov ? Promise.resolve(ov) : window.kayn.getOverview(anFilterSel, compareId), window.kayn.getAnalysis(key, anFilterSel)]);
      if (req !== anRequest) return;
      if (!ov) { ov = o; renderFilters(); }
      anView = a;
      if (a.reference) refShort = a.reference.short;
      anKey = anView.selected;
      renderAnalysis();
    }
  } catch (e) {
    console.error(e);
  } finally {
    if (req === anRequest) box.classList.remove("loading");
  }
}

function renderFilters(): void {
  if (!ov) return;
  const f = ov.filter;
  const champ = $<HTMLSelectElement>("af-champ");
  champ.replaceChildren(h("option", { value: "" }, "Tous les champions"), ...ov.options.champions.map((c) => h("option", { value: String(c.id) }, `${champName(c.id)} (${c.games})`)));
  champ.value = f.championId == null ? "" : String(f.championId);
  $<HTMLSelectElement>("af-role").value = f.role ?? "";
  const period = $<HTMLSelectElement>("af-period");
  period.replaceChildren(h("option", { value: "all" }, "Toute la période"), ...ov.options.seasons.map((s) => h("option", { value: `s${s}` }, `Saison ${s}`)),
    h("option", { value: "30d" }, "30 derniers jours"), h("option", { value: "patch" }, "Dernier patch"));
  period.value = f.period.kind === "season" ? `s${f.period.season}` : f.period.kind;
  const acc = $<HTMLSelectElement>("af-account");
  acc.replaceChildren(h("option", { value: "" }, "Les deux comptes"), ...ov.options.accounts.map((a) => h("option", { value: a }, a)));
  acc.value = f.account ?? "";
}

function readFilters(): void {
  const c = $<HTMLSelectElement>("af-champ").value, r = $<HTMLSelectElement>("af-role").value, p = $<HTMLSelectElement>("af-period").value, a = $<HTMLSelectElement>("af-account").value;
  anFilterSel = {
    championId: c ? Number(c) : null,
    role: r || null,
    period: p.startsWith("s") ? { kind: "season", season: Number(p.slice(1)) } : p === "30d" ? { kind: "30d" } : p === "patch" ? { kind: "patch" } : { kind: "all" },
    account: a || null,
  };
}
for (const id of ["af-champ", "af-role", "af-period", "af-account"]) $(id).addEventListener("change", () => { readFilters(); anKey = null; void loadAnalysis(null); });
// Objectif du pool : mémorisé, puis l'accueil et Champions sont recalculés.
$<HTMLSelectElement>("pool-goal").addEventListener("change", (e) => {
  const goal = (e.target as HTMLSelectElement).value as AppState["poolGoal"];
  void window.kayn.setPoolGoal(goal).then(() => { void loadPool(); const fr = $<HTMLIFrameElement>("frame-reco"); if (fr.src) fr.src = fr.dataset.src!; });
});



// ---------- Analyses d'après-partie ----------

const QUEUE_LABEL: Record<PostGame["queue"], string> = { ranked: "classée", flex: "flexible", draftNormal: "normale (draft)" };
const num = (v: number, unit: string) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: unit.trim() === "%" || Math.abs(v) >= 100 ? 0 : 1 })}${unit}`;
let postOpen: string | null = null;

function renderPostGame(p: PostGame, open: boolean): HTMLElement {
  void open;
  const mark = (b: boolean | null) => (b === true ? "✔ " : b === false ? "✘ " : "= ");
  const head = `${new Date(p.startMs).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} · ${champName(p.championId)} · ${QUEUE_LABEL[p.queue]} · ${p.win ? "victoire" : "défaite"}${p.opponent ? ` · contre ${champName(p.opponent)}` : ""}`;
  const l = p.lesson;
  const c = p.curves?.[0];
  const line = (x: { text: string }) => {
    const m = x.text.match(/^(\d+:\d\d) — (.*)$/);
    return m ? h("li", { class: "tl-row" }, h("b", {}, m[1]), " ", m[2]) : h("li", {}, x.text);
  };
  const block = (title: string, ...kids: Child[]) => [h("h4", {}, title), ...kids];
  const main: Child[] = l ? [
    ...block("Le tournant", ...l.turning.map((t) => h("p", { class: "turn" }, t))),
    ...(l.well.length ? block("Bien joué", h("ul", { class: "plain-list" }, ...l.well.map(line))) : []),
    ...(l.fix.length ? block("À corriger", h("ul", { class: "plain-list" }, ...l.fix.map(line))) : []),
    ...(l.replay.length ? block("À revoir en replay", h("p", {}, l.replay.join(" · "))) : []),
    ...(l.theme ? block(`Thème de la semaine · ${l.theme.label}`, h("p", { class: l.theme.respected ? "good-text" : "bad-text" }, l.theme.text)) : []),
    ...block(`Repères ${l.reference.label ? `face aux ${l.reference.label}` : ""} sur ${champName(p.championId)}`,
      l.reference.lines.length ? h("ul", { class: "plain-list" }, ...l.reference.lines.map((x) => h("li", {}, x.text))) : h("p", { class: "muted small" }, "Rien de net : dans la moyenne sur les repères mesurés.")),
    ...block("Ton build", h("p", { class: "small" }, l.build.mine.join(" → ") || "Aucun objet terminé."), h("ul", { class: "plain-list" }, ...l.build.lines.map((x) => h("li", {}, x.text)))),
  ] : [
    h("ul", { class: "plain-list post-top" },
      p.top.well ? h("li", {}, h("span", { class: "good-text" }, "Bien : "), p.top.well) : null,
      h("li", {}, h("span", { class: "bad-text" }, "À travailler : "), p.top.point, p.top.moment ? h("div", { class: "small" }, p.top.moment) : null),
      h("li", {}, h("b", {}, "Prochaine partie : "), p.top.next)),
    h("p", { class: "muted small" }, "Chronologie de la partie pas encore lue : le récit détaillé arrive quand la collecte l'a relue."),
  ];
  const details: { title: string; lines: (string | Node)[] }[] = [
    { title: `Partie : ${p.win ? "victoire" : "défaite"} en ${Math.floor(p.durationS / 60)} min, ${p.kda}`, lines: [] },
    ...(l ? [
      { title: "Repères (chiffres)", lines: [...l.reference.lines.map((x) => `${x.text} ${x.detail ?? ""}`), ...l.reference.notes] },
      { title: "Build (chiffres)", lines: l.build.lines.filter((x) => x.detail).map((x) => `${x.text} ${x.detail}`) },
    ] : []),
    { title: p.role === "JUNGLE" ? "Face au jungler adverse" : "Face à ton vis-à-vis", lines: p.vs.filter((v) => v.mine != null).map((v) => `${mark(v.better)}${v.label} : ${v.diff ? `${v.mine! >= 0 ? "+" : "−"}${num(Math.abs(v.mine!), v.unit)} (${v.mine! > 0 ? "en ta faveur" : v.mine! < 0 ? "en sa faveur" : "égalité"})` : `${num(v.mine!, v.unit)} contre ${v.opp != null ? num(v.opp, v.unit) : "–"}`}${v.outcomeLinked ? " (toute la partie : suit en partie l'issue)" : ""}`) },
    { title: "Tes objectifs de la semaine (cette partie)", lines: p.goals.length ? p.goals.map((g) => `${mark(g.met)}${g.label} : ${g.value} (cible ${g.target})`) : ["Tes objectifs portent sur la jungle : pas suivis sur une partie dans un autre rôle."] },
    { title: "Moments clés", lines: p.moments.length ? p.moments.map((m) => `${m.time} ${m.text}`) : ["Chronologie pas encore lue pour cette partie."] },
    { title: p.average ? `Ta moyenne sur ${champName(p.championId)} (${p.average.games} autres parties cette saison)` : "Ta moyenne sur ce champion", lines: p.average ? p.average.lines.map((x) => `${mark(x.better)}${x.label} : ${num(x.game, x.unit)} contre ${num(x.average, x.unit)} en moyenne`) : ["Moins de 5 autres parties sur ce champion cette saison : pas de comparaison."] },
    ...(p.progression ? [{ title: "Repère de progression", lines: [p.progression] }] : []),
    { title: "Tendances (tes 20 parties précédentes)", lines: [...p.work, p.strength, ...(c ? [c.vsTarget] : [])] },
  ];
  return h("div", { class: "post", id: `postgame-${p.matchId}` }, h("h3", {}, head), ...main, detailsBlock(details));
}

/** Carte des kills et des morts, et barres comparées à l'Émeraude+, pour la partie choisie. */
async function loadGameDetail(p: PostGame): Promise<void> {
  const v = await window.kayn.getAnalysis(`${p.matchId}|${p.account}`, { championId: null, role: null, period: { kind: "all" }, account: null }).catch(() => null);
  if (!v || postOpen !== p.matchId) return;
  anView = v;
  if (v.reference) refShort = v.reference.short;
  renderAnalysis();
}

// ---------- Progresser : thème de la semaine et Mon pool ----------

async function loadTheme(): Promise<void> {
  const t = await window.kayn.getTheme().catch(() => null);
  if (!t) return;
  const cur = t.current;
  const fmt = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  $("theme").replaceChildren(
    ...(cur ? [
      h("p", { class: "theme-head" }, h("b", {}, cur.short)),
      h("p", { class: "small" }, `${cur.label} : dans ${shareText(cur.recent.withError, cur.recent.games)}.`),
      h("h4", {}, "Exercice"), h("p", {}, cur.exercise),
      h("h4", {}, "À revoir en replay"),
      h("ul", { class: "plain-list" }, ...cur.examples.map((x) => h("li", { class: "tl-row" }, h("b", {}, mmss(x.t)), ` ${new Date(x.startMs).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} · ${champName(x.championId)} · ${x.text}`))),
      h("h4", {}, "Cette semaine"), h("p", { class: "small" }, cur.week?.verdict ?? "La semaine commence."),
    ] : [h("p", { class: "muted small" }, "Pas encore de thème : il faut 20 parties de jungle dont la chronologie est relue.")]),
    ...(t.review ? [h("h4", {}, "Bilan de la semaine dernière"), h("p", { class: "small" }, `${t.review.label} : ${t.review.text}`)] : []),
    detailsBlock([...(cur?.week ? [{ title: "Cette semaine (chiffres)", lines: [cur.week.numbers] }] : []), { title: "Erreurs suivies (tes 20 dernières parties)", lines: t.all.map((s) => `${s.label} : ${s.withError} parties sur ${s.games}, ${fmt(s.perGame)} ± ${fmt(s.margin)} par partie.`) },
      { title: "Méthode", lines: ["Le thème est l'erreur personnelle qui revient dans le plus de parties (les objectifs laissés sans contrepartie sont déjà un objectif de la semaine). Il change chaque semaine, après un bilan avant / pendant, avec la marge."] }]));
}

async function loadPool(): Promise<void> {
  const pools = await window.kayn.getPool().catch(() => null);
  if (!pools) return;
  const flag = (id: number, f: "notForMe" | "progress" | null, label: string) => {
    const b = h("button", { type: "button", class: "flag-btn" }, label);
    b.addEventListener("click", async () => {
      const c = champByKey(id)?.id;
      if (!c) return;
      const r = await window.kayn.setChampionFlag(c, f);
      $("pool-flag-error").hidden = !r.flagError;
      $("pool-flag-error").textContent = r.flagError ?? "";
      void loadPool();
    });
    return b;
  };
  const row = (e: { championId: number; line: string; details: string[] }, buttons: Node[]) =>
    h("div", { class: "pool-row" }, icon(champByKey(e.championId)?.image ? CDN_CHAMP + champByKey(e.championId)!.image : "", champName(e.championId), "pr-ic"),
      h("div", {}, h("b", {}, champName(e.championId)), h("p", { class: "small pool-line" }, e.line)), h("div", { class: "pool-btns" }, ...buttons));
  const role = (v: (typeof pools)[number]) => [
    h("h3", {}, v.role === "JUNGLE" ? "Jungle" : "Milieu"),
    ...(v.tooMany ? [h("p", { class: "warn-text small" }, `Tu as ${v.progress.length} champions « Je veux progresser dessus » : c'est trop pour progresser vraiment. Garde-en 2, retire les autres.`)] : []),
    h("h4", {}, "À faire progresser"),
    ...(v.progress.length ? v.progress.map((e) => row(e, [flag(e.championId, null, "Retirer")])) : [h("p", { class: "muted small" }, "Aucun : choisis-en 1 ou 2 dans « À essayer ».")]),
    h("h4", {}, "Confort"),
    ...(v.comfort.length ? v.comfort.map((e) => row(e, [flag(e.championId, "progress", "Je veux progresser dessus"), flag(e.championId, "notForMe", "Pas pour moi")])) : [h("p", { class: "muted small" }, "Aucun : tes champions les plus joués sont en « Pas pour moi ».")]),
    h("h4", {}, "À essayer"),
    ...(v.toTry.length ? v.toTry.map((e) => row(e, [flag(e.championId, "progress", "Je veux progresser dessus"), flag(e.championId, "notForMe", "Pas pour moi")])) : [h("p", { class: "muted small" }, "Rien à proposer pour l'instant.")]),
    detailsBlock([...[...v.progress, ...v.comfort, ...v.toTry].map((e) => ({ title: champName(e.championId), lines: e.details })),
      { title: "Pas pour moi", lines: v.notForMe.map((id) => h("span", {}, champName(id), " ", flag(id, null, "Rétablir"))) }]),
  ];
  $("pool").replaceChildren(...pools.filter((v) => v.role === "JUNGLE").flatMap(role),
    ...pools.filter((v) => v.role !== "JUNGLE").flatMap((v) => [h("details", { class: "details" }, h("summary", { class: "small muted" }, v.role === "MIDDLE" ? "Milieu" : v.role), ...role(v))]));
}

/** Tes dernières parties (cliquables) et l'analyse de celle choisie ; la même analyse partout dans l'appli. */
let postList: PostGame[] = [];
async function loadPostGames(): Promise<void> {
  const list = await window.kayn.getPostGames().catch(() => null);
  postList = list ?? [];
  if (!postList.length) {
    $("post-list").replaceChildren(h("p", { class: "muted small" }, "Pas encore de partie analysée : joue une partie classée ou normale en draft."));
    $("post-view").replaceChildren();
    return;
  }
  showPostGame(postOpen && postList.some((p) => p.matchId === postOpen) ? postOpen : postList[0].matchId);
}
function showPostGame(matchId: string): void {
  postOpen = matchId;
  $("post-list").replaceChildren(...postList.map((p) => {
    const b = h("button", { type: "button", class: `post-row${p.matchId === matchId ? " sel" : ""}`, "aria-pressed": String(p.matchId === matchId) },
      icon(champByKey(p.championId)?.image ? CDN_CHAMP + champByKey(p.championId)!.image : "", champName(p.championId), "pr-ic"),
      h("span", {}, `${new Date(p.startMs).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} · ${champName(p.championId)}`),
      h("span", { class: p.win ? "good-text" : "bad-text" }, p.win ? "victoire" : "défaite"),
      h("span", { class: "muted" }, p.opponent ? `contre ${champName(p.opponent)}` : ""));
    b.addEventListener("click", () => showPostGame(p.matchId));
    return b;
  }));
  const p = postList.find((x) => x.matchId === matchId);
  $("post-view").replaceChildren(...(p ? [renderPostGame(p, true)] : []));
  if (p) void loadGameDetail(p);
}
/** Ouvre l'analyse d'une partie (Accueil, notification). */
function openPostGame(matchId: string | null): void {
  selectTab("after");
  postOpen = matchId;
  void loadPostGames().then(() => $("post-sec").scrollIntoView({ block: "start" }));
}
$("post-check").addEventListener("click", async () => {
  const before = postList[0]?.matchId ?? null;
  const btn = $<HTMLButtonElement>("post-check");
  btn.disabled = true;
  $("post-status").textContent = "Recherche de ta dernière partie chez Riot…";
  await window.kayn.checkNewGames().catch(() => {});
  // La collecte lit la partie puis sa chronologie : on regarde toutes les 5 s pendant 2 minutes.
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const list = await window.kayn.getPostGames().catch(() => null);
    if (list?.[0] && list[0].matchId !== before) { postOpen = list[0].matchId; await loadPostGames(); $("post-status").textContent = "Nouvelle partie analysée."; btn.disabled = false; return; }
  }
  $("post-status").textContent = before ? "Pas de nouvelle partie chez Riot : ta dernière partie est déjà analysée (Riot la publie quelques minutes après la fin)." : "Aucune partie trouvée pour l'instant.";
  btn.disabled = false;
});
void loadPostGames();
window.kayn.onPostGameReady((id) => { postOpen = id; void loadPostGames(); });

// Niveau de référence : mémorisé dans les réglages (partagé avec Champions recommandés), puis tout est recalculé.
$<HTMLSelectElement>("af-ref").addEventListener("change", (e) => {
  const tier = (e.target as HTMLSelectElement).value as AppState["refTier"];
  void window.kayn.setRefTier(tier).then(() => { ov = null; void loadAnalysis(anKey); });
});
for (const b of document.querySelectorAll<HTMLButtonElement>(".an-views button")) {
  b.addEventListener("click", () => {
    anViewMode = b.dataset.view as typeof anViewMode;
    for (const x of document.querySelectorAll(".an-views button")) x.setAttribute("aria-selected", String(x === b));
    void loadAnalysis(anKey);
  });
}

/** Ligne de mesure : valeur, barre de position, médiane. */
function metricRow(label: string, mine: number | null, unit: string, rank: number | null, med: number | null, extra = "", medLabel = "méd."): HTMLElement {
  const fill = h("span", { class: "an-fill", "data-pct": String(Math.round(rank ?? 0)) });
  const cls = rank == null ? "" : rank >= 60 ? " good" : rank < 40 ? " bad" : "";
  return h("div", { class: `an-metric${cls}` },
    h("span", { class: "an-label" }, label, extra ? h("span", { class: "small muted" }, extra) : null),
    h("span", { class: "an-val" }, fmtNum(mine, unit)),
    h("span", { class: "an-bar", title: rank == null ? "" : `Mieux que ${Math.round(rank)} % des joueurs ${refShort}` }, fill),
    h("span", { class: "an-med small muted" }, med == null ? "" : `${medLabel} ${fmtNum(med, unit)}`));
}
const applyBars = () => { for (const f of document.querySelectorAll<HTMLElement>(".an-fill")) f.style.width = `${f.dataset.pct}%`; };

function renderOverview(): void {
  const v = ov;
  if (!v) return;
  const o = v.overview;
  const empty = o.games === 0;
  $("ov-empty").hidden = !empty;
  for (const s of document.querySelectorAll<HTMLElement>("#an-overview > section")) s.hidden = empty;
  if (empty) return;
  const who = v.filter.championId != null ? champName(v.filter.championId) : "tous tes champions";
  $("ov-summary").replaceChildren(h("b", {}, `${o.games} partie${o.games > 1 ? "s" : ""}`), ` · ${who} · `,
    h("b", {}, `${fmtNum(o.winRate, " %")} ± ${Math.round(wilsonPm(o.winRate ?? 0, o.games))} de victoires`), o.metaWinRate != null ? h("span", { class: "muted" }, ` (${refShort} : ${fmtNum(o.metaWinRate, " %")})`) : "");
  const season = o.refs.season ?? "";
  const metaRef = o.comparedTo === "champion" ? `joueurs ${refShort} ${season} sur ${who}` : `joueurs ${refShort} ${season} du rôle`;
  $("ov-note").textContent = [
    o.refs.opponent === 0 ? `Référence : ${metaRef}.`
      : o.refs.meta === 0 ? `Référence : ton adversaire direct de la même partie (${o.refs.opponent} parties de saisons sans méta) ; la barre donne la part des parties où tu fais mieux que lui.`
      : `Référence : ${metaRef} pour ${o.refs.meta} parties de ${season} ; ton adversaire direct de la même partie pour ${o.refs.opponent} parties des saisons précédentes (part des parties où tu fais mieux que lui).`,
    "Barre : à droite = meilleur, 50 % = la référence.",
  ].join(" ");
  $("ov-metrics").replaceChildren(...o.metrics.map((m) => metricRow(m.label, m.mine, m.unit, m.rank, m.median, m.n < o.games ? ` (${m.n})` : "")));
  applyBars();
  const item = (m: (typeof o.metrics)[number]) => h("li", {}, h("b", {}, m.label), ` : ${fmtNum(m.mine, m.unit)}${m.median != null ? ` (méd. ${fmtNum(m.median, m.unit)})` : ""} · mieux que ${Math.round(m.rank ?? 0)} %`);
  $("ov-strengths").replaceChildren(...(o.strengths.length ? o.strengths.map(item) : [h("li", { class: "muted" }, "Rien de nettement au-dessus de la médiane.")]));
  $("ov-weaknesses").replaceChildren(...(o.weaknesses.length ? o.weaknesses.map(item) : [h("li", { class: "muted" }, "Rien de nettement en dessous de la médiane.")]));
  renderRadar();
  drawHeat();
  renderEvolution();
  renderTable();
}

/** Radar de la sélection (et d'un champion à comparer), sur la médiane du rôle au niveau de référence. */
function renderRadar(): void {
  const v = ov!;
  const sel = $<HTMLSelectElement>("ov-compare");
  sel.replaceChildren(h("option", { value: "" }, "—"), ...v.compareOptions.filter((id) => id !== v.filter.championId).map((id) => h("option", { value: String(id) }, champName(id))));
  sel.value = v.compare ? String(v.compare.championId) : "";
  const name = v.filter.championId != null ? champName(v.filter.championId) : "Ta sélection";
  const series: RadarSeries[] = [];
  if (v.radar) series.push({ values: v.radar.values, cls: "s-main", name });
  if (v.compare?.radar) series.push({ values: v.compare.radar.values, cls: "s-cmp", name: champName(v.compare.championId) });
  const box = $("ov-radar");
  if (!v.radar) { box.replaceChildren(h("p", { class: "small muted" }, "Il faut au moins 5 parties relues pour tracer le profil.")); $("ov-radar-note").textContent = ""; return; }
  box.replaceChildren(radarSvg(series, { size: 220, labels: true, refName: refShort }));
  $("ov-radar-note").replaceChildren(h("span", { class: "lg lg-main" }), ` ${name} (${v.radar.games} parties)`,
    v.compare ? h("span", {}, h("span", { class: "lg lg-cmp" }), ` ${champName(v.compare.championId)}${v.compare.radar ? ` (${v.compare.radar.games} parties)` : " : moins de 5 parties"}`) : "",
    h("span", {}, h("span", { class: "lg lg-med" }), ` médiane ${refShort} du rôle (${ov!.reference.games.toLocaleString("fr-FR")} joueurs de méta)`),
    h("br"), `Chaque axe : ta position « mieux que X % » face aux joueurs ${refShort} du même rôle (parties trouvées par un joueur de ce rang ; le matchmaking mélange des rangs voisins)`, " pour les parties de la saison de la méta, et la part des parties où tu fais mieux que ton adversaire direct pour les saisons précédentes. Survole un point pour le détail.");
}
$<HTMLSelectElement>("ov-compare").addEventListener("change", (e) => {
  const v = (e.target as HTMLSelectElement).value;
  compareId = v ? Number(v) : null;
  void loadAnalysis(anKey);
});

/**
 * Carte de chaleur : densité des kills et des morts sur une grille (noyau gaussien), normalisée par une valeur
 * haute (90ᵉ centile) pour que les zones fréquentes ressortent sans tout saturer.
 */
function drawHeat(): void {
  const canvas = $<HTMLCanvasElement>("ov-heat");
  const size = canvas.clientWidth || 400;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr; canvas.height = size * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const heat = ov?.heat;
  if (!heat) return;
  // Le moteur envoie déjà le nombre d'événements par case : on étale chaque case (noyau gaussien).
  const G = 96, R = 3, SIG = 1.6;
  const spread = (flat: number[]) => {
    const grid = new Float32Array(G * G);
    for (let n = 0; n < flat.length; n += 2) {
      const idx = flat[n], count = flat[n + 1];
      const cx = idx % G, cy = Math.floor(idx / G);
      for (let j = cy - R; j <= cy + R; j++) for (let i = cx - R; i <= cx + R; i++) {
        if (i < 0 || j < 0 || i >= G || j >= G) continue;
        grid[j * G + i] += count * Math.exp(-((i - cx) ** 2 + (j - cy) ** 2) / (2 * SIG * SIG));
      }
    }
    return grid;
  };
  const pick = (g: { early: number[]; late: number[] }) => (heatTime === "all" ? [...g.early, ...g.late] : g[heatTime]);
  const kCells = heatKinds === "deaths" ? [] : pick(heat.kills);
  const dCells = heatKinds === "kills" ? [] : pick(heat.deaths);
  const kg = spread(kCells), dg = spread(dCells);
  const nz = [...kg, ...dg].filter((v) => v > 0.01).sort((p, q) => p - q);
  const top = nz.length ? nz[Math.floor(nz.length * 0.9)] : 1;
  const small = document.createElement("canvas");
  small.width = G; small.height = G;
  const sctx = small.getContext("2d")!;
  const img = sctx.createImageData(G, G);
  for (let p = 0; p < G * G; p++) {
    const k = Math.min(1, kg[p] / top), d = Math.min(1, dg[p] / top), t = k + d;
    if (t < 0.02) continue;
    img.data[p * 4] = (79 * k + 224 * d) / t;
    img.data[p * 4 + 1] = (195 * k + 83 * d) / t;
    img.data[p * 4 + 2] = (138 * k + 93 * d) / t;
    img.data[p * 4 + 3] = Math.pow(Math.max(k, d), 0.7) * 235;
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  const sum = (flat: number[]) => flat.reduce((n, v, i) => (i % 2 ? n + v : n), 0);
  $("ov-heat-note").textContent = `${sum(kCells)} kill(s) en vert, ${sum(dCells)} mort(s) en rouge. Plus la couleur est vive, plus il y en a au même endroit.`;
}
function pressGroup(attr: string, b: HTMLButtonElement): void {
  for (const x of document.querySelectorAll(`[${attr}]`)) x.setAttribute("aria-pressed", String(x === b));
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-hk]")) b.addEventListener("click", () => { heatKinds = b.dataset.hk as typeof heatKinds; pressGroup("data-hk", b); drawHeat(); });
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-ht]")) b.addEventListener("click", () => { heatTime = b.dataset.ht as typeof heatTime; pressGroup("data-ht", b); drawHeat(); });

/** Évolution d'une mesure (ou du win rate), mois par mois ou patch par patch. */
function renderEvolution(): void {
  const v = ov!;
  const sel = $<HTMLSelectElement>("ov-evo-metric");
  if (!sel.options.length) {
    sel.replaceChildren(h("option", { value: "wr" }, "Win rate"), ...v.overview.metrics.map((m) => h("option", { value: m.key }, m.label)));
    sel.addEventListener("change", renderEvolution);
  }
  const key = sel.value || "wr";
  const metric = v.overview.metrics.find((m) => m.key === key);
  const unit = key === "wr" ? " %" : metric?.unit ?? "";
  const pts = v.evolution.points.map((p) => ({ label: p.label, n: p.games, y: key === "wr" ? p.winRate : p.values[key] })).filter((p): p is { label: string; n: number; y: number } => p.y != null);
  const box = $("ov-evo");
  if (pts.length < 2) { box.replaceChildren(h("p", { class: "small muted" }, `Pas assez de ${v.evolution.by === "month" ? "mois" : "patchs"} différents pour une courbe.`)); return; }
  const NS = "http://www.w3.org/2000/svg";
  const W = 400, H = 150, L = 34, R = 20, T = 10, B = 34;
  const ref = key === "wr" ? v.overview.metaWinRate : metric?.median ?? null;
  const ys = [...pts.map((p) => p.y), ...(ref != null ? [ref] : [])];
  const lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo || 1) * 0.15;
  const sx = (i: number) => L + (i * (W - L - R)) / (pts.length - 1);
  const sy = (y: number) => T + (1 - (y - (lo - pad)) / (hi - lo + 2 * pad)) * (H - T - B);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "evo");
  const el = (tag: string, attrs: Record<string, string>, text?: string) => { const e = document.createElementNS(NS, tag); for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val); if (text) e.textContent = text; svg.append(e); return e; };
  for (const y of [lo, hi]) el("text", { x: String(L - 4), y: String(sy(y) + 3), class: "evo-axis", "text-anchor": "end" }, fmtNum(y, unit));
  if (ref != null) el("line", { x1: String(L), x2: String(W - R), y1: String(sy(ref)), y2: String(sy(ref)), class: "spark-med" });
  el("polyline", { points: pts.map((p, i) => `${sx(i)},${sy(p.y)}`).join(" "), class: "spark-line" });
  pts.forEach((p, i) => {
    const c = el("circle", { cx: String(sx(i)), cy: String(sy(p.y)), r: "3.5", class: "evo-dot" });
    const t = document.createElementNS(NS, "title"); t.textContent = `${p.label} : ${fmtNum(p.y, unit)} (${p.n} partie${p.n > 1 ? "s" : ""})`; c.append(t);
    if (pts.length <= 8 || i % Math.ceil(pts.length / 8) === 0 || i === pts.length - 1) el("text", { x: String(sx(i)), y: String(H - B + 14), class: "evo-axis", "text-anchor": "middle" }, p.label);
    el("text", { x: String(sx(i)), y: String(H - B + 26), class: "evo-n", "text-anchor": "middle" }, String(p.n));
  });
  box.replaceChildren(svg, h("p", { class: "small muted" }, `${v.evolution.by === "month" ? "Mois par mois" : "Patch par patch"} · sous chaque point : nombre de parties${ref != null ? " · pointillés : médiane Émeraude+ actuelle" : ""}.`));
}

/** « Tous les champions » : tes champions comparés entre eux. */
function renderTable(): void {
  const rows = ov?.table;
  $("ov-table-sec").hidden = !rows?.length;
  if (!rows?.length) return;
  const metrics = ov!.overview.metrics;
  const cols: { key: string; label: string; unit: string; better: "+" | "-"; get: (r: ChampionRow) => number | null }[] = [
    { key: "games", label: "Parties", unit: "", better: "+", get: (r) => r.games },
    { key: "wr", label: "Victoires", unit: " %", better: "+", get: (r) => r.winRate },
    ...metrics.map((m) => ({ key: m.key, label: m.label.replace("Participation aux ", "Part. ").replace(" avant 15 min", " <15").replace(" après 15 min", " >15").replace(" à ", " "), unit: m.unit, better: m.better, get: (r: ChampionRow) => r.values[m.key] })),
  ];
  const sorted = [...rows].sort((a, b) => {
    if (tableSort.key === "name") return champName(a.championId).localeCompare(champName(b.championId), "fr") * (tableSort.asc ? 1 : -1);
    const c = cols.find((x) => x.key === tableSort.key)!;
    return ((c.get(a) ?? -Infinity) - (c.get(b) ?? -Infinity)) * (tableSort.asc ? 1 : -1);
  });
  const head = h("tr", {}, h("th", { class: "left", "data-k": "name" }, "Champion"), ...cols.map((c) => h("th", { "data-k": c.key, title: c.label }, c.label)));
  for (const th of head.querySelectorAll<HTMLElement>("th")) th.addEventListener("click", () => { const k = th.dataset.k!; tableSort = { key: k, asc: tableSort.key === k ? !tableSort.asc : k === "name" }; renderTable(); });
  const body = sorted.map((r) => {
    const name = h("button", { type: "button", class: "link" }, champName(r.championId));
    name.addEventListener("click", () => { anFilterSel = { ...anFilterSel, championId: r.championId }; void loadAnalysis(null); });
    return h("tr", {}, h("td", { class: "left" }, name), ...cols.map((c) => {
      const v = c.get(r);
      // Meilleur / plus faible : seulement entre champions d'au moins 20 parties (pas de conclusion en dessous).
      // Comparaison par la position face à la référence de chaque saison (jamais des moyennes brutes qui
      // mélangeraient des saisons différentes) ; le win rate tel quel.
      const pos = (x: ChampionRow) => (c.key === "wr" ? x.winRate : x.ranks[c.key] ?? null);
      const all = rows.filter((x) => x.games >= 20).map(pos).filter((x): x is number => x != null);
      const p = pos(r);
      let cls = "";
      if (p != null && r.games >= 20 && all.length >= 2 && c.key !== "games") {
        cls = p === Math.max(...all) ? "best" : p === Math.min(...all) ? "worst" : "";
      }
      const med = r.medians[c.key];
      return h("td", { class: cls, title: med != null ? `Médiane ${refShort} sur ${champName(r.championId)} : ${fmtNum(med, c.unit)}` : "" },
        fmtNum(v, c.unit), c.key === "wr" ? h("span", { class: "small muted" }, ` ±${Math.round(wilsonPm(v ?? 0, r.games))}`) : null);
    }));
  });
  $("ov-table").replaceChildren(h("thead", {}, head), h("tbody", {}, ...body));
}

function renderAnalysis(): void {
  const v = anView;
  const has = !!v?.analysis;
  $("an-empty").hidden = has;
  for (const id of ["an-map-sec", "an-metrics-sec", "an-focus-sec", "an-radar-sec"]) $(id).hidden = !has;
  const sel = $<HTMLSelectElement>("an-game");
  sel.replaceChildren(...(v?.games ?? []).map((g) => h("option", { value: g.key },
    `${new Date(g.startMs).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} · ${champName(g.championId)} (${ROLE_SHORT[g.role] ?? g.role}) · ${g.win ? "Victoire" : "Défaite"} · ${g.kda}`)));
  sel.hidden = !v?.games.length;
  if (!v?.analysis) return;
  sel.value = v.selected ?? "";
  const a = v.analysis, g = a.game;
  $("an-summary").textContent = `${champName(g.championId)} · ${g.win ? "victoire" : "défaite"} en ${mmss(g.durationS * 1000)} · ${g.kills}/${g.deaths}/${g.assists} · ${g.cs} CS · patch ${officialPatch(g.patch)}`;

  // Carte : base bleue en bas à gauche ; y inversé pour l'écran.
  const evs = a.events.filter((e) => anFilter === "all" || (anFilter === "early" ? e.t < 900_000 : e.t >= 900_000));
  const map = $("an-map");
  map.querySelectorAll(".an-dot").forEach((d) => d.remove());
  for (const e of evs) {
    const other = champName(e.otherChamp);
    const dot = h("span", { class: `an-dot ${e.kind}`, title: `${mmss(e.t)} · ${e.kind === "kill" ? `kill sur ${other}` : e.kind === "death" ? `mort (tué par ${other})` : `assist sur ${other}`}` });
    dot.style.left = `${(e.x / MAP_SIZE) * 100}%`;
    dot.style.top = `${100 - (e.y / MAP_SIZE) * 100}%`;
    map.append(dot);
  }

  const rs: RadarSeries[] = [];
  if (v.radar?.average) rs.push({ values: v.radar.average.values, cls: "s-avg", name: `Ta moyenne (${v.radar.average.games} parties)` });
  if (v.radar?.game) rs.push({ values: v.radar.game.values, cls: "s-main", name: "Cette partie" });
  $("an-radar").replaceChildren(radarSvg(rs, { size: 200, labels: true, refName: refShort }));
  const opp = a.comparedTo === "opponent";
  $("an-metrics").replaceChildren(...a.metrics.map((m) => metricRow(m.label, m.mine, m.unit, m.rank, m.median, "", opp ? "adv." : "méd.")));
  applyBars();
  $("an-ref").textContent = opp
    ? `Partie d'une saison sans méta : comparée à ton adversaire direct (même rôle, même partie). « adv. » : sa valeur ; barre pleine si tu fais mieux que lui, à moitié à égalité.`
    : a.comparedTo === "champion"
    ? `Comparé à ${a.metaGames.toLocaleString("fr-FR")} parties ${refShort} sur ${champName(g.championId)} (${ROLE_SHORT[g.role] ?? g.role}). La barre : ta position (à droite = meilleur).`
    : `Pas encore assez de parties ${refShort} sur ce champion : comparé à tous les joueurs du rôle (${a.metaGames.toLocaleString("fr-FR")} parties).`;

  $("an-focus").replaceChildren(...(a.focus.length ? a.focus.map((f) => h("div", { class: "an-focus" }, h("p", { class: "small" }, f.text), sparkline(f.trend, f.median)))
    : [h("p", { class: "small muted" }, a.focusGames < 3 ? "Pas encore assez de parties récentes pour dégager des tendances." : `Rien de marqué : tu es au niveau ou au-dessus de la médiane ${refShort} sur tous les points suivis.`)]));
}

/** Petite courbe de tes valeurs (de la plus ancienne à la plus récente), avec la médiane Émeraude+ en pointillés. */
function sparkline(values: number[], med: number): Element {
  const NS = "http://www.w3.org/2000/svg";
  const W = 220, H = 36, P = 3;
  const lo = Math.min(med, ...values), hi = Math.max(med, ...values);
  const sx = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, values.length - 1);
  const sy = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "spark");
  const line = document.createElementNS(NS, "polyline");
  line.setAttribute("points", values.map((v, i) => `${sx(i)},${sy(v)}`).join(" "));
  line.setAttribute("class", "spark-line");
  const m = document.createElementNS(NS, "line");
  m.setAttribute("x1", "0"); m.setAttribute("x2", String(W)); m.setAttribute("y1", String(sy(med))); m.setAttribute("y2", String(sy(med)));
  m.setAttribute("class", "spark-med");
  svg.append(m, line);
  return svg;
}

$<HTMLSelectElement>("an-game").addEventListener("change", (e) => void loadAnalysis((e.target as HTMLSelectElement).value));
for (const b of document.querySelectorAll<HTMLButtonElement>(".an-game-filter button")) {
  b.addEventListener("click", () => {
    anFilter = b.dataset.f as typeof anFilter;
    for (const x of document.querySelectorAll(".an-game-filter button")) x.setAttribute("aria-pressed", String(x === b));
    renderAnalysis();
  });
}

// ---------- Objectifs ----------

type GV = Awaited<ReturnType<typeof window.kayn.getGoals>>;
const fmtStat = (s: GV["goals"][number]["metrics"][number]["since"], unit: string) =>
  s.value == null ? "–" : `${fmtNum(s.value, unit)}${s.margin != null ? ` ± ${fmtNum(s.margin, unit === " %" ? "" : "")}` : ""} (${s.n})`;

function goalCard(g: GV["goals"][number]): HTMLElement {
  const per = g.horizon === "week" ? "semaine" : "mois";
  const details: string[] = [];
  const rows = g.metrics.filter((m) => !m.info).map((m) => {
    const cur = m.since.n >= 5 ? m.since : m.before;
    const status = m.since.n < 20 ? ["muted", "pas encore de conclusion"] : m.reached ? ["ok-text", "cible atteinte"] : ["warn-text", "pas encore à la cible"];
    details.push(`${m.label} : avant ${fmtStat(m.before, m.unit)} → depuis ${fmtStat(m.since, m.unit)} (entre parenthèses : parties ; ± : marge). ${m.needed === 0 ? "Assez de parties pour trancher." : m.needed == null ? "Trop proche de la cible pour trancher." : `Encore environ ${m.needed} parties pour trancher.`}${m.clear ? " Écart net avec la période d'avant." : ""}`);
    return h("div", { class: "goal-metric" },
      h("div", { class: "goal-label" }, m.label),
      h("div", { class: "goal-vals" }, h("b", {}, cur.value != null ? fmtNum(cur.value, m.unit) : "–"), ` → cible ${fmtNum(m.target, m.unit)} `, h("span", { class: `small ${status[0]}` }, `· ${status[1]}`)),
      m.periods.filter((w) => w.stat.value != null).length >= 2 ? periodBars(m, per) : null);
  });
  for (const m of g.metrics.filter((x) => x.info)) details.push(`${m.label} (pour information${m.note ? `, ${m.note}` : ""}) : avant ${fmtStat(m.before, m.unit)} → depuis ${fmtStat(m.since, m.unit)}.`);
  return h("div", { class: `goal${g.main ? " main" : ""}` },
    h("h3", {}, g.label),
    ...rows,
    h("p", { class: "small goal-ex" }, h("b", {}, g.horizon === "week" ? "Exercice : " : "À quoi ça sert : "), g.exercise),
    detailsBlock([{ title: "Chiffres", lines: details }]));
}

function renderGoals(v: GV): void {
  const start = new Date(v.startMs).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const from = new Date(v.baseline.fromMs).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  $("goals-head").textContent = `Depuis le ${start} : ${v.sinceGames} partie${v.sinceGames > 1 ? "s" : ""}.`;
  const weekly = v.goals.filter((g) => g.horizon === "week"), monthly = v.goals.filter((g) => g.horizon === "month");
  $("goals").replaceChildren(
    ...weekly.map(goalCard),
    h("details", { class: "details" }, h("summary", { class: "small muted" }, "Résultats à long terme (chaque mois)"), ...monthly.map(goalCard),
      h("p", { class: "small muted" }, `Référence : ${v.baseline.extended ? `tes ${v.baseline.games} dernières parties d'avant (moins de 20 sur les 4 semaines)` : `les 4 semaines d'avant (${v.baseline.games} parties, depuis le ${from})`}.`)));
}

/** Valeur par période depuis le début du suivi (barres), avec la cible en pointillés. */
function periodBars(m: GV["goals"][number]["metrics"][number], per: string): Element {
  const NS = "http://www.w3.org/2000/svg";
  const W = 260, H = 44, pts = m.periods;
  const vals = pts.map((w) => w.stat.value ?? 0);
  const hi = Math.max(m.target, ...vals) * 1.15 || 1;
  const bw = (W - 10) / pts.length;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "weeks");
  svg.setAttribute("aria-label", `Valeur par ${per}`);
  pts.forEach((w, i) => {
    if (w.stat.value == null) return;
    const hgt = (w.stat.value / hi) * (H - 12);
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", String(5 + i * bw + 2)); r.setAttribute("width", String(Math.max(2, bw - 4)));
    r.setAttribute("y", String(H - 10 - hgt)); r.setAttribute("height", String(hgt));
    const good = m.better === "-" ? w.stat.value <= m.target : w.stat.value >= m.target;
    r.setAttribute("class", good ? "wk good" : "wk");
    const t = document.createElementNS(NS, "title"); t.textContent = `${w.label} : ${fmtNum(w.stat.value, m.unit)} (${w.stat.n} partie(s))${w.stat.n < 20 ? " · moins de 20 parties : indicatif" : ""}`; r.append(t);
    svg.append(r);
  });
  const y = H - 10 - (m.target / hi) * (H - 12);
  const l = document.createElementNS(NS, "line");
  l.setAttribute("x1", "0"); l.setAttribute("x2", String(W)); l.setAttribute("y1", String(y)); l.setAttribute("y2", String(y)); l.setAttribute("class", "spark-med");
  svg.append(l);
  return svg;
}

/** Réglages : début du suivi et cibles. */
function renderGoalSettings(v: GV): void {
  $("goals-start").textContent = `Suivi depuis le ${new Date(v.startMs).toLocaleDateString("fr-FR")}.`;
  // Champs créés une seule fois, mis à jour sur place (jamais pendant la saisie).
  syncTargetInputs($("goals-targets"), v.goals.flatMap((g) => g.metrics.filter((m) => !m.info).map((m) => ({ key: m.key, label: m.label, better: m.better, unit: m.unit, target: m.target }))),
    (key, value) => void window.kayn.setGoalTarget(key, value).then(applyGoals));
}

function applyGoals(v: GV): void { renderGoals(v); renderGoalSettings(v); }
async function loadGoals(): Promise<void> { applyGoals(await window.kayn.getGoals()); }
$("goals-restart").addEventListener("click", async () => applyGoals(await window.kayn.restartGoals()));
void loadGoals();
window.setInterval(() => void loadGoals(), 120_000);

// ---------- Champions exclus ----------

let excludedNow: string[] = [];
$("champ-list").replaceChildren(...CHAMPIONS.map((c) => h("option", { value: c.name })));
function renderExcluded(ids: string[]): void {
  if (ids.join() === excludedNow.join() && $("excluded").childElementCount) return;
  excludedNow = [...ids];
  $("excluded").replaceChildren(...(ids.length ? ids.map((id) => {
    const c = findChamp(id);
    const x = h("button", { type: "button", title: "Retirer", "aria-label": `Retirer ${c?.name ?? id}` }, "✕");
    x.addEventListener("click", async () => render(await window.kayn.setExcludedChampions(excludedNow.filter((e) => e !== id))));
    return h("span", { class: "chip" }, c?.name ?? id, x);
  }) : [h("span", { class: "muted small" }, "Aucun")]));
}
$<HTMLInputElement>("excluded-add").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const c = findChamp(input.value.trim());
  if (!c?.id || excludedNow.includes(c.id)) return;
  input.value = "";
  render(await window.kayn.setExcludedChampions([...excludedNow, c.id]));
});

window.kayn.onState(render);
void window.kayn.getState().then(render);

