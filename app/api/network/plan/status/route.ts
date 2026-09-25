// app/api/network/plan/status/route.ts
//
// "Where is this client's Networking Plan up to?"
//
// The one question the screens could not previously answer. Plan state lived
// in the import page's React state, so it existed only for as long as the
// coach stayed on that page after an upload: clicking away to look at the
// imported contacts lost it, and Build Networking Plan became unreachable
// without finding and uploading the workbook a second time.
//
// Read-only, and cheap enough to call on every board render.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { errorStatus } from "../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveRequestScope } from "@/lib/collab/scope"
import { resolveDelegation } from "@/lib/collab/delegation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

/** What the status bar renders. One of four states, decided here not in the UI. */
export type PlanStage = "no_source" | "ready_to_build" | "built" | "shared"

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const scope = await resolveRequestScope(req, supabase, { require: "read" })

    const { data: rel } = await supabase
      .from("coach_clients").select("id")
      .in("coach_profile_id", (await resolveDelegation(supabase, scope.actorId)).actingIds)
      .eq("client_profile_id", scope.subjectId)
      .eq("status", "active").maybeSingle()

    // A plan is a coaching artifact. An owner on their own board has no
    // relationship and therefore no plan, which is a state rather than an error.
    if (!rel) {
      return withCorsJson(req, { ok: true, stage: "no_source" as PlanStage, source: null, job: null }, 200)
    }

    const [{ data: source }, { data: jobs }] = await Promise.all([
      supabase.from("networking_plan_sources")
        .select("file_name, source_hash, updated_at").eq("coach_client_id", rel.id).maybeSingle(),
      supabase.from("networking_plan_jobs")
        .select("id, status, step, shared_at, drive_file_url, client_email_sent_at, client_email_sent_count, client_email_to, client_email_error, source_hash, updated_at")
        .eq("coach_client_id", rel.id)
        .order("created_at", { ascending: false }).limit(5),
    ])

    // THE JOB THAT MATTERS IS THE UNSHARED ONE, if there is one. Generating
    // after a share starts a fresh job and leaves the old shared row behind, so
    // "the newest row" and "the one the coach is working on" are not the same
    // thing the moment a rebuild happens.
    const list = jobs ?? []
    const open = list.find((j) => !j.shared_at && j.status === "complete")
    const pending = list.find((j) => !j.shared_at && j.status !== "complete")
    const shared = list.find((j) => j.shared_at)
    const job = open ?? pending ?? shared ?? null

    const stage: PlanStage =
      !source ? "no_source"
      : open ? "built"
      : pending ? "ready_to_build"
      : shared ? "shared"
      : "ready_to_build"

    return withCorsJson(req, {
      ok: true,
      stage,
      source: source
        ? { file_name: source.file_name, updated_at: source.updated_at, hash: source.source_hash }
        : null,
      job: job
        ? {
            id: job.id,
            status: job.status,
            step: job.step,
            shared_at: job.shared_at,
            drive_file_url: job.drive_file_url,
            client_email_sent_at: job.client_email_sent_at,
            client_email_sent_count: job.client_email_sent_count,
            client_email_to: job.client_email_to,
            client_email_error: job.client_email_error,
            // True when the built plan came from a DIFFERENT workbook than the
            // one currently stored, i.e. somebody re-uploaded since. The bar
            // says "Rebuild" louder in that case.
            stale: !!source && job.source_hash !== source.source_hash,
          }
        : null,
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[plan/status]", err?.stack || msg)
    const status = errorStatus(err)
    if (status === 401) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    return withCorsJson(req, { ok: false, error: msg }, status === 403 ? 403 : 500)
  }
}
