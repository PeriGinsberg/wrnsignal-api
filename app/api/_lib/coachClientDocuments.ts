// app/api/_lib/coachClientDocuments.ts
//
// Shared building blocks for the Client Library per-client documents API — a
// sub-resource of coach_clients (coach_client_documents). Auth / scoping is
// REUSED from ./coachAuth via ./coachEngagements (bearer → coach profile →
// is_coach), and the relationship ownership guard (isCoachClientOwnedByCoach)
// is the same one the engagement routes use.
//
// SECURITY: coach_client_documents has NO RLS — ownership reaches through
// coach_client_id → coach_clients.coach_profile_id. Routes verify the
// coach_clients row [id] belongs to the authed coach; the [doc_id] routes
// additionally match the doc's coach_client_id to [id] (nested-resource guard).
// A category attached to a doc must be one of THIS coach's own active categories.

import { type SupabaseClient } from "@supabase/supabase-js"

// Reuse the generic coach-route auth/scoping helpers + the relationship guard.
export {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  UUID_RE,
  isCoachClientOwnedByCoach,
} from "./coachEngagements"

export const TITLE_MAX = 200
export const URL_MAX = 2048

// ── Row shape / select / mapper ──
export type DocumentRow = {
  id: string
  coach_client_id: string
  coach_profile_id: string
  client_profile_id: string
  category_id: string | null
  activity_id: string | null
  title: string
  url: string
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export const DOCUMENT_SELECT =
  "id, coach_client_id, coach_profile_id, client_profile_id, category_id, activity_id, title, url, sort_order, created_at, updated_at, deleted_at"

export function toApiDocument(r: DocumentRow) {
  return {
    id: r.id,
    category_id: r.category_id,
    activity_id: r.activity_id,
    title: r.title,
    url: r.url,
    sort_order: r.sort_order,
  }
}

// ── Title validation (trim, required, length cap — the existing idiom) ──
export function validateTitle(raw: unknown): { title: string } | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { error: "title is required" }
  const t = raw.trim()
  if (t.length > TITLE_MAX) return { error: `title too long (max ${TITLE_MAX})` }
  return { title: t }
}

// ── URL validation (reuses the parse-job-url convention) ──
// trim → extract first http(s) URL out of pasted noise → if no protocol,
// prepend https:// (BUT reject an explicit non-http(s) scheme rather than
// mangling it) → new URL() try/catch → http(s)-only whitelist.
export function normalizeUrl(raw: unknown): { url: string } | { error: string } {
  let s = String(raw ?? "").trim()
  if (!s) return { error: "url is required" }

  // Mobile share sheets prepend text; extract the first http(s) URL if present.
  const m = s.match(/https?:\/\/.+/i)
  if (m) s = m[0].trim()

  if (!/^https?:\/\//i.test(s)) {
    // An explicit scheme that isn't http(s) (ftp:, javascript:, mailto:, …) →
    // reject. Otherwise it's a bare host → prepend https:// (mobile copy-paste).
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      return { error: "URL must use http or https" }
    }
    s = `https://${s}`
  }

  let parsed: URL
  try {
    parsed = new URL(s)
  } catch {
    return { error: "Invalid URL format" }
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "URL must use http or https" }
  }
  if (s.length > URL_MAX) return { error: `url too long (max ${URL_MAX})` }
  return { url: s }
}

// ── Relationship fetch (ownership guard + the denormalized ids for insert) ──
// Scoped on coach_profile_id, so a relationship owned by another coach returns
// null → the route maps that to 404. Returns the row's client_profile_id
// (nullable for prospects) so the caller can denormalize it onto the doc.
export async function getOwnedRelationship(
  supabase: SupabaseClient,
  coachProfileId: string,
  coachClientId: string,
): Promise<{ coach_profile_id: string; client_profile_id: string | null } | null> {
  const { data, error } = await supabase
    .from("coach_clients")
    .select("coach_profile_id, client_profile_id")
    .eq("id", coachClientId)
    .eq("coach_profile_id", coachProfileId)
    .maybeSingle()
  if (error) throw new Error(`Ownership check failed: ${error.message}`)
  return (data as { coach_profile_id: string; client_profile_id: string | null } | null) ?? null
}

// ── Category guard: is this one of the coach's OWN active categories? ──
export async function isCategoryOwnedActive(
  supabase: SupabaseClient,
  coachProfileId: string,
  categoryId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("coach_document_categories")
    .select("id")
    .eq("id", categoryId)
    .eq("coach_profile_id", coachProfileId)
    .eq("active", true)
    .maybeSingle()
  if (error) throw new Error(`Category check failed: ${error.message}`)
  return !!data
}

// ── List a relationship's ACTIVE docs, ordered by category sort then doc sort ──
// Uncategorized docs (and any whose category is missing/inactive) sort last.
export async function listApiDocuments(
  supabase: SupabaseClient,
  coachProfileId: string,
  coachClientId: string,
) {
  const { data: docsData, error } = await supabase
    .from("coach_client_documents")
    .select(DOCUMENT_SELECT)
    .eq("coach_client_id", coachClientId)
    .is("deleted_at", null)
  if (error) throw new Error(`Failed to read documents: ${error.message}`)
  const docs = (docsData ?? []) as DocumentRow[]

  // Category sort_order map (this coach's categories) for the primary sort key.
  const { data: catData, error: catErr } = await supabase
    .from("coach_document_categories")
    .select("id, sort_order")
    .eq("coach_profile_id", coachProfileId)
  if (catErr) throw new Error(`Failed to read categories: ${catErr.message}`)
  const catSort = new Map<string, number>()
  for (const c of (catData ?? []) as { id: string; sort_order: number }[]) {
    catSort.set(c.id, c.sort_order)
  }

  const keyFor = (d: DocumentRow) =>
    d.category_id !== null && catSort.has(d.category_id)
      ? (catSort.get(d.category_id) as number)
      : Number.POSITIVE_INFINITY

  docs.sort(
    (a, b) =>
      keyFor(a) - keyFor(b) ||
      a.sort_order - b.sort_order ||
      a.created_at.localeCompare(b.created_at),
  )
  return docs.map(toApiDocument)
}
