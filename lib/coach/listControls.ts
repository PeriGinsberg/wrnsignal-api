// lib/coach/listControls.ts
//
// Search, sort and filter for the people lists: My Clients today, My Prospects
// next, and whatever roster comes after.
//
// WHY THIS IS SHARED RATHER THAN WRITTEN TWICE. Two rosters that sort
// differently are two rosters a coach has to learn separately, and the second
// one always ends up with the first one's bugs plus its own. The behaviour
// lives here; each page supplies its rows and its status vocabulary.
//
// BUILT SO AN ENGAGEMENT-PHASE FILTER CAN BE ADDED WITHOUT TOUCHING THE PAGES.
// A filter is a named predicate over a row, and the control renders whatever
// list of them it is given. Adding "phase" later means adding a second
// FilterGroup, not rewriting the sort or the search.

/** A sort the coach can pick. `key` is what lives in the URL and in state. */
export type SortKey = "name_asc" | "name_desc" | "newest" | "oldest"

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  // ALPHABETICAL IS FIRST AND IS THE DEFAULT. A roster's job is to let somebody
  // find a person they are already thinking about, and "where is Marco" has one
  // answer under A to Z and no answer under "most recently active".
  { key: "name_asc", label: "A to Z" },
  { key: "name_desc", label: "Z to A" },
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
]

export const DEFAULT_SORT: SortKey = "name_asc"

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && SORT_OPTIONS.some((o) => o.key === v)
}

/** The fields a list row must expose to be sortable and searchable. */
export type ListRow = {
  name: string | null
  email: string | null
  /** When this person arrived. Anything Date can parse, or null. */
  created_at?: string | null
}

/**
 * Name, then email, then nothing.
 *
 * A row with no name sorts by whatever it can be identified by rather than
 * collapsing to the top as an empty string: an unnamed invite is still a
 * person somebody is looking for.
 */
function sortable(r: ListRow): string {
  return ((r.name && r.name.trim()) || (r.email && r.email.trim()) || "").toLowerCase()
}

/**
 * Case-insensitive, accent-aware, and numeric-aware, which matters more than
 * it sounds: a plain < comparison puts "Zoe" before "alex" and "Client 10"
 * before "Client 9".
 */
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true })

function arrivedAt(r: ListRow): number {
  if (!r.created_at) return 0
  const t = new Date(r.created_at).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function sortRows<T extends ListRow>(rows: T[], key: SortKey): T[] {
  const out = [...rows]
  switch (key) {
    case "name_asc":
      return out.sort((a, b) => collator.compare(sortable(a), sortable(b)))
    case "name_desc":
      return out.sort((a, b) => collator.compare(sortable(b), sortable(a)))
    // A row with no date sorts last under both, not first under one of them:
    // "unknown" is not "oldest", and it is certainly not "newest".
    case "newest":
      return out.sort((a, b) => (arrivedAt(b) || -Infinity) - (arrivedAt(a) || -Infinity))
    case "oldest":
      return out.sort((a, b) => (arrivedAt(a) || Infinity) - (arrivedAt(b) || Infinity))
  }
}

/**
 * Match on name OR email.
 *
 * Whitespace-tolerant and case-insensitive. Every term must match somewhere,
 * so "marco gar" finds Marco Garcia and "marco lily" finds nobody, which is
 * what a person typing two words means.
 */
export function matchesSearch(r: ListRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = `${r.name ?? ""} ${r.email ?? ""}`.toLowerCase()
  return q.split(/\s+/).every((term) => haystack.includes(term))
}

/**
 * One group of mutually exclusive filters, rendered as a segmented control.
 *
 * `values` is the vocabulary (the statuses this list has), `all` is the label
 * for "no filter". A second group slots in beside the first when engagement
 * phase arrives: the page renders an array of these, and neither the sort nor
 * the search needs to know.
 */
export type FilterGroup<V extends string = string> = {
  id: string
  /** Shown above the control. */
  label: string
  values: V[]
  /** The option meaning "everything in this group". */
  all: string
  /** Selected on first load. */
  initial: V | string
  /** Answers "does this row pass". */
  matches: (row: any, selected: string) => boolean
}

/** Apply search, every filter group, and the sort, in that order. */
export function applyListControls<T extends ListRow>(
  rows: T[],
  opts: {
    search: string
    sort: SortKey
    groups: FilterGroup[]
    selected: Record<string, string>
  },
): T[] {
  let out = rows.filter((r) => matchesSearch(r, opts.search))
  for (const g of opts.groups) {
    const sel = opts.selected[g.id] ?? g.initial
    if (sel === g.all) continue
    out = out.filter((r) => g.matches(r, sel))
  }
  return sortRows(out, opts.sort)
}
