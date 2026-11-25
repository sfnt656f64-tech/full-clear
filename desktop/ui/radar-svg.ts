// Dessin du radar (hexagone) en SVG, partagé par la fenêtre principale et « Champions recommandés ».
// Pas de style en ligne (politique de sécurité des pages) : tout passe par des classes CSS.
import { AXES } from "../analysis/radar.ts";

export interface RadarSeries {
  values: (number | null)[];
  /** Classe CSS de la forme (couleur). */
  cls: string;
  /** Nom affiché au survol. */
  name: string;
}

const NS = "http://www.w3.org/2000/svg";

function el(tag: string, attrs: Record<string, string>, parent: Element, title?: string): Element {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (title) { const t = document.createElementNS(NS, "title"); t.textContent = title; e.append(t); }
  parent.append(e);
  return e;
}

/**
 * Radar : la médiane du niveau de référence (50 sur chaque axe) en pointillés, puis chaque série (0–100).
 * `labels` : noms des axes autour (grand radar) ; sinon mini-radar sans texte.
 */
export function radarSvg(series: RadarSeries[], opts: { size: number; labels: boolean; refName: string }): SVGSVGElement {
  const pad = opts.labels ? 62 : 3;
  const W = opts.size + 2 * pad;
  const c = W / 2, R = opts.size / 2;
  const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", `0 0 ${W} ${W}`);
  svg.setAttribute("class", opts.labels ? "radar" : "radar mini");
  const n = AXES.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [c + Math.cos(a) * R * (v / 100), c + Math.sin(a) * R * (v / 100)] as const;
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(",")).join(" ");
  // Grille : 25 / 75 / 100, axes.
  for (const lvl of [25, 75, 100]) el("polygon", { points: poly(AXES.map(() => lvl)), class: "radar-grid" }, svg);
  for (let i = 0; i < n; i++) { const [x, y] = pt(i, 100); el("line", { x1: String(c), y1: String(c), x2: String(x), y2: String(y), class: "radar-grid" }, svg); }
  el("polygon", { points: poly(AXES.map(() => 50)), class: "radar-median" }, svg, `Médiane ${opts.refName} (50 sur chaque axe)`);
  for (const s of series) {
    const vals = s.values.map((v) => v ?? 0);
    el("polygon", { points: poly(vals), class: `radar-shape ${s.cls}` }, svg, s.name);
    if (opts.labels) {
      s.values.forEach((v, i) => {
        if (v == null) return;
        const [x, y] = pt(i, v);
        el("circle", { cx: String(x), cy: String(y), r: "3", class: `radar-dot ${s.cls}` }, svg, `${s.name} · ${AXES[i].label} : mieux que ${Math.round(v)} % des joueurs (${AXES[i].hint})`);
      });
    }
  }
  if (opts.labels) {
    AXES.forEach((a, i) => {
      const [x, y] = pt(i, 118);
      const t = el("text", { x: String(x), y: String(y + 4), class: "radar-label", "text-anchor": x < c - 5 ? "end" : x > c + 5 ? "start" : "middle" }, svg, a.hint);
      t.append(document.createTextNode(a.label));
    });
    // Référence écrite sur le radar lui-même.
    el("text", { x: "4", y: String(W - 6), class: "radar-ref" }, svg, "Niveau de référence des positions").append(document.createTextNode(`Réf. : ${opts.refName}`));
  }
  return svg;
}

