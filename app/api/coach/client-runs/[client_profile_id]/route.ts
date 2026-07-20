// app/api/coach/client-runs/[client_profile_id]/route.ts
//
// Full Coaches Access — Half A, read endpoint.
// GET: returns every SIGNAL run (jobfit / positioning / coverletter /
// networking) for one client, with per-function display fields and this
// coach's private notes attached. Auth mirrors coach/recommend-job.
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"

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

async function verifyCoachAccess(coachProfileId: string, clientProfileId: string, requiredLevel: string, supabase: any) {
  const levels: Record<string, string[]> = { view: ["view", "annotate", "full"], annotate: ["annotate", "full"], full: ["full"] }
  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status")
    .eq("coach_profile_id", coachProfileId)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
    .maybeSingle()
  if (!data) return null
  if (!levels[requiredLevel]?.includes(data.access_level)) return null
  return data
}

// First non-empty line of a body of text, truncated — used for the
// coverletter preview (no title/status is persisted on the run row).
function firstLine(text: unknown, max = 120): string | null {
  if (typeof text !== "string") return null
  const line = text.trim().split(/\r?\n/)[0]?.trim() ?? ""
  if (!line) return null
  return line.length > max ? line.slice(0, max) + "…" : line
}

type RunCard = {
  function_type: string
  run_id: string
  created_at: string
  owner: "coach" | "client"
  display: Record<string, any>
  notes: any[]
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ client_profile_id: string }> }
) {
  try {
    const { client_profile_id: clientProfileId } = await params
    if (!clientProfileId) {
      return withCorsJson(req, { ok: false, error: "client_profile_id is required" }, 400)
    }

    const { userId, email } = await getAuthedUser(req)
    const coachProfileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const isCoach = await verifyCoach(coachProfileId, supabase)
    if (!isCoach) {
      return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)
    }

    // Any active relationship (view/annotate/full) can read; return the
    // access_level so the frontend can gate the note-write UI.
    const access = await verifyCoachAccess(coachProfileId, clientProfileId, "view", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coaching relationship with this client" }, 403)
    }

    const runs: RunCard[] = []

    // ── jobfit_runs (client link: client_profile_id) ──
    {
      const { data, error } = await supabase
        .from("jobfit_runs")
        .select("id, created_at, verdict, result_json, sourced_by_coach_id")
        .eq("client_profile_id", clientProfileId)
      if (error) console.warn("[client-runs] jobfit_runs query failed:", error.message)
      for (const r of (data ?? []) as any[]) {
        const rj: any = r.result_json ?? {}
        const js: any = rj?.job_signals ?? {}
        runs.push({
          function_type: "jobfit",
          run_id: r.id,
          created_at: r.created_at,
          owner: r.sourced_by_coach_id ? "coach" : "client",
          display: {
            verdict: r.verdict ?? null,
            decision: typeof rj?.decision === "string" ? rj.decision : null,
            score: typeof rj?.score === "number" ? rj.score : null,
            jobTitle: typeof js?.jobTitle === "string" ? js.jobTitle : null,
            companyName: typeof js?.companyName === "string" ? js.companyName : null,
            jobFamily: typeof js?.jobFamily === "string" ? js.jobFamily : null,
          },
          notes: [],
        })
      }
    }

    // ── positioning_runs_v2 (client link: profile_id) ──
    {
      const { data, error } = await supabase
        .from("positioning_runs_v2")
        .select("id, created_at, case_assigned, status, current_phase, job_title, job_company")
        .eq("profile_id", clientProfileId)
      if (error) console.warn("[client-runs] positioning_runs_v2 query failed:", error.message)
      for (const r of (data ?? []) as any[]) {
        runs.push({
          function_type: "positioning",
          run_id: r.id,
          created_at: r.created_at,
          owner: "client",
          display: {
            case_assigned: r.case_assigned ?? null,
            status: r.status ?? null,
            current_phase: r.current_phase ?? null,
            job_title: r.job_title ?? null,
            job_company: r.job_company ?? null,
          },
          notes: [],
        })
      }
    }

    // ── coverletter_runs (no job/title/status persisted — preview only) ──
    {
      const { data, error } = await supabase
        .from("coverletter_runs")
        .select("id, created_at, result_json")
        .eq("client_profile_id", clientProfileId)
      if (error) console.warn("[client-runs] coverletter_runs query failed:", error.message)
      for (const r of (data ?? []) as any[]) {
        const rj: any = r.result_json ?? {}
        runs.push({
          function_type: "coverletter",
          run_id: r.id,
          created_at: r.created_at,
          owner: "client",
          display: {
            letter_preview: firstLine(rj?.letter),
            context_used: rj?.context_used ?? null,
          },
          notes: [],
        })
      }
    }

    // ── networking_runs (no job title/company persisted) ──
    {
      const { data, error } = await supabase
        .from("networking_runs")
        .select("id, created_at, result_json")
        .eq("client_profile_id", clientProfileId)
      if (error) console.warn("[client-runs] networking_runs query failed:", error.message)
      for (const r of (data ?? []) as any[]) {
        const rj: any = r.result_json ?? {}
        runs.push({
          function_type: "networking",
          run_id: r.id,
          created_at: r.created_at,
          owner: "client",
          display: {
            application_state: typeof rj?.application_state === "string" ? rj.application_state : null,
            framing: typeof rj?.framing === "string" ? rj.framing : null,
            move_count: Array.isArray(rj?.moves) ? rj.moves.length : 0,
          },
          notes: [],
        })
      }
    }

    // ── Attach this coach's private notes, grouped by (function_type, run_id) ──
    {
      const { data: notes, error } = await supabase
        .from("coach_notes")
        .select("id, function_type, run_id, body, visibility, created_at, updated_at")
        .eq("coach_profile_id", coachProfileId)
        .eq("client_profile_id", clientProfileId)
        .eq("visibility", "coach_private")
      if (error) {
        console.warn("[client-runs] coach_notes query failed:", error.message)
      } else {
        const byRun = new Map<string, any[]>()
        for (const n of (notes ?? []) as any[]) {
          const key = `${n.function_type}:${n.run_id}`
          const arr = byRun.get(key) ?? []
          arr.push(n)
          byRun.set(key, arr)
        }
        for (const run of runs) {
          run.notes = byRun.get(`${run.function_type}:${run.run_id}`) ?? []
        }
      }
    }

    // Newest first across all four functions.
    runs.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))

    return withCorsJson(
      req,
      {
        ok: true,
        client_profile_id: clientProfileId,
        access_level: (access as any).access_level,
        runs,
      },
      200
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[client-runs] Error:", msg)
    const lower = msg.toLowerCase()
    const status = lower.includes("unauthorized") ? 401 : lower.includes("profile not found") ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
