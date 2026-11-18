# Projet : simulateur de builds Kayn (jungle)

## Contexte
Je joue Kayn jungle en classé. J'ai une première version d'un simulateur sous forme d'une seule page HTML : `kayn-simulator.html` (dans ce dossier). Elle contient :
- des guides de build par compo adverse, pour les formes bleue (Shadow Assassin) et rouge (Rhaast) ;
- un modèle de dégâts en JavaScript (combo bleu, combat de 6 s en rouge) ;
- un benchmark du 4ᵉ item et un classement des items selon la rentabilité de leurs stats ;
- un simulateur de draft : je choisis 5 adversaires et 4 alliés, et la page me donne la forme, les bottes, l'ordre de build et une simulation contre chaque adversaire.

Je veux transformer cette page en vrai projet, maintenable et mis à jour automatiquement à chaque patch.

**Avant d'écrire du code, lis `kayn-simulator.html` en entier, puis propose-moi un plan.**

## Stack souhaitée
- Vite + TypeScript, sans framework (ou Preact si tu le juges vraiment utile).
- Tests avec Vitest.
- Interface en français, pensée d'abord pour le mobile, thème sombre façon dpm.lol.
- Structure suggérée :
  - `src/data/` : données générées et fichiers d'override manuels
  - `src/model/` : calculs de dégâts, purs et testés
  - `src/engine/` : analyse de draft et choix du build
  - `src/ui/` : interface
  - `scripts/` : synchronisation des données

## Étapes (une par une, je valide entre chaque)

### 1. Porter l'existant
- Extraire de la page le modèle, la base de champions, le moteur de draft et l'interface vers la structure ci-dessus.
- Écrire des tests qui figent les résultats actuels. Exemple : au niveau 14, avec Voltaic + Hubris (4 stacks) + Lucidity, Serylda en 4ᵉ item retire environ 65 % des PV du profil « bruiser » (milieu de partie), contre environ 55 % pour Axiom Arc.

### 2. Synchroniser les données avec Data Dragon
Écrire `scripts/sync-ddragon.ts` qui :
- récupère la dernière version dans `https://ddragon.leagueoflegends.com/api/versions.json` ;
- télécharge `item.json`, `champion.json` et `champion/Kayn.json` (locale `fr_FR`, plus `en_US` pour les noms d'items) ;
- génère les stats des items utilisés (AD, létalité, haste, PV, armure, MR, prix) ;
- génère la liste des champions : nom, tags Riot (Tank, Fighter, Assassin, Mage, Marksman, Support), portée d'attaque (mêlée si ≤ 325).

Garder un fichier `src/data/overrides.json`, édité à la main, pour ce que Data Dragon ne donne pas : niveau de CC (0 à 3), boucliers, soins, ralentissements, type de dégâts. Repartir des valeurs de la page actuelle.

Afficher la version du patch dans l'interface.

### 3. Icônes officielles
Utiliser les images de Data Dragon pour les champions et les items. C'est un projet perso et non commercial ; ajouter en pied de page la mention légale requise par Riot pour les projets de fans (« Legal Jibber Jabber »). Garder les icônes originales actuelles en secours si une image ne charge pas.

### 4. Vérifier le modèle
Les valeurs suivantes n'ont pas été vérifiées. Les confronter au wiki officiel (wiki.leagueoflegends.com) et à Data Dragon, me lister les écarts, puis corriger :
- les stats de Guardian Angel et des bottes (Lucidity, Steelcaps, Mercury's, Swiftness, et leurs versions améliorées) ;
- la réduction de bouclier de Serpent's Fang (supposée à 50 % en mêlée) ;
- le remboursement du R par Axiom Arc (supposé à 10 % + 0,25 % par point de létalité) ;
- le passif de Hubris (supposé à 15 AD + 3 par stack) ;
- les ratios de Kayn : Q, W et R dans les deux formes, passif Shadow Assassin de 20 à 40 %, soins de Rhaast.

Ajouter ensuite au modèle Dark Harvest (bleu) et Conqueror (rouge), en option désactivable.

### 5. (Optionnel, demande-moi avant) Mes vraies parties
Avec une clé API Riot personnelle :
- récupérer mes dernières parties classées sur Kayn ;
- comparer mon build réel à celui que recommande le moteur pour la même compo adverse ;
- afficher mon taux de victoire par forme et par item.

La clé va dans `.env`, qui doit être dans `.gitignore`. Ne jamais la commiter.

### 6. Déploiement
- Publier sur GitHub Pages pour que je puisse ouvrir la page depuis mon téléphone.
- Ajouter une GitHub Action qui lance la synchronisation Data Dragon chaque semaine et redéploie si le patch a changé.

## Règles de travail
- Commencer par un plan, puis avancer étape par étape et me montrer le résultat à chaque fois.
- Lancer les tests avant chaque commit.
- Ne jamais inventer une valeur de jeu : soit elle vient de Data Dragon ou du wiki, soit elle est marquée « non vérifiée » dans l'interface.
