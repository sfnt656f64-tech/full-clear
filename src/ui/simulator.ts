import { GUIDES } from "../data/guides";
import { STAGE_LEVEL, TARGETS } from "../data/targets";
import type { Form, Stage, TargetKey } from "../data/types";
import { buildAtStage } from "../engine/draft";
import { blueCombo } from "../model/blue";
import { redFight } from "../model/red";
import { stats } from "../model/stats";
import { $, esc, fmt, pct } from "./html";
import { itemIcon } from "./icons";

let form: Form = "blue";

export function mountSimulator(): void {
  $("simulator").innerHTML = `<div class="ctrl">
      <div><label for="s-build">Build</label><select id="s-build"></select></div>
      <div><label for="s-stage">Moment de la partie</label><select id="s-stage"><option value="mid">Mi-partie — niv. 13, 3 items + bottes</option><option value="late">Fin de partie — niv. 18, build complet</option></select></div>
      <div><label for="s-tgt">Cible</label><select id="s-tgt"></select></div>
      <div id="hub-wrap"><label for="s-hub">Stacks Hubris (bleu)</label><select id="s-hub"><option value="-1">Inactif</option><option value="2">2 stacks</option><option value="4" selected>4 stacks</option><option value="8">8 stacks</option></select></div>
    </div><div id="s-out"></div>`;
  for (const id of ["s-build", "s-stage", "s-tgt", "s-hub"]) $(id).onchange = sim;
}

export function setSimulatorForm(f: Form): void {
  form = f;
  $("s-build").innerHTML = GUIDES[f].map((g, i) => `<option value="${i}">${esc(g.t)}</option>`).join("");
  const def: TargetKey = f === "blue" ? "adc" : "tank";
  $("s-tgt").innerHTML = (Object.entries(TARGETS.mid) as [TargetKey, { n: string }][])
    .map(([k, t]) => `<option value="${k}" ${k === def ? "selected" : ""}>${esc(t.n.replace(/ \d+$/, ""))}</option>`).join("");
  $("hub-wrap").style.display = f === "blue" ? "" : "none";
  sim();
}

const val = (id: string) => $<HTMLSelectElement>(id).value;

function sim(): void {
  const guide = GUIDES[form][+val("s-build")];
  const stage = val("s-stage") as Stage, tk = val("s-tgt") as TargetKey;
  const L = STAGE_LEVEL[stage], b = buildAtStage(guide.b, stage), tgt = TARGETS[stage][tk], hub = +val("s-hub");
  let h = `<div class="path">${b.map(itemIcon).join("")}</div>`
    + `<div class="sub" style="margin:-6px 0 12px">Niv. ${L} · ${fmt(stats(b, L).cost)} po · cible : ${esc(tgt.n)} (${fmt(tgt.hp)} PV, ${tgt.armor} armure${tgt.shield ? `, bouclier ${tgt.shield}` : ""})</div>`;
  if (form === "blue") {
    const r = blueCombo(b, L, tgt, { hubrisStacks: hub });
    const mx = Math.max(...r.log.map((x) => x[1]));
    h += `<div class="kpis">
        <div class="kpi"><div class="sub">Dégâts du combo</div><div class="big">${fmt(r.total)}</div></div>
        <div class="kpi"><div class="sub">% PV de la cible</div><div class="big" style="color:${r.kill ? "var(--green)" : "var(--gold)"}">${pct(r.pct)}</div></div>
        <div class="kpi"><div class="sub">Résultat</div><div class="big">${r.kill ? "☠️ Kill" : "Survit"}</div></div>
        <div class="kpi"><div class="sub">AD total / létha</div><div class="big">${Math.round(r.s.totalAD)} / ${r.s.leth}</div></div></div>
      <h3 style="margin-top:14px">Combo W › Q › AA › R › AA (passif Assassin inclus)</h3>`
      + r.log.map(([n, d]) => `<div class="row"><span>${esc(n)}</span><div class="bar"><i style="width:${(100 * d) / mx}%;background:var(--blue)"></i></div><span>${fmt(d)}</span></div>`).join("");
  } else {
    const r = redFight(b, L, tgt);
    const mx = Math.max(...Object.values(r.parts));
    h += `<div class="kpis">
        <div class="kpi"><div class="sub">DPS (combat de 6 s)</div><div class="big">${fmt(r.dps)}</div></div>
        <div class="kpi"><div class="sub">% PV max retirés</div><div class="big">${pct(r.pct)}</div></div>
        <div class="kpi"><div class="sub">Soins sur 6 s</div><div class="big" style="color:var(--green)">${fmt(r.heal)}</div></div>
        <div class="kpi"><div class="sub">PV eff. phys / mag</div><div class="big">${fmt(r.ehpPhys)}<span class="sub"> / ${fmt(r.ehpMag)}</span></div></div></div>
      <h3 style="margin-top:14px">Répartition (${r.nQ} Q, ${r.nW} W, 1 R, ${r.nAA} AA)</h3>`
      + Object.entries(r.parts).map(([n, d]) => `<div class="row"><span>${n}</span><div class="bar"><i style="width:${(100 * d) / mx}%;background:var(--red)"></i></div><span>${fmt(d)}</span></div>`).join("");
  }
  $("s-out").innerHTML = h;
}
