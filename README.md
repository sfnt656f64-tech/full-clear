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

## Données du jeu

- `scripts/sync-ddragon.ts` télécharge `item.json`, `champion.json` et `champion/Kayn.json` (fr_FR et en_US)
  et écrit `src/data/generated/` : version et patch, stats des items utilisés, champions (nom FR/EN, tags Riot,
  portée, mêlée si ≤ 325), stats et sorts de Kayn. Les fichiers sont déterministes : un diff git vide = rien n'a changé.
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
| `scripts/` | Scripts de données |
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
