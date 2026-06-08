// app/api/me/activities/route.ts
//
// CLIENT-FACING read of the coached client's OWN engagement activities — the
// things they're responsible for (owner 'client' or 'both'). Mirrors
// /api/me/documents: plain-client identity (getBearerToken → getAuthedUser →
// getProfileId), then the Slice-1 coached gate (getActiveCoachRelationship), then
// a scoped walk down the engagement chain. NOT coachAuth (no is_coach / no
// resolveCoach / no access_level). Service-role bypasses RLS, so the explicit
// scoping (active relationship id + owner filter) IS the guard.
//
// A relationship can hold MULTIPLE engagements (no unique on coach_client_id;
// the coach can attach several packages), and there is no "live" flag on an
// engagement. To avoid hiding anything the client owns, this returns client/both
// activities across ALL of the active relationship's engagements, grouped by
// DELIVERABLE. owner='coach' activities are filtered out. Read-only.
//
// Minimal per-activity payload — { id, name, status, owner } — never source_*_id,
// pricing/fee, or any engagement/coach internals.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getActiveCoachRelationship } from "../../_lib/coachedClient"

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

type DelivRow = { id: string; name: string; sort_order: number; created_at: string }
type ActRow = {
  id: string
  name: string
  status: string
  owner: string
  sort_order: number
  created_at: string
  engagement_deliverable_id: string
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const empty = () => withCorsJson(req, { ok: true, groups: [] })

    // The gate: my ACTIVE coach relationship (null if none / paused / revoked /
    // pending). No active coach → nothing to show (empty, not an error).
    const rel = await getActiveCoachRelationship(supabase, profileId)
    if (!rel) return empty()

    // All engagements on this relationship.
    const { data: engData, error: engErr } = await supabase
      .from("coach_client_engagements")
      .select("id")
      .eq("coach_client_id", rel.id)
    if (engErr) throw new Error(`Engagements lookup failed: ${engErr.message}`)
    const engIds = (engData ?? []).map((e: { id: string }) => e.id)
    if (engIds.length === 0) return empty()

    // Their deliverables (group headers + order).
    const { data: delivData, error: delivErr } = await supabase
      .from("coach_client_engagement_deliverables")
      .select("id, name, sort_order, created_at")
      .in("engagement_id", engIds)
    if (delivErr) throw new Error(`Deliverables lookup failed: ${delivErr.message}`)
    const delivs = (delivData ?? []) as DelivRow[]
    if (delivs.length === 0) return empty()
    const delivById = new Map(delivs.map((d) => [d.id, d]))

    // Activities the client owns ('client' or 'both') — the owner filter is the
    // line between "mine to do" and the coach's own steps.
    const { data: actData, error: actErr } = await supabase
      .from("coach_client_engagement_activities")
      .select("id, name, status, owner, sort_order, created_at, engagement_deliverable_id")
      .in("engagement_deliverable_id", [...delivById.keys()])
      .in("owner", ["client", "both"])
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
    if (actErr) throw new Error(`Activities lookup failed: ${actErr.message}`)
    const acts = (actData ?? []) as ActRow[]

    // Group by deliverable — only deliverables that have ≥1 owned activity appear.
    type Group = { deliverable_id: string; name: string; sort_order: number; created_at: string; activities: { id: string; name: string; status: string; owner: string }[] }
    const groups = new Map<string, Group>()
    for (const a of acts) {
      const d = delivById.get(a.engagement_deliverable_id)
      if (!d) continue
      let g = groups.get(d.id)
      if (!g) {
        g = { deliverable_id: d.id, name: d.name, sort_order: d.sort_order, created_at: d.created_at, activities: [] }
        groups.set(d.id, g)
      }
      g.activities.push({ id: a.id, name: a.name, status: a.status, owner: a.owner })
    }

    // Order groups by deliverable sort_order, then created_at as a stable
    // tiebreaker (across engagements). Activities are already query-ordered.
    const out = [...groups.values()]
      .sort((x, y) => x.sort_order - y.sort_order || x.created_at.localeCompare(y.created_at))
      .map((g) => ({ deliverable_id: g.deliverable_id, name: g.name, activities: g.activities }))

    return withCorsJson(req, { ok: true, groups: out })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
