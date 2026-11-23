// Fenêtre d'état. Pas d'accès à Node : tout passe par window.kayn (preload.ts).
import type { AppState, DraftView, KaynApi } from "../ipc.ts";
import { acceleratorFromKey } from "../shortcuts.ts";
import { CHAMPIONS, champByKey, findChamp } from "../../src/data/champions";
import { DDRAGON_VERSION } from "../../src/data/version";
import { runeIconUrl, runeName, RUNE_TREES, RUNES_BY_ID } from "../../src/data/runes";

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
    : c.matchesEnv === false ? `Compte : ${c.account}, différent du RIOT_ID du .env (${s.riotId}).`
    : c.matchesEnv ? `Compte : ${c.account} (identique au .env)`
    : `Compte : ${c.account}`;
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

/** Texte du moteur où seul <b>…</b> est autorisé : tout le reste est affiché tel quel. */
function boldText(s: string): HTMLElement {
  const p = h("p");
  s.split(/(<b>.*?<\/b>)/).forEach((part) => {
    const m = part.match(/^<b>(.*)<\/b>$/);
    p.append(m ? h("b", {}, m[1]) : part);
  });
  return p;
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
const sgn = (x: number) => `${x < 0 ? "−" : "+"}${Math.abs(x).toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`;

/** Page de runes recommandée, avec le bouton d'import dans le client. */
function renderRunePage(p: NonNullable<DraftView["runePage"]>, note: string | null): HTMLElement {
  const runeIcon = (id: number, cls: string) => {
    const r = RUNES_BY_ID[id];
    return r ? icon(runeIconUrl(r.icon), runeName(id), cls) : h("span", { class: cls });
  };
  const tree = (id: number) => RUNE_TREES[id]?.nameEn ?? String(id);
  const source = p.source === "guide"
    ? "Guide Kayn pour la forme recommandée."
    : `Page la plus jouée en Émeraude+ avec ${runeName(p.selections[0])} : ${p.games} parties, ${Math.round(p.winRate ?? 0)} % de victoires.`;
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
    h("p", { class: "small" }, h("b", {}, `${tree(p.primary)} : `), p.selections.slice(0, 4).map(runeName).join(" · ")),
    h("p", { class: "small" }, h("b", {}, `${tree(p.sub)} : `), p.selections.slice(4).map(runeName).join(" · ")),
    h("p", { class: "small muted" }, `Shards : ${p.shards.map(runeName).join(", ")}`),
    note ? boldText(note) : null,
    h("p", { class: "small muted" }, source),
    h("div", { class: "row" }, btn),
    status);
}

/** Tes meilleurs choix pour cette draft : mis en avant, c'est toi qui choisis. */
function renderPicks(p: NonNullable<DraftView["picks"]>): HTMLElement {
  const card = (x: NonNullable<DraftView["picks"]>["list"][number], i: number | null) => {
    const ch = champByKey(x.championId);
    const delta = x.score - x.base;
    return h("div", { class: `pick${i === 0 ? " best" : ""}${x.inPool ? "" : " off"}` },
      icon(ch?.image ? CDN_CHAMP + ch.image : "", ch?.name ?? "", "champ"),
      h("div", {},
        h("div", { class: "pick-name" }, `${i != null ? `${i + 1}. ` : ""}${ch?.name ?? `#${x.championId}`}`,
          h("span", { class: "small muted", title: "Effet de cette draft sur le score (contres, synergies, dégâts)" }, ` ${sgn(delta)} avec cette draft`),
          x.provisional ? h("span", { class: "small muted" }, " · provisoire") : null),
        h("ul", { class: "why small" }, ...x.reasons.map((r) => h("li", {}, r)))));
  };
  return h("div", { class: `picks${p.myTurn ? " my-turn" : ""}` },
    h("h3", {}, p.myTurn ? "À toi de choisir" : `Tes meilleurs choix (${p.role === "JUNGLE" ? "jungle" : "milieu"})`),
    ...(p.list.length ? p.list.map((x, i) => card(x, i)) : [h("p", { class: "muted small" }, "Aucun champion de ton pool disponible.")]),
    ...(p.offPool ? [h("p", { class: "small muted" }, "À envisager :"), card(p.offPool, null)] : []),
    h("p", { class: "muted small" }, "Classés selon ton pool, les duels et associations en Émeraude+ et l'équilibre des dégâts. Mis à jour à chaque pick."));
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
      cell(r.enemy, "en", r.enemy && r.probable ? h("span", { class: "small muted", title: "Rôle déduit de la méta Émeraude+" }, " probable") : null))));
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
  if (d.picks) body.push(renderPicks(d.picks));
  if (d.runePage) body.push(renderRunePage(d.runePage, d.isKayn && d.runes ? d.runes.note : null));
  // Section Kayn (forme, runes, build) : seulement si tu survoles ou as verrouillé Kayn.
  if (!d.isKayn) {
    $("draft-body").replaceChildren(...body.filter((c): c is Node | string => !!c));
    return;
  }
  if (d.unknown) body.push(h("p", { class: "warn-text small" }, `${d.unknown} champion(s) inconnu(s) : relance npm run sync pour mettre les données à jour.`));

  if (!d.form) {
    body.push(h("p", { class: "muted" }, "En attente du premier champion adverse…"));
  } else {
    const f = d.form;
    const name = f.value === "blue" ? "Bleu · assassin (Shadow Assassin)" : "Rouge · Rhaast";
    body.push(h("div", { class: `form ${f.value}` },
      h("strong", {}, `Forme recommandée : ${name}`),
      h("span", { class: "small" }, `${f.provisional ? `provisoire (${d.enemyCount}/5 adversaires)` : `${d.enemyCount}/5 adversaires`}${f.close ? " · c'est serré" : ""} · score ${f.score > 0 ? "+" : ""}${f.score}`)));
    body.push(h("ul", { class: "why small" }, ...f.why.map((w) => h("li", {}, w))));
  }

  if (d.runes && !d.runePage) {
    const r = d.runes;
    body.push(h("div", { class: "runes" },
      h("h3", {}, r.title),
      h("p", {}, h("b", {}, `${r.primary[0]} : `), r.primary[1]),
      h("p", {}, h("b", {}, `${r.secondary[0]} : `), r.secondary[1]),
      h("p", { class: "small muted" }, `Fragments : ${r.shards}`),
      boldText(r.note)));
  }

  if (d.build) {
    const b = d.build;
    body.push(h("h3", {}, "Build (ordre d'achat)"));
    const [pet, ...petAlts] = b.starter;
    body.push(h("div", { class: "items" },
      h("div", { class: "item", title: `${pet.name} · ${pet.cost} po` }, icon(pet.icon, pet.name), h("span", { class: "small" }, `Départ. ${pet.name}`)),
      ...b.items.map((it, i) =>
      h("div", { class: "item", title: `${it.name} · ${it.cost} po` }, it.icon ? icon(it.icon, it.name) : null, h("span", { class: "small" }, `${i + 1}. ${it.name}`)))));
    body.push(h("p", { class: "small" }, h("b", {}, `Familier : ${pet.name}`), ` (${pet.cost} po) : ${pet.why}`));
    body.push(h("p", { class: "small muted" }, `Adulte : ${pet.effect}`));
    for (const a of petAlts) body.push(h("p", { class: "small muted" }, `Sinon ${a.name} : ${a.why}`));
    const [boot, ...alts] = b.boots;
    body.push(h("p", { class: "small" }, h("b", {}, `Bottes : ${boot.name}`), ` (${boot.t3}) : ${boot.why}`));
    for (const a of alts) body.push(h("p", { class: "small muted" }, `Sinon ${a.name} : ${a.why}`));
    for (const n of b.notes) { const p = boldText(n); p.classList.add("small"); body.push(p); }
  } else if (d.form) {
    body.push(h("p", { class: "muted small" }, "Build complet dès 3 adversaires connus."));
  }
  const open = h("button", { type: "button" }, "Ouvrir dans le simulateur");
  open.addEventListener("click", () => void window.kayn.openDraftInSimulator());
  body.push(h("div", { class: "row" }, open));
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
  if (v) {
    if (!v.next) body.push(h("p", { class: "ok-text" }, "Build terminé."));
    else {
      const n = v.next;
      body.push(h("div", { class: "next" }, icon(n.item.icon, n.item.name), h("div", {},
        h("b", {}, `${n.rank ? "Prochain" : "Départ"} : ${n.item.name}`),
        h("div", { class: "small" }, n.missingGold ? h("span", { class: "gold" }, `${n.missingGold} po manquants (or : ${v.gold})`) : h("span", { class: "ok-text" }, "achetable maintenant"),
          n.component ? ` · en attendant : ${n.component.name}` : ""))));
    }
    if (v.reasons.length) body.push(h("p", { class: "muted small" }, `Build ajusté : ${v.reasons.join(" ; ")}.`));
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
    if (x.meta.length) summary.push(h("p", { class: "small" }, `Méta Émeraude+ : ${x.meta.map((m) => `${m.games.toLocaleString("fr-FR")} partie(s) en ${m.patch}`).join(", ")}`));
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
  const home = $("home-col-text");
  home.className = `status ${cls}`;
  home.textContent = `Collecte : ${text.split(" (")[0].toLowerCase()}${homeText}`;
  $("accounts").textContent = s.riotIds.length > 1 ? `Comptes suivis : ${s.riotIds.join(", ")}` : s.riotIds.length ? `Compte suivi : ${s.riotIds[0]} (ajoute RIOT_ID_2 pour un 2ᵉ compte)` : "";
}

$("col-stats").addEventListener("click", () => void window.kayn.openStatsWindow());
$("col-meta").addEventListener("click", () => void window.kayn.openMetaWindow());
$("col-reco").addEventListener("click", () => void window.kayn.openRecoWindow());
$("col-pause").addEventListener("click", async () => {
  const s = await window.kayn.getState();
  render(await window.kayn.setCollectorPaused(!s.collectorPaused));
});

function render(s: AppState): void {
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
  const alerts = [...s.problems, ...(s.envFile ? [] : ["Pas de fichier .env : voir Réglages."])];
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

type Tab = "home" | "draft" | "collect" | "settings";
const TABS: Tab[] = ["home", "draft", "collect", "settings"];

function selectTab(tab: Tab): void {
  for (const t of TABS) {
    $(`tab-${t}`).hidden = t !== tab;
    document.querySelector(`[data-tab="${t}"]`)!.setAttribute("aria-selected", String(t === tab));
  }
  try { localStorage.setItem("tab", tab); } catch { /* stockage indisponible */ }
}
for (const t of TABS) document.querySelector(`[data-tab="${t}"]`)!.addEventListener("click", () => selectTab(t));
$("home-col").addEventListener("click", () => selectTab("collect"));
try { const t = localStorage.getItem("tab") as Tab | null; if (t && TABS.includes(t) && t !== "draft") selectTab(t); } catch { /* idem */ }

/** Onglet Draft ouvert tout seul au début de la sélection, Accueil à la fin (seulement aux changements). */
let wasLive: boolean | null = null;
function autoTab(live: boolean): void {
  if (wasLive !== null && live !== wasLive) selectTab(live ? "draft" : "home");
  else if (wasLive === null && live) selectTab("draft");
  wasLive = live;
}

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

// ---------- Top 3 ----------

const nf1 = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Les 3 meilleurs champions de ton pool en jungle et au milieu (score de la vue « Champions recommandés »). */
async function renderTop3(): Promise<void> {
  const r = await window.kayn.getRecommendations();
  const rows = r.roles.map((role) => {
    const top = role.pool.slice(0, 3);
    return h("div", { class: "top3-row" },
      h("span", { class: "top3-role" }, role.role === "JUNGLE" ? "Jungle" : "Milieu"),
      ...(top.length ? top.map((p, i) => {
        const ch = champByKey(p.championId);
        const img = h("img", { src: ch?.image ? `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${ch.image}` : "", alt: "", class: "ic" });
        return h("span", { class: "top3-pick", title: [`Score ${nf1(p.score)} · ${p.games} parties · ${Math.round(p.winRate)} %`, ...p.reasons].join("\n") },
          `${i + 1}.`, img, ch?.name ?? `#${p.championId}`, p.provisional ? h("span", { class: "muted small" }, " (provisoire)") : null);
      }) : [h("span", { class: "muted small" }, "pas assez de parties dans ce rôle")]));
  });
  $("top3").replaceChildren(...rows, h("p", { class: "muted small" }, "Survole un champion pour le détail ; « Champions recommandés » pour le calcul complet."));
}
void renderTop3();
window.setInterval(() => void renderTop3(), 120_000);
