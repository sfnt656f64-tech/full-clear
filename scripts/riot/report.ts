// Rapport local de npm run stats : résumé console + page HTML autonome (jamais publiée).
import { MIN_GAMES, wr, type ItemIndex, type StatsReport, type WinRate } from "./aggregate.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pctTxt = (w: WinRate) => (w.n ? `${wr(w)!.toLocaleString("fr-FR")} %` : "—");
const dateFr = (ms: number) => new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const FORM_LABEL = { blue: "🔵 Shadow Assassin", red: "🔴 Rhaast", none: "⚪ Sans transformation" } as const;

/** Résumé texte pour la console. */
export function consoleSummary(r: StatsReport): string {
  const line = (label: string, w: WinRate) => `  ${label.padEnd(30)} ${pctTxt(w).padStart(7)}  (${w.wins}/${w.n})${w.n && w.n < MIN_GAMES ? "  peu de parties" : ""}`;
  const c = r.comparison;
  const out = [
    `Kayn en Solo/Duo depuis le ${dateFr(r.since)} : ${r.games} parties${r.remakes ? ` (+${r.remakes} remake(s) exclu(s))` : ""}`,
    line("Win rate global", r.overall),
    "", "Par forme :",
    line("Shadow Assassin (bleu)", r.byForm.blue), line("Rhaast (rouge)", r.byForm.red), line("Sans transformation", r.byForm.none),
    "", `Build réel vs recommandé (${c.compared} parties comparées) :`,
    line("Build suivi (≥ 2 des 3 items)", c.followed), line("Build non suivi", c.notFollowed),
    line("1er item conforme", c.firstMatched), line("1er item différent", c.firstDiffered),
    line("Forme conforme", c.formAgreed), line("Forme différente", c.formDiffered),
    "", "Items les plus joués :",
    ...r.byItem.slice(0, 8).map((i) => line(i.name, i.w)),
  ];
  return out.join("\n");
}

function bar(w: WinRate): string {
  const v = wr(w);
  if (v == null) return `<div class="bar"></div>`;
  const col = v >= 55 ? "var(--green)" : v >= 48 ? "var(--gold)" : "var(--red)";
  return `<div class="bar"><i style="width:${v}%;background:${col}"></i><span class="k"></span></div>`;
}

function row(label: string, w: WinRate, icon = ""): string {
  const low = w.n > 0 && w.n < MIN_GAMES;
  return `<div class="row${low ? " low" : ""}">${icon}<span class="lbl">${label}</span>${bar(w)}<span class="val">${pctTxt(w)}</span><span class="n">${w.wins}/${w.n}</span></div>`;
}

function kpi(title: string, a: [string, WinRate], b: [string, WinRate]): string {
  return `<div class="kpi"><div class="sub">${title}</div>${row(a[0], a[1])}${row(b[0], b[1])}</div>`;
}

export function renderHtml(r: StatsReport, index: ItemIndex, ddVersion: string): string {
  const img = (id: number) => {
    const it = index[id];
    return it ? `<img class="ic" src="https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/item/${esc(it.image)}" alt="" title="${esc(it.name)}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ic none',textContent:'?'}))">` : `<span class="ic none">?</span>`;
  };
  const c = r.comparison;
  const games = c.games.slice(0, 40).map((g) => `<tr class="${g.win ? "w" : "l"}">
      <td>${dateFr(g.start)}</td><td>${g.win ? "Victoire" : "Défaite"}</td>
      <td>${FORM_LABEL[g.played]}${g.played !== "none" && g.played !== g.recommendedForm ? ` <span class="tag">reco : ${g.recommendedForm === "blue" ? "bleu" : "rouge"}</span>` : ""}</td>
      <td class="items">${g.actual.core.map(img).join("")}${g.actual.boots ? img(g.actual.boots) : ""}</td>
      <td class="items">${g.recommended.core.map(img).join("")}${img(g.recommended.boots)}</td>
      <td>${g.coreOverlap}/3</td>
      <td class="champs">${g.enemies.map(esc).join(", ")}</td></tr>`).join("");

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mes parties Kayn</title><style>
:root{--bg:#0b0e17;--card:#131826;--card2:#1a2033;--line:#252c42;--txt:#e6e9f2;--mut:#8a93ad;--blue:#4f8cff;--red:#ff4d5e;--gold:#e8b64c;--green:#3ecf8e;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 Inter,system-ui,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:16px}h1{font-size:19px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}
.sub{color:var(--mut);font-size:12px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px}
.big{font-size:28px;font-weight:800}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}.kpi{background:var(--card2);border-radius:10px;padding:10px}
.row{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12.5px}.row.low{opacity:.45}.lbl{width:190px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{flex:1;height:10px;border-radius:5px;background:var(--bg);position:relative;min-width:60px}.bar i{display:block;height:100%;border-radius:5px}.bar .k{position:absolute;left:50%;top:-3px;width:2px;height:16px;background:#fff6}
.kpi .lbl{width:auto;flex:1 1 90px}.kpi .bar{flex:1 1 50px;min-width:40px}.val{width:58px;text-align:right;font-weight:700;flex:none}.n{width:54px;text-align:right;color:var(--mut);flex:none}
.ic{width:24px;height:24px;border-radius:5px;vertical-align:middle;margin-right:3px;display:inline-grid;place-items:center;background:var(--card2);font-size:11px;color:var(--mut)}
.tscroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:6px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{color:var(--mut);font-weight:600}
tr.w td:nth-child(2){color:var(--green)}tr.l td:nth-child(2){color:var(--red)}td.champs{white-space:normal;color:var(--mut);min-width:200px}
.tag{font-size:10px;background:#3a2e10;color:var(--gold);padding:1px 5px;border-radius:4px}.note{color:var(--mut);font-size:12px;line-height:1.55}
</style></head><body><div class="wrap">
<h1>📈 Mes parties Kayn</h1>
<div class="sub">Solo/Duo depuis le ${dateFr(r.since)} · généré le ${dateFr(Date.now())} · rapport local, jamais publié</div>

<div class="card" style="margin-top:12px"><div class="big">${pctTxt(r.overall)}</div>
<div class="sub">${r.overall.wins} victoires sur ${r.games} parties${r.remakes ? ` · ${r.remakes} remake(s) exclu(s)` : ""}</div></div>

<h2>Par forme</h2><div class="card">${row(FORM_LABEL.blue, r.byForm.blue)}${row(FORM_LABEL.red, r.byForm.red)}${row(FORM_LABEL.none, r.byForm.none)}</div>

<h2>Build réel vs build recommandé</h2>
<div class="card"><div class="sub" style="margin-bottom:8px">${c.compared} parties comparées${c.skipped ? ` · ${c.skipped} ignorée(s) (champion inconnu)` : ""}${c.withoutTimeline ? ` · ${c.withoutTimeline} sans chronologie (ordre d'achat approché par l'inventaire final)` : ""} · en moyenne ${c.avgCoreOverlap?.toLocaleString("fr-FR") ?? "—"} des 3 items recommandés dans tes 3 premiers</div>
<div class="kpis">
${kpi("Build suivi (au moins 2 des 3 premiers items recommandés)", ["Suivi", c.followed], ["Non suivi", c.notFollowed])}
${kpi("1er item", ["Celui recommandé", c.firstMatched], ["Un autre", c.firstDiffered])}
${kpi("Forme", ["Celle recommandée", c.formAgreed], ["L'autre", c.formDiffered])}
${kpi("Bottes", ["Celles recommandées", c.bootsMatched], ["D'autres", c.bootsDiffered])}
</div>
<div class="note" style="margin-top:8px">Le build recommandé est celui que le moteur du site propose <b>aujourd'hui</b> pour la même compo (5 adversaires, 4 alliés), dans la forme que tu as jouée (ou celle qu'il recommande si tu ne t'es pas transformé). Les parties d'anciens patchs sont donc comparées aux recommandations actuelles. Peu de parties = tendance, pas preuve : les lignes sous ${MIN_GAMES} parties sont grisées.</div></div>

<h2>Par 1er item</h2><div class="card">${r.byFirstItem.map((i) => row(esc(i.name), i.w, img(i.id))).join("") || '<div class="sub">—</div>'}</div>

<h2>Par item (inventaire final)</h2><div class="card">${r.byItem.map((i) => row(esc(i.name), i.w, img(i.id))).join("") || '<div class="sub">—</div>'}</div>

<h2>Dernières parties</h2><div class="card tscroll"><table>
<thead><tr><th>Date</th><th>Résultat</th><th>Forme</th><th>Tes 3 items + bottes</th><th>Recommandé</th><th>Commun</th><th>En face</th></tr></thead>
<tbody>${games || '<tr><td colspan="7" class="sub">Aucune partie.</td></tr>'}</tbody></table></div>

<div class="note">Données : API Riot (match-v5) avec ta clé personnelle, icônes Data Dragon ${esc(ddVersion)}. Full Clear isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</div>
</div></body></html>
`;
}
