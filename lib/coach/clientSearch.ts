// lib/coach/clientSearch.ts
//
// The Coaches Dashboard's client search: which of a coach's clients match what
// was typed. Pure, so the rule is testable without a database.
//
// THE RULE. Case-insensitive, at least 2 characters. Every word typed must be
// the start of a word in the client's name: "li" finds Lily Chen, "chen" finds
// her by last name, "lily ch" narrows to her. A match in the middle of a word
// ("ily") does not count, so a short search stays a short list.

export const MIN_QUERY = 2
export const MAX_RESULTS = 8

const words = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9']+/).filter(Boolean)

export function nameMatches(name: string, query: string): boolean {
  const q = words(query)
  if (!q.length || query.trim().length < MIN_QUERY) return false
  const n = words(name)
  return q.every((w) => n.some((part) => part.startsWith(w)))
}

export type SearchHit = { id: string; name: string; href: string }

/** Matching clients, best first: names starting with the query, then A to Z. */
export function searchClients<T extends { name: string }>(rows: T[], query: string, limit = MAX_RESULTS): T[] {
  const q = query.trim().toLowerCase()
  return rows
    .filter((r) => nameMatches(r.name, query))
    .sort((a, b) =>
      Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q))
      || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** The client's existing detail page: by login profile when there is one, else by the relationship. */
export function clientHref(c: { id: string; client_profile_id: string | null }): string {
  return c.client_profile_id
    ? `/dashboard/coach/clients/${c.client_profile_id}`
    : `/dashboard/coach/coach-clients/${c.id}`
}
