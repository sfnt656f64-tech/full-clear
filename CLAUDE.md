# Règles de travail

## Vérifier avant de répondre

Après chaque changement :

1. Vérification des types (`npx tsc --noEmit`), tests (`npx vitest run`) et build (`npm run desktop:build`).
2. Lancer une copie de l'appli sur une copie de la base de l'utilisateur, avec une collecte simulée :
   - copie cohérente de la base : `vacuum into` depuis `%APPDATA%\kayn-sim\riot.db` vers un dossier de test, avec un
     `settings.json` dont la collecte est en pause (aucune requête à l'API Riot) ;
   - lancement : `KAYN_SIM_USER_DATA=<dossier de test> KAYN_SIM_PROFILE=1 npx electron . --remote-debugging-port=9333`
     (`KAYN_SIM_PROFILE` journalise le temps de chaque appel IPC et les blocages du processus principal) ;
   - collecte simulée : ajouter régulièrement des lignes dans `my_detail` de la copie pendant le parcours.
3. Parcourir chaque onglet ou fenêtre concerné par le changement (pilotage par le protocole DevTools) et prendre des
   captures.
4. Corriger ce qui ne va pas avant de répondre.

## Se relire comme un relecteur exigeant

- Chaque texte affiché correspond à la règle qui le produit (seuils, groupes, libellés).
- Aucun trou entre les règles d'un classement : chaque cas tombe dans un groupe, et un seul.
- Ne jamais comparer des saisons différentes (le jeu change d'une saison à l'autre).
- Pas de conclusion sous 20 parties ; afficher les marges d'erreur.
- Signaler les mesures circulaires ou confondues avec l'issue de la partie.
- Ce qui est annoncé à l'utilisateur correspond à ce que l'appli affiche réellement (vérifié sur l'appli, pas sur
  une valeur arrondie ou un script à part).

## Politique Riot

- Aucune information cachée au joueur.
- Aucune action automatique dans le client ou le jeu.
- Aucun conseil en direct selon l'état de la partie : seulement des données connues avant la partie, ou de
  l'analyse après la partie.

## Sollicitations

Ne solliciter l'utilisateur que pour ce qui ne peut pas être testé soi-même : une vraie draft, une vraie partie, ou
une décision qui lui revient.

## Commits

- Commiter chaque étape validée, pousser la branche, et donner le lien pour ouvrir la PR.
- Ne jamais commiter de données personnelles (Riot ID, clé API, `.env`, base `riot.db`) : le dépôt est public.
