// Fenêtre d'état. Pas d'accès à Node : tout passe par window.kayn (preload.ts).
import type { AppState, DraftView, KaynApi } from "../ipc.ts";
import { acceleratorFromKey } from "../shortcuts.ts";

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

let timerHandle: number | undefined;

function renderDraft(s: AppState): void {
  const sec = $("draft");
  const d = s.draft;
  window.clearInterval(timerHandle);
  sec.hidden = !d;
  if (!d) return;
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
  if (d.notKayn) body.push(h("p", { class: "warn-text small" }, "Tu n'es pas sur Kayn : la recommandation suppose quand même que tu le joues."));
  body.push(h("div", { class: "team" }, h("span", { class: "tl red" }, "En face"), slots(d.enemies, "en")));
  body.push(h("div", { class: "team" }, h("span", { class: "tl blue" }, "Alliés"), slots(d.allies, "al")));
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

  if (d.runes) {
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
      h("div", { class: "item", title: `${pet.nameFr} (${pet.name}) · ${pet.cost} po` }, icon(pet.icon, pet.nameFr), h("span", { class: "small" }, `Départ. ${pet.nameFr}`)),
      ...b.items.map((it, i) =>
      h("div", { class: "item", title: `${it.name} · ${it.cost} po` }, it.icon ? icon(it.icon, it.name) : null, h("span", { class: "small" }, `${i + 1}. ${it.name}`)))));
    body.push(h("p", { class: "small" }, h("b", {}, `Familier : ${pet.nameFr}`), ` (${pet.name}, ${pet.cost} po) : ${pet.why}`));
    body.push(h("p", { class: "small muted" }, `Adulte : ${pet.effect}`));
    for (const a of petAlts) body.push(h("p", { class: "small muted" }, `Sinon ${a.nameFr} : ${a.why}`));
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

$<HTMLInputElement>("overlay-on").addEventListener("change", async (e) => render(await window.kayn.setOverlayEnabled((e.target as HTMLInputElement).checked)));
$<HTMLSelectElement>("form-choice").addEventListener("change", async (e) => render(await window.kayn.setFormChoice((e.target as HTMLSelectElement).value as "auto" | "blue" | "red")));
$("overlay-reset").addEventListener("click", async () => render(await window.kayn.resetOverlayPosition()));

// ---------- Collecte ----------

const PAUSE_LABELS: Record<string, string> = { game: "partie en cours", user: "pause manuelle", key: "clé refusée", config: "configuration" };

function renderCollector(s: AppState): void {
  const st = $("col-status");
  const body: Child[] = [];
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
    for (const acc of s.riotIds) body.push(h("p", { class: "small" }, `${acc} : ${x.myGames[acc] ?? 0} partie(s) Solo/Duo enregistrée(s)`));
    for (const [acc, n] of games) if (!s.riotIds.includes(acc)) body.push(h("p", { class: "small muted" }, `${acc} (ancien compte) : ${n} partie(s)`));
    for (const j of x.jobs) {
      if (!j.pending && !j.done && !j.failed) continue;
      body.push(h("p", { class: "small muted" }, `${j.label} : ${j.done} fait(s)${j.pending ? `, ${j.pending} en attente` : ""}${j.failed ? `, ${j.failed} en échec` : ""}`));
    }
    body.push(h("p", { class: "small muted" }, `Requêtes sur 2 min : europe ${x.usage.europe}/${x.budget} · euw1 ${x.usage.euw1}/${x.budget}`));
    if (x.lastError && x.state !== "running") body.push(h("p", { class: "small warn-text" }, `Dernière erreur : ${x.lastError}`));
  }
  st.className = `status ${cls}`;
  st.textContent = text;
  $("col-body").replaceChildren(...body.filter((b): b is Node | string => !!b));
  $("accounts").textContent = s.riotIds.length > 1 ? `Comptes suivis : ${s.riotIds.join(", ")}` : s.riotIds.length ? `Compte suivi : ${s.riotIds[0]} (ajoute RIOT_ID_2 pour un 2ᵉ compte)` : "";
}

$("col-stats").addEventListener("click", () => void window.kayn.openStatsWindow());
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
  $<HTMLInputElement>("login").checked = s.openAtLogin;
  $("dev-note").hidden = !(s.dev && s.openAtLogin);
}

$("reload").addEventListener("click", async () => render(await window.kayn.reloadConfig()));
$("open-dir").addEventListener("click", () => void window.kayn.openUserDataDir());
$<HTMLInputElement>("login").addEventListener("change", async (e) => render(await window.kayn.setOpenAtLogin((e.target as HTMLInputElement).checked)));
window.kayn.onState(render);
void window.kayn.getState().then(render);
