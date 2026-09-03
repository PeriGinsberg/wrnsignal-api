// app/api/network/contacts/[contactId]/route.ts
// GET one contact record: the contact + its company + its action log (newest first).
//   Owner or an authorized coach ('view'). Authority comes from the contact's own
//   the owner (client_profile_id), resolved before any read — never from a URL param.
// PATCH the contact's own notes. Owner, or a coach holding 'full' on this
//   client; edited_by_role and edited_at record which. No engine involvement:
//   notes do not affect due dates.
// DELETE the contact. OWNER-ONLY, not widened alongside PATCH. HARD delete — network_actions and
//   network_comments cascade (ON DELETE CASCADE). No soft-delete flag (that would
//   mean excluding a deleted state from every query forever).

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { routeError } from "../../../_lib/routeError"
import { must } from "../../../_lib/must"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { editedBy, resolveActor, resolveOwnerScope, resolveRequestScope, resolveScope } from "@/lib/collab/scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RELATIONSHIPS = new Set(["personal", "affinity", "referred", "cold", "recruiter"])
const PRIORITIES = new Set(["A", "B", "C"])

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const { contactId } = await params
    const actor = await resolveActor(req)
    const supabase = getSupabaseAdmin()

    const { data: contact, error } = await supabase
      .from("network_contacts")
      .select("*, network_companies(id, name, tier, status)")
      .eq("id", contactId)
      .maybeSingle()
    if (error) throw new Error(`Contact lookup failed: ${error.message}`)
    if (!contact) return withCorsJson(req, { ok: false, error: "Contact not found" }, 404)

    // Row-derived subject: the contact says whose board it is, the ladder says
    // whether this actor may reach it. Same "view" level as before.
    await resolveScope(supabase, actor, { subject: contact.client_profile_id, require: "read" })

    // must(): without it a missing column renders an EMPTY TIMELINE, which
    // says "you have never done anything with this person" to somebody who
    // has. The most misleading possible answer.
    const actions = must(await supabase
      .from("network_actions")
      // body/channel/subject/status/application_id: the timeline holds MESSAGES
      // as well as logged actions now. Same table, one ordered sequence, so the
      // record does not have to union two reads and cannot get that union wrong.
      .select("id, type, action_date, note, author_role, author_id, created_at, body, channel, subject, status, application_id")
      .eq("contact_id", contactId)
      .order("action_date", { ascending: false }),
      "read this contact's history")

    return withCorsJson(req, { ok: true, contact, actions: actions ?? [] }, 200)
  } catch (err: any) {
    return routeError(req, err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const supabase = getSupabaseAdmin()
    const { contactId } = await params
    // A coach with full access can edit a contact on the client's board.
    //
    // "write" means FULL access, not merely view: resolveRequestScope refuses
    // a coach holding view or annotate before this line returns. A request
    // naming no subject still resolves to the caller's own board, so the owner
    // path is unchanged from resolveOwnerScope.
    const scope = await resolveRequestScope(req, supabase, { require: "write" })

    // Load by id, then board-gate. scope.subjectId is the board this request
    // resolved to, so this still refuses a coach reaching for a contact on some
    // OTHER client's board with a guessed id.
    const { data: c } = await supabase
      .from("network_contacts").select("id, client_profile_id").eq("id", contactId).maybeSingle()
    if (!c) return withCorsJson(req, { ok: false, error: "Contact not found" }, 404)
    if (c.client_profile_id !== scope.subjectId)
      return withCorsJson(req, { ok: false, error: "Forbidden: that contact is not on this board" }, 403)

    const body = await req.json().catch(() => null)
    if (body == null) return withCorsJson(req, { ok: false, error: "nothing to update" }, 400)

    // Editable fields: notes + the v3 contact attributes (relationship, priority,
    // segment). Only keys PRESENT in the body are touched — an absent key is a
    // no-op; an empty string clears (stored NULL). Stage/dates/reminders are NOT
    // editable here (those go through the pipeline routes + engine).
    const patch: Record<string, any> = {}
    const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
    if ("notes" in body) patch.notes = clean(body.notes)
    if ("segment" in body) patch.segment = clean(body.segment)
    if ("additional_info" in body) patch.additional_info = clean(body.additional_info)
    if ("relationship" in body) {
      const rel = clean(body.relationship)
      if (rel && !RELATIONSHIPS.has(rel)) return withCorsJson(req, { ok: false, error: "invalid relationship" }, 400)
      patch.relationship = rel
    }
    if ("priority" in body) {
      const pri = clean(body.priority)
      if (pri && !PRIORITIES.has(pri)) return withCorsJson(req, { ok: false, error: "invalid priority" }, 400)
      patch.priority = pri
    }
    if (Object.keys(patch).length === 0)
      return withCorsJson(req, { ok: false, error: "nothing to update" }, 400)

    // Stamped only PAST the guard above: a request that changes nothing cannot
    // put a fresh editor on the row. Otherwise a form that saves on blur would
    // rewrite the history of a contact nobody actually touched.
    Object.assign(patch, editedBy(scope))

    const { data: updated, error: updErr } = await supabase
      .from("network_contacts").update(patch).eq("id", contactId)
      .select("id, notes, relationship, priority, segment, additional_info").single()
    if (updErr) throw new Error(`Update failed: ${updErr.message}`)

    return withCorsJson(req, { ok: true, contact: updated }, 200)
  } catch (err: any) {
    return routeError(req, err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const { contactId } = await params
    // Owner-only by design; resolveOwnerScope never consults the query
    // string, so this cannot widen into coach access by accident.
    const scope = await resolveOwnerScope(req)
    const supabase = getSupabaseAdmin()

    // Load by id, then owner-gate. Deletion is owner-only (coaches cannot).
    const { data: c } = await supabase
      .from("network_contacts").select("id, client_profile_id").eq("id", contactId).maybeSingle()
    if (!c) return withCorsJson(req, { ok: false, error: "Contact not found" }, 404)
    if (c.client_profile_id !== scope.subjectId)
      return withCorsJson(req, { ok: false, error: "Forbidden: delete is owner-only" }, 403)

    // Hard delete — network_actions + network_comments cascade.
    const { error } = await supabase.from("network_contacts").delete().eq("id", contactId)
    if (error) throw new Error(`Delete failed: ${error.message}`)

    return withCorsJson(req, { ok: true, deleted: 1 }, 200)
  } catch (err: any) {
    return routeError(req, err)
  }
}
