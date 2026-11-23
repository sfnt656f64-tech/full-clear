// Mobilité des champions (déplacements : sauts, ruées, téléportations courtes), estimée à la main d'après
// leurs sorts. Sert seulement à rapprocher des champions qui se jouent de la même façon (« À essayer »).
// 3 : très mobile (plusieurs déplacements ou un déplacement très fréquent) · 2 : un déplacement (par défaut)
// 1 : peu ou pas de déplacement.
export type Mobility = 1 | 2 | 3;

const HIGH = [
  "Ahri", "Akali", "Akshan", "Ambessa", "Aurora", "Belveth", "Briar", "Corki", "Diana", "Ekko", "Evelynn", "Ezreal", "Fiora",
  "Fizz", "Graves", "Hecarim", "Irelia", "Kaisa", "Kalista", "Kassadin", "Katarina", "Kayn", "Khazix", "Kindred", "Leblanc",
  "LeeSin", "Lillia", "Lucian", "MasterYi", "Naafiri", "Nidalee", "Nilah", "Pyke", "Qiyana", "Rakan", "RekSai", "Rengar", "Riven",
  "Samira", "Shaco", "Sylas", "Talon", "Tristana", "Tryndamere", "Viego", "Vi", "Yasuo", "Yone", "Zac", "Zed", "Zeri",
];
const LOW = [
  "Anivia", "Annie", "Ashe", "Brand", "Cassiopeia", "Chogath", "DrMundo", "Fiddlesticks", "Heimerdinger", "Ivern", "Karthus",
  "Lux", "Malzahar", "Mordekaiser", "Morgana", "Nasus", "Orianna", "Ryze", "Seraphine", "Singed", "Sona", "Soraka", "Swain",
  "Syndra", "TwistedFate", "Udyr", "Veigar", "Velkoz", "Viktor", "Xerath", "Yorick", "Ziggs", "Zilean", "Zyra", "Karma",
  "Lissandra", "Malphite", "Trundle", "Warwick", "Olaf", "Garen", "Darius", "Sion", "Amumu",
];

const LEVEL = new Map<string, Mobility>([...HIGH.map((id) => [id, 3] as const), ...LOW.map((id) => [id, 1] as const)]);

/** Mobilité d'un champion (identifiant Data Dragon) ; 2 si non renseignée. */
export const mobility = (id: string | undefined): Mobility => (id && LEVEL.get(id)) || 2;

export const MOBILITY_LABEL: Record<Mobility, string> = { 1: "peu mobile", 2: "mobile", 3: "très mobile" };
