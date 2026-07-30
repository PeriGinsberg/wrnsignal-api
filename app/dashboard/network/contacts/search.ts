// Free-text search over the contacts spreadsheet.
//
// Its own module rather than a helper inside page.tsx: a `page.tsx` is a route
// file and should export only route members, so anything the tests need to
// reach directly has to live outside it.
//
// Deliberately NOT searched: additional_info. It is long freeform text, so
// including it would let a stray word in someone's notes surface a contact
// whose name, company and title all look nothing like the query — the match
// would be invisible in the row you get back, which reads as a bug.

import type { Contact } from "./contactModel"

// One haystack per contact, fields joined with a space so a query can span two
// of them ("jane schr" matches across first_name + last_name).
function haystack(c: Contact & { email?: string | null }): string {
  return [c.first_name, c.last_name, c.network_companies?.name, c.title, c.email]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
}

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ")
}

// Case-insensitive partial match. An empty query matches everything, so the
// caller can apply this unconditionally rather than branching around it.
export function matchesQuery(c: Contact & { email?: string | null }, q: string): boolean {
  const needle = normalizeQuery(q)
  if (!needle) return true
  return haystack(c).includes(needle)
}
