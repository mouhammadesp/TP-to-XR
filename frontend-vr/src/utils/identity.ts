/**
 * Student identity for one TP session (pure helpers, unit-tested).
 *
 * Only what the individual report needs: first name, last name and an optional
 * student number. Kept in sessionStorage (this browser tab only, cleared when the
 * tab closes) so the form is pre-filled for the next TP of the same student, and
 * sent with the session results. Never written to the logs: the technical logs
 * keep using the pseudonymous `student_id`.
 */

export interface StudentIdentity {
  first_name: string;
  last_name: string;
  /** Optional student number (matricule). */
  matricule: string | null;
}

export type IdentityField = "first_name" | "last_name" | "matricule";

/** Letters (any script), spaces, hyphens, apostrophes, dots — 1 to 60 characters. */
export const NAME_RE = /^[\p{L}][\p{L}\p{M} .'’-]{0,59}$/u;
/** Letters, digits, and - _ / . — up to 30 characters. */
export const MATRICULE_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,29}$/;

const STORAGE_KEY = "tpxr_identity";

/** Trims and collapses inner whitespace. */
function clean(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Validates the form input.
 * @returns the normalized identity, or the list of invalid fields with a French message
 */
export function validateIdentity(input: { first_name?: unknown; last_name?: unknown; matricule?: unknown }):
  | { ok: true; identity: StudentIdentity }
  | { ok: false; errors: Partial<Record<IdentityField, string>> } {
  const first = clean(input.first_name);
  const last = clean(input.last_name);
  const mat = clean(input.matricule).toUpperCase();
  const errors: Partial<Record<IdentityField, string>> = {};
  if (!first) errors.first_name = "Indiquez votre prénom.";
  else if (!NAME_RE.test(first)) errors.first_name = "Prénom : lettres, espaces, tirets ou apostrophes (60 caractères max).";
  if (!last) errors.last_name = "Indiquez votre nom.";
  else if (!NAME_RE.test(last)) errors.last_name = "Nom : lettres, espaces, tirets ou apostrophes (60 caractères max).";
  if (mat && !MATRICULE_RE.test(mat)) errors.matricule = "Matricule : lettres, chiffres, - _ / . (30 caractères max).";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, identity: { first_name: first, last_name: last.toUpperCase(), matricule: mat || null } };
}

/** "Awa DIOP" (and the matricule in parentheses when present). */
export function displayName(id: StudentIdentity, withMatricule = false): string {
  const name = `${id.first_name} ${id.last_name}`;
  return withMatricule && id.matricule ? `${name} (${id.matricule})` : name;
}

/** Identity of the current tab, or null (also null if storage is unavailable or tampered with). */
export function loadIdentity(storage: Pick<Storage, "getItem"> | null = safeSession()): StudentIdentity | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const r = validateIdentity(JSON.parse(raw) as Record<string, unknown>);
    return r.ok ? r.identity : null;
  } catch {
    return null;
  }
}

export function saveIdentity(id: StudentIdentity, storage: Pick<Storage, "setItem"> | null = safeSession()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(id));
  } catch {
    /* private mode: the identity still goes with this TP through the session */
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
