// Fenêtre d'état. Pas d'accès à Node : tout passe par window.kayn (preload.ts).
import type { AppState, DraftView, KaynApi } from "../ipc.ts";

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
    body.push(h("div", { class: "items" }, ...b.items.map((it, i) =>
      h("div", { class: "item", title: `${it.name} · ${it.cost} po` }, it.icon ? icon(it.icon, it.name) : null, h("span", { class: "small" }, `${i + 1}. ${it.name}`)))));
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

function render(s: AppState): void {
  renderClient(s);
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
