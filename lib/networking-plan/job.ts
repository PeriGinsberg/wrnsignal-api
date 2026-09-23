// lib/networking-plan/job.ts
// The Networking Plan delivery job: generate, upload, file, and later share.
//
// Every step is idempotent, because the job spans two external systems and two
// databases with no transaction across them. A half-finished run is normal, and
// the fix for a half-finished run is to run it again:
//
//   generate  pure, so a retry just recomputes
//   upload    keyed by drive_file_id (and by an appProperties stamp before that
//             id exists), so a retry updates the same file instead of making a
//             second one
//   file      keyed by document_id, so a retry cannot file the plan twice
//   share     the permission is created BEFORE visible_to_client flips, so the
//             failure mode is "not visible yet" rather than "visible but 403"
//
// See docs/Features/networking-plan-delivery-frd.md.

import { createHash } from "node:crypto"
import { type SupabaseClient } from "@supabase/supabase-js"
import {
  DriveError,
  createPdf,
  ensureChildFolder,
  findByJobId,
  getFile,
  anyoneLinkPermission,
  isSharingBlocked,
  isViewerOrHigher,
  shareAnyoneWithLink,
  updatePdf,
  verifyFolder,
} from "@/lib/drive/client"
import { driveFileUrl } from "@/lib/drive/folderUrl"
import { buildPlanContent } from "./planData"
import { renderPlanHtml } from "./render"
import { htmlToPdf } from "./pdf"

export type PlanJob = {
  id: string
  coach_client_id: string
  client_profile_id: string
  status: string
  step: string
  drive_file_id: string | null
  drive_file_url: string | null
  document_id: string | null
  shared_at: string | null
  drive_permission_id: string | null
  error: string | null
  attempts: number
}

const PLAN_TITLE = (clientName: string) => `${clientName} - Networking Plan`
const FILE_NAME = (clientName: string) => `${PLAN_TITLE(clientName)}.pdf`

/** The same workbook for the same client is the same job. */
export function sourceHash(rows: string[][]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex")
}

/**
 * Where this client's plan goes. Prefers the folder someone wired up; otherwise
 * creates `<clients root>/<Client Name>/Networking` and REMEMBERS it, so the
 * convention is applied exactly once and every later run uses the id.
 */
export async function resolveFolder(
  supabase: SupabaseClient,
  coachClientId: string,
  clientName: string,
): Promise<{ id: string } | { error: string }> {
  const { data: rel } = await supabase
    .from("coach_clients").select("drive_folder_id").eq("id", coachClientId).maybeSingle()

  if (rel?.drive_folder_id) {
    const v = await verifyFolder(rel.drive_folder_id)
    // A folder that has been moved or trashed since it was wired up is worth
    // saying plainly rather than silently creating a replacement somewhere else.
    return v.ok ? { id: rel.drive_folder_id } : { error: v.error }
  }

  const root = process.env.GOOGLE_DRIVE_CLIENTS_ROOT_ID
  if (!root) return { error: "No Drive folder is set for this client, and GOOGLE_DRIVE_CLIENTS_ROOT_ID is not configured." }
  const clientFolder = await ensureChildFolder(root, clientName)
  const networking = await ensureChildFolder(clientFolder.id, "Networking")
  await supabase
    .from("coach_clients")
    .update({ drive_folder_id: networking.id, drive_folder_url: `https://drive.google.com/drive/folders/${networking.id}` })
    .eq("id", coachClientId)
  return { id: networking.id }
}

/** Find the job for this workbook, or start one. */
export async function findOrCreateJob(
  supabase: SupabaseClient,
  args: { coachClientId: string; clientProfileId: string; createdById: string; hash: string },
): Promise<PlanJob> {
  const { data: existing } = await supabase
    .from("networking_plan_jobs").select("*")
    .eq("coach_client_id", args.coachClientId).eq("source_hash", args.hash).maybeSingle()
  if (existing) return existing as PlanJob

  const { data, error } = await supabase.from("networking_plan_jobs").insert({
    coach_client_id: args.coachClientId,
    client_profile_id: args.clientProfileId,
    created_by_id: args.createdById,
    source_hash: args.hash,
    status: "pending",
  }).select("*").single()
  if (error) {
    // Two clicks landing together: the loser of the unique index re-reads.
    if ((error as any).code === "23505") {
      const { data: again } = await supabase
        .from("networking_plan_jobs").select("*")
        .eq("coach_client_id", args.coachClientId).eq("source_hash", args.hash).single()
      return again as PlanJob
    }
    throw new Error(`Could not start the plan job: ${error.message}`)
  }
  return data as PlanJob
}

/**
 * Run (or resume) a job through generate, upload and file.
 *
 * Returns the job as it now stands. A failure is recorded on the row and
 * re-thrown so the route can answer with it; calling this again resumes.
 */
export async function runPlanJob(
  supabase: SupabaseClient,
  args: {
    job: PlanJob
    rows: string[][]
    clientName: string
    attribution: { created_by_role: "client" | "coach"; created_by_id: string }
  },
): Promise<PlanJob> {
  const { job, rows, clientName, attribution } = args
  const patch = async (p: Record<string, unknown>) => {
    const { data } = await supabase.from("networking_plan_jobs").update(p).eq("id", job.id).select("*").single()
    return (data ?? job) as PlanJob
  }

  let current = await patch({ status: "running", attempts: job.attempts + 1, error: null })

  try {
    // ── 1. generate (pure) ──
    const content = buildPlanContent(rows)
    if (!content.emailTouches.length && !content.linkedinTouches.length && !content.otherTouches.length) {
      throw new Error("That workbook's Outreach Messages tab has no messages in it.")
    }
    const pdf = await htmlToPdf(renderPlanHtml({ clientName, content }))
    current = await patch({ step: "generated" })

    // ── 2. upload, or update the file this job already made ──
    const folder = await resolveFolder(supabase, job.coach_client_id, clientName)
    if ("error" in folder) throw new Error(folder.error)

    const name = FILE_NAME(clientName)
    let fileId = current.drive_file_id
    if (!fileId) {
      // The response to a previous upload may have been lost; the stamp on the
      // file is how we find it rather than uploading a duplicate.
      const orphan = await findByJobId(folder.id, job.id)
      fileId = orphan?.id ?? null
    }
    // A file someone deleted from Drive by hand should not wedge the job
    // forever: update it if it is still there, otherwise make it again and let
    // the library entry follow the new id.
    let file
    if (fileId) {
      // "Deleted from Drive" is usually the trash, not a hard delete, and
      // updating a trashed file would leave the plan sitting in the bin with
      // the library still pointing at it. Treat trashed and missing alike.
      const existing = await getFile(fileId)
      if (!existing || existing.trashed) {
        file = await createPdf(folder.id, name, pdf, job.id)
      } else {
        try {
          file = await updatePdf(fileId, name, pdf)
        } catch (e) {
          if (e instanceof DriveError && e.status === 404) {
            file = await createPdf(folder.id, name, pdf, job.id)
          } else throw e
        }
      }
    } else {
      file = await createPdf(folder.id, name, pdf, job.id)
    }

    current = await patch({
      step: "uploaded",
      drive_file_id: file.id,
      drive_file_url: file.webViewLink ?? driveFileUrl(file.id),
    })

    // ── 3. file it in the library, hidden ──
    if (!current.document_id) {
      const { data: doc, error: docErr } = await supabase.from("coach_client_documents").insert({
        coach_client_id: job.coach_client_id,
        coach_profile_id: attribution.created_by_id,
        client_profile_id: job.client_profile_id,
        title: PLAN_TITLE(clientName),
        url: current.drive_file_url,
        // HIDDEN. The Share action is what reaches the client, and until then a
        // half-finished job has no audience.
        visible_to_client: false,
      }).select("id").single()
      if (docErr) throw new Error(`Could not file the plan in the library: ${docErr.message}`)
      current = await patch({ document_id: doc.id })
    } else {
      // A re-run keeps the same entry and points it at the same file; only the
      // title can drift, if the client was renamed.
      await supabase.from("coach_client_documents")
        .update({ title: PLAN_TITLE(clientName), url: current.drive_file_url })
        .eq("id", current.document_id)
    }

    return await patch({ step: "filed", status: "complete" })
  } catch (e: any) {
    const message = e instanceof DriveError ? `Drive: ${e.message}` : (e?.message ?? String(e))
    await patch({ status: "failed", error: message })
    throw e
  }
}

/**
 * Share with client: link access on the FILE, then visibility in the library.
 *
 * Ordering is the whole design. A permission that succeeds and a flag that then
 * fails leaves a file anyone with the link can read and nobody has the link to;
 * the reverse would put a dead link in front of a client.
 */
export async function sharePlanJob(
  supabase: SupabaseClient,
  job: PlanJob,
): Promise<{ ok: true; job: PlanJob } | { ok: false; error: string; policy?: boolean }> {
  if (!job.drive_file_id || !job.document_id) {
    return { ok: false, error: "That plan is not finished yet." }
  }

  // WHAT SHARING MEANS HERE: can a client holding this link open the plan.
  //
  // The client folders are deliberately shared with anyone who has the link so
  // clients can collaborate in them, and Drive passes that access down to
  // everything inside. So the plan is usually already reachable before this
  // button is pressed, and creating a second, weaker permission on top would be
  // noise at best: Drive will not let a file grant LESS than its parent.
  //
  // So: look first, act only if the link grants nothing.
  let permissionId = job.drive_permission_id
  if (!permissionId) {
    try {
      const existing = await anyoneLinkPermission(job.drive_file_id)
      if (existing && isViewerOrHigher(existing.role)) {
        // Already reachable, by inheritance or by an earlier share. Record what
        // is actually granting access rather than manufacturing a duplicate.
        permissionId = existing.id
      } else {
        const granted = await shareAnyoneWithLink(job.drive_file_id)
        permissionId = granted.permissionId
      }
    } catch (e: any) {
      if (isSharingBlocked(e)) {
        return {
          ok: false,
          policy: true,
          error: "Google Workspace does not allow link sharing for this Drive, so the plan cannot be shared this way.",
        }
      }
      return { ok: false, error: e instanceof DriveError ? `Drive: ${e.message}` : (e?.message ?? String(e)) }
    }
  }

  const { error: docErr } = await supabase
    .from("coach_client_documents").update({ visible_to_client: true }).eq("id", job.document_id)
  if (docErr) return { ok: false, error: `Could not show the plan to the client: ${docErr.message}` }

  const { data } = await supabase.from("networking_plan_jobs")
    .update({ drive_permission_id: permissionId, shared_at: new Date().toISOString() })
    .eq("id", job.id).select("*").single()
  return { ok: true, job: (data ?? job) as PlanJob }
}

/** Used by the route to show the coach what the file looks like now. */
export async function driveFileState(fileId: string) {
  return getFile(fileId)
}
