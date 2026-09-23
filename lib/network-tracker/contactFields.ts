// lib/network-tracker/contactFields.ts
// Validation for the identity fields on a networking contact: the name, the
// title, and the three ways to reach a person. Pure, so the rules can be tested
// without a database and the route stays about authorization and persistence.
//
// Everything here follows one principle: store what the user typed, correct
// only what is unambiguous, and refuse only what cannot be stored honestly.
// A phone number is free text because "+1 (312) 555-0148 x22" is a real thing
// people type; an email is checked because a malformed one silently breaks the
// dedupe that the import and this editor both rely on.

export type FieldError = { field: string; message: string }

const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "")

/** Empty string clears the column; anything else is stored as typed. */
export function cleanOptional(v: unknown): string | null {
  const s = trim(v)
  return s ? s : null
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

/**
 * An email, or null to clear it. Rejected rather than silently dropped: this
 * editor is where someone fixes a wrong address, so "it didn't save" has to be
 * visible.
 */
export function normalizeEmail(raw: unknown): { value: string | null } | { error: string } {
  const s = trim(raw)
  if (!s) return { value: null }
  if (!isEmail(s)) return { error: "That email address doesn't look right." }
  return { value: s }
}

/**
 * A LinkedIn URL, or null to clear it. A bare "linkedin.com/in/jane" gets https://
 * because that is unambiguous; anything that is not http(s) is refused, because a
 * javascript: or data: URL in a field the UI renders as a link is how a contact
 * record becomes an attack.
 */
export function normalizeLinkedInUrl(raw: unknown): { value: string | null } | { error: string } {
  let s = trim(raw)
  if (!s) return { value: null }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`
  let parsed: URL
  try {
    parsed = new URL(s)
  } catch {
    return { error: "That LinkedIn URL doesn't look right." }
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "A LinkedIn URL has to start with http:// or https://." }
  }
  if (s.length > 2048) return { error: "That LinkedIn URL is too long." }
  return { value: s }
}

/**
 * A phone number, or null to clear it. Deliberately permissive: extensions,
 * country codes, and punctuation all survive. The only rule is that it contains
 * enough digits to be a number at all, so a stray word does not land in a field
 * the UI offers to dial.
 */
export function normalizePhone(raw: unknown): { value: string | null } | { error: string } {
  const s = trim(raw)
  if (!s) return { value: null }
  if (s.length > 40) return { error: "That phone number is too long." }
  const digits = s.replace(/\D/g, "")
  if (digits.length < 7) return { error: "That phone number doesn't look right." }
  return { value: s }
}

/** A person needs something to be called. Either part may be blank, not both. */
export function validateName(first: string | null, last: string | null): string | null {
  if (!((first ?? "").trim() || (last ?? "").trim())) return "A contact needs a first or last name."
  return null
}

export const NAME_MAX = 120
export const TITLE_MAX = 200

export function validateLength(value: string | null, max: number, label: string): string | null {
  if (value && value.length > max) return `${label} is too long.`
  return null
}
