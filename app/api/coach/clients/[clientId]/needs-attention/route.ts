// app/api/coach/clients/[clientId]/needs-attention/route.ts
//
// Phase 2 of the Client Dashboard build. Returns the per-client list of
// open coach action items used by the dashboard's "Needs your attention"
// section.
//
// Pilot scope is coach-authored action items only (heuristic items are
// deferred to post-pilot per SIGNAL PM Item 8). The query filters:
//   - notes.type = 'action_item'
//   - notes.completed_at IS NULL
//   - notes.deleted_at IS NULL
//   - notes.client_profile_id = <clientId>
//   - notes.coach_profile_id = <authenticated coach>
//
// Sort: priority urgent → this_week → when_ready, then created_at DESC
// within each bucket. Sort is JS-side because the existing index sorts
// priority alphabetically (this_week, urgent, when_ready) which is the
// wrong logical order. The index still serves the WHERE clause.
//
// Distinct from /note-feed because the consuming surface has a different
// shape need: dashboard preview list (cap, ordered for triage) vs. full
// chronological feed.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import {
  runHeuristics,
  type HeuristicClient,
} from "../../../../_lib/coachEngagementHeuristics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  this_week: 1,
  when_ready: 2,
}

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

// Phase 3 Commit 3.0: also pulls last_viewed_at, which the engagement-
// signal engine needs for R3-R5 (the "no coach view since" predicate).
async function verifyCoachAccess(coachProfileId: string, clientProfileId: string, requiredLevel: string, supabase: any) {
  const levels: Record<string, string[]> = {
    view: ["view", "annotate", "full"],
    annotate: ["annotate", "full"],
    full: ["full"],
  }
  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status, last_viewed_at")
    .eq("coach_profile_id", coachProfileId)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
    .maybeSingle()
  if (!data) return null
  if (!levels[requiredLevel]?.includes(data.access_level)) return null
  return data
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)

    // 'view' is sufficient for read. Annotate-only and full coaches both
    // see the list. View-only coaches also see it (consistent with the
    // notes feed GET).
    const access = await verifyCoachAccess(profileId, clientProfileId, "view", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    // Action items + engagement signals run in parallel (independent
    // queries). Response shape changed Phase 3 Commit 3.0 from a flat
    // `items` array to two named arrays:
    //   actionItems       coach-authored action item notes (existing)
    //   engagementSignals system-detected R1-R6 signals (new)
    // Sole consumer NeedsAttentionSection.tsx is updated in the same
    // commit. The legacy `items` key is no longer returned.
    const [notesResult, clientProfileResult] = await Promise.all([
      supabase
        .from("coach_client_notes")
        .select("id, body, priority, created_at, completed_at")
        .eq("coach_profile_id", profileId)
        .eq("client_profile_id", clientProfileId)
        .eq("type", "action_item")
        .is("deleted_at", null)
        .is("completed_at", null),
      // For the heuristic engine we need the client's name/email/user_id;
      // last_viewed_at comes from the verifyCoachAccess result above (it
      // already pulled the coach_clients row). One extra query for the
      // profile fields, parallelized with the notes fetch.
      supabase
        .from("client_profiles")
        .select("id, name, email, user_id")
        .eq("id", clientProfileId)
        .maybeSingle(),
    ])

    const { data: notesData, error: notesErr } = notesResult
    if (notesErr) throw new Error(`Needs-attention query failed: ${notesErr.message}`)

    const actionItems = (notesData ?? [])
      .map((r) => ({
        note_id: r.id as string,
        body: r.body as string,
        priority: r.priority as string,
        created_at: r.created_at as string,
        completed_at: r.completed_at as string | null,
      }))
      .sort((a, b) => {
        // priority rank ascending (urgent=0 first), then created_at desc
        const pa = PRIORITY_ORDER[a.priority] ?? 99
        const pb = PRIORITY_ORDER[b.priority] ?? 99
        if (pa !== pb) return pa - pb
        return b.created_at.localeCompare(a.created_at)
      })

    // Build a single-client HeuristicClient and invoke the shared engine.
    // last_viewed_at comes from the access row we already verified.
    const cp = clientProfileResult.data
    const heuristicClients: HeuristicClient[] = cp
      ? [{
          client_profile_id: cp.id as string,
          name: (cp.name as string | null) ?? null,
          email: (cp.email as string | null) ?? null,
          user_id: (cp.user_id as string | null) ?? null,
          last_viewed_at: (access as any).last_viewed_at ?? null,
        }]
      : []
    const engagementSignals = await runHeuristics({
      supabase,
      coachProfileId: profileId,
      clients: heuristicClients,
    })

    return withCorsJson(req, { ok: true, actionItems, engagementSignals })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
