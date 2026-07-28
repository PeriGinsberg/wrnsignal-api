// lib/network-tracker/import-fields.ts
// The import target fields + header synonym matching. Pure and dependency-free
// so BOTH the server parser (import-parse.ts) and the client mapping UI can use
// it. See docs/network-tracker/network-tracker-import.md §3.

export type ImportField =
  | "name" | "first_name" | "last_name" | "company" | "title" | "email"
  | "linkedin_url" | "company_domain" | "segment" | "priority" | "relationship" | "additional_info"

// Order + labels for the mapping dropdown.
export const IMPORT_FIELDS: { field: ImportField; label: string }[] = [
  { field: "name", label: "Name (one column)" },
  { field: "first_name", label: "First name" },
  { field: "last_name", label: "Last name" },
  { field: "company", label: "Company" },
  { field: "title", label: "Title" },
  { field: "email", label: "Email" },
  { field: "linkedin_url", label: "LinkedIn URL" },
  { field: "company_domain", label: "Company domain" },
  { field: "segment", label: "Segment" },
  { field: "priority", label: "Priority (A/B/C)" },
  { field: "relationship", label: "Relationship" },
  { field: "additional_info", label: "Additional info" },
]

// Header synonyms (§3) — a starting set, not exhaustive. Matched on normalised text.
const SYNONYMS: { field: ImportField; terms: string[] }[] = [
  { field: "name", terms: ["name", "contact", "contact name", "full name", "person"] },
  { field: "first_name", terms: ["first", "first name", "fname", "given name"] },
  { field: "last_name", terms: ["last", "last name", "lname", "surname", "family name"] },
  { field: "company", terms: ["company", "firm", "employer", "organisation", "organization", "account"] },
  { field: "title", terms: ["title", "job title", "role", "position"] },
  { field: "email", terms: ["email", "e-mail", "email address", "contact method"] },
  { field: "linkedin_url", terms: ["linkedin", "linkedin url", "li", "profile"] },
  { field: "company_domain", terms: ["domain", "website", "url", "company url"] },
  { field: "segment", terms: ["segment", "list", "source list", "category"] },
  { field: "priority", terms: ["priority", "rank", "tier"] },
  { field: "relationship", terms: ["relationship", "type", "connection", "warmth"] },
  { field: "additional_info", terms: ["personalization", "personalisation", "opener", "hook", "why", "angle", "additional info", "notes about", "personalization sentence"] },
]

// lowercase, collapse punctuation/spacing to single spaces.
export function normalizeHeader(h: string): string {
  return (h ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

// Guess a field for each header. Exact normalised match wins; else null (don't import).
export function guessMapping(headers: string[]): (ImportField | null)[] {
  const table = SYNONYMS.map((s) => ({ field: s.field, terms: s.terms.map(normalizeHeader) }))
  const used = new Set<ImportField>()
  return headers.map((h) => {
    const n = normalizeHeader(h)
    if (!n) return null
    // Exact match first, preferring a field not already claimed by an earlier column.
    let hit: ImportField | null = null
    for (const t of table) {
      if (t.terms.includes(n)) { hit = t.field; if (!used.has(t.field)) break }
    }
    if (hit) { used.add(hit); return hit }
    return null
  })
}
