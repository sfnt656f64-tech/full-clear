// Synchronise les données du jeu avec Data Dragon (CDN officiel de Riot).
//
//   npm run sync               → dernière version
//   npm run sync -- 16.22.1    → version précise
//
// Écrit dans src/data/generated/ :
//   version.json    version Data Dragon + numéro de patch
//   items.json      stats des items utilisés (AD, létalité, haste, PV, armure, RM, pén. %, prix)
//   champions.json  champions : nom FR/EN, tags Riot, portée d'attaque, icône
//   kayn.json       stats de base et sorts de Kayn
//   item-index.json tous les items terminés de la Faille (légendaires, bottes) : nom, icône, type
//                   (sert aux stats de tes parties, npm run stats)
//   shop.json       tous les items achetables de la Faille : prix, recette, stats principales
//                   (sert à l'overlay en jeu de l'appli de bureau)
//
// Les fichiers sont déterministes (pas d'horodatage) : un diff git vide = rien n'a changé.
// Ce script n'importe rien de src/ pour pouvoir tourner avec `node` seul (type stripping).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "src/data/generated");
const CDN = "https://ddragon.leagueoflegends.com";

/** Clé interne → identifiant Data Dragon et nom anglais attendu (garde-fou si Riot renumérote). */
const ITEM_IDS: Record<string, [id: string, name: string]> = {
  voltaic: ["6699", "Voltaic Cyclosword"],
  hubris: ["6697", "Hubris"],
  axiom: ["6696", "Axiom Arc"],
  edge: ["3814", "Edge of Night"],
  serylda: ["6694", "Serylda's Grudge"],
  serpent: ["6695", "Serpent's Fang"],
  youmuu: ["3142", "Youmuu's Ghostblade"],
  bastion: ["2520", "Bastionbreaker"],
  profane: ["6698", "Profane Hydra"],
  cleaver: ["3071", "Black Cleaver"],
  dd: ["6333", "Death's Dance"],
  sterak: ["3053", "Sterak's Gage"],
  ga: ["3026", "Guardian Angel"],
  chempunk: ["6609", "Chempunk Chainsword"],
  lucidity: ["3158", "Ionian Boots of Lucidity"],
  steelcaps: ["3047", "Plated Steelcaps"],
  mercury: ["3111", "Mercury's Treads"],
  swiftness: ["3009", "Boots of Swiftness"],
  crimsonLucidity: ["3171", "Crimson Lucidity"],
  armoredAdvance: ["3174", "Armored Advance"],
  chainlacedCrushers: ["3173", "Chainlaced Crushers"],
  swiftmarch: ["3170", "Swiftmarch"],
};

/** Libellés du bloc <stats> de la description anglaise → champ généré. */
const STAT_LABELS: Record<string, string> = {
  "Attack Damage": "ad",
  "Lethality": "leth",
  "Ability Haste": "ah",
  "Health": "hp",
  "Armor": "armor",
  "Magic Resist": "mr",
  "Armor Penetration": "pen",
  "Move Speed": "ms",
  "Tenacity": "tenacity",
  "Slow Resist": "slowResist",
};

/** Stats toujours exprimées en % (le suffixe Pct n'est ajouté qu'aux autres). */
const PERCENT_STATS = new Set(["pen", "tenacity", "slowResist"]);

/** Champ numérique de Data Dragon correspondant, pour recouper la description. */
const STAT_FIELDS: Record<string, string> = {
  ad: "FlatPhysicalDamageMod",
  hp: "FlatHPPoolMod",
  armor: "FlatArmorMod",
  mr: "FlatSpellBlockMod",
  ms: "FlatMovementSpeedMod",
};

/** Portée d'attaque au-delà de laquelle un champion est considéré à distance. */
const MELEE_MAX_RANGE = 325;

// ---------- Téléchargement ----------

async function get<T>(path: string): Promise<T> {
  const url = `${CDN}${path}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      if (attempt >= 4) throw new Error(`Échec du téléchargement de ${url} : ${(e as Error).message}`);
      await new Promise((ok) => setTimeout(ok, 1000 * 2 ** attempt));
    }
  }
}

interface DDItem {
  name: string;
  description: string;
  stats: Record<string, number>;
  gold: { total: number; purchasable: boolean };
  maps: Record<string, boolean>;
  image: { full: string };
  tags?: string[];
  from?: string[];
  into?: string[];
  inStore?: boolean;
}
interface DDChampion {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
  info: { attack: number; defense: number; magic: number; difficulty: number };
  stats: Record<string, number>;
  image: { full: string };
}
interface DDSpell { id: string; name: string; cooldown: number[]; cost: number[]; range: number[]; image: { full: string } }
interface DDChampionFull extends DDChampion { spells: DDSpell[]; passive: { name: string; image: { full: string } } }
type DDFile<T> = { version: string; data: Record<string, T> };

// ---------- Items ----------

/** Lit le bloc <stats> d'une description : « <attention>35%</attention> Armor Penetration<br>… ». */
export function parseStatBlock(description: string): { stats: Record<string, number>; unknown: string[] } {
  const block = description.match(/<stats>(.*?)<\/stats>/s)?.[1] ?? "";
  const stats: Record<string, number> = {};
  const unknown: string[] = [];
  for (const line of block.split(/<br\s*\/?>/)) {
    const m = line.match(/<attention>\s*([\d.]+)\s*(%?)\s*<\/attention>\s*(.+)$/);
    if (!m) continue;
    const label = m[3].replace(/<[^>]+>/g, "").trim();
    let field = STAT_LABELS[label];
    if (!field) { unknown.push(label); continue; }
    // « 4% Move Speed » (Youmuu) est un pourcentage, pas une valeur fixe.
    if (m[2] === "%" && !PERCENT_STATS.has(field)) field += "Pct";
    stats[field] = Number(m[1]);
  }
  return { stats, unknown };
}

function buildItems(en: DDFile<DDItem>, fr: DDFile<DDItem>, warnings: string[]) {
  const out: Record<string, unknown> = {};
  for (const [key, [id, expected]] of Object.entries(ITEM_IDS)) {
    const it = en.data[id];
    if (!it) throw new Error(`Item ${key} (${id}) absent de Data Dragon : vérifier ITEM_IDS.`);
    if (it.name !== expected) throw new Error(`Item ${id} : attendu « ${expected} », trouvé « ${it.name} ». Riot a renuméroté ? Mettre ITEM_IDS à jour.`);
    if (!it.maps["11"] || !it.gold.purchasable) warnings.push(`${expected} n'est plus achetable sur la Faille de l'invocateur.`);
    const { stats, unknown } = parseStatBlock(it.description);
    for (const u of unknown) warnings.push(`${expected} : stat non reconnue « ${u} » (ajouter à STAT_LABELS ?)`);
    for (const [field, ddField] of Object.entries(STAT_FIELDS)) {
      const a = stats[field] ?? 0, b = it.stats[ddField] ?? 0;
      if (a !== b) warnings.push(`${expected} : ${field} = ${a} dans la description, ${b} dans stats.${ddField}. Valeur de la description retenue.`);
    }
    out[key] = {
      id,
      name: it.name,
      nameFr: fr.data[id]?.name ?? it.name,
      image: it.image.full,
      cost: it.gold.total,
      ...stats,
    };
  }
  return out;
}

/** Prix minimal d'un item légendaire (les composants coûtent moins). */
const LEGENDARY_MIN_GOLD = 2000;
const BASIC_BOOTS = "1001";

export interface IndexedItem { name: string; nameFr: string; image: string; kind: "legendary" | "boots"; baseBoots?: string }

/**
 * Items « terminés » achetables sur la Faille : légendaires (aucune amélioration, ≥ 2000 po, hors consommables)
 * et bottes (hors bottes de base). Les bottes de niveau 3 pointent vers leurs bottes de niveau 2 (baseBoots).
 */
export function buildItemIndex(en: DDFile<DDItem>, fr: DDFile<DDItem>): Record<string, IndexedItem> {
  const out: Record<string, IndexedItem> = {};
  for (const [id, it] of Object.entries(en.data).sort(([a], [b]) => Number(a) - Number(b))) {
    if (!it.maps["11"] || !it.gold.purchasable || it.inStore === false || Number(id) >= 10000) continue;
    const tags = it.tags ?? [];
    const base = { name: it.name, nameFr: fr.data[id]?.name ?? it.name, image: it.image.full };
    if (tags.includes("Boots")) {
      if (id === BASIC_BOOTS) continue;
      const parent = (it.from ?? []).find((f) => en.data[f]?.tags?.includes("Boots") && f !== BASIC_BOOTS);
      out[id] = { ...base, kind: "boots", ...(parent ? { baseBoots: parent } : {}) };
    } else if (!(it.into?.length) && it.gold.total >= LEGENDARY_MIN_GOLD && !tags.includes("Consumable") && !tags.includes("Trinket")) {
      out[id] = { ...base, kind: "legendary" };
    }
  }
  return out;
}

/** Une entrée de la boutique : prix total, recette et stats utiles pour lire l'inventaire adverse. */
export interface ShopItem {
  /** Nom français. */
  name: string;
  cost: number;
  /** Composants directs (identifiants), dans l'ordre de Data Dragon. */
  from?: string[];
  ad?: number;
  ap?: number;
  armor?: number;
  mr?: number;
  hp?: number;
  /** Vol de vie ou omnivampirisme. */
  heal?: true;
  boots?: true;
}

/** Tous les items achetables sur la Faille (composants compris), pour l'overlay en jeu. */
export function buildShop(en: DDFile<DDItem>, fr: DDFile<DDItem>): Record<string, ShopItem> {
  const out: Record<string, ShopItem> = {};
  const stat: [keyof ShopItem, string][] = [["ad", "FlatPhysicalDamageMod"], ["ap", "FlatMagicDamageMod"], ["armor", "FlatArmorMod"], ["mr", "FlatSpellBlockMod"], ["hp", "FlatHPPoolMod"]];
  for (const [id, it] of Object.entries(en.data).sort(([a], [b]) => Number(a) - Number(b))) {
    if (!it.maps["11"] || !it.gold.purchasable || Number(id) >= 10000) continue;
    const e: ShopItem = { name: fr.data[id]?.name ?? it.name, cost: it.gold.total };
    const from = (it.from ?? []).filter((f) => en.data[f]);
    if (from.length) e.from = from;
    for (const [k, dd] of stat) if (it.stats[dd]) (e as unknown as Record<string, number>)[k] = it.stats[dd];
    const tags = it.tags ?? [];
    if (tags.includes("LifeSteal") || tags.includes("SpellVamp") || it.stats.PercentLifeStealMod) e.heal = true;
    if (tags.includes("Boots")) e.boots = true;
    out[id] = e;
  }
  return out;
}

// ---------- Champions ----------

function buildChampions(en: DDFile<DDChampion>, fr: DDFile<DDChampion>) {
  return Object.values(fr.data)
    .map((c) => ({
      id: c.id,
      key: Number(c.key),
      name: c.name,
      nameEn: en.data[c.id]?.name ?? c.name,
      tags: c.tags,
      attackRange: c.stats.attackrange,
      range: c.stats.attackrange <= MELEE_MAX_RANGE ? "melee" : "ranged",
      info: c.info,
      image: c.image.full,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildKayn(fr: DDFile<DDChampionFull>, en: DDFile<DDChampionFull>) {
  const k = fr.data.Kayn, ke = en.data.Kayn;
  return {
    stats: k.stats,
    passive: { name: k.passive.name, nameEn: ke.passive.name, image: k.passive.image.full },
    spells: k.spells.map((s, i) => ({
      slot: "QWER"[i],
      id: s.id,
      name: s.name,
      nameEn: ke.spells[i].name,
      cooldown: s.cooldown,
      range: s.range,
      image: s.image.full,
    })),
  };
}

// ---------- Patch ----------

/**
 * Depuis 2025, Riot numérote les patchs par année (25.x, 26.x) alors que Data Dragon
 * garde l'ancienne série (15.x, 16.x) : patch = (majeure + 10).(mineure).
 */
export const patchFromVersion = (v: string): string => {
  const [maj, min] = v.split(".").map(Number);
  return maj >= 15 ? `${maj + 10}.${min}` : `${maj}.${min}`;
};

// ---------- Overrides ----------

interface Overrides { champions: Record<string, { name?: string }> }

async function checkOverrides(champions: { id: string; name: string }[], warnings: string[]) {
  const ov = JSON.parse(await readFile(resolve(ROOT, "src/data/overrides.json"), "utf8")) as Overrides;
  const dd = new Set(champions.map((c) => c.id));
  const missing = champions.filter((c) => !ov.champions[c.id]);
  for (const c of missing) warnings.push(`Nouveau champion sans override : ${c.name} (${c.id}). Profil déduit des tags Riot, CC/boucliers/soins à remplir dans overrides.json.`);
  for (const id of Object.keys(ov.champions)) if (!dd.has(id)) warnings.push(`overrides.json : ${id} n'existe pas dans Data Dragon.`);
}

// ---------- Main ----------

const write = (name: string, data: unknown) =>
  writeFile(resolve(OUT, name), JSON.stringify(data, null, 2) + "\n");

async function main() {
  const versions = await get<string[]>("/api/versions.json");
  const version = process.argv[2] ?? versions[0];
  if (!versions.includes(version)) throw new Error(`Version inconnue : ${version}`);
  console.log(`Data Dragon ${version} (patch ${patchFromVersion(version)})`);

  const base = `/cdn/${version}/data`;
  const [itemEn, itemFr, champEn, champFr, kaynFr, kaynEn] = await Promise.all([
    get<DDFile<DDItem>>(`${base}/en_US/item.json`),
    get<DDFile<DDItem>>(`${base}/fr_FR/item.json`),
    get<DDFile<DDChampion>>(`${base}/en_US/champion.json`),
    get<DDFile<DDChampion>>(`${base}/fr_FR/champion.json`),
    get<DDFile<DDChampionFull>>(`${base}/fr_FR/champion/Kayn.json`),
    get<DDFile<DDChampionFull>>(`${base}/en_US/champion/Kayn.json`),
  ]);

  const warnings: string[] = [];
  const items = buildItems(itemEn, itemFr, warnings);
  const champions = buildChampions(champEn, champFr);
  const kayn = buildKayn(kaynFr, kaynEn);
  const itemIndex = buildItemIndex(itemEn, itemFr);
  const shop = buildShop(itemEn, itemFr);
  await checkOverrides(champions, warnings);

  await mkdir(OUT, { recursive: true });
  await write("version.json", { version, patch: patchFromVersion(version) });
  await write("items.json", items);
  await write("champions.json", champions);
  await write("kayn.json", kayn);
  await write("item-index.json", itemIndex);
  await write("shop.json", shop);

  console.log(`${Object.keys(items).length} items, ${champions.length} champions, ${Object.keys(itemIndex).length} items terminés écrits dans src/data/generated/`);
  if (warnings.length) console.log(`\n⚠️  ${warnings.length} avertissement(s) :\n- ` + warnings.join("\n- "));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
