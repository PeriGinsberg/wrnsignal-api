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
import { resolveDelegation } from "@/lib/collab/delegation"
import { resolveBriefId } from "@/lib/briefs/resolve"

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

    // THE RELATIONSHIP IS RESOLVED FIRST NOW, because the stored-source path
    // needs it to find the rows and the file path needs it to save them.
    const { data: relEarly } = await supabase
      .from("coach_clients").select("id")
      .in("coach_profile_id", (await resolveDelegation(supabase, scope.actorId)).actingIds)
      .eq("client_profile_id", scope.subjectId)
      .eq("status", "active").maybeSingle()
    if (!relEarly) {
      return withCorsJson(req, { ok: false, error: "A Networking Plan is created by a coach for a client." }, 403)
    }

    const form = await req.formData().catch(() => null)
    const file = (form?.get("file") as File | null) ?? null

    // REBUILD WITHOUT THE FILE. Until now the only moment a plan could be
    // built was the moment of upload, while the workbook was still in the
    // browser. A coach who clicked away to look at the imported contacts could
    // not get back to Build without finding and uploading the file again.
    //
    // With no file, the rows come from the source saved at the last upload.
    let rows: string[][]
    let fileName: string | null = null

    if (!file) {
      const { data: src } = await supabase
        .from("networking_plan_sources").select("rows, file_name, brief_id")
        .eq("coach_client_id", relEarly.id).maybeSingle()
      if (!src) {
        return withCorsJson(req, {
          ok: false,
          error: "No networking list has been uploaded for this client yet.",
        }, 400)
      }
      rows = src.rows as string[][]
      fileName = (src.file_name as string | null) ?? null
    } else {

    const buffer = Buffer.from(await file.arrayBuffer())
    fileName = file.name || "workbook.xlsx"
    const first = await parseFile(buffer, file.name || "workbook.xlsx")
    const sheet =
      (form?.get("sheet") as string | null) ||
      first.sheets.find((s) => s.trim().toLowerCase() === MESSAGES_SHEET)
    if (!sheet) {
      return withCorsJson(req, {
        ok: false,
        error: `That workbook has no "Outreach Messages" tab. Tabs found: ${first.sheets.join(", ") || "none"}.`,
      }, 400)
    }
    const parsed = sheet === first.sheet ? first : await parseFile(buffer, file.name || "workbook.xlsx", sheet)
    rows = dataRows(parsed.grid, detectHeaderRow(parsed.grid))
    if (!rows.length) return withCorsJson(req, { ok: false, error: "That tab has no rows." }, 400)

      // Saved BEFORE the plan runs, so an upload whose build then fails still
      // leaves a source the coach can retry from. Upsert, because one current
      // source per client is the whole model.
      const { error: srcErr } = await supabase.from("networking_plan_sources").upsert({
        coach_client_id: relEarly.id,
        client_profile_id: String(scope.subjectId),
        rows,
        source_hash: sourceHash(rows),
        file_name: fileName,
        // Which campaign this list was uploaded for. Explicit if the screen
        // asked, otherwise the client's most recent open campaign.
        brief_id: await resolveBriefId(supabase, relEarly.id, (form?.get("brief_id") as string | null) ?? null),
        uploaded_by_id: scope.actorId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "coach_client_id" })
      // Logged rather than ignored. An upsert whose error nobody reads is
      // indistinguishable from one that worked, which is how the first cut of
      // the status bar shipped looking fine and storing nothing.
      if (srcErr) console.error("[plan/run] plan source not saved:", srcErr.message)
    }

    // The relationship was resolved at the top; a plan is a coaching artifact,
    // so an owner running this on their own board is refused there.
    const rel = relEarly

    const clientName = (await loadSubjectName(supabase, scope.subjectId)) ?? "Client"
    const job = await findOrCreateJob(supabase, {
      coachClientId: rel.id,
      clientProfileId: String(scope.subjectId),
      createdById: scope.actorId,
      hash: sourceHash(rows),
      // Read again rather than carried from above, because the no-file path
      // never went near that branch and the stored source is where the
      // campaign was recorded at upload time.
      briefId: await resolveBriefId(supabase, rel.id, (form?.get("brief_id") as string | null) ?? null),
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
