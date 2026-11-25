# Installer Kayn Sim sur Windows (depuis zéro)

Ce guide installe le projet sur ton PC pour utiliser **l'application de bureau** (draft et overlay en jeu),
**`npm run stats`** (tes parties) et, en secours, **`npm run live`**. Le site lui-même n'a besoin d'aucune
installation : https://sfnt656f64-tech.github.io/kayn-sim/

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
RIOT_ID=Pseudo#TAG
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

## 6. L'application de bureau (draft et overlay en jeu)

Une petite application Windows, sans terminal, qui vit dans la **zone de notification** (à côté de
l'horloge) :

- **Pendant la sélection des champions**, sa fenêtre s'affiche (sans prendre le clavier au client) et se met
  à jour à chaque pick, allié comme adverse : forme recommandée et page de runes dès le 1er adversaire,
  bottes et build complet à partir de 3.
- **En jeu**, un petit overlay transparent, toujours au premier plan, montre le **prochain item** du build
  d'après ton inventaire et ton or (avec le composant achetable en attendant), ajusté aux items adverses
  (armure, vol de vie, part de dégâts physiques / magiques). Il ne fait que suggérer : rien n'est acheté pour toi.

### Créer l'installeur

Depuis le dossier du projet (étapes 1 à 3) :

```powershell
npm run desktop:dist
```

Le premier lancement télécharge les outils d'empaquetage (quelques minutes). Le résultat est
`release\KaynSim-Setup-<version>.exe`.

### Installer

1. Lance `KaynSim-Setup-<version>.exe`. L'installation se fait pour ton compte seulement (pas besoin d'être
   administrateur), par défaut dans `%LOCALAPPDATA%\Programs\kayn-sim`.
2. L'installeur n'est pas signé : Windows affiche « Windows a protégé votre ordinateur ». Clique sur
   **Informations complémentaires** → **Exécuter quand même**.
3. Copie ton `.env` dans le dossier de l'appli :

   ```powershell
   New-Item -ItemType Directory -Force "$env:APPDATA\kayn-sim" | Out-Null
   Copy-Item "$HOME\Documents\kayn-sim\.env" "$env:APPDATA\kayn-sim\.env"
   ```

   L'appli n'y lit que `RIOT_ID` (pour vérifier que le compte connecté au client est le tien) et, s'il est
   présent, `SITE_URL`. La clé API n'est pas utilisée par l'appli : elle ne parle qu'au client LoL de ton PC.
   Le bouton **Ouvrir le dossier de l'appli** de la fenêtre ouvre ce dossier.
4. Dans l'appli : coche **Lancer au démarrage de Windows** si tu veux qu'elle démarre discrètement à
   l'ouverture de session (aussi dans le menu clic droit de l'icône).

### Régler le jeu

Dans League of Legends : **Options → Vidéo → Mode fenêtre : Sans bordure**. En plein écran, Windows
n'affiche aucune autre fenêtre par-dessus le jeu. La fenêtre de l'appli te prévient si le réglage ne convient pas.

### Utiliser l'overlay

- Il apparaît tout seul au chargement de la partie et disparaît à la fin. Les clics le traversent (ils vont
  au jeu) et il ne prend jamais le clavier.
- **Ctrl+Maj+K** : masquer / afficher (aussi dans le menu clic droit de l'icône).
- **Ctrl+Maj+L** : le déverrouiller (bord orange), le glisser où tu veux, puis **Ctrl+Maj+L** à nouveau pour
  le verrouiller. La position est retenue.
- Les deux raccourcis se changent dans la fenêtre principale. À côté de chacun : **libre** / **actif**, ou
  **déjà pris par une autre appli** (Discord, navigateur…) : choisis alors une autre combinaison.
- **Forme** : « Recommandée (auto) » suit la composition ; tu peux forcer bleu ou rouge.

### Ce que l'appli lit (règles de Riot)

Uniquement les API locales prévues par Riot, qui restent autorisées avec Vanguard : celle du client
(sélection des champions, via le fichier `lockfile`) et celle du jeu (`https://127.0.0.1:2999`, ton or et le
tableau des scores). Aucune injection ni lecture de la mémoire du jeu, et seulement des informations que tu
vois déjà (tes picks, les picks adverses révélés, les items visibles avec Tab). Les pseudos des autres joueurs
ne sont jamais affichés ni enregistrés. Pas de compteurs de sorts adverses, pas d'achat automatique.

### Mettre à jour ou désinstaller

- Mise à jour : après `git pull` et `npm ci` (étape 7), relance `npm run desktop:dist` et installe le nouvel
  installeur par-dessus. Ton `.env` et tes réglages (dans `%APPDATA%\kayn-sim`) sont conservés.
- Désinstallation : Paramètres → Applications → **Kayn Sim** → Désinstaller. Le lancement au démarrage est
  retiré ; le dossier `%APPDATA%\kayn-sim` est conservé (supprime-le à la main si tu veux).

### Pour développer

`npm run desktop` compile et lance l'appli sans l'installer (le terminal reste ouvert ; l'appli lit alors
le `.env` du projet).

## 7. En secours : `npm run live`

> L'application de bureau remplace ce script. Il reste disponible tant qu'elle n'a pas fait ses preuves.

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

## 8. Mettre à jour plus tard

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
| Appli : « Client LoL fermé » alors qu'il est ouvert | Attends 15 s (détection périodique). Si le client est lancé en administrateur, lance aussi l'appli en administrateur, ou plus simplement aucun des deux. |
| Appli : compte « différent du RIOT_ID du .env » | Mets ton Riot ID actuel dans `%APPDATA%\kayn-sim\.env`, puis **Relire le .env**. |
| Appli : l'overlay n'apparaît pas en jeu | Jeu en « Sans bordure » ? Case **Afficher l'overlay** cochée ? Pas masqué par le raccourci (menu de l'icône → Masquer / afficher) ? |
| Appli : un raccourci ne réagit pas | S'il est marqué « déjà pris », change-le dans la fenêtre. Certaines applis (overlays de jeu, macros clavier) captent des touches sans les réserver : essaie une autre combinaison. |
