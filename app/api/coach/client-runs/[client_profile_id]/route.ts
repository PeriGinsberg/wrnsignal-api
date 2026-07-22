// app/api/coach/client-runs/[client_profile_id]/route.ts
//
// Full Coaches Access — Half A, read endpoint.
// GET: returns every SIGNAL run (jobfit / positioning / coverletter /
// networking) for one client, with per-function display fields and this
// coach's private notes attached. Auth mirrors coach/recommend-job.
import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { verifyCoachAccess } from "@/lib/collab/access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Identity ("who is calling" -> { profileId, isCoach }) and the coach-access
// check (coach_clients status='active' + view/annotate/full) are centralized
// in lib/collab. Imported above; the previous inline copies were byte-identical
// to those, so this is a pure centralization refactor with no behavior change.

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

    const { profileId: coachProfileId, isCoach } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()

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
        runs.push({
          function_type: "jobfit",
          run_id: r.id,
          created_at: r.created_at,
          owner: r.sourced_by_coach_id ? "coach" : "client",
          // Full jobfit content, matching the client's own view: GET /api/runs/[id]
          // returns result_json decorated with jobfit_run_id (same as POST /api/jobfit).
          display:
            r.result_json && typeof r.result_json === "object"
              ? { ...(r.result_json as any), jobfit_run_id: r.id }
              : r.result_json,
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
            // Full cover-letter content, matching the client's own view
            // (coverletter_runs.result_json = { letter, contact, context_used }).
            letter: rj?.letter ?? null,
            contact: rj?.contact ?? null,
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
