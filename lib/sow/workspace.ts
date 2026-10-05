// lib/sow/workspace.ts
//
// The client's Google Drive workspace: "[First Last]" under the clients folder
// (GOOGLE_DRIVE_CLIENTS_ROOT_ID) with its empty subfolders, made at Let's Go,
// and shared with the client (editor, no Google email) when the coach releases
// the welcome task. Saved as coach_clients.workspace_folder_id/_url. The
// Networking folder (drive_folder_id, where the Networking Plan writes) takes
// the workspace's Networking subfolder only when it is empty.
//
// Neither ever blocks what called it. A failure comes back as an error for
// the caller to turn into a task for the coach.

import type { SupabaseClient } from "@supabase/supabase-js"
import { createFolder, freeChildFolderName, shareWithUser } from "../drive/client"
import { createTask } from "../tasks/service"
import { logProspectEvent } from "../prospects/history"
import { planLink } from "../plan/todo"

export const WORKSPACE_SUBFOLDERS = ["Resume", "Cover Letter", "LinkedIn", "Networking", "Interviewing", "DNA", "Toolkit"] as const

/** The Drive calls, passed in so the rules run without Google. */
export type DriveApi = {
  freeChildFolderName: (parentId: string, name: string) => Promise<string>
  createFolder: (parentId: string, name: string) => Promise<{ id: string }>
  shareWithUser: (fileId: string, email: string) => Promise<{ permissionId: string; role: string }>
}
const realDrive: DriveApi = { freeChildFolderName, createFolder, shareWithUser }

export const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`

type Rel = {
  id: string; coach_profile_id: string; client_profile_id: string | null; name: string | null; invited_email: string | null
  workspace_folder_id: string | null; drive_folder_id: string | null
}

async function rel(db: SupabaseClient, coachClientId: string): Promise<Rel | null> {
  const { data } = await db.from("coach_clients")
    .select("id, coach_profile_id, client_profile_id, name, invited_email, workspace_folder_id, drive_folder_id").eq("id", coachClientId).maybeSingle()
  return data as Rel | null
}

async function clientEmail(db: SupabaseClient, r: Rel): Promise<string | null> {
  if (r.invited_email?.trim()) return r.invited_email.trim()
  if (!r.client_profile_id) return null
  const { data } = await db.from("client_profiles").select("email").eq("id", r.client_profile_id).maybeSingle()
  return (data as { email: string | null } | null)?.email?.trim() || null
}

/**
 * Make the workspace, unless the record already has one (then it is kept).
 * Returns its URL, or why it could not be made.
 */
export async function createWorkspace(
  db: SupabaseClient,
  coachClientId: string,
  opts: { drive?: DriveApi; rootId?: string | null } = {},
): Promise<{ ok: true; url: string; created: boolean } | { ok: false; error: string }> {
  const r = await rel(db, coachClientId)
  if (!r) return { ok: false, error: "Client not found" }
  if (r.workspace_folder_id) return { ok: true, url: folderUrl(r.workspace_folder_id), created: false }
  const root = opts.rootId ?? process.env.GOOGLE_DRIVE_CLIENTS_ROOT_ID ?? null
  if (!root) return { ok: false, error: "GOOGLE_DRIVE_CLIENTS_ROOT_ID is not set" }
  const drive = opts.drive ?? realDrive
  try {
    const name = await drive.freeChildFolderName(root, r.name?.trim() || `Client ${coachClientId.slice(0, 8)}`)
    const top = await drive.createFolder(root, name)
    let networking: string | null = null
    for (const sub of WORKSPACE_SUBFOLDERS) {
      const f = await drive.createFolder(top.id, sub)
      if (sub === "Networking") networking = f.id
    }
    const patch: Record<string, unknown> = { workspace_folder_id: top.id, workspace_folder_url: folderUrl(top.id) }
    if (!r.drive_folder_id && networking) { patch.drive_folder_id = networking; patch.drive_folder_url = folderUrl(networking) }
    const { error } = await db.from("coach_clients").update(patch).eq("id", coachClientId)
    if (error) return { ok: false, error: `The folder was made but not saved on the record: ${error.message}` }
    await logProspectEvent(db, { coachClientId, eventType: "workspace_created", actor: null, context: { name, url: folderUrl(top.id) } })
    return { ok: true, url: folderUrl(top.id), created: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Share the workspace with the client as an editor. */
export async function shareWorkspace(
  db: SupabaseClient,
  coachClientId: string,
  opts: { drive?: DriveApi } = {},
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const r = await rel(db, coachClientId)
  if (!r) return { ok: false, error: "Client not found" }
  if (!r.workspace_folder_id) return { ok: false, error: "There is no Drive workspace on this record yet." }
  const email = await clientEmail(db, r)
  if (!email) return { ok: false, error: "There is no email on this record to share with." }
  try {
    await (opts.drive ?? realDrive).shareWithUser(r.workspace_folder_id, email)
    await logProspectEvent(db, { coachClientId, eventType: "workspace_shared", actor: null, context: { email, url: folderUrl(r.workspace_folder_id) } })
    return { ok: true, email }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** A task for the coach when SIGNAL could not do a Drive step itself. */
export async function driveFallbackTask(db: SupabaseClient, coachClientId: string, title: string, why: string): Promise<void> {
  const r = await rel(db, coachClientId)
  if (!r) return
  const res = await createTask(db, {
    title,
    description: `SIGNAL could not do this automatically: ${why}`,
    coach_client_id: r.id,
    client_profile_id: r.client_profile_id,
    assignee_profile_id: r.coach_profile_id,
    due_at: new Date().toISOString(),
    source: "auto",
    link: planLink({ coach_client_id: r.id, client_profile_id: r.client_profile_id }),
  }, null)
  if (!res.ok) console.error("[sow/workspace] fallback task failed:", res.error)
}

/**
 * The welcome task was released: share the workspace, or leave the coach a
 * task saying it still needs sharing.
 */
export async function onWelcomeReleased(db: SupabaseClient, coachClientId: string, opts: { drive?: DriveApi } = {}): Promise<void> {
  const shared = await shareWorkspace(db, coachClientId, opts)
  if (shared.ok) return
  const r = await rel(db, coachClientId)
  await driveFallbackTask(db, coachClientId, `Share Drive folder with ${r?.name?.trim() || "this client"}`, shared.error)
}
