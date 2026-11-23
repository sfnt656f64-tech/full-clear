import { describe, expect, it } from "vitest";
import { acceleratorFromKey, displayAccelerator, isValidAccelerator, type KeyLike } from "../desktop/shortcuts";
import { parseSettings } from "../desktop/settings";

const key = (k: Partial<KeyLike>): KeyLike => ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });

describe("raccourcis", () => {
  it("valide les combinaisons", () => {
    for (const ok of ["CommandOrControl+Shift+K", "Alt+K", "CommandOrControl+Alt+Shift+9", "F8", "Shift+F12", "Alt+num5"]) expect(isValidAccelerator(ok)).toBe(true);
    for (const ko of ["K", "Shift+Shift+K", "Super+K", "CommandOrControl+Shift+Space", "", "CommandOrControl+", "Ctrl+K", 42, null]) expect(isValidAccelerator(ko)).toBe(false);
  });

  it("convertit un appui clavier, AZERTY compris", () => {
    expect(acceleratorFromKey(key({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true }))).toBe("CommandOrControl+Shift+K");
    // AZERTY : la touche à la place du Q américain donne « a ».
    expect(acceleratorFromKey(key({ key: "a", code: "KeyQ", altKey: true }))).toBe("Alt+A");
    // AZERTY : rangée du haut sans Maj → « & », on garde le chiffre.
    expect(acceleratorFromKey(key({ key: "&", code: "Digit1", ctrlKey: true }))).toBe("CommandOrControl+1");
    expect(acceleratorFromKey(key({ key: "5", code: "Numpad5", altKey: true }))).toBe("Alt+num5");
    expect(acceleratorFromKey(key({ key: "F8", code: "F8" }))).toBe("F8");
    expect(acceleratorFromKey(key({ key: "k", code: "KeyK" }))).toBeNull(); // lettre seule : refusée
    expect(acceleratorFromKey(key({ key: " ", code: "Space", ctrlKey: true }))).toBeNull();
    expect(acceleratorFromKey(key({ key: "k", code: "KeyK", metaKey: true }))).toBeNull();
  });

  it("affiche en français", () => {
    expect(displayAccelerator("CommandOrControl+Shift+K")).toBe("Ctrl+Maj+K");
    expect(displayAccelerator("Alt+num5")).toBe("Alt+Pavé num. 5");
  });

  it("champions exclus : Jax, Fiora et Camille par défaut, liste vide respectée", () => {
    expect(parseSettings(null).excludedChampions).toEqual(["Jax", "Fiora", "Camille"]);
    expect(parseSettings('{"excludedChampions":[]}').excludedChampions).toEqual([]);
    expect(parseSettings('{"excludedChampions":["Jax","Jax","Kai Sa",3,"Riven"]}').excludedChampions).toEqual(["Jax", "Riven"]);
    expect(parseSettings('{"excludedChampions":"Jax"}').excludedChampions).toEqual(["Jax", "Fiora", "Camille"]);
  });

  it("garde un raccourci valide des réglages et remplace un raccourci invalide", () => {
    const s = parseSettings('{"shortcuts":{"toggle":"Alt+F9","move":"rm -rf"}}');
    expect(s.shortcuts).toEqual({ toggle: "Alt+F9", move: "CommandOrControl+Shift+L" });
    expect(parseSettings(null).shortcuts).toEqual({ toggle: "CommandOrControl+Shift+K", move: "CommandOrControl+Shift+L" });
  });
});
