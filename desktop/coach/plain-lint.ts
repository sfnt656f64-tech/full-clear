// Vérification des règles d'écriture de la vue principale (tests) : 12 mots au plus, pas de chiffre technique (sauf
// une minute de jeu), pas de parenthèse explicative, noms dans la langue du client (jamais l'anglais).
import { CHAMPIONS } from "../../src/data/champions";
import { SHOP } from "../next-item.ts";

export const MAX_WORDS = 12;
const words = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
/** Noms anglais qui diffèrent du nom français (items et champions). */
const ENGLISH = [
  ...Object.values(SHOP).filter((i) => i.nameFr && i.nameFr !== i.name).map((i) => i.name),
  ...CHAMPIONS.filter((c) => c.nameEn && c.nameEn !== c.name).map((c) => c.nameEn!),
  "Blue Buff", "Red Buff", "early", "late game", "side lane", "frontline", "Steelcaps", "Treads",
].filter((n) => n.length >= 4);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function lineIssues(text: string): string[] {
  const out: string[] = [];
  if (words(text).length > MAX_WORDS) out.push(`plus de ${MAX_WORDS} mots (${words(text).length})`);
  const noMinutes = text.replace(/\d+ min\b/g, "");
  if (/\d/.test(noMinutes)) out.push("chiffre hors minute de jeu");
  if (/[%±()]|\bpo\b/.test(text)) out.push("pourcentage, marge ou parenthèse");
  for (const n of ENGLISH) if (new RegExp(`(^|[^\\p{L}])${esc(n)}([^\\p{L}]|$)`, "u").test(text)) out.push(`nom anglais : ${n}`);
  return out;
}
