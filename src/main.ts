import "./ui/style.css";
import type { Form } from "./data/types";
import { renderBench, renderGold } from "./ui/benchmark";
import { mountDraft, run as runDraft } from "./ui/draft";
import { renderGuides } from "./ui/guides";
import { $ } from "./ui/html";
import { installImageFallback } from "./ui/icons";
import { renderFooter, renderHeader, renderMethod } from "./ui/method";
import { mountSettings, onSettingsChange } from "./ui/settings";
import { mountSimulator, setSimulatorForm, sim } from "./ui/simulator";

let form: Form = "blue";

function setForm(f: Form): void {
  form = f;
  for (const t of document.querySelectorAll<HTMLButtonElement>("#tabs .tab")) {
    const on = t.dataset.form === f;
    t.classList.toggle("on", on);
    t.setAttribute("aria-pressed", String(on));
  }
  renderGuides(f);
  setSimulatorForm(f);
  renderBench(f);
}

installImageFallback();
renderHeader();
mountSettings();
mountDraft();
mountSimulator();
setForm("blue");
renderGold();
renderMethod();
renderFooter();

onSettingsChange(() => {
  runDraft();
  sim();
  renderBench(form);
});

$("tabs").addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-form]");
  if (t) setForm(t.dataset.form as Form);
});
