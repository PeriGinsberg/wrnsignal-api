// app/api/coach/coach-clients/[id]/drive-folder/route.ts
// Wire a client's Networking folder in Drive, from a link the coach pastes.
//
// The id is stored, never the name: a folder found by name at run time is a
// folder that breaks when someone renames it, duplicates it, or trashes it, and
// its failure mode is writing a client's plan into the wrong client's folder.
// The URL is kept alongside purely so the screen can link back to what was
// pasted.
//
// PATCH with an empty string clears the wiring.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { errorStatus } from "../../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveCoach } from "@/app/api/_lib/coachAuth"
import { getOwnedRelationship, libraryAccessDenied } from "@/app/api/_lib/coachClientDocuments"
import { parseDriveFolderUrl, driveFolderUrl } from "@/lib/drive/folderUrl"
import { verifyFolder } from "@/lib/drive/client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    const rel = await getOwnedRelationship(supabase, coachProfileId, id)
    if (!rel) return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    const denied = libraryAccessDenied(rel, "read")
    if (denied) return withCorsJson(req, { ok: false, error: denied }, 403)

    const { data } = await supabase
      .from("coach_clients").select("drive_folder_id, drive_folder_url").eq("id", id).maybeSingle()
    return withCorsJson(req, {
      ok: true,
      folder: data?.drive_folder_id ? { id: data.drive_folder_id, url: data.drive_folder_url } : null,
    }, 200)
  } catch (err: any) {
    console.error("[coach/drive-folder GET]", err?.stack || err?.message)
    const status = errorStatus(err)
    if (status === 401) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    return withCorsJson(req, { ok: false, error: err?.message || String(err) }, 500)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    const rel = await getOwnedRelationship(supabase, coachProfileId, id)
    if (!rel) return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    // Wiring a Drive folder is a change to how this client's work is filed, so
    // it needs the same access level as any other write on their behalf.
    const denied = libraryAccessDenied(rel, "write")
    if (denied) return withCorsJson(req, { ok: false, error: denied }, 403)

    const body = await req.json().catch(() => null)
    if (body == null || !("url" in body)) return withCorsJson(req, { ok: false, error: "Nothing to update." }, 400)

    const raw = typeof body.url === "string" ? body.url.trim() : ""
    if (!raw) {
      await supabase.from("coach_clients").update({ drive_folder_id: null, drive_folder_url: null }).eq("id", id)
      return withCorsJson(req, { ok: true, folder: null }, 200)
    }

    const parsed = parseDriveFolderUrl(raw)
    if ("error" in parsed) return withCorsJson(req, { ok: false, error: parsed.error }, 400)

    // Verified before it is stored: a folder that cannot be reached, or that
    // lives outside the Shared Drive, is a problem worth hearing about now
    // rather than in the middle of the first plan run.
    const check = await verifyFolder(parsed.id)
    if (!check.ok) return withCorsJson(req, { ok: false, error: check.error }, 400)

    const url = driveFolderUrl(parsed.id)
    const { error: upErr } = await supabase
      .from("coach_clients").update({ drive_folder_id: parsed.id, drive_folder_url: url }).eq("id", id)
    if (upErr) throw new Error(`Could not save the folder: ${upErr.message}`)

    return withCorsJson(req, { ok: true, folder: { id: parsed.id, url, name: check.name } }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/drive-folder]", err?.stack || msg)
    const status = errorStatus(err)
    if (status === 401) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    return withCorsJson(req, { ok: false, error: msg }, status === 403 ? 403 : 500)
  }
}
