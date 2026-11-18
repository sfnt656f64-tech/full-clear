import type { BootKey, Form, ItemKey } from "../data/types";
import type { Analysis } from "./analyse";

/** [bottes, justification]. La première entrée est la recommandation. */
export type BootChoice = [BootKey, string];

export function chooseBoots(x: Analysis, f: Form): BootChoice[] {
  const o: BootChoice[] = [];
  if (x.apShare >= 0.6 || (x.hard >= 3 && x.apShare >= 0.4))
    o.push(["mercury", `${Math.round(x.apShare * 100)} % de dégâts magiques${x.hard >= 3 ? ` + ${x.hard} gros CC` : ""} → MR + 30 % de ténacité`]);
  else if (x.hard >= 4) o.push(["mercury", `${x.hard} champions à gros CC → la ténacité vaut plus que la haste`]);
  if (x.adShare >= (f === "blue" ? 0.7 : 0.6) && x.aa >= 2)
    o.push(["steelcaps", `${Math.round(x.adShare * 100)} % de dégâts physiques dont ${x.aa} auto-attaqueurs`]);
  if (x.slows >= 3 && x.ranged >= 3)
    o.push(["swiftness", `${x.slows} sources de ralentissement et ${x.ranged} champions à distance : Swiftness réduit les ralentissements`]);
  const def: BootChoice = f === "blue"
    ? ["lucidity", "par défaut en bleu : haste sur E/R et sur les sorts d'invocateur"]
    : ["steelcaps", "par défaut en rouge (rester en bottes de base jusqu'aux 2 items)"];
  if (!o.length) o.push(def);
  else if (!o.find((b) => b[0] === def[0])) o.push([def[0], "alternative : " + def[1]]);
  return o;
}

export interface BuildChoice {
  /** 6 emplacements : 5 items + bottes, dans l'ordre d'achat. */
  b: ItemKey[];
  /** Justifications (HTML autorisé : <b>). */
  notes: string[];
}

export function chooseBuild(x: Analysis, f: Form): BuildChoice {
  const boots = chooseBoots(x, f)[0][0];
  const notes: string[] = [];
  let b: ItemKey[];
  if (f === "blue") {
    const second: ItemKey = x.hard >= 3 ? "edge" : "hubris";
    b = ["voltaic", second, boots];
    if (second === "edge") notes.push(`<b>Edge of Night en 2ᵉ</b> : ${x.hard} gros CC en face, le bouclier anti-sort protège ton engage.`);
    let fourth: ItemKey = "axiom";
    if (x.shields >= 2) {
      fourth = "serpent";
      notes.push(`<b>Serpent's Fang</b> : ${Math.round(x.shields)} sources de boucliers en face.`);
    } else if (x.tanks + x.fight * 0.5 >= 2 || x.allyAD >= 3) {
      fourth = "serylda";
      notes.push(`<b>Serylda en 4ᵉ</b> : ${x.tanks + x.fight >= 2 ? "frontline armurée" : "ton équipe fait surtout des dégâts physiques, ils vont stacker l'armure"}.`);
    }
    b.push(fourth);
    const rest = (["hubris", "axiom", "serylda", "edge", "ga"] as ItemKey[]).filter((k) => !b.includes(k));
    if (fourth === "serpent" && !b.includes("serylda")) b.push("serylda");
    while (b.length < 6) b.push(rest.shift()!);
    b = b.slice(0, 6);
    if (!b.includes("hubris")) notes.push("Pas de Hubris : sans kills, son passif ne s'active pas.");
  } else {
    const tanky = x.tanks >= 2;
    b = tanky ? ["cleaver", "voltaic", boots] : ["voltaic", "cleaver", boots];
    if (x.heals >= 2) { b.push("chempunk"); notes.push(`<b>Chempunk Chainsword</b> : ${x.heals} champions avec beaucoup de soins (anti-heal). Prends Executioner's Calling tôt.`); }
    if (tanky) { b.push("serylda"); notes.push(`<b>Serylda + Cleaver</b> : ${x.tanks} tanks. Les deux se multiplient (−30 % d'armure, puis 35 % de pénétration).`); }
    if (x.adShare >= 0.55) { b.push("dd"); notes.push(`<b>Death's Dance</b> : ${Math.round(x.adShare * 100)} % de dégâts physiques en face.`); }
    if (x.apShare >= 0.55) { b.push("sterak"); notes.push(`<b>Sterak</b> : ${Math.round(x.apShare * 100)} % de dégâts magiques en face (Maw of Malmortius possible aussi, non modélisé).`); }
    for (const k of ["dd", "sterak", "ga"] as ItemKey[]) if (!b.includes(k)) b.push(k);
    b = [...new Set(b)].slice(0, 6);
  }
  if (f === "blue" && x.heals >= 2) notes.push(`${x.heals} champions avec beaucoup de soins : un Executioner's Calling (800 po) suffit en bleu, car tu burst.`);
  return { b, notes };
}
