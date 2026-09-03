// app/api/network/contacts/[contactId]/actions/route.ts
// POST: log a dated action. Owner, or a coach holding 'full' on this client.
// author_role on the row records which, so a coach's outreach is never shown to
// the client as their own.
// Writes the log entry, then runs computeNextDue() ONCE and saves next_due_at /
// next_due_reason / any stage->dormant flip. No interval math outside the engine.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { routeError } from "../../../../_lib/routeError"
import { must } from "../../../../_lib/must"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { authorRole, resolveRequestScope } from "@/lib/collab/scope"
import { computeNextDue } from "@/lib/network-tracker/reminder-engine"
import { ACTION_TYPES, isPipelineAction, stageAfterAction } from "@/lib/network-tracker/action-semantics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"



export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const supabase = getSupabaseAdmin()
    const { contactId } = await params
    // A coach with full access can log an action. author_role on the row
    // records who did it, so a coach's outreach is never shown to the client as
    // their own.
    //
    // "write" means FULL access, not merely view: resolveRequestScope refuses
    // a coach holding view or annotate before this line returns. A request
    // naming no subject still resolves to the caller's own board, so the owner
    // path is unchanged from what the owner-only helper did.
    const scope = await resolveRequestScope(req, supabase, { require: "write" })

    const { data: c } = await supabase
      .from("network_contacts")
      .select("id, client_profile_id, stage, created_at, reminder_override, dormant_since, cycle_started_at, first_touch_at")
      .eq("id", contactId).maybeSingle()
    if (!c) return withCorsJson(req, { ok: false, error: "Contact not found" }, 404)
    if (c.client_profile_id !== scope.subjectId)
      return withCorsJson(req, { ok: false, error: "Forbidden: that contact is not on this board" }, 403)

    const body = await req.json().catch(() => null)
    const type = body?.type
    if (typeof type !== "string" || !ACTION_TYPES.has(type))
      return withCorsJson(req, { ok: false, error: "invalid action type" }, 400)
    const actionDate = body?.action_date ? new Date(body.action_date) : new Date()
    if (Number.isNaN(actionDate.getTime()))
      return withCorsJson(req, { ok: false, error: "invalid action_date" }, 400)
    const note = typeof body?.note === "string" ? (body.note.trim() || null) : null

    // 1) write the log entry — author from the SESSION, never the body
    const { error: insErr } = await supabase.from("network_actions").insert({
      contact_id: contactId, type, action_date: actionDate.toISOString(), note,
      author_role: authorRole(scope), author_id: scope.actorId,
    })
    if (insErr) throw new Error(`Log failed: ${insErr.message}`)

    // 2) INERT types stop here. No engine run, no contact patch — the row is the
    // whole point. Returning the contact UNREAD (rather than re-selecting it)
    // keeps this path incapable of writing to network_contacts at all, which is
    // a stronger guarantee than remembering not to.
    if (!isPipelineAction(type)) {
      return withCorsJson(req, { ok: true, action: { type, action_date: actionDate.toISOString(), note } }, 201)
    }

    // 3) reload actions, run the engine ONCE (the only place due dates are computed)
    // action_date is required: the engine scopes follow-up counting to the current cycle.
    // status: the engine drops drafts, which are not touches.
    // must(): a swallowed read here makes the engine think the contact has
    // never been touched, and its answer is WRITTEN to network_contacts.
    const acts = must(await supabase.from("network_actions")
      .select("type, action_date, status").eq("contact_id", contactId),
      "read this contact's history")
    // The action may imply a stage move (first outreach from `identified`).
    // Applied BEFORE the engine runs so it schedules from the stage the contact
    // is moving TO — computing against `identified` would return no due date and
    // leave a contact that was just messaged looking untouched.
    const implied = stageAfterAction(c.stage, type)
    const effectiveStage = implied ?? c.stage
    const due = computeNextDue({
      stage: effectiveStage, createdAt: c.created_at, lastActionAt: actionDate,
      reminderOverride: c.reminder_override, dormantSince: c.dormant_since,
      pokeEnabled: false, actions: acts ?? [],
      cycleStartedAt: c.cycle_started_at,
      pipelineActivity: true,   // acting satisfies a snooze -> engine consumes the override
    })

    // 4) save (last_action_at + engine result, incl. reached_out->dormant flip)
    const patch: Record<string, any> = {
      last_action_at: actionDate.toISOString(),
      next_due_at: due.nextDueAt ? due.nextDueAt.toISOString() : null,
      next_due_reason: due.nextDueReason,
    }
    if (implied) patch.stage = implied
    if (due.stage) patch.stage = due.stage   // an engine flip still wins over the implied move
    if (due.dormantSince) patch.dormant_since = due.dormantSince.toISOString()
    if (due.clearOverride) patch.reminder_override = null   // the snooze has been served

    // First outreach milestone — stamped ONCE on the first touch_1, from its
    // action_date (a backdated first touch stamps its real date). Never recomputed.
    if (type === "touch_1" && !c.first_touch_at) patch.first_touch_at = actionDate.toISOString()

    const { data: updated, error: updErr } = await supabase
      .from("network_contacts").update(patch).eq("id", contactId)
      .select("id, stage, last_action_at, next_due_at, next_due_reason, dormant_since, reminder_override, first_touch_at").single()
    if (updErr) throw new Error(`Update failed: ${updErr.message}`)

    return withCorsJson(req, { ok: true, contact: updated }, 201)
  } catch (err: any) {
    return routeError(req, err)
  }
}
