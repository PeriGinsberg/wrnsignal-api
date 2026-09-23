// app/api/network/plan/run/route.ts
// POST the workbook (multipart) + the client it is for: generate the Networking
// Plan PDF, put it in the client's Drive folder, and file it in their library
// HIDDEN. Safe to call again; see lib/networking-plan/job.ts for why each step
// is idempotent.
//
// Same authority as the importer, because it is the same act by the same
// person: resolveRequestScope with require "write", which is `full`, so `view`
// and `annotate` coaches are refused. The board written to is the branded
// subjectId, never a raw id off the request.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { errorStatus } from "../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { createdBy, resolveRequestScope } from "@/lib/collab/scope"
import { parseFile, detectHeaderRow, dataRows } from "@/lib/network-tracker/import-parse"
import { loadSubjectName } from "@/lib/network-tracker/import-load"
import { findOrCreateJob, runPlanJob, sourceHash } from "@/lib/networking-plan/job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Chromium plus an upload does not fit in the 30-60s the other network routes
// use. This is the one route in the tracker that needs the long ceiling.
export const maxDuration = 300

const MESSAGES_SHEET = "outreach messages"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const scope = await resolveRequestScope(req, supabase, { require: "write" })

    const form = await req.formData()
    const file = form.get("file") as File | null
    if (!file) return withCorsJson(req, { ok: false, error: "No file uploaded." }, 400)

    const buffer = Buffer.from(await file.arrayBuffer())
    const first = await parseFile(buffer, file.name || "workbook.xlsx")
    const sheet =
      (form.get("sheet") as string | null) ||
      first.sheets.find((s) => s.trim().toLowerCase() === MESSAGES_SHEET)
    if (!sheet) {
      return withCorsJson(req, {
        ok: false,
        error: `That workbook has no "Outreach Messages" tab. Tabs found: ${first.sheets.join(", ") || "none"}.`,
      }, 400)
    }
    const parsed = sheet === first.sheet ? first : await parseFile(buffer, file.name || "workbook.xlsx", sheet)
    const rows = dataRows(parsed.grid, detectHeaderRow(parsed.grid))
    if (!rows.length) return withCorsJson(req, { ok: false, error: "That tab has no rows." }, 400)

    // The relationship this plan belongs to. A coach acting on a client always
    // has one; an owner running this on their own board does not, and the plan
    // is a coaching artifact, so that is refused rather than half-supported.
    const { data: rel } = await supabase
      .from("coach_clients").select("id")
      .eq("coach_profile_id", scope.actorId).eq("client_profile_id", scope.subjectId)
      .eq("status", "active").maybeSingle()
    if (!rel) {
      return withCorsJson(req, { ok: false, error: "A Networking Plan is created by a coach for a client." }, 403)
    }

    const clientName = (await loadSubjectName(supabase, scope.subjectId)) ?? "Client"
    const job = await findOrCreateJob(supabase, {
      coachClientId: rel.id,
      clientProfileId: String(scope.subjectId),
      createdById: scope.actorId,
      hash: sourceHash(rows),
    })

    const done = await runPlanJob(supabase, {
      job,
      rows,
      clientName,
      attribution: createdBy(scope) as { created_by_role: "client" | "coach"; created_by_id: string },
    })

    return withCorsJson(req, {
      ok: true,
      job: {
        id: done.id,
        status: done.status,
        step: done.step,
        drive_file_url: done.drive_file_url,
        document_id: done.document_id,
        shared_at: done.shared_at,
      },
      client: { id: String(scope.subjectId), name: clientName },
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[plan/run]", err?.stack || msg)
    const status = errorStatus(err)
    if (status === 401) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    if (status === 403) return withCorsJson(req, { ok: false, error: "You do not have full access to that client's board." }, 403)
    // The job row holds what succeeded, so the honest message is that it can be
    // run again rather than that everything must be redone.
    return withCorsJson(req, { ok: false, error: `${msg} You can run it again; finished steps are not repeated.` }, 500)
  }
}
