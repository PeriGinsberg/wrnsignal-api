// app/api/coach/action-items/route.ts
//
// Cross-client list of open coach action item notes for the authenticated
// coach. Backbone of:
//   - /dashboard/coach (Coach Home Action Items section, Item 7)
//   - /dashboard/coach/required-actions (Required Actions tab Action Items
//     section, Item 4 — the action-items half; heuristic half is already
//     served by /api/coach/home)
//
// Pilot scope: coach-authored action items only. Heuristic items remain
// on /api/coach/home (deferred unification per SIGNAL PM Item 8).
//
// Response items include client_id + client_name so consumers can render
// without a join and navigate without a lookup.
//
// Optional ?priorities=urgent,this_week filter so Coach Home (urgent +
// this_week only) and Required Actions tab (all three) can hit the same
// route. No filter = all priorities.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  this_week: 1,
  when_ready: 2,
}
const VALID_PRIORITIES = new Set(["urgent", "this_week", "when_ready"])

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

async function getCoachProfile(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id, name, is_coach, user_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, name, is_coach, user_id")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) return byEmail
  }
  return null
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, email)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 404)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)

    const supabase = getSupabaseAdmin()
    const coachProfileId = coach.id as string

    // Parse ?priorities= filter. Empty / missing = all three priorities.
    // Comma-separated list. Invalid values 400.
    const url = new URL(req.url)
    const prioritiesParam = url.searchParams.get("priorities")
    let priorityFilter: string[] | null = null
    if (prioritiesParam) {
      const requested = prioritiesParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      for (const p of requested) {
        if (!VALID_PRIORITIES.has(p)) {
          return withCorsJson(req, { ok: false, error: `Invalid priority: ${p}` }, 400)
        }
      }
      priorityFilter = requested
    }

    // Fetch notes. Filtering by coach_profile_id alone is sufficient — the
    // RLS policy + service-role read both restrict to this coach's rows,
    // and ownership-by-coach equals ownership of the row. Active scope only
    // (open + not soft-deleted action items).
    let q = supabase
      .from("coach_client_notes")
      .select("id, body, priority, created_at, client_profile_id")
      .eq("coach_profile_id", coachProfileId)
      .eq("type", "action_item")
      .is("completed_at", null)
      .is("deleted_at", null)

    if (priorityFilter && priorityFilter.length > 0) {
      q = q.in("priority", priorityFilter)
    }

    const { data: notes, error: notesErr } = await q
    if (notesErr) throw new Error(`Action items query failed: ${notesErr.message}`)

    // Resolve client names in one batch. Coaches typically have <50
    // clients, and most don't appear in every batch — set ensures one
    // lookup per distinct client.
    const clientIds = Array.from(
      new Set((notes ?? []).map((n) => n.client_profile_id as string).filter(Boolean))
    )
    const nameByClientId = new Map<string, { name: string | null; email: string | null }>()
    if (clientIds.length > 0) {
      const { data: profs, error: profsErr } = await supabase
        .from("client_profiles")
        .select("id, name, email")
        .in("id", clientIds)
      if (profsErr) throw new Error(`Client lookup failed: ${profsErr.message}`)
      for (const p of profs ?? []) {
        nameByClientId.set(p.id as string, { name: p.name as string | null, email: p.email as string | null })
      }
    }

    const items = (notes ?? [])
      .map((n) => {
        const client = nameByClientId.get(n.client_profile_id as string)
        return {
          note_id: n.id as string,
          body: n.body as string,
          priority: n.priority as string,
          created_at: n.created_at as string,
          client_id: n.client_profile_id as string,
          client_name: client?.name ?? null,
          client_email: client?.email ?? null,
        }
      })
      .sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 99
        const pb = PRIORITY_ORDER[b.priority] ?? 99
        if (pa !== pb) return pa - pb
        return b.created_at.localeCompare(a.created_at)
      })

    return withCorsJson(req, { ok: true, items })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
