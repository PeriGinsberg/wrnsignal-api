// app/api/coach/clients/route.ts
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
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        const { error: attachErr } = await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
        if (attachErr) throw new Error(`Profile attach failed: ${attachErr.message}`)
      }
      return byEmail.id as string
    }
  }

  throw new Error("Profile not found")
}

async function verifyCoach(profileId: string, supabase: any): Promise<boolean> {
  const { data } = await supabase
    .from("client_profiles")
    .select("is_coach")
    .eq("id", profileId)
    .single()
  return data?.is_coach === true
}

/**
 * Read every row matching an `IN (...)` filter, chunking the id list and paging
 * the results.
 *
 * Same helper and same reasoning as /api/coach/home: PostgREST caps a response
 * at a thousand rows without saying so, and an `.in()` list travels in the query
 * string, so both limits bite hardest on the busiest accounts. `build` is a
 * factory because a Supabase query builder is single-use, and it must set its
 * own `.order()` or the pages will not partition the set.
 */
async function fetchInChunks<T>(ids: string[], build: (chunk: string[]) => any): Promise<T[]> {
  const ID_CHUNK = 200
  const PAGE = 1000
  const out: T[] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(chunk).range(from, from + PAGE - 1)
      if (error) throw new Error(`Batched read failed: ${error.message}`)
      const page = (data ?? []) as T[]
      out.push(...page)
      if (page.length < PAGE) break
    }
  }
  return out
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const isCoach = await verifyCoach(profileId, supabase)
    if (!isCoach) {
      return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)
    }

    // Fetch all active coach-client relationships
    const { data: relationships, error: relErr } = await supabase
      .from("coach_clients")
      .select("id, client_profile_id, invited_email, access_level, status, accepted_at, private_notes")
      .eq("coach_profile_id", profileId)
      .eq("status", "active")

    if (relErr) throw new Error(`Failed to fetch clients: ${relErr.message}`)

    const clientProfileIds = (relationships || [])
      .map((r: any) => r.client_profile_id)
      .filter(Boolean)

    // Fetch client profiles
    let profileMap: Record<string, any> = {}
    if (clientProfileIds.length > 0) {
      const { data: profiles } = await supabase
        .from("client_profiles")
        .select("id, name, email, target_roles, updated_at")
        .in("id", clientProfileIds)
      for (const p of profiles || []) {
        profileMap[p.id] = p
      }
    }

    // Build client list with stats.
    //
    // BATCHED. This used to run two queries per client inside a per-client
    // async function, so a coach with twenty-five clients paid fifty round
    // trips to render the list. It is now two queries whatever the roster size,
    // and the per-client work is pure computation. Same change, same reasoning
    // and the same helper as /api/coach/home.
    type AppRow = { id: string; profile_id: string; application_status: string; created_at: string }
    const appRows =
      clientProfileIds.length === 0
        ? []
        : await fetchInChunks<AppRow>(clientProfileIds, (chunk) =>
            supabase
              .from("signal_applications")
              .select("id, profile_id, application_status, created_at")
              .in("profile_id", chunk)
              .order("id", { ascending: true })
          )
    const appsByClient: Record<string, AppRow[]> = {}
    for (const a of appRows) (appsByClient[a.profile_id] ||= []).push(a)

    type RecRow = { id: string; client_profile_id: string; created_at: string }
    const recRows =
      clientProfileIds.length === 0
        ? []
        : await fetchInChunks<RecRow>(clientProfileIds, (chunk) =>
            supabase
              .from("coach_job_recommendations")
              .select("id, client_profile_id, created_at")
              .in("client_profile_id", chunk)
              .eq("coach_profile_id", profileId)
              .eq("client_status", "new")
              .order("id", { ascending: true })
          )
    const recsByClient: Record<string, RecRow[]> = {}
    for (const r of recRows) (recsByClient[r.client_profile_id] ||= []).push(r)

    const clients = (relationships || []).map((rel: any) => {
        const clientProfileId = rel.client_profile_id
        const profile = clientProfileId ? profileMap[clientProfileId] : null

        let stats = {
          total_applications: 0,
          applied_count: 0,
          interviewing_count: 0,
          offers_count: 0,
          pending_recommendations: 0,
          last_activity_at: null as string | null,
        }

        if (clientProfileId) {
          const apps = appsByClient[clientProfileId] ?? []

          if (apps.length > 0) {
            stats.total_applications = apps.length
            stats.applied_count = apps.filter((a: any) =>
              ["applied", "interviewing", "offer", "rejected", "withdrawn"].includes(a.application_status)
            ).length
            stats.interviewing_count = apps.filter((a: any) => a.application_status === "interviewing").length
            stats.offers_count = apps.filter((a: any) => a.application_status === "offer").length
            // The batched read is ordered by id so its pages partition cleanly,
            // which is not the created_at DESC the per-client query used. Taking
            // the max is what "most recent" meant then and means now, and it no
            // longer depends on the order rows happen to arrive in.
            stats.last_activity_at = apps.reduce<string | null>(
              (latest, a) => (latest === null || a.created_at > latest ? a.created_at : latest),
              null
            )
          }

          // Pending coach recommendations (client_status = 'new' means unseen).
          const recs = recsByClient[clientProfileId] ?? []
          if (recs.length > 0) {
            stats.pending_recommendations = recs.length
            // Also max rather than recs[0]. The old query had no ORDER BY at
            // all, so "the last rec" was whichever row Postgres returned first;
            // the surrounding comment always said "if recs are more recent",
            // and now that is what it does.
            const lastRec = recs.reduce<string | null>(
              (latest, r) => (latest === null || r.created_at > latest ? r.created_at : latest),
              null
            )
            if (lastRec && (!stats.last_activity_at || lastRec > stats.last_activity_at)) {
              stats.last_activity_at = lastRec
            }
          }
        }

        const needs_attention =
          stats.pending_recommendations > 0 ||
          stats.interviewing_count > 0

        return {
          id: rel.id,
          client_profile_id: clientProfileId,
          email: rel.invited_email,
          name: profile?.name || null,
          status: rel.status,
          access_level: rel.access_level,
          accepted_at: rel.accepted_at,
          target_roles: profile?.target_roles || null,
          last_activity_at: stats.last_activity_at,
          stats: {
            applications: stats.total_applications,
            interviewing: stats.interviewing_count,
            pending_recs: stats.pending_recommendations,
            interview_rate: stats.applied_count > 0
              ? Math.round((stats.interviewing_count / stats.applied_count) * 100)
              : 0,
          },
          needs_attention,
        }
      })

    // Sort: needs_attention DESC, last_activity_at DESC
    clients.sort((a, b) => {
      if (a.needs_attention !== b.needs_attention) return a.needs_attention ? -1 : 1
      const aTime = a.last_activity_at || ""
      const bTime = b.last_activity_at || ""
      return bTime.localeCompare(aTime)
    })

    return withCorsJson(req, { ok: true, clients })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
