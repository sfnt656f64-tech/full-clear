// Vue simple du plan de partie : ce qui s'affiche en draft (30 secondes pour lire) et dans l'overlay (2 secondes).
// Règles : une ligne = une consigne d'action, 12 mots au plus, aucun chiffre technique (sauf une minute de jeu, et la
// valeur → cible de tes rappels en draft), noms dans la langue du client. Les chiffres, marges et la méthode vont dans
// « Détails ». La vue simple n'affirme jamais plus que les détails. Fonctions pures.
import type { OverlayView } from "../next-item.ts";
import { ruleText } from "../next-item.ts";
import type { Strategy } from "./strategy.ts";

export interface PlainItem { id: string; name: string; icon: string }
export interface PlainPlan {
  provisional: boolean;
  retain: string[];
  /** Thème de la semaine (consigne courte), rappelé avant chaque partie. */
  theme: string | null;
  /** Objets adaptés à cette compo : une ligne chacun (pourquoi, contre qui). */
  buildNotes: string[];
  /** Kayn : la forme, en une ligne. */
  form: string | null;
  starter: PlainItem | null;
  build: PlainItem[];
  ifThen: string[];
  reminders: { text: string; value: string | null }[];
  details: { title: string; lines: string[] }[];
}

/** Section de détails : ses lignes, ou une seule ligne « Rien de net ». */
const section = (title: string, lines: (string | null | undefined)[]) => ({ title, lines: lines.filter((x): x is string => !!x).length ? lines.filter((x): x is string => !!x) : ["Rien de net."] });

/** Rappel personnel couvert par le thème de la semaine (pas deux fois la même consigne). */
const THEME_REMINDER: Record<string, string> = { deathBeforeObjective: "deathsBeforeObj", freeObjective: "uncompensatedEarly" };

export function plainPlan(s: Strategy | null, b: OverlayView | null, theme: { key: string; short: string } | null = null, situational: { line: string; detail: string }[] = []): PlainPlan {
  const rules = (b?.rules ?? []).map((r) => ruleText(r));
  // Si… alors… : d'abord ce qui vient de la draft (2 au plus), puis le build, 3 au total.
  const fromDraft = s?.plain.ifThen ?? [];
  const ifThen = [...fromDraft.slice(0, 2), ...rules, ...fromDraft.slice(2)].slice(0, 3);
  const form = b?.source === "kayn" ? (b.form === "blue" ? "Forme bleue : assassin, joue les picks." : "Forme rouge : Rhaast, joue les combats.") : null;
  const details = s ? [
    section("Condition de victoire", [s.winCondition.summary]),
    section("Si… alors… (détail)", s.winCondition.ifThen),
    section("Moments de force", s.ours.marked.length || s.theirs.marked.length ? s.power : []),
    ...(s.plain.demoted.length ? [section("Revient dans la plupart de tes parties", s.plain.demoted)] : []),
    section("Jungler adverse", [s.enemyJungler]),
    section("Premier chemin", s.path),
    section("Objectifs", s.objectives),
    section("Build", b && b.source !== "none" ? [
      b.source === "meta" ? `Build le plus joué en Émeraude+ sur ce champion (${b.buildGames ?? 0} parties), adapté à la draft.` : "Build du modèle de Kayn, adapté à la draft.",
      ...b.reasons.map((r) => `Selon la draft : ${r}.`.replace("..", ".")),
    ] : []),
    section("Rappels (détail)", s.reminders.map((r) => r.text)),
    ...(situational.length ? [section("Objets selon la compo (détail)", situational.map((x) => x.detail))] : []),
  ] : [];
  return {
    provisional: s?.provisional ?? true,
    retain: s?.plain.retain ?? [],
    theme: theme?.short ?? null,
    buildNotes: situational.map((x) => x.line),
    form,
    starter: b?.starter ? { id: b.starter.id, name: b.starter.name, icon: b.starter.icon } : null,
    build: (b?.build ?? []).map((i) => ({ id: i.id, name: i.name, icon: i.icon })),
    ifThen,
    reminders: (s?.reminders ?? []).filter((r) => !theme || THEME_REMINDER[theme.key] !== r.key).map((r) => ({ text: r.short, value: r.value })),
    details,
  };
}

/** Toutes les lignes de la vue principale (pour la vérification des règles d'écriture). */
export function mainLines(p: PlainPlan): { text: string; kind: "line" | "reminder" }[] {
  return [
    ...p.retain.map((text) => ({ text, kind: "line" as const })),
    ...(p.theme ? [{ text: p.theme, kind: "line" as const }] : []),
    ...p.buildNotes.map((text) => ({ text, kind: "line" as const })),
    ...(p.form ? [{ text: p.form, kind: "line" as const }] : []),
    ...p.ifThen.map((text) => ({ text, kind: "line" as const })),
    ...p.reminders.map((r) => ({ text: r.text, kind: "reminder" as const })),
  ];
}
