import { GUIDES, RUNES } from "../data/guides";
import { ITEMS } from "../data/items";
import type { Form } from "../data/types";
import { $, esc } from "./html";
import { itemIcon } from "./icons";

export function renderGuides(form: Form): void {
  const r = RUNES[form];
  $("guides").innerHTML = `
    <div class="card"><h3>${r.title}</h3>
      <div class="runes"><div><b>${r.primary[0]}</b><br>${r.primary[1]}</div>
      <div><b>${r.secondary[0]}</b><br>${r.secondary[1]}<br><span class="sub">Fragments : ${r.shards}</span></div></div>
      <div class="note" style="margin-top:8px">${r.note}</div></div>
    <h2>Builds selon la compo en face</h2>
    <div class="grid">${GUIDES[form].map((g) => `
      <div class="card"><h3>${esc(g.t)}${g.wr ? `<span class="tag wr">${esc(g.wr)}</span>` : ""}</h3>
        <div class="path">${g.b.map((k, i) => (i ? '<span class="arr">›</span>' : "") + itemIcon(k)).join("")}</div>
        <div class="sub">${g.b.map((k) => esc(ITEMS[k].n)).join(" → ")}</div>
        <div class="when">${g.w}</div></div>`).join("")}
    </div>`;
}
