import "./ui/style.css";
import type { Form } from "./data/types";
import { renderBench, renderGold } from "./ui/benchmark";
import { mountDraft } from "./ui/draft";
import { renderGuides } from "./ui/guides";
import { $ } from "./ui/html";
import { renderHeader, renderMethod } from "./ui/method";
import { mountSimulator, setSimulatorForm } from "./ui/simulator";

function setForm(f: Form): void {
  for (const t of document.querySelectorAll<HTMLButtonElement>("#tabs .tab")) {
    const on = t.dataset.form === f;
    t.classList.toggle("on", on);
    t.setAttribute("aria-pressed", String(on));
  }
  renderGuides(f);
  setSimulatorForm(f);
  renderBench(f);
}

renderHeader();
mountDraft();
mountSimulator();
setForm("blue");
renderGold();
renderMethod();

$("tabs").addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-form]");
  if (t) setForm(t.dataset.form as Form);
});
