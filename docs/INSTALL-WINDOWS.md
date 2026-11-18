# Installer Kayn Sim sur Windows (depuis zéro)

Ce guide installe le projet sur ton PC pour utiliser **`npm run stats`** (tes parties) et **`npm run live`**
(ta partie en cours). Le site lui-même n'a besoin d'aucune installation :
https://sfnt656f64-tech.github.io/kayn-sim/

Compte environ 15 minutes. Il te faut Windows 10 ou 11, et ta clé personnelle Riot
(sur https://developer.riotgames.com, dans la page de ton application).

---

## 1. Ouvrir un terminal

Clic droit sur le bouton Démarrer → **Terminal** (ou « Windows PowerShell »).
Toutes les commandes ci-dessous se tapent dans cette fenêtre, puis Entrée.

## 2. Installer Node.js et Git

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Git.Git -e
```

Accepte les conditions si on te le demande (`O` ou `Y`, puis Entrée).

> Sans `winget` : télécharge l'installateur « LTS » sur https://nodejs.org et l'installateur de
> https://git-scm.com/download/win, puis garde les options par défaut.

**Ferme le terminal et rouvre-le** (sinon les nouvelles commandes ne sont pas trouvées), puis vérifie :

```powershell
node -v
npm -v
git --version
```

`node -v` doit afficher **v22.18 ou plus** (par exemple `v24.11.0`). Sinon :
`winget upgrade --id OpenJS.NodeJS.LTS -e`.

> **Si PowerShell répond « l'exécution de scripts est désactivée sur ce système »** à `npm -v` :
>
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```
>
> Réponds `O` (ou `Y`), puis relance `npm -v`. Ce réglage ne concerne que ton compte Windows.

## 3. Télécharger le projet

```powershell
cd $HOME\Documents
git clone https://github.com/sfnt656f64-tech/kayn-sim.git
cd kayn-sim
npm ci
```

Le projet est maintenant dans `Documents\kayn-sim`. `npm ci` installe les dépendances (une minute environ).

## 4. Créer le fichier `.env` (ta clé)

```powershell
Copy-Item .env.example .env
notepad .env
```

Dans le Bloc-notes, remplis les deux lignes, sans espace autour du `=` :

```
RIOT_API_KEY=RGAPI-...ta clé complète...
RIOT_ID=Invincy#TIG
```

Enregistre (**Ctrl+S**) et ferme le Bloc-notes.

- `.env` reste **uniquement sur ton PC** : il est ignoré par git, donc jamais envoyé sur GitHub.
  Pour le vérifier : `git status` ne doit pas le lister.
- Ne colle ta clé nulle part ailleurs (chat, capture d'écran, commit…).
- Si tu régénères ta clé sur le site de Riot, remplace-la dans `.env`.

## 5. Tes parties : `npm run stats`

```powershell
npm run stats
```

- Le **1er lancement** télécharge tes parties Solo/Duo de la saison : quelques minutes (la clé est limitée
  à 100 requêtes toutes les 2 minutes, le script attend tout seul). Tu peux l'interrompre avec **Ctrl+C**
  et le relancer : rien n'est perdu.
- Les lancements suivants ne téléchargent que les nouvelles parties : quelques secondes.
- À la fin, un résumé s'affiche et le rapport s'ouvre dans ton navigateur
  (fichier `Documents\kayn-sim\.cache\riot\rapport.html`).

Options :

```powershell
npm run stats -- --since=2026-09-01   # depuis une date
npm run stats -- --refresh            # retélécharge tout
npm run stats -- --no-open            # n'ouvre pas le rapport
```

## 6. Ta partie en cours : `npm run live`

Lance une partie classée, puis, **une fois l'écran de chargement affiché** :

```powershell
npm run live
```

Le navigateur s'ouvre sur le simulateur de draft déjà rempli : les 5 adversaires en face, tes 4 coéquipiers
dans ton équipe, toi dans la case « Toi ». Le lien ne contient que des noms de champions, jamais ta clé.

Pour ne pas avoir à guetter l'écran de chargement, lance-le **avant** la partie : il vérifie toutes les
30 secondes et s'arrête dès qu'il la trouve.

```powershell
npm run live -- --watch
```

> La sélection des champions n'est pas visible par l'API Riot : la détection marche à partir de l'écran
> de chargement.

## 7. Mettre à jour plus tard

```powershell
cd $HOME\Documents\kayn-sim
git pull
npm ci
```

Ton `.env` et ton cache de parties sont conservés.

---

## Dépannage

| Message | Que faire |
|---|---|
| `node` / `npm` / `git` n'est pas reconnu | Ferme et rouvre le terminal. Sinon, refais l'étape 2. |
| « l'exécution de scripts est désactivée » | Voir l'encadré de l'étape 2 (`Set-ExecutionPolicy`). |
| `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` ou erreur de syntaxe au démarrage | Node trop ancien : `winget upgrade --id OpenJS.NodeJS.LTS -e`, puis rouvre le terminal. |
| « Configuration incomplète » | Le fichier `.env` manque ou est mal rempli (étape 4). Il doit s'appeler exactement `.env`, pas `.env.txt` : `Get-ChildItem -Force .env*` pour vérifier. |
| « Clé API refusée (HTTP 401/403) » | Ta clé a été régénérée ou révoquée : recopie celle du site de Riot dans `.env`. |
| « Compte … introuvable » | Vérifie `RIOT_ID` dans `.env` : `Nom#TAG`, avec le `#`. |
| « Pas de partie en cours » | La partie n'a pas encore atteint l'écran de chargement : relance, ou utilise `--watch`. |
| « Tu joues …, pas Kayn » | Simple avertissement : le simulateur te considère comme Kayn. |
| Le navigateur ne s'ouvre pas | Copie le lien affiché dans le terminal et colle-le dans ton navigateur. |
| Le script semble en pause pendant `npm run stats` | Normal au 1er lancement : il respecte la limite de 100 requêtes / 2 min de la clé. |
