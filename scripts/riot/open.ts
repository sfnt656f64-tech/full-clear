import { spawn } from "node:child_process";

/** Ouvre une URL ou un fichier dans le navigateur par défaut (Windows, macOS, Linux). */
export function openBrowser(target: string): void {
  // Windows : commande passée telle quelle (sinon cmd découpe ou échappe l'URL). La cible ne contient ni guillemet ni espace
  // problématique : le lien de draft n'utilise que [A-Za-z0-9.~-], et un chemin de fichier est mis entre guillemets.
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", `start "" "${target}"`]]
    : process.platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true, windowsVerbatimArguments: process.platform === "win32" });
  child.on("error", () => console.log("Impossible d'ouvrir le navigateur : ouvre le lien ci-dessus à la main."));
  child.unref();
}
