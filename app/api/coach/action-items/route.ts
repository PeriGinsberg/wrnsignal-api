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
      .select("id, body, priority, created_at, client_profile_id, coach_client_id")
      .eq("coach_profile_id", coachProfileId)
      .eq("type", "action_item")
      .is("completed_at", null)
      .is("deleted_at", null)

    if (priorityFilter && priorityFilter.length > 0) {
      q = q.in("priority", priorityFilter)
    }

    const { data: notes, error: notesErr } = await q
    if (notesErr) throw new Error(`Action items query failed: ${notesErr.message}`)

    // Resolve names via coach_clients first (where prospect names live —
    // notes attached to a Prospect-status coach_clients row have NULL
    // client_profile_id, so the legacy client_profiles-only lookup would
    // return null name for those notes). Two-stage lookup:
    //   1. coach_clients by coach_client_id → row name + linked profile id
    //   2. client_profiles by the linked profile id → richer name/email
    // Prefer the client_profiles fields when populated (post-onboarding
    // updates land there); fall back to coach_clients.name +
    // invited_email for prospect notes. Prospects v0.1 Commit 3 / FRD §6.3.
    const coachClientIds = Array.from(
      new Set((notes ?? []).map((n) => n.coach_client_id as string).filter(Boolean))
    )
    const coachClientById = new Map<string, {
      name: string | null
      client_profile_id: string | null
      invited_email: string | null
    }>()
    if (coachClientIds.length > 0) {
      const { data: ccs, error: ccErr } = await supabase
        .from("coach_clients")
        .select("id, name, client_profile_id, invited_email")
        .in("id", coachClientIds)
      if (ccErr) throw new Error(`coach_clients lookup failed: ${ccErr.message}`)
      for (const cc of ccs ?? []) {
        coachClientById.set(cc.id as string, {
          name: (cc.name as string | null) ?? null,
          client_profile_id: (cc.client_profile_id as string | null) ?? null,
          invited_email: (cc.invited_email as string | null) ?? null,
        })
      }
    }

    const profileIds = Array.from(
      new Set(
        Array.from(coachClientById.values())
          .map((cc) => cc.client_profile_id)
          .filter((id): id is string => !!id),
      ),
    )
    const profileById = new Map<string, { name: string | null; email: string | null }>()
    if (profileIds.length > 0) {
      const { data: profs, error: profsErr } = await supabase
        .from("client_profiles")
        .select("id, name, email")
        .in("id", profileIds)
      if (profsErr) throw new Error(`Client lookup failed: ${profsErr.message}`)
      for (const p of profs ?? []) {
        profileById.set(p.id as string, {
          name: (p.name as string | null) ?? null,
          email: (p.email as string | null) ?? null,
        })
      }
    }

    const items = (notes ?? [])
      .map((n) => {
        const cc = coachClientById.get(n.coach_client_id as string)
        const prof = cc?.client_profile_id ? profileById.get(cc.client_profile_id) : null
        const name = prof?.name ?? cc?.name ?? null
        const email = prof?.email ?? cc?.invited_email ?? null
        // TODO Commit 4: frontend must handle nullable client_id
        // (route via coach_client_id instead). See FRD §6.3 + Commit 3
        // runlog entry.
        return {
          note_id: n.id as string,
          body: n.body as string,
          priority: n.priority as string,
          created_at: n.created_at as string,
          client_id: (n.client_profile_id as string | null) ?? null,
          coach_client_id: n.coach_client_id as string,
          client_name: name,
          client_email: email,
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
