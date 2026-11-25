import version from "./generated/version.json";

/** Version Data Dragon des données (ex. 16.23.1). */
export const DDRAGON_VERSION: string = version.version;
/** Patch Data Dragon / API (16.23) → numéro officiel affiché par Riot (26.23) : la saison 2026 porte le numéro 26. */
export const officialPatch = (p: string): string => { const [a, b] = p.split("."); return Number.isFinite(Number(a)) && b != null ? `${Number(a) + 10}.${b}` : p; };

/** Numéro de patch officiel (ex. 26.23). */
export const PATCH: string = version.patch;
