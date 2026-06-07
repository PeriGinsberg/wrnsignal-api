// app/api/me/documents/route.ts
//
// CLIENT-FACING read of the coached client's SHARED Library documents. This is
// the D2C side — a logged-in client sees only the docs their coach explicitly
// shared. Mirrors the coach-annotations client read in app/api/applications:
// plain-client identity (getBearerToken → getAuthedUser → getProfileId), and the
// privacy filter is the point —
//   .eq("client_profile_id", myProfileId)
//   .eq("visible_to_client", true)
//   .is("deleted_at", null)
//
// NOT coachAuth: no is_coach, no access_level, no resolveCoach. Service-role
// bypasses RLS, so these explicit filters ARE the guard. Read-only — there are
// no client write routes for documents in this slice.
//
// Output is grouped by the coach's document categories (name + sort_order). Only
// categories that have ≥1 visible doc appear; null-category (or inactive/missing
// category) docs land in an "Uncategorized" group, last. The client payload is
// deliberately minimal — { id, title, url } per doc — not the coach-side shape
// (no visible_to_client / sort_order / coach ids / activity_id / timestamps).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string

  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles")
      .select("id, user_id")
      .eq("email", email)
      .maybeSingle()
    if (emailErr) throw new Error(`Profile email lookup failed: ${emailErr.message}`)
    if (byEmail) return byEmail.id as string
  }
  throw new Error("Profile not found")
}

const UNCATEGORIZED_KEY = "__uncategorized__"

type DocRow = { id: string; title: string; url: string; category_id: string | null; sort_order: number }

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // The privacy wall: my docs, shared, not deleted. Nothing else can match.
    const { data: docData, error: docErr } = await supabase
      .from("coach_client_documents")
      .select("id, title, url, category_id, sort_order")
      .eq("client_profile_id", profileId)
      .eq("visible_to_client", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
    if (docErr) throw new Error(`Documents lookup failed: ${docErr.message}`)
    const docs = (docData ?? []) as DocRow[]

    // Resolve category names + order for the categories actually present on the
    // visible docs. Only ACTIVE categories form named groups (matches the coach
    // Library view); anything else → Uncategorized.
    const catIds = [...new Set(docs.map((d) => d.category_id).filter((x): x is string => !!x))]
    const catById = new Map<string, { name: string; sort_order: number }>()
    if (catIds.length > 0) {
      const { data: cats, error: catErr } = await supabase
        .from("coach_document_categories")
        .select("id, name, sort_order")
        .in("id", catIds)
        .eq("active", true)
      if (catErr) throw new Error(`Categories lookup failed: ${catErr.message}`)
      for (const c of (cats ?? []) as { id: string; name: string; sort_order: number }[]) {
        catById.set(c.id, { name: c.name, sort_order: c.sort_order })
      }
    }

    // Bucket docs → groups. Key by category when it's an active category; else
    // Uncategorized. Drop coach-internal fields from the per-doc payload.
    type Group = { category_id: string | null; name: string; sort_order: number; documents: { id: string; title: string; url: string }[] }
    const groups = new Map<string, Group>()
    for (const d of docs) {
      const cat = d.category_id ? catById.get(d.category_id) : undefined
      const key = cat ? (d.category_id as string) : UNCATEGORIZED_KEY
      let g = groups.get(key)
      if (!g) {
        g = cat
          ? { category_id: d.category_id, name: cat.name, sort_order: cat.sort_order, documents: [] }
          : { category_id: null, name: "Uncategorized", sort_order: Number.POSITIVE_INFINITY, documents: [] }
        groups.set(key, g)
      }
      g.documents.push({ id: d.id, title: d.title, url: d.url })
    }

    // Order: category sort_order, then Uncategorized last. Docs already in
    // sort_order from the query (stable within each group).
    const ordered = [...groups.values()].sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    )
    const out = ordered.map((g) => ({ category_id: g.category_id, name: g.name, documents: g.documents }))

    return withCorsJson(req, { ok: true, groups: out })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
