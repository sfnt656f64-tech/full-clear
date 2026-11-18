import { CHAMPIONS, PROFILE_LABEL, champ, matchesQuery } from "../data/champions";
import { EXAMPLE_DRAFTS } from "../data/guides";
import { BOOTS_T3, ITEMS, isBoots } from "../data/items";
import type { Champion, Form, Profile, Stage } from "../data/types";
import { draftReport, MIN_ENEMIES, type DraftReport } from "../engine/draft";
import { $, esc, fmt, pct } from "./html";
import { champTile, itemIcon } from "./icons";
import { runeOptions } from "./settings";

type Team = "en" | "al";

const state = {
  en: [null, null, null, null, null] as (Champion | null)[],
  al: [null, null, null, null] as (Champion | null)[],
  slot: null as [Team, number] | null,
  filter: "all" as Profile | "all",
  query: "",
};

export function mountDraft(): void {
  const root = $("draft");
  root.innerHTML = `
    <div class="sub" style="margin-bottom:6px">Clique ou touche une case pour choisir un champion.</div>
    <div class="team"><span class="tl" style="color:var(--red)">En face</span><div class="slots" id="slots-en"></div></div>
    <div class="team"><span class="tl" style="color:var(--blue)">Ton équipe</span><div class="slots" id="slots-al"></div></div>
    <div class="ctrl" style="margin-top:12px">
      <div><label for="d-stage">Moment de la partie</label><select id="d-stage"><option value="mid">Mi-partie — niv. 13</option><option value="late">Fin de partie — niv. 18</option></select></div>
      <div><label for="d-form">Forme</label><select id="d-form"><option value="auto">Recommandée</option><option value="blue">Forcer bleu</option><option value="red">Forcer rouge</option></select></div>
      <div><label for="d-ex">Exemples</label><select id="d-ex"><option value="">—</option>${Object.keys(EXAMPLE_DRAFTS).map((k) => `<option>${esc(k)}</option>`).join("")}</select></div>
    </div>
    <div id="d-out" class="note"></div>`;

  root.addEventListener("click", (e) => {
    const sl = (e.target as HTMLElement).closest<HTMLElement>("[data-slot]");
    if (sl) openPicker(sl.dataset.team as Team, +sl.dataset.slot!);
  });
  $("d-stage").onchange = run;
  $("d-form").onchange = run;
  $<HTMLSelectElement>("d-ex").onchange = (e) => {
    const v = EXAMPLE_DRAFTS[(e.target as HTMLSelectElement).value];
    if (!v) return;
    state.en = v[0].map(champ);
    state.al = v[1].map(champ);
    drawSlots();
    run();
  };

  mountPicker();
  drawSlots();
  run();
}

function drawSlots(): void {
  for (const t of ["en", "al"] as Team[]) {
    let h = state[t].map((c, i) =>
      `<button type="button" class="sl" data-team="${t}" data-slot="${i}" aria-label="${c ? esc(c.name) : "Case vide"}">${champTile(c, 48)}<span>${c ? esc(c.name) : ""}</span></button>`,
    ).join("");
    if (t === "al") h += `<div class="sl me">${champTile(champ("Kayn"), 48)}<span style="color:var(--blue)">Toi</span></div>`;
    $(`slots-${t}`).innerHTML = h;
  }
}

// ---------- Fenêtre de choix ----------

function mountPicker(): void {
  const m = $("picker");
  m.innerHTML = `<div class="mbox">
    <div class="msearch"><input id="pk-q" type="search" placeholder="Rechercher un champion…" autocomplete="off" />
      <button type="button" id="pk-clr" class="btn">Vider</button><button type="button" id="pk-cls" class="btn" aria-label="Fermer">✕</button></div>
    <div class="fil" id="pk-fil"></div>
    <div class="pgrid" id="pk-grid"></div></div>`;
  const q = $<HTMLInputElement>("pk-q");
  q.oninput = () => { state.query = q.value; drawPicker(); };
  $("pk-cls").onclick = closePicker;
  $("pk-clr").onclick = () => setSlot(null);
  m.onclick = (e) => { if (e.target === m) closePicker(); };
  $("pk-fil").onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-f]");
    if (b) { state.filter = b.dataset.f as Profile | "all"; drawPicker(); }
  };
  $("pk-grid").onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-name]");
    if (b) setSlot(champ(b.dataset.name!));
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.slot) closePicker(); });
}

function openPicker(t: Team, i: number): void {
  state.slot = [t, i];
  state.query = "";
  $<HTMLInputElement>("pk-q").value = "";
  $("picker").classList.remove("hide");
  drawPicker();
}

function closePicker(): void {
  state.slot = null;
  $("picker").classList.add("hide");
  drawSlots();
}

function setSlot(c: Champion | null): void {
  if (!state.slot) return;
  const [t, i] = state.slot;
  state[t][i] = c;
  closePicker();
  run();
}

function drawPicker(): void {
  const used = new Set([...state.en, ...state.al].filter(Boolean).map((c) => c!.id));
  const filters: [Profile | "all", string][] = [["all", "Tous"], ...(Object.entries(PROFILE_LABEL) as [Profile, string][])];
  $("pk-fil").innerHTML = filters.map(([k, l]) => `<button type="button" data-f="${k}" class="${state.filter === k ? "on" : ""}">${l}</button>`).join("");
  $("pk-grid").innerHTML = CHAMPIONS
    .filter((c) => c.id !== "Kayn" && !used.has(c.id) && (state.filter === "all" || c.profile === state.filter) && matchesQuery(c, state.query))
    .map((c) => `<button type="button" class="pc" data-name="${esc(c.id!)}">${champTile(c, 52)}<span>${esc(c.name)}</span></button>`)
    .join("");
}

// ---------- Analyse ----------

export function run(): void {
  const out = $("d-out");
  const stage = $<HTMLSelectElement>("d-stage").value as Stage;
  const fsel = $<HTMLSelectElement>("d-form").value as Form | "auto";
  const rep = draftReport(state.en, state.al, stage, fsel, { runes: runeOptions() });
  if (!rep) {
    out.className = "note";
    out.innerHTML = `Ajoute au moins ${MIN_ENEMIES} adversaires pour lancer l'analyse.`;
    return;
  }
  out.className = "";
  out.innerHTML = renderReport(rep);
}

export function renderReport(rep: DraftReport): string {
  const x = rep.analysis, f = rep.form;
  const pos = Math.max(2, Math.min(98, 50 + x.sc * 9));
  let h = `<div class="verdict ${f}"><div class="ico">${f === "blue" ? "🔵" : "🔴"}</div><div style="flex:1;min-width:0">
    <div style="font-weight:800;font-size:16px">${f === "blue" ? "Shadow Assassin" : "Rhaast"}${x.form === "either" && rep.formChoice === "auto" ? ' <span class="tag ap">les deux sont jouables</span>' : ""}${rep.formChoice !== "auto" ? ' <span class="tag ap">forcé</span>' : ""}</div>
    <div class="gauge"><i style="left:${pos}%"></i></div><div class="sub gauge-l"><span>Rouge</span><span>Bleu</span></div>
    <div class="sub" style="margin-top:4px">${x.why.map(esc).join(" · ")}</div></div></div>`;

  h += `<div class="thr"><div>Dégâts phys./mag.<b>${Math.round(x.adShare * 100)} / ${Math.round(x.apShare * 100)} %</b></div>`
    + `<div>Gros CC<b>${x.hard}</b></div><div>Boucliers<b>${fmt(Math.round(x.shields * 10) / 10)}</b></div><div>Soins<b>${x.heals}</b></div>`
    + `<div>Ralentissements<b>${x.slows}</b></div><div>Tanks / combattants<b>${x.tanks} / ${x.fight}</b></div></div>`;

  h += `<h3>👟 Bottes</h3>` + rep.boots.map(([k, why], i) =>
    `<div class="bootrow${i ? " alt" : ""}">${itemIcon(k)}<div><b>${esc(ITEMS[k].n)}</b>${i ? "" : ' <span class="tag wr">conseillé</span>'}<br><span class="sub">${esc(why)} · niveau 3 : ${BOOTS_T3[k]}</span></div></div>`,
  ).join("");

  h += `<h3 style="margin-top:14px">🛠️ Ordre de build</h3><div class="path">${rep.build.map((k, i) => (i ? '<span class="arr">›</span>' : "") + itemIcon(k)).join("")}</div>`
    + `<div class="sub">${rep.build.map((k) => esc(ITEMS[k].n)).join(" → ")}</div>`;
  if (rep.notes.length) h += `<div class="note" style="margin-top:8px">${rep.notes.map((n) => "• " + n).join("<br>")}</div>`;

  const nItems = rep.simBuild.filter((k) => !isBoots(k)).length;
  h += `<h3 style="margin-top:16px">⚔️ Contre chaque adversaire (niv. ${rep.level}, ${nItems} items)</h3>`;
  if (f === "blue") {
    h += `<div class="sub">% des PV retirés par le combo W › Q › AA › R › AA (bouclier des enchanteurs adverses inclus). Le trait blanc marque 100 % (kill).</div>`;
    for (const v of rep.vs) {
      if (v.form !== "blue") continue;
      const w = Math.min(100, v.pct / 1.5);
      h += `<div class="erow">${champTile(v.champion, 38)}<div class="lbl">${esc(v.champion.name)}<br><span class="sub">${PROFILE_LABEL[v.champion.profile]}${v.target.shield ? ` · 🛡${v.target.shield}` : ""}</span></div>`
        + `<div class="bar"><i style="width:${w}%;background:${v.kill ? "var(--green)" : "var(--gold)"}"></i><span class="k" style="left:${100 / 1.5}%"></span></div>`
        + `<div class="val">${pct(v.pct)}${v.kill ? " ☠️" : ""}</div></div>`;
    }
  } else {
    h += `<div class="sub">Temps estimé pour tuer la cible en 1v1 (DPS d'un combat de 6 s, Cleaver à 5 stacks). Le trait blanc marque 6 s.</div>`;
    for (const v of rep.vs) {
      if (v.form !== "red") continue;
      const w = Math.min(100, (v.ttk / 12) * 100);
      const col = v.ttk <= 6 ? "var(--green)" : v.ttk <= 9 ? "var(--gold)" : "var(--red)";
      h += `<div class="erow">${champTile(v.champion, 38)}<div class="lbl">${esc(v.champion.name)}<br><span class="sub">${PROFILE_LABEL[v.champion.profile]}</span></div>`
        + `<div class="bar"><i style="width:${w}%;background:${col}"></i><span class="k" style="left:50%"></span></div>`
        + `<div class="val">${v.ttk.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s</div></div>`;
    }
    if (rep.resist) h += `<div class="sub" style="margin-top:6px">Ta résistance : ${fmt(rep.resist.ehpPhys)} PV effectifs contre le physique, ${fmt(rep.resist.ehpMag)} contre le magique.</div>`;
  }
  return h;
}
