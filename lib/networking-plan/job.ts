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
import { ghlConfig } from "@/lib/ghl/client"
import { autoResolveContact, noContactMessage, shareNetworkingPlan } from "@/lib/ghl/networkingPlanSync"
import { sendNetworkingPlanReady } from "@/lib/email/sendNetworkingPlanReady"
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
  // GHL half of a share. See 20260924_networking_plan_jobs_ghl.sql.
  ghl_contact_id: string | null
  ghl_note_added_at: string | null
  ghl_tagged_at: string | null
  ghl_email_sent_count: number
  // The Postmark half of a share, from 2026-09-26. The ghl_* fields above are
  // the record of how this worked before that.
  client_email_sent_at: string | null
  client_email_sent_count: number
  client_email_to: string | null
  client_email_error: string | null
  ghl_error: string | null
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

  // ---- GHL: tell the client.
  //
  // DELIBERATELY AFTER Drive and the library, and deliberately NOT fatal.
  //
  // By this point the plan is genuinely shared: the link works and the library
  // row is visible. The GHL tag is what tells the client that. If it fails, the
  // client has a plan they have not been told about -- quiet, correct, and
  // resumable. If it ran FIRST and Drive then failed, the client would be
  // emailed about a plan they cannot open, which is not resumable because
  // nothing un-sends an email.
  //
  // So a GHL failure never fails the share. It is recorded, surfaced, and
  // retried from the "shared but never told" query.
  const shared = (data ?? job) as PlanJob

  // The client's own SIGNAL record gets a line saying this happened, so the
  // share shows up in their history beside everything else a coach has done.
  // Non-fatal, and before the client is told: a missing history line is a gap
  // in the record, while a failed share that has already emailed the client is
  // not recoverable.
  await noteShareOnClientRecord(supabase, shared)

  // The GHL contact note, which is an audit line for whoever works in GHL. It
  // no longer tells the client anything: the tag that used to do that is gone,
  // and the email below is how they are told.
  const ghl = await notifyClientViaGhl(supabase, shared)

  // LAST, because it is the only step that cannot be undone. Everything above
  // is recoverable by clicking Share again; an email that has left cannot be
  // unsent, so it goes after the plan is provably shareable.
  const emailed = await emailClientPlanReady(supabase, ghl)
  return { ok: true, job: emailed }
}

/**
 * Write "Networking plan shared with client" onto the client's SIGNAL record.
 *
 * THE COACH AND THE TIMESTAMP ARE COLUMNS, NOT SENTENCE. coach_profile_id and
 * created_at are what the note feed already renders beside every other note, so
 * baking them into the body would print the byline twice and would freeze a
 * formatted date into text that no longer matches if it is ever re-rendered in
 * another timezone.
 *
 * Never throws. The share has already succeeded by the time this runs.
 */
async function noteShareOnClientRecord(supabase: SupabaseClient, job: PlanJob): Promise<void> {
  const { data: cc, error: ccErr } = await supabase
    .from("coach_clients")
    .select("coach_profile_id, client_profile_id")
    .eq("id", job.coach_client_id)
    .maybeSingle()

  if (ccErr || !cc?.coach_profile_id) {
    console.error("[networking-plan] share note skipped:", ccErr?.message ?? "no coach on the relationship")
    return
  }

  const { error } = await supabase.from("coach_client_notes").insert({
    coach_client_id: job.coach_client_id,
    coach_profile_id: cc.coach_profile_id,
    client_profile_id: cc.client_profile_id ?? job.client_profile_id,
    type: "other",
    body: "Networking plan shared with client",
  })

  if (error) console.error("[networking-plan] share note failed:", error.message)
}

/**
 * Note, then tag, on the client's GHL contact. Records what happened.
 *
 * Returns the job either way -- never throws. The share has already succeeded
 * by the time this runs.
 */
export async function notifyClientViaGhl(
  supabase: SupabaseClient,
  job: PlanJob,
): Promise<PlanJob> {
  const { data: cc } = await supabase
    .from("coach_clients")
    .select("ghl_contact_id, invited_email, client_profile_id")
    .eq("id", job.coach_client_id).maybeSingle()
  let contactId = cc?.ghl_contact_id ?? null

  let cfgEarly
  try {
    cfgEarly = ghlConfig()
  } catch (e: any) {
    const { data } = await supabase.from("networking_plan_jobs")
      .update({ ghl_error: `GHL not configured: ${e?.message ?? e}` })
      .eq("id", job.id).select("*").single()
    return (data ?? job) as PlanJob
  }

  // NOT WIRED YET? FIND THEM. No confirmation step: a match is accepted only
  // when exactly one contact carries the address, which is a stronger check
  // than a human glancing at a name, and it happens without making the coach
  // do setup they did not ask for.
  //
  // A failure here NEVER fails the share. The plan is already shared by this
  // point; not finding a contact means nobody was told, which is recorded and
  // shown, not thrown.
  if (!contactId) {
    let loginEmail: string | null = null
    if (cc?.client_profile_id) {
      const { data: prof } = await supabase
        .from("client_profiles").select("email").eq("id", cc.client_profile_id).maybeSingle()
      loginEmail = prof?.email ?? null
    }
    const found = await autoResolveContact(
      { loginEmail, invitedEmail: cc?.invited_email }, cfgEarly,
    ).catch((e) => ({ status: "not_found" as const, triedEmails: [String(e?.message ?? e)] }))

    if (found.status === "matched") {
      contactId = found.contactId
      await supabase.from("coach_clients").update({
        ghl_contact_id: found.contactId,
        ghl_contact_name: found.displayName,
        ghl_contact_source: "search",
        ghl_contact_resolved_at: new Date().toISOString(),
      }).eq("id", job.coach_client_id)
    } else {
      const { data } = await supabase.from("networking_plan_jobs")
        .update({ ghl_error: noContactMessage(found) })
        .eq("id", job.id).select("*").single()
      return (data ?? job) as PlanJob
    }
  }

  let cfg
  try {
    cfg = ghlConfig()
  } catch (e: any) {
    const { data } = await supabase.from("networking_plan_jobs")
      .update({ ghl_contact_id: contactId, ghl_error: `GHL not configured: ${e?.message ?? e}` })
      .eq("id", job.id).select("*").single()
    return (data ?? job) as PlanJob
  }

  const res = await shareNetworkingPlan({ contactId }, cfg)

  // ghl_tagged_at is deliberately NOT written any more. The tag is gone, and a
  // timestamp in a column named "tagged" would claim something that did not
  // happen. Existing values stay as the record of shares made before
  // 2026-09-26.
  const { data } = await supabase.from("networking_plan_jobs")
    .update({
      ghl_contact_id: contactId,
      ghl_note_added_at: res.note.outcome === "ok" ? new Date().toISOString() : null,
      ghl_error: res.note.outcome === "ok" ? null : `GHL note failed: ${res.note.error}`,
    })
    .eq("id", job.id).select("*").single()
  return (data ?? job) as PlanJob
}

/**
 * Email the client that their plan is ready, and record what happened.
 *
 * Used by the share (once) and by the "Re-send email" button (again). Both are
 * the same act now that SIGNAL owns the email: there is no tag to remove and
 * re-add, so there is no window in which a contact can end up with neither the
 * tag nor the email.
 *
 * NEVER THROWS. Sharing has already succeeded by the time this runs; a client
 * who was not emailed is a recoverable state with a button for it, and taking
 * the whole share down would turn a missing email into a lost plan.
 */
export async function emailClientPlanReady(
  supabase: SupabaseClient,
  job: PlanJob,
): Promise<PlanJob> {
  const { data: cc } = await supabase
    .from("coach_clients")
    .select("invited_email, client_profile_id")
    .eq("id", job.coach_client_id).maybeSingle()

  let email: string | null = null
  let firstName = ""
  const profileId = cc?.client_profile_id ?? job.client_profile_id
  if (profileId) {
    const { data: prof } = await supabase
      .from("client_profiles").select("email, name").eq("id", profileId).maybeSingle()
    email = prof?.email ?? null
    firstName = String(prof?.name ?? "").trim().split(/\s+/)[0] ?? ""
  }
  // The login address first, the invited address second: same order the GHL
  // contact lookup uses, so both reach the same person.
  email = email ?? cc?.invited_email ?? null

  if (!email) {
    const { data } = await supabase.from("networking_plan_jobs")
      .update({ client_email_error: "No email address on this client, so nobody was told." })
      .eq("id", job.id).select("*").single()
    return (data ?? job) as PlanJob
  }

  const sent = await sendNetworkingPlanReady({ to: email, firstName })

  const patch: Record<string, unknown> = sent.ok
    ? {
        client_email_sent_at: new Date().toISOString(),
        client_email_sent_count: (job.client_email_sent_count ?? 0) + 1,
        client_email_to: sent.to,
        client_email_error: null,
      }
    : { client_email_error: sent.error }

  const { data } = await supabase.from("networking_plan_jobs")
    .update(patch).eq("id", job.id).select("*").single()
  return (data ?? job) as PlanJob
}

/** Used by the route to show the coach what the file looks like now. */
export async function driveFileState(fileId: string) {
  return getFile(fileId)
}
