// Win rates de Kayn sur le site : méta collectée par l'appli (src/data/generated/kayn-meta.json).
import meta from "../data/generated/kayn-meta.json";
import { wrText, type KaynMeta } from "../data/kayn-meta";

export const KAYN_META = meta as KaynMeta;
const date = (d: string) => new Date(d).toLocaleDateString("fr-FR");

export function metaPill(m: KaynMeta): string {
  return `<span class="pill" title="Parties Émeraude et au-dessus (EUW) collectées par l'appli de bureau, chiffres du ${date(m.generated)}">WR jungle ${wrText(m.wins, m.games)} · patchs ${m.officialPatches.join(" et ")}</span>`;
}

/** Win rate de la rune principale conseillée, et des autres assez jouées. */
export function keystoneLine(m: KaynMeta, keystone: number): string {
  const k = m.keystones.find((x) => x.id === keystone);
  const others = m.keystones.filter((x) => x.id !== keystone && x.games >= 20);
  const few = m.keystones.filter((x) => x.id !== keystone && x.games < 20);
  return `Méta collectée (patchs ${m.officialPatches.join(" et ")}, ${date(m.generated)}) : ${k ? `${k.name} ${wrText(k.wins, k.games)}` : "rune principale pas encore vue"}`
    + (others.length ? ` ; ${others.map((x) => `${x.name} ${wrText(x.wins, x.games)}`).join(" ; ")}` : "")
    + (few.length ? ` ; moins de 20 parties pour ${few.map((x) => x.name).join(", ")} : pas de conclusion.` : ".");
}
