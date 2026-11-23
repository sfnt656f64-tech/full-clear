// Import d'une page de runes dans le client (API locale LCU), seulement quand tu cliques sur « Importer ».
//
// - L'ancienne page « KaynSim … » est remplacée (jamais une de tes pages).
// - Si toutes tes pages sont utilisées, rien n'est supprimé : un message explique quoi faire.
import { lcuGet, lcuRequest, type LcuCredentials } from "../lcu.ts";
import { PAGE_PREFIX, validPage, type RecommendedPage } from "./rune-page.ts";

interface LcuPage { id: number; name: string; isDeletable: boolean; isEditable?: boolean }

/** Les appels au client, isolés pour les tests. */
export interface PerksApi {
  pages(): Promise<LcuPage[]>;
  ownedPageCount(): Promise<number | null>;
  remove(id: number): Promise<void>;
  create(body: unknown): Promise<void>;
}

export function lcuPerks(creds: LcuCredentials): PerksApi {
  return {
    pages: async () => (await lcuGet<LcuPage[]>(creds, "/lol-perks/v1/pages")) ?? [],
    ownedPageCount: async () => (await lcuGet<{ ownedPageCount?: number }>(creds, "/lol-perks/v1/inventory"))?.ownedPageCount ?? null,
    remove: async (id) => { await lcuRequest(creds, "DELETE", `/lol-perks/v1/pages/${id}`); },
    create: async (body) => { await lcuRequest(creds, "POST", "/lol-perks/v1/pages", body); },
  };
}

export interface ImportResult { ok: boolean; message: string }

export async function importRunePage(api: PerksApi, page: RecommendedPage): Promise<ImportResult> {
  if (!validPage(page)) return { ok: false, message: "Page de runes incomplète : import annulé." };
  const pages = await api.pages();
  // Nos anciennes pages d'abord : la place qu'elles occupent est réutilisée.
  for (const p of pages.filter((x) => x.isDeletable && x.name.startsWith(PAGE_PREFIX))) await api.remove(p.id);
  const mine = pages.filter((x) => x.isDeletable && !x.name.startsWith(PAGE_PREFIX)).length;
  const owned = await api.ownedPageCount();
  if (owned != null && mine >= owned) {
    return { ok: false, message: "Toutes tes pages de runes sont utilisées : supprime-en une dans le client (ou renomme-la « KaynSim »), puis réessaie." };
  }
  await api.create({
    name: page.name.slice(0, 25),
    primaryStyleId: page.primary,
    subStyleId: page.sub,
    selectedPerkIds: [...page.selections, ...page.shards],
    current: true,
  });
  return { ok: true, message: `Page « ${page.name.slice(0, 25)} » importée et sélectionnée dans le client.` };
}
