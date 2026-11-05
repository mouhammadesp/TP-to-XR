/**
 * UploadUI — PDF import: drag-and-drop or click (keyboard accessible),
 * validated before upload (type, size, %PDF- header).
 */
import { PipelineClient } from "../services/PipelineClient";
import { Domain } from "../utils/stateManager";
import { DOMAIN_LABEL } from "./MenuUI";

/**
 * Headset browsers (Pico, Quest): the Android file picker opens as a separate 2D
 * window that the VR shell does not display properly (the browser looks frozen —
 * seen in the Pico 4 Ultra system log: ChooserActivity → documentsui, browser sent
 * to background). There, PDFs are only taken from the PC inbox.
 */
export const IS_HEADSET_BROWSER = /OculusBrowser|PicoBrowser|Quest|PICO/i.test(navigator.userAgent);

export class UploadUI {
  private file: File | null = null;
  /** PDF of the PC inbox selected in the list (alternative to a local file). */
  private inboxName: string | null = null;
  private readonly zone = this.el("dropzone");
  private readonly input = this.el("pdf-input") as HTMLInputElement;
  private readonly error = this.el("upload-error");
  private readonly card = this.el("file-card");
  private readonly submit = this.el("btn-upload") as HTMLButtonElement;

  constructor(onSubmit: (file: File) => void, private readonly onInbox: (name: string) => void) {
    if (IS_HEADSET_BROWSER) {
      this.zone.hidden = true;
      this.el("inbox-title").textContent = "Choisissez le PDF du TP (déposé sur le PC, dossier backend/data/pdf-inbox) :";
    }
    this.zone.addEventListener("click", () => this.openPicker());
    this.zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.input.click();
      }
    });
    this.input.addEventListener("change", () => {
      const f = this.input.files?.[0];
      console.log(`📄 Fichier choisi : ${f ? `${f.name} (${f.type || "type inconnu"}, ${f.size} o)` : "aucun"}`);
      if (f) void this.accept(f);
      this.input.value = ""; // allow re-selecting the same file
    });
    this.input.addEventListener("cancel", () => console.log("📄 Sélecteur de fichiers fermé sans choix"));
    // Drag-and-drop: dragover must preventDefault for drop to fire.
    for (const type of ["dragenter", "dragover"]) {
      this.zone.addEventListener(type, (e) => {
        e.preventDefault();
        this.zone.classList.add("over");
      });
    }
    for (const type of ["dragleave", "dragend"]) {
      this.zone.addEventListener(type, () => this.zone.classList.remove("over"));
    }
    this.zone.addEventListener("drop", (e) => {
      e.preventDefault();
      this.zone.classList.remove("over");
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f) void this.accept(f);
    });
    // A PDF dropped outside the zone must not make the browser navigate away.
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => e.preventDefault());

    // One explicit "Importer" button for both sources (local file or PDF from the PC).
    this.submit.addEventListener("click", () => {
      if (this.file) onSubmit(this.file);
      else if (this.inboxName) this.onInbox(this.inboxName);
    });
    this.el("btn-change-file").addEventListener("click", () => this.openPicker());
  }

  /** Opens the system file picker (logged, so a failure is visible in the headset console). */
  private openPicker(): void {
    console.log("📄 Ouverture du sélecteur de fichiers…");
    try {
      const picker = this.input as HTMLInputElement & { showPicker?: () => void };
      if (picker.showPicker) picker.showPicker();
      else this.input.click();
    } catch (err) {
      console.warn("📄 showPicker refusé, repli sur click()", err);
      this.input.click();
    }
  }

  /** Lists the PDFs dropped on the PC; clicking one starts the pipeline directly. */
  public async renderInbox(files: { name: string; size: number }[]): Promise<void> {
    const list = this.el("inbox-list");
    list.replaceChildren();
    // In a headset this list is the only way to import: always shown, with a hint when empty.
    this.el("inbox-block").hidden = files.length === 0 && !IS_HEADSET_BROWSER;
    if (files.length === 0) {
      list.append(Object.assign(document.createElement("li"), { className: "muted", textContent: "Aucun PDF pour l'instant : déposez le PDF du TP dans backend/data/pdf-inbox sur le PC, puis revenez sur cet écran." }));
    }
    for (const f of files) {
      const btn = document.createElement("button");
      btn.className = "inbox-row";
      btn.append(
        Object.assign(document.createElement("span"), { textContent: `📄 ${f.name}` }),
        Object.assign(document.createElement("span"), { className: "muted", textContent: `${(f.size / 1024).toFixed(0)} Ko` })
      );
      btn.addEventListener("click", () => this.selectInbox(f.name, btn));
      const li = document.createElement("li");
      li.append(btn);
      list.append(li);
    }
  }

  /** Selects a PDF of the PC list (highlighted) and enables "Importer". */
  private selectInbox(name: string, row: HTMLElement): void {
    this.inboxName = name;
    this.file = null;
    this.el("inbox-list").querySelectorAll(".inbox-row").forEach((r) => r.classList.toggle("selected", r === row));
    this.card.hidden = true;
    if (!IS_HEADSET_BROWSER) this.zone.hidden = false;
    this.error.hidden = true;
    this.el("upload-hint").textContent = `Sélectionné : ${name} — cliquez « Importer et préparer l'atelier ».`;
    this.submit.disabled = false;
    this.submit.focus();
  }

  /**
   * Forgets any previous choice (local file or PC PDF): every import starts from an
   * explicit selection. Without this, a PDF selected earlier in the same page stayed
   * selected (not highlighted any more) and "Importer" re-sent it — e.g. the electricity
   * PDF re-imported while the teacher thought the biology one was going.
   */
  public reset(): void {
    this.file = null;
    this.inboxName = null;
    this.input.value = "";
    this.card.hidden = true;
    if (!IS_HEADSET_BROWSER) this.zone.hidden = false;
    this.error.hidden = true;
    this.el("upload-hint").textContent = "Sélectionnez un PDF, puis cliquez « Importer ».";
    this.submit.disabled = true;
  }

  /** Called when entering the upload view. */
  public setDomain(domain: Domain | null): void {
    this.el("upload-domain").textContent = domain ? DOMAIN_LABEL[domain] : "";
  }

  /** The file currently selected (kept when coming back after an error). */
  public get selected(): File | null {
    return this.file;
  }

  private async accept(file: File): Promise<void> {
    const problem = await PipelineClient.validate(file);
    if (problem) {
      this.error.textContent = problem;
      this.error.hidden = false;
      return;
    }
    this.error.hidden = true;
    this.file = file;
    this.el("file-name").textContent = file.name;
    this.el("file-size").textContent = `${(file.size / 1024 / 1024).toFixed(2)} Mo`;
    this.card.hidden = false;
    this.zone.hidden = true;
    this.inboxName = null;
    this.el("inbox-list").querySelectorAll(".inbox-row").forEach((r) => r.classList.remove("selected"));
    this.el("upload-hint").textContent = `Sélectionné : ${file.name} — cliquez « Importer et préparer l'atelier ».`;
    this.submit.disabled = false;
    this.submit.focus();
  }

  private el(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }
}
