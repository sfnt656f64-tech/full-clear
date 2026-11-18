# kayn-sim

Simulateur de builds pour Kayn jungle (formes bleue et rouge) : guides par compo adverse, simulateur de draft, benchmark d'items.
Interface en français, pensée pour le mobile.

## Démarrer

```bash
npm install
npm run dev        # serveur de développement
npm test           # tests (Vitest)
npm run build      # vérification des types + build dans dist/
```

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
« non vérifiée » dans l'interface. Les valeurs actuelles sont celles de la première version et seront
vérifiées (étapes 2 et 4).
