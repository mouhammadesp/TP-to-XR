/**
 * In-session HUD helpers (desktop overlay, top-left card).
 */
const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** Sets the HUD status line. */
export function status(text: string): void {
  $("status").textContent = text;
}

/** Appends a warning line to the HUD (DOM-safe). */
export function hudWarn(text: string): void {
  $("warnings").append(Object.assign(document.createElement("div"), { textContent: `⚠ ${text}` }));
}

/** Switches the page between the menu overlay and the in-TP HUD. */
export function setMode(mode: "menu" | "vr"): void {
  document.body.classList.toggle("mode-menu", mode === "menu");
  document.body.classList.toggle("mode-vr", mode === "vr");
}
