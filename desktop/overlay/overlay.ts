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

/** Conseils d'avant-partie : bloc à part, recréé seulement quand ils changent (l'animation d'effacement continue). */
let tipsShown = "";
function renderTips(tips: string[]): void {
  const key = tips.join("|");
  if (key === tipsShown) return;
  tipsShown = key;
  const box = document.getElementById("tips")!;
  box.hidden = !tips.length;
  box.replaceChildren(...tips.map((t) => h("p", { class: "tip" }, t)));
}

function render(v: OverlayView | null): void {
  renderTips(v?.tips ?? []);
  const content = document.getElementById("content")!;
  if (!v) {
    content.replaceChildren(h("p", { class: "muted" }, "En attente des données de la partie…"));
    return;
  }
  // Kayn : forme ; autres champions : build de la méta Émeraude+.
  const formTag = v.source === "kayn"
    ? h("span", { class: `tag ${v.form}` }, `${v.form === "blue" ? "bleu" : "rouge"}${v.formForced ? "" : " (auto)"}`)
    : h("span", { class: "tag meta", title: `Build le plus joué en Émeraude+ (${v.buildGames ?? 0} parties), adapté à la composition` }, "Émeraude+");
  const out: Child[] = [];
  if (v.source === "none") {
    content.replaceChildren(h("p", { class: "muted" }, `Pas encore assez de parties Émeraude+ pour proposer un build${v.champion ? ` sur ${v.champion}` : ""}.`));
    return;
  }
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
    if (n.why) out.push(h("p", { class: "small muted mt4" }, n.why));
    if (n.component) {
      out.push(h("div", { class: "row small mt4" },
        icon(n.component, "ic sm"), `En attendant : ${n.component.name} (${po(n.component.cost)})`));
    }
  }
  if (v.then.length) {
    out.push(h("div", { class: "sep" }));
    out.push(h("div", { class: "then small muted" }, "Ensuite :", ...v.then.map((t) => icon(t, "ic sm")), v.then.map((t) => t.name).join(", ")));
  }
  if (v.reasons.length) out.push(h("p", { class: "small muted mt4" }, `Ajusté : ${v.reasons.join(" ; ")}`));
  content.replaceChildren(...out.filter((c): c is Node | string => !!c));
}

window.overlay.onView(render);
window.overlay.onMoving((m) => {
  document.body.classList.toggle("moving", m);
  document.getElementById("move-hint")!.hidden = !m;
});
const card = document.getElementById("card")!;
new ResizeObserver(() => window.overlay.setHeight(Math.ceil(card.getBoundingClientRect().height) + 8)).observe(card);
