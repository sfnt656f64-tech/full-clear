// Contenu de l'overlay : le plan écrit en draft (à retenir, build, si… alors…, rappels), en consignes courtes et sans
// chiffres, lisible d'un coup d'œil. Rien ne dépend de l'état de la partie (or, items, kills, objectifs) : règles Riot.
import type { OverlayApi } from "../ipc.ts";
import { ruleText, type OverlayView } from "../next-item.ts";
import type { PlainItem } from "../coach/plain.ts";

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
function item(it: PlainItem): HTMLElement {
  const img = h("img", { src: it.icon, alt: "", class: "ic", draggable: "false" }) as HTMLImageElement;
  img.addEventListener("error", () => img.classList.add("broken"), { once: true });
  return h("span", { class: "it" }, img, h("span", { class: "it-name" }, it.name));
}
const block = (title: string, lines: string[]) => (lines.length ? [h("div", { class: "head" }, title), ...lines.map((t) => h("p", { class: "line" }, t))] : []);

function render(v: OverlayView | null): void {
  const content = document.getElementById("content")!;
  if (!v) { content.replaceChildren(h("p", { class: "muted" }, "En attente de la partie…")); return; }
  const p = v.plan;
  // Plan écrit en draft ; sans draft (partie lancée sans l'appli), le build d'après les champions de la partie.
  const build: PlainItem[] = p ? [...(p.starter ? [p.starter] : []), ...p.build] : [...(v.starter ? [v.starter] : []), ...v.build];
  const out: Child[] = [
    ...block("À RETENIR", p?.retain ?? []),
    ...block("THÈME DE LA SEMAINE", p?.theme ? [p.theme] : []),
    ...(build.length ? [h("div", { class: "head" }, "BUILD", p?.form ? h("span", { class: "form" }, ` · ${p.form}`) : null), h("div", { class: "build" }, ...build.flatMap((it, i) => [...(i ? [h("span", { class: "arrow" }, "→")] : []), item(it)]))] : []),
    ...block("SI… ALORS…", p ? p.ifThen : v.rules.map((r) => ruleText(r))),
    ...block("MES RAPPELS", (p?.reminders ?? []).map((r) => r.text)),
  ];
  content.replaceChildren(...(out.length ? out : [h("p", { class: "muted" }, `Pas assez de parties Émeraude+ pour proposer un build${v.champion ? ` sur ${v.champion}` : ""}.`)]).filter((c): c is Node | string => !!c));
}

window.overlay.onView(render);
window.overlay.onMoving((m) => {
  document.body.classList.toggle("moving", m);
  document.getElementById("move-hint")!.hidden = !m;
});
const card = document.getElementById("card")!;
new ResizeObserver(() => window.overlay.setHeight(Math.ceil(card.getBoundingClientRect().height) + 8)).observe(card);
