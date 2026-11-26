// Contenu de l'overlay : build de la partie décidé en draft, règles « si… alors… » et conseils d'avant-partie.
// Rien ne dépend de l'état de la partie (or, items, kills, objectifs) : règles Riot.
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

/** Build décidé en draft (champions de la partie seulement) : rien ne change selon ce qui se passe en jeu. */
function render(v: OverlayView | null): void {
  renderTips(v?.tips ?? []);
  const content = document.getElementById("content")!;
  if (!v) {
    content.replaceChildren(h("p", { class: "muted" }, "En attente des données de la partie…"));
    return;
  }
  if (v.source === "none") {
    content.replaceChildren(h("p", { class: "muted" }, `Pas encore assez de parties Émeraude+ pour proposer un build${v.champion ? ` sur ${v.champion}` : ""}.`));
    return;
  }
  // Kayn : forme ; autres champions : build de la méta Émeraude+.
  const formTag = v.source === "kayn"
    ? h("span", { class: `tag ${v.form}` }, `${v.form === "blue" ? "bleu" : "rouge"}${v.formForced ? "" : " (auto)"}`)
    : h("span", { class: "tag meta", title: `Build le plus joué en Émeraude+ (${v.buildGames ?? 0} parties), adapté à la composition de la draft` }, "Émeraude+");
  const out: Child[] = [h("div", { class: "row" }, h("span", { class: "title" }, "Build de la partie"), formTag)];
  out.push(h("div", { class: "then" }, ...(v.starter ? [icon(v.starter, "ic sm")] : []), ...v.build.map((t, i) => h("span", { class: "step", title: `${i + 1}. ${t.name}` }, icon(t, "ic sm")))));
  out.push(h("p", { class: "small muted" }, [v.starter ? `Départ : ${v.starter.name}` : "", ...v.build.map((t, i) => `${i + 1}. ${t.name}`)].filter(Boolean).join(" · ")));
  if (v.reasons.length) out.push(h("p", { class: "small muted mt4" }, `Selon la draft : ${v.reasons.join(" ; ")}`));
  if (v.ifThen.length) {
    out.push(h("div", { class: "sep" }));
    out.push(h("p", { class: "small mt4" }, "Si… alors… (à appliquer toi-même) :"));
    for (const t of v.ifThen) out.push(h("p", { class: "small muted" }, `• ${t}`));
  }
  content.replaceChildren(...out.filter((c): c is Node | string => !!c));
}

window.overlay.onView(render);
window.overlay.onMoving((m) => {
  document.body.classList.toggle("moving", m);
  document.getElementById("move-hint")!.hidden = !m;
});
const card = document.getElementById("card")!;
new ResizeObserver(() => window.overlay.setHeight(Math.ceil(card.getBoundingClientRect().height) + 8)).observe(card);
