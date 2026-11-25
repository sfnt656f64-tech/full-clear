// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { syncTargetInputs, type TargetItem } from "../desktop/ui/goal-targets";

const items = (deaths = 0.9, cs = 72): TargetItem[] => [
  { key: "deathsBeforeObj", label: "Morts dans la minute avant un objectif adverse", better: "-", unit: "", target: deaths },
  { key: "cs10", label: "CS à 10 min", better: "+", unit: "", target: cs },
];

describe("cibles des objectifs (Réglages)", () => {
  it("modifier une cible envoie la nouvelle valeur, vide = cible par défaut", () => {
    const box = document.createElement("div"); document.body.append(box);
    const onChange = vi.fn();
    syncTargetInputs(box, items(), onChange);
    const input = box.querySelector<HTMLInputElement>('label[data-key="cs10"] input')!;
    input.value = "75"; input.dispatchEvent(new Event("input")); input.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledWith("cs10", 75);
    input.value = ""; input.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith("cs10", null);
  });

  it("bug corrigé : une réponse qui arrive pendant la saisie ne remplace ni n'efface le champ en cours", () => {
    const box = document.createElement("div"); document.body.append(box);
    syncTargetInputs(box, items(), () => {});
    const first = box.querySelector<HTMLInputElement>('label[data-key="deathsBeforeObj"] input')!;
    const second = box.querySelector<HTMLInputElement>('label[data-key="cs10"] input')!;
    // Tu passes au champ suivant et tu tapes pendant que la réponse du premier changement arrive.
    second.focus(); second.value = "7"; second.dispatchEvent(new Event("input"));
    syncTargetInputs(box, items(0.7, 72), () => {});
    expect(box.querySelector('label[data-key="cs10"] input')).toBe(second); // même élément : focus conservé
    expect(document.activeElement).toBe(second);
    expect(second.value).toBe("7"); // saisie conservée
    expect(first.value).toBe("0.7"); // les autres champs suivent la réponse
    // Une fois sorti du champ, la valeur enregistrée reprend le dessus.
    second.blur();
    syncTargetInputs(box, items(0.7, 80), () => {});
    expect(second.value).toBe("80");
  });
});
