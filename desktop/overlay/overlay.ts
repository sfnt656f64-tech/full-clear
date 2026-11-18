// Contenu de l'overlay : prochain item, or manquant, composant achetable, deux items suivants.
import type { OverlayApi } from "../ipc.ts";
import type { ItemLite, OverlayView } from "../next-item.ts";

declare global {
  interface Window { overlay: OverlayApi }
}

type Child = Node | string | null | false | undefined;
function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}
function icon(it: ItemLite, cls = "ic"): HTMLElement {
  const img = h("img", { src: it.icon, alt: "", class: cls, draggable: "false" }) as HTMLImageElement;
  img.addEventListener("error", () => img.classList.add("broken"), { once: true });
  return img;
}
const po = (n: number) => `${n.toLocaleString("fr-FR")} po`;

function render(v: OverlayView | null): void {
  const content = document.getElementById("content")!;
  if (!v) {
    content.replaceChildren(h("p", { class: "muted" }, "En attente des données de la partie…"));
    return;
  }
  const formTag = h("span", { class: `tag ${v.form}` }, `${v.form === "blue" ? "bleu" : "rouge"}${v.formForced ? "" : " (auto)"}`);
  const out: Child[] = [];
  if (!v.next) {
    out.push(h("div", { class: "row" }, h("span", { class: "ok" }, "Build terminé"), formTag));
  } else {
    const n = v.next;
    out.push(h("div", { class: "row" },
      icon(n.item),
      h("div", {},
        h("div", {}, h("span", { class: "title" }, `${n.rank ? `${n.rank}.` : "Départ :"} ${n.item.name}`), formTag),
        n.missingGold === 0
          ? h("div", { class: "ok" }, `Achetable maintenant (${po(n.item.cost)})`)
          : h("div", { class: "small" }, h("span", { class: "gold" }, `${po(n.missingGold)} manquants`), ` · reste ${po(n.item.cost)}`))));
    if (n.why) out.push(h("p", { class: "small muted", style: "margin-top:4px" }, n.why));
    if (n.component) {
      out.push(h("div", { class: "row small", style: "margin-top:4px" },
        icon(n.component, "ic sm"), `En attendant : ${n.component.name} (${po(n.component.cost)})`));
    }
  }
  if (v.then.length) {
    out.push(h("div", { class: "sep" }));
    out.push(h("div", { class: "then small muted" }, "Ensuite :", ...v.then.map((t) => icon(t, "ic sm")), v.then.map((t) => t.name).join(", ")));
  }
  if (v.reasons.length) out.push(h("p", { class: "small muted", style: "margin-top:4px" }, `Ajusté : ${v.reasons.join(" ; ")}`));
  if (v.notKayn) out.push(h("p", { class: "small warn" }, "Tu ne joues pas Kayn."));
  content.replaceChildren(...out.filter((c): c is Node | string => !!c));
}

window.overlay.onView(render);
window.overlay.onMoving((m) => {
  document.body.classList.toggle("moving", m);
  document.getElementById("move-hint")!.hidden = !m;
});
const card = document.getElementById("card")!;
new ResizeObserver(() => window.overlay.setHeight(Math.ceil(card.getBoundingClientRect().height) + 8)).observe(card);
