// lib/network-tracker/parse-name.ts
//
// Split one "Name" column into { first_name, last_name } for CSV/XLSX import.
// Pure function, unit-tested (parse-name.test.ts) — the import step most likely
// to be subtly wrong. See docs/network-tracker/network-tracker-import.md §4.
//
// Rules, in order:
//   1. Strip a leading title (Dr., Mr., Ms., Mrs., Prof.).
//   2. Strip and RETAIN a trailing suffix (Jr., Sr., II, III, IV, Esq., PhD, JD),
//      appended back onto last_name.
//   3. Everything after the LAST space is last_name; everything before is first_name.
//   4. Preserve verbatim — accents, apostrophes, hyphens. Never ASCII-fold, title-case,
//      or otherwise "clean" a person's name.
// Encoded edge rules (approved):
//   • single-token name  -> all of it in last_name, first_name = "".
//   • non-person / blank  -> first_name = "", last_name = the raw text (trimmed).

const LEADING_TITLES = new Set(["dr", "mr", "ms", "mrs", "prof", "mx"])
// Compared case-INSENSITIVELY but re-emitted verbatim from the source token.
const TRAILING_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "esq", "phd", "jd", "md"])

// Normalise a token for matching: lowercase, drop trailing period/comma.
function norm(tok: string): string {
  return tok.replace(/[.,]+$/, "").toLowerCase()
}

export type SplitName = { first_name: string; last_name: string }

export function splitName(raw: string): SplitName {
  const cleaned = (raw ?? "").trim().replace(/\s+/g, " ")
  if (!cleaned) return { first_name: "", last_name: "" }

  let tokens = cleaned.split(" ")

  // 1. Strip a single leading title.
  if (tokens.length > 1 && LEADING_TITLES.has(norm(tokens[0]))) {
    tokens = tokens.slice(1)
  }

  // 2. Strip and retain a single trailing suffix.
  let suffix = ""
  if (tokens.length > 1 && TRAILING_SUFFIXES.has(norm(tokens[tokens.length - 1]))) {
    suffix = tokens[tokens.length - 1]
    tokens = tokens.slice(0, -1)
  }

  // Single token remaining -> it's the last name (matches the non-person shape).
  if (tokens.length === 1) {
    const last = suffix ? `${tokens[0]} ${suffix}` : tokens[0]
    return { first_name: "", last_name: last }
  }
  // (Title + suffix around nothing, e.g. "Dr. Jr." — degenerate; fall back to raw.)
  if (tokens.length === 0) {
    return { first_name: "", last_name: cleaned }
  }

  // 3. Last token is the surname; everything before is the given name(s).
  const lastToken = tokens[tokens.length - 1]
  const firstName = tokens.slice(0, -1).join(" ")
  const lastName = suffix ? `${lastToken} ${suffix}` : lastToken
  return { first_name: firstName, last_name: lastName }
}

// The display name the tracker uses everywhere: first + last, trimmed. Kept here
// so import previews render exactly what the record/roster will.
export function displayName(first: string, last: string): string {
  return `${first} ${last}`.trim()
}

// Org / inbox hints — a name containing these (or a single token) is treated as
// NOT a person's name (IMPORT.md §5): the raw text goes in last_name, first_name
// stays empty, and it's flagged for the preview. Advisory — the row still imports.
const ORG_HINTS =
  /\b(team|group|inc|llc|ltd|corp|company|dept|department|office|firm|partners|associates|committee|desk|inbox|legal|recruiting|trademark)\b/i

export function looksLikePerson(raw: string): boolean {
  const t = (raw ?? "").trim()
  if (!t) return false
  if (!t.includes(" ")) return false // single token → not a person name (§4/§5 shape)
  return !ORG_HINTS.test(t)
}

// Resolve an imported "Name" cell to {first, last} plus a non-person flag.
// Person → splitName rules; non-person → whole (collapsed) text in last_name.
export function resolveImportedName(raw: string): { first_name: string; last_name: string; nonPerson: boolean } {
  if (looksLikePerson(raw)) return { ...splitName(raw), nonPerson: false }
  return { first_name: "", last_name: (raw ?? "").trim().replace(/\s+/g, " "), nonPerson: true }
}
