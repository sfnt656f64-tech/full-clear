// Petite courbe (moyenne glissante) avec une ligne de cible en pointillés. Sans style en ligne (politique de la page).
const NS = "http://www.w3.org/2000/svg";

export interface SparkInput { points: (number | null)[]; target: number | null; fmt: (v: number) => string; targetLabel: string }

export function sparkline(x: SparkInput, w = 280, h = 64): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "tc");
  const vals = x.points.filter((v): v is number => v != null);
  if (!vals.length) return svg;
  const all = x.target != null ? [...vals, x.target] : vals;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) { hi += 1; lo -= 1; }
  const padL = 4, padR = 70, padY = 8;
  const X = (i: number) => padL + (i / Math.max(1, x.points.length - 1)) * (w - padL - padR);
  const Y = (v: number) => padY + (1 - (v - lo) / (hi - lo)) * (h - 2 * padY);
  const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text != null) e.textContent = text;
    svg.appendChild(e);
    return e;
  };
  if (x.target != null) {
    el("line", { x1: padL, x2: w - padR, y1: Y(x.target), y2: Y(x.target), class: "tc-target" });
    el("text", { x: w - padR + 4, y: Y(x.target) + 4, class: "tc-label" }, `${x.targetLabel} ${x.fmt(x.target)}`);
  }
  // Segments : une valeur manquante coupe la courbe.
  let seg: string[] = [];
  const flush = () => { if (seg.length > 1) el("polyline", { points: seg.join(" "), class: "tc-line" }); seg = []; };
  x.points.forEach((v, i) => { if (v == null) flush(); else seg.push(`${X(i).toFixed(1)},${Y(v).toFixed(1)}`); });
  flush();
  const lastI = x.points.length - 1, last = x.points[lastI];
  if (last != null) {
    el("circle", { cx: X(lastI), cy: Y(last), r: 2.5, class: "tc-dot" });
    el("text", { x: w - padR + 4, y: x.target != null && Math.abs(Y(last) - Y(x.target)) < 12 ? Y(last) + (Y(last) < Y(x.target) ? -6 : 16) : Y(last) + 4, class: "tc-label strong" }, `toi ${x.fmt(last)}`);
  }
  return svg;
}
