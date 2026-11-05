/**
 * IdentityUI — "Qui réalise ce TP ?" form (first name, last name, optional
 * student number), shown before each TP launched from the menu. Pre-filled with
 * the identity of this tab, so the same student only confirms.
 */
import { IdentityField, StudentIdentity, loadIdentity, saveIdentity, validateIdentity } from "../utils/identity";

const FIELDS: Record<IdentityField, string> = { first_name: "id-first", last_name: "id-last", matricule: "id-matricule" };

export class IdentityUI {
  private readonly form = document.getElementById("identity-form") as HTMLFormElement;
  private backHandler: () => void = () => undefined;

  constructor(private readonly onDone: (identity: StudentIdentity) => void) {
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submit();
    });
    document.getElementById("identity-back")?.addEventListener("click", () => this.backHandler());
    for (const id of Object.values(FIELDS)) {
      this.input(id).addEventListener("input", () => this.setError(id, null));
    }
  }

  /**
   * Prepares the view.
   * @param tpTitle title of the TP about to open (demo / library), or null (PDF import next)
   * @param onBack where "← Retour" leads
   */
  public prepare(tpTitle: string | null, onBack: () => void): void {
    this.backHandler = onBack;
    const saved = loadIdentity();
    this.input(FIELDS.first_name).value = saved?.first_name ?? "";
    this.input(FIELDS.last_name).value = saved?.last_name ?? "";
    this.input(FIELDS.matricule).value = saved?.matricule ?? "";
    for (const id of Object.values(FIELDS)) this.setError(id, null);
    (document.getElementById("identity-tp") as HTMLElement).textContent = tpTitle ? `TP : ${tpTitle}` : "";
    (document.getElementById("btn-identity") as HTMLButtonElement).textContent = tpTitle ? "Commencer le TP →" : "Continuer →";
  }

  private submit(): void {
    const r = validateIdentity({
      first_name: this.input(FIELDS.first_name).value,
      last_name: this.input(FIELDS.last_name).value,
      matricule: this.input(FIELDS.matricule).value,
    });
    if (!r.ok) {
      let first: HTMLInputElement | null = null;
      for (const [field, id] of Object.entries(FIELDS) as [IdentityField, string][]) {
        this.setError(id, r.errors[field] ?? null);
        if (r.errors[field] && !first) first = this.input(id);
      }
      first?.focus();
      return;
    }
    saveIdentity(r.identity);
    this.onDone(r.identity);
  }

  private setError(inputId: string, message: string | null): void {
    const err = document.getElementById(`${inputId}-err`) as HTMLElement;
    err.textContent = message ?? "";
    err.hidden = !message;
    this.input(inputId).setAttribute("aria-invalid", message ? "true" : "false");
  }

  private input(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
  }
}
