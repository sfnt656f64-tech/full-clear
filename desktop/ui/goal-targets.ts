// Champs des cibles d'objectifs (Réglages). Créés une seule fois puis mis à jour sur place : un champ en cours de
// saisie n'est jamais remplacé ni réécrit (sinon, une réponse qui arrive pendant la frappe effaçait la saisie).

export interface TargetItem { key: string; label: string; better: "+" | "-"; unit: string; target: number }

export function syncTargetInputs(container: HTMLElement, items: TargetItem[], onChange: (key: string, value: number | null) => void): void {
  const doc = container.ownerDocument;
  const wanted = new Set(items.map((i) => i.key));
  for (const row of [...container.querySelectorAll<HTMLElement>("label[data-key]")]) if (!wanted.has(row.dataset.key!)) row.remove();
  for (const item of items) {
    let row = container.querySelector<HTMLElement>(`label[data-key="${item.key}"]`);
    if (!row) {
      row = doc.createElement("label");
      row.className = "goal-target small";
      row.dataset.key = item.key;
      const name = doc.createElement("span");
      const sign = doc.createElement("span");
      sign.className = "muted";
      const input = doc.createElement("input");
      input.type = "number";
      input.step = item.unit.trim() === "%" ? "1" : "0.1";
      // Saisie en cours : la valeur affichée ne doit plus être réécrite tant que le champ a le focus.
      input.addEventListener("input", () => { input.dataset.dirty = "1"; });
      input.addEventListener("change", () => {
        const x = input.value.trim() === "" ? null : Number(input.value);
        onChange(item.key, x != null && Number.isFinite(x) ? x : null);
      });
      input.addEventListener("blur", () => { delete input.dataset.dirty; });
      const unit = doc.createElement("span");
      row.append(name, sign, input, unit);
      container.append(row);
    }
    const [name, sign, input, unit] = [...row.children] as [HTMLElement, HTMLElement, HTMLInputElement, HTMLElement];
    name.textContent = item.label;
    sign.textContent = item.better === "-" ? "≤" : "≥";
    unit.textContent = item.unit.trim();
    input.setAttribute("aria-label", `Cible : ${item.label}`);
    const editing = doc.activeElement === input || input.dataset.dirty === "1";
    if (!editing) input.value = String(item.target);
  }
}
