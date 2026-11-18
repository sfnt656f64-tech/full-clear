import { ITEMS } from "../data/items";
import { TARGETS } from "../data/targets";
import type { Form, ItemKey } from "../data/types";
import { BENCH_BLUE, BENCH_LEVEL, BENCH_RED, benchBlue, benchRed, bestPerColumn, goldEfficiency, STAT_GOLD, type BenchRow } from "../model/benchmark";
import { axiomRefundPct } from "../model/blue";
import { RULES } from "../model/constants";
import { $, esc, fmt, pct } from "./html";
import { runeOptions } from "./settings";

/** Passifs (wiki), avec ce que le modèle en simule. */
function passives(): Partial<Record<ItemKey, string>> {
  const refund = axiomRefundPct([...BENCH_BLUE.base, "axiom"], BENCH_LEVEL);
  const b = RULES.bastion;
  return {
    axiom: `Rembourse ${fmt(refund)} % du CD du R par takedown (non simulé)`,
    serylda: "Ralentit de 30 % les cibles sous 50 % de PV (non simulé)",
    edge: "Bouclier anti-sort, +250 PV (non simulé)",
    serpent: `Réduit les boucliers de ${RULES.serpentShieldReduction * 100} % (simulé)`,
    youmuu: "Vitesse de déplacement (non simulé)",
    bastion: b ? `${b.base} (+ ${fmt(b.perLethality)} / létha) dégâts bruts sur le 1ᵉʳ sort (simulé) ; dégâts aux tours` : "Dégâts aux tours",
    profane: "Actif de zone (non simulé)",
  };
}

const shortName = (n: string) => n.replace(/ \d+$/, "");
const approx = (k: ItemKey) => (ITEMS[k].approx ? ' <span class="tag ap" title="Stats non vérifiées sur ce patch">≈</span>' : "");
const pts = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/** Écart (en points) entre le meilleur et le deuxième d'une colonne. */
function lead(rows: BenchRow[], col: number): { k: ItemKey; gap: number } {
  const sorted = [...rows].sort((a, b) => b.v[col] - a.v[col]);
  return { k: sorted[0].k, gap: Math.round((sorted[0].v[col] - sorted[1].v[col]) * 10) / 10 };
}

export function renderBench(form: Form): void {
  if (form === "blue") {
    const rows = benchBlue({ runes: runeOptions() }), best = bestPerColumn(rows), ts = BENCH_BLUE.targets, PASSIVES = passives();
    const iB = ts.indexOf("bruiser"), iT = ts.indexOf("tank");
    const lb = lead(rows, iB), lt = lead(rows, iT);
    const bestEverywhere = rows.find((r) => r.v.every((v, i) => v === best[i]));
    $("bench").innerHTML = `<div class="sub" style="margin-bottom:8px">Base : Voltaic + Hubris (${BENCH_BLUE.hubrisStacks} stacks) + Lucidity, niveau ${BENCH_LEVEL}. Valeur = % de PV retirés par le combo complet (au-delà de 100 % = surplus de dégâts).</div>
      <div class="tscroll"><table><thead><tr><th>4ᵉ item</th><th>Prix</th>${ts.map((t) => `<th>${esc(shortName(TARGETS.mid[t].n))}</th>`).join("")}<th>Passif</th></tr></thead><tbody>`
      + rows.map((r) => `<tr><td>${esc(ITEMS[r.k].n)}${approx(r.k)}</td><td>${fmt(ITEMS[r.k].cost)}</td>${r.v.map((v, i) => `<td class="${v === best[i] ? "best" : ""}">${pct(v)}</td>`).join("")}<td class="sub passive">${PASSIVES[r.k] ?? ""}</td></tr>`).join("")
      + `</tbody></table></div>
      <div class="note" style="margin-top:8px"><b>Lecture :</b> ${bestEverywhere ? `${esc(ITEMS[bestEverywhere.k].n)} est le meilleur 4ᵉ item partout` : "aucun item n'est le meilleur partout"} (contre un bruiser : ${esc(ITEMS[lb.k].n)}, +${pts(lb.gap)} pts sur le 2ᵉ ; contre un tank : ${esc(ITEMS[lt.k].n)}, +${pts(lt.gap)} pts). Axiom, Youmuu, Bastionbreaker et Profane ont les mêmes stats (55 AD, 18 létha) : seul le passif de Bastionbreaker ajoute des dégâts au combo ; Axiom sert en teamfight (reset partiel du R), Youmuu pour le roam. Serpent's ne vaut le coup que contre les boucliers.</div>`;
  } else {
    const rows = benchRed({ runes: runeOptions() }), best = bestPerColumn(rows);
    const top = (i: number) => esc(ITEMS[rows.reduce((a, r) => (r.v[i] > a.v[i] ? r : a)).k].n);
    $("bench").innerHTML = `<div class="sub" style="margin-bottom:8px">Base : Voltaic + Cleaver + Steelcaps, niveau ${BENCH_LEVEL}, combat de 6 s.</div>
      <div class="tscroll"><table><thead><tr><th>4ᵉ item</th><th>Prix</th>${BENCH_RED.columns.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>`
      + rows.map((r) => `<tr><td>${esc(ITEMS[r.k].n)}${approx(r.k)}</td><td>${fmt(ITEMS[r.k].cost)}</td>${r.v.map((v, i) => `<td class="${v === best[i] ? "best" : ""}">${fmt(v)}</td>`).join("")}</tr>`).join("")
      + `</tbody></table></div>
      <div class="note" style="margin-top:8px"><b>Lecture :</b> les % de PV de Rhaast montent avec l'AD bonus. Meilleur DPS contre un tank : ${top(0)} (Serylda se cumule avec Cleaver). Plus de PV effectifs physiques : ${top(3)} ; contre le magique : ${top(4)}. Death's Dance diffère ${RULES.deathsDance.deferred * 100} % des dégâts physiques et magiques ; le modèle suppose que la moitié est purgée par un kill (hypothèse). Les soins varient peu d'un item à l'autre, car le R (en % des PV max de la cible) en fournit une grosse partie.</div>`;
  }
}

export function renderGold(): void {
  const rows = goldEfficiency();
  const g = STAT_GOLD;
  $("gold").innerHTML = `<div class="sub" style="margin-bottom:8px">Valeur des stats brutes au prix des composants de base (AD ${g.ad} po, létha ${g.leth}, AH ${g.ah}, PV ${fmt(g.hp)}, armure ${g.armor}). Hors passifs et hors pénétration en %.</div>`
    + rows.map((r) => `<div class="row"><span>${esc(ITEMS[r.k].n)}</span><div class="bar"><i style="width:${Math.min(100, r.e / 1.3)}%;background:${r.e >= 100 ? "var(--green)" : "var(--gold)"}"></i></div><span>${r.e} %</span></div>`).join("")
    + `<div class="note" style="margin-top:6px">Voltaic paraît peu rentable sur le papier (seulement 10 létha), mais Firmament (+${RULES.voltaic.lethality} létha pendant 4 s et ${RULES.voltaic.currentHp * 100} % des PV actuels) se déclenche à chaque combo grâce à Galvanize. C'est pour ça qu'il est le premier item dans les deux formes.</div>`;
}
