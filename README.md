# kayn-sim

Simulateur de builds pour Kayn jungle (formes bleue et rouge) : guides par compo adverse, simulateur de draft, benchmark d'items.
Interface en français, pensée pour le mobile.

## Démarrer

```bash
npm install
npm run dev        # serveur de développement
npm test           # tests (Vitest)
npm run build      # vérification des types + build dans dist/
npm run sync       # synchronise les données avec Data Dragon (dernière version)
npm run sync -- 16.22.1   # … ou une version précise
```

Installation sur Windows pas à pas : [docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md).

## Mes parties (`npm run stats`, sur ton PC, rien n'est publié)

Analyse tes parties **Solo/Duo de la saison en cours** (depuis le patch 26.01, le 8 janvier 2026) sur Kayn :
win rate global, par forme (bleu, rouge, sans transformation), par 1er item et par item de l'inventaire final,
et comparaison entre ton build réel et celui que le moteur recommande pour la même compo (forme, 1er item,
3 premiers items, bottes). Résultat : un résumé dans la console et un rapport `.cache/riot/rapport.html`
qui s'ouvre dans le navigateur.

- Options : `--since=AAAA-MM-JJ`, `--refresh` (ignore le cache), `--no-open`.
- Les parties déjà analysées restent dans `.cache/riot/` (ignoré par git) : le 1er lancement prend quelques
  minutes (limite de 100 requêtes / 2 min), les suivants quelques secondes. Ctrl+C ne perd rien.
- Seuls les résumés utiles sont gardés en cache (champions, items, forme, résultat) : ni PUUID d'autres joueurs,
  ni noms.

## Application de bureau (draft et overlay en jeu)

Application Electron (`desktop/`), dans la zone de notification de Windows, qui réutilise le moteur de `src/` :

- **Draft** : lit la sélection des champions via l'API locale du client (LCU, identifiants du `lockfile` ou de
  la ligne de commande de `LeagueClientUx.exe`) et affiche à chaque pick la forme, les runes, les bottes et le build.
- **En jeu** : lit la Live Client Data API (`https://127.0.0.1:2999`) et affiche dans un overlay transparent,
  toujours au premier plan et traversé par la souris, le prochain item selon l'inventaire, l'or et les items
  adverses (`src/data/generated/shop.json` : prix, recettes et stats de tous les items).
- Aucune injection ni lecture mémoire ; seulement ce que le joueur voit déjà. Les réponses des API locales sont
  réduites dès réception à des numéros de champions et d'items : aucun pseudo d'autre joueur n'est affiché ni gardé.
- Seul `RIOT_ID` (et `SITE_URL`) est lu dans le `.env` : celui du projet en développement, puis
  `%APPDATA%\kayn-sim\.env`. La clé API n'est pas utilisée.

```bash
npm run desktop        # compile (esbuild → desktop/dist) et lance l'appli
npm run desktop:dist   # installeur Windows (NSIS) dans release/
```

Guide d'installation et d'utilisation : [docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md#6-lapplication-de-bureau-draft-et-overlay-en-jeu).

## Partie en cours (`npm run live`, en secours)

> Remplacé par l'application de bureau ; gardé en secours.

Prérequis : Node 22.18 ou plus récent (le script TypeScript tourne directement avec `node`).

1. Copier `.env.example` en `.env` et y mettre ta clé personnelle Riot (`RIOT_API_KEY`) et ton Riot ID
   (`RIOT_ID=Nom#TAG`). `.env` est dans `.gitignore` : il n'est jamais commité.
2. Lancer une partie, puis `npm run live` une fois l'écran de chargement affiché (spectator-v5 ne voit pas
   la sélection des champions). Options : `--watch` (vérifie toutes les 30 s), `--local` (ouvre `npm run dev`
   au lieu du site), `--no-open` (affiche seulement le lien).
3. Le navigateur s'ouvre sur le simulateur de draft pré-rempli : adversaires en face, tes 4 coéquipiers
   dans ton équipe, toi dans la case « Toi ».

La clé n'est envoyée qu'à l'API Riot, dans l'en-tête `X-Riot-Token`. Le lien ouvert ne contient que des
identifiants de champions, dans le fragment `#draft=…` (jamais envoyé au serveur). Le client
(`scripts/riot/client.ts`) respecte les limites de la clé personnelle (20 requêtes/s et 100 par 2 minutes)
et attend la durée `Retry-After` en cas de réponse 429.

Le même lien sert à partager une draft : la page met l'adresse à jour quand tu modifies les équipes.

## Données du jeu

- `scripts/sync-ddragon.ts` télécharge `item.json`, `champion.json` et `champion/Kayn.json` (fr_FR et en_US)
  et écrit `src/data/generated/` : version et patch, stats des items utilisés, champions (nom FR/EN, tags Riot,
  portée, mêlée si ≤ 325), stats et sorts de Kayn, et tous les items achetables (`shop.json` : prix, recette, stats). Les fichiers sont déterministes : un diff git vide = rien n'a changé.
  Le script s'arrête si Riot renumérote un item, et signale les nouveaux champions sans override.
- La létalité, la haste et la pénétration en % ne figurent pas dans les stats numériques de Data Dragon :
  elles sont lues dans le bloc `<stats>` de la description anglaise, recoupée avec les stats numériques.
- `src/data/overrides.json` (édité à la main) : ce que Data Dragon ne donne pas (profil, type de dégâts,
  CC de 0 à 3, boucliers, soins, ralentissements, portée forcée) et les corrections sourcées
  (croissance d'AD de Kayn : 3,3 selon le wiki, Data Dragon donnant 0).

## Structure

| Dossier | Rôle |
|---|---|
| `src/data/` | Données : items, champions (`champions.json`), profils de cibles, guides et runes |
| `src/model/` | Calculs de dégâts purs : stats de Kayn, combo bleu, combat rouge de 6 s, benchmark. Toutes les valeurs de jeu sont dans `constants.ts` |
| `src/engine/` | Analyse de draft : score de forme, bottes, ordre de build, simulation contre chaque adversaire |
| `src/ui/` | Interface (TypeScript sans framework) |
| `desktop/` | Application de bureau Electron : processus principal, fenêtre, overlay, accès aux API locales |
| `scripts/` | Scripts de données et de compilation de l'appli |
| `tests/` | Tests Vitest |

## Référence de non-régression

`kayn-simulator.html` est la première version, en une seule page. Elle sert de référence :
`npm run fixtures:legacy` exécute son JavaScript et enregistre ses résultats dans `tests/fixtures/legacy.json`
(290 simulations, 504 analyses de draft, benchmark, valeur des items). `tests/legacy.test.ts` vérifie que le
portage les reproduit à l'identique. Quand le modèle est corrigé volontairement, ces tests échouent : relire
chaque écart, puis mettre la référence à jour.

## Valeurs de jeu

Aucune valeur n'est inventée : elle vient de Data Dragon ou du wiki officiel, sinon elle est marquée
« non vérifiée » dans l'interface. `src/model/constants.ts` donne la source de chaque valeur (vérifiées le
18/11/2026, patch 26.23) et sépare les **hypothèses** de modélisation (durée du combat, temps d'auto-attaque…).
Les règles d'origine (Voltaic 9 %, Death's Dance 35 %…) restent dans `tests/fixtures/legacy-data.ts` pour le
test de non-régression ; `tests/claims.test.ts` vérifie que les chiffres cités dans les guides suivent le modèle.

## Déploiement

- `.github/workflows/deploy.yml` : à chaque push sur `main`, tests + build + déploiement sur GitHub Pages.
  Chaque jeudi, synchronisation Data Dragon : si le patch a changé, les nouvelles données sont testées,
  commitées sur `main` puis déployées. Lancement manuel possible (onglet Actions → Déploiement → Run workflow).
- `.github/workflows/ci.yml` : tests et build sur les autres branches et les pull requests.
- Prérequis (une fois) : Settings → Pages → Source : « GitHub Actions ».
