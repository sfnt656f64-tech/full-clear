// Lien de draft : la composition des deux équipes dans le fragment de l'URL (après #).
// Le fragment n'est jamais envoyé au serveur. Il ne contient que des identifiants de champions.
//
//   #draft=en-Ahri.Zed.Jinx.Lulu.Thresh~al-Ornn.Syndra.KaiSa.Nautilus~src-live
//
// Séparateurs choisis parmi les caractères sûrs partout (URL, ligne de commande Windows) :
//   « ~ » entre les sections, « - » après le nom de section, « . » entre les champions.
// Une case vide est une chaîne vide (« Ahri..Jinx »). Identifiants = ceux de Data Dragon.
//
// Ce fichier n'importe rien : il est aussi utilisé par scripts/riot/live.ts (Node sans build).

export interface DraftLink {
  /** Adversaires (5 cases), identifiants Data Dragon ou null. */
  en: (string | null)[];
  /** Alliés hors toi (4 cases). */
  al: (string | null)[];
  /** Provenance : "live" quand le lien vient de npm run live. */
  src?: string;
}

export const DRAFT_SLOTS = { en: 5, al: 4 } as const;
const ID = /^[A-Za-z0-9]+$/;

const pad = (ids: (string | null)[], n: number) =>
  Array.from({ length: n }, (_, i) => (ids[i] && ID.test(ids[i]!) ? ids[i]! : null));

export function encodeDraft(d: DraftLink): string {
  const part = (ids: (string | null)[], n: number) => pad(ids, n).map((x) => x ?? "").join(".");
  let s = `draft=en-${part(d.en, DRAFT_SLOTS.en)}~al-${part(d.al, DRAFT_SLOTS.al)}`;
  if (d.src && ID.test(d.src)) s += `~src-${d.src}`;
  return s;
}

/** Lit un fragment d'URL (avec ou sans « # »). Renvoie null s'il ne contient pas de draft. */
export function decodeDraft(hash: string): DraftLink | null {
  const h = hash.replace(/^#/, "");
  if (!h.startsWith("draft=")) return null;
  const out: DraftLink = { en: pad([], DRAFT_SLOTS.en), al: pad([], DRAFT_SLOTS.al) };
  for (const section of h.slice(6).split("~")) {
    const dash = section.indexOf("-");
    if (dash < 0) continue;
    const key = section.slice(0, dash), val = section.slice(dash + 1);
    if (key === "en" || key === "al") out[key] = pad(val.split("."), DRAFT_SLOTS[key]);
    else if (key === "src" && ID.test(val)) out.src = val;
  }
  return out;
}
