/**
 * Texts of the step notifications (pure, unit-tested).
 */

/**
 * Confirmation sentence built from the conditions the validation engine has just
 * checked — so it always describes what the student actually did.
 * e.g. "Étape 1/4 : plaque d'essai sur le poste, batterie dans son logement."
 */
export function confirmationSentence(labels: string[], step?: { index: number; total: number }): string {
  const parts = labels.map((l) => l.trim().replace(/[.;]+$/, "")).filter(Boolean);
  const prefix = step ? `Étape ${step.index + 1}/${step.total} : ` : "";
  if (!parts.length) return `${prefix}toutes les conditions de l'étape sont remplies.`;
  const text = parts.map((p, i) => (i === 0 && !prefix ? p : p.charAt(0).toLowerCase() + p.slice(1))).join(", ");
  return `${prefix}${text}.`;
}
