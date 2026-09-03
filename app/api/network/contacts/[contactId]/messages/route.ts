// app/api/network/contacts/[contactId]/messages/route.ts
//
// MESSAGES. Rows in network_actions with a body, which is what makes them
// messages; see 20260902_network_messages.sql for the shape rule.
//
// OWNER-ONLY, like every other pipeline write. author_role is written as
// "client" from the SESSION, never from the body, so the column carries real
// attribution already and nothing has to be backfilled when coaches arrive.
//
// SIGNAL DOES NOT SEND ANYTHING. "Sent" is the user saying they sent it, in
// their own mail client or on LinkedIn. That is why the send path takes no
// recipient and does no delivery: it is a log entry with a lifecycle.
//
// THE DRAFT/SENT ASYMMETRY IS THE WHOLE ROUTE:
//
//   draft   inert. No last_action_at, no engine run, no stage move. A draft is
//           not a thing that happened, and treating it as one would advance the
//           follow-up sequence for a message nobody sent.
//   sent    a real touch. Identical treatment to POST /actions: stamp
//           last_action_at, apply any implied stage move, run computeNextDue
//           ONCE. Same engine, same single place due dates are computed.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { routeError } from "../../../../_lib/routeError"
import { must } from "../../../../_lib/must"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveOwnerScope } from "@/lib/collab/scope"
import { computeNextDue } from "@/lib/network-tracker/reminder-engine"
import { ACTION_TYPES, isPipelineAction, stageAfterAction } from "@/lib/network-tracker/action-semantics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CHANNELS = new Set(["email", "linkedin"])
const MESSAGE_COLS =
  "id, contact_id, type, action_date, body, channel, subject, status, application_id, author_role, author_id, created_at"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

async function ownedContact(supabase: any, contactId: string) {
  const { data: c } = await supabase
    .from("network_contacts")
    .select("id, client_profile_id, stage, created_at, reminder_override, dormant_since, cycle_started_at, first_touch_at, company_id")
    .eq("id", contactId).maybeSingle()
  return c
}

/** The sent path, shared by "compose and send at once" and "send this draft".
 *  Mirrors POST /actions step for step; the engine is not re-implemented. */
async function applySend(supabase: any, c: any, type: string, sentAt: Date) {
  if (!isPipelineAction(type)) return null
  // must(): same reason as the three engine routes. This one also runs on the
  // send path, so a swallowed read would persist a wrong due date on a real
  // outreach the student just made.
  // The generic is explicit because this file takes `supabase: any`, so
  // must() has nothing to infer T from and would land on {}.
  const acts = must<{ type: string; action_date?: string | null; status?: string | null }[]>(
    await supabase.from("network_actions")
      .select("type, action_date, status").eq("contact_id", c.id),
    "read this contact's history")
  const implied = stageAfterAction(c.stage, type)
  const effectiveStage = implied ?? c.stage
  const due = computeNextDue({
    stage: effectiveStage, createdAt: c.created_at, lastActionAt: sentAt,
    reminderOverride: c.reminder_override, dormantSince: c.dormant_since,
    pokeEnabled: false, actions: acts ?? [],
    cycleStartedAt: c.cycle_started_at,
    pipelineActivity: true,
  })
  const patch: Record<string, any> = {
    last_action_at: sentAt.toISOString(),
    next_due_at: due.nextDueAt ? due.nextDueAt.toISOString() : null,
    next_due_reason: due.nextDueReason,
  }
  if (due.stage && due.stage !== c.stage) patch.stage = due.stage
  else if (implied && implied !== c.stage) patch.stage = implied
  if (!c.first_touch_at && type === "touch_1") patch.first_touch_at = sentAt.toISOString()
  const { error } = await supabase.from("network_contacts").update(patch).eq("id", c.id)
  if (error) throw new Error(`Contact update failed: ${error.message}`)
  return patch
}

/** POST — write a message. `status` decides whether it is a draft or a send. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const { contactId } = await params
    const scope = await resolveOwnerScope(req)
    const supabase = getSupabaseAdmin()

    const c = await ownedContact(supabase, contactId)
    if (!c) return withCorsJson(req, { ok: false, error: "Contact not found" }, 404)
    if (c.client_profile_id !== scope.subjectId)
      return withCorsJson(req, { ok: false, error: "Forbidden: pipeline edits are owner-only" }, 403)

    const b = await req.json().catch(() => null)
    const body = typeof b?.body === "string" ? b.body.trim() : ""
    if (!body) return withCorsJson(req, { ok: false, error: "A message needs a body." }, 400)
    const channel = typeof b?.channel === "string" ? b.channel : ""
    if (!CHANNELS.has(channel)) return withCorsJson(req, { ok: false, error: "invalid channel" }, 400)
    const status = b?.status === "sent" ? "sent" : "draft"
    const type = typeof b?.type === "string" && ACTION_TYPES.has(b.type) ? b.type : "touch_1"
    // Subject is email-only and optional. Dropped rather than rejected on
    // linkedin: the composer hides the field there, so a value arriving is
    // stale form state and not a user asking for something.
    const subject = channel === "email" && typeof b?.subject === "string" ? (b.subject.trim() || null) : null
    const applicationId = typeof b?.application_id === "string" && b.application_id ? b.application_id : null

    const when = new Date()
    const { data: row, error: insErr } = await supabase.from("network_actions").insert({
      contact_id: contactId, type, action_date: when.toISOString(),
      body, channel, subject, status, application_id: applicationId,
      author_role: "client", author_id: scope.subjectId,
    }).select(MESSAGE_COLS).single()
    if (insErr) throw new Error(`Save failed: ${insErr.message}`)

    const contactPatch = status === "sent" ? await applySend(supabase, c, type, when) : null
    return withCorsJson(req, { ok: true, message: row, contact: contactPatch }, 201)
  } catch (err: any) {
    return routeError(req, err)
  }
}

/**
 * PATCH — edit a draft, or send it.
 *
 * ONE ROW, no revision history: editing overwrites. That is the chosen model,
 * and it is enforced here by there being nowhere for a previous body to go.
 *
 * A SENT MESSAGE IS IMMUTABLE. It records something that happened in somebody
 * else's inbox; letting it be rewritten would make the timeline a claim rather
 * than a log.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const { contactId } = await params
    const scope = await resolveOwnerScope(req)
    const supabase = getSupabaseAdmin()

    const c = await ownedContact(supabase, contactId)
    if (!c) return withCorsJson(req, { ok: false, error: "Contact not found" }, 404)
    if (c.client_profile_id !== scope.subjectId)
      return withCorsJson(req, { ok: false, error: "Forbidden: pipeline edits are owner-only" }, 403)

    const b = await req.json().catch(() => null)
    const id = typeof b?.id === "string" ? b.id : ""
    if (!id) return withCorsJson(req, { ok: false, error: "which message?" }, 400)

    const { data: existing } = await supabase
      .from("network_actions").select("id, contact_id, status, type").eq("id", id).maybeSingle()
    if (!existing || existing.contact_id !== contactId)
      return withCorsJson(req, { ok: false, error: "Message not found" }, 404)
    if (existing.status !== "draft")
      return withCorsJson(req, { ok: false, error: "A sent message cannot be edited." }, 409)

    const patch: Record<string, any> = {}
    if (typeof b?.body === "string") {
      const t = b.body.trim()
      if (!t) return withCorsJson(req, { ok: false, error: "A message needs a body." }, 400)
      patch.body = t
    }
    if (typeof b?.channel === "string") {
      if (!CHANNELS.has(b.channel)) return withCorsJson(req, { ok: false, error: "invalid channel" }, 400)
      patch.channel = b.channel
      if (b.channel === "linkedin") patch.subject = null
    }
    if (typeof b?.subject === "string") patch.subject = b.subject.trim() || null
    if (b && "application_id" in b) patch.application_id = b.application_id || null
    if (typeof b?.type === "string" && ACTION_TYPES.has(b.type)) patch.type = b.type

    const sending = b?.status === "sent"
    const when = new Date()
    if (sending) { patch.status = "sent"; patch.action_date = when.toISOString() }

    const { data: row, error: updErr } = await supabase
      .from("network_actions").update(patch).eq("id", id).select(MESSAGE_COLS).single()
    if (updErr) throw new Error(`Save failed: ${updErr.message}`)

    const contactPatch = sending
      ? await applySend(supabase, c, (patch.type ?? existing.type) as string, when)
      : null
    return withCorsJson(req, { ok: true, message: row, contact: contactPatch }, 200)
  } catch (err: any) {
    return routeError(req, err)
  }
}

/** DELETE — discard a draft. A sent message is not discardable, for the same
 *  reason it is not editable. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const { contactId } = await params
    const scope = await resolveOwnerScope(req)
    const supabase = getSupabaseAdmin()

    const c = await ownedContact(supabase, contactId)
    if (!c) return withCorsJson(req, { ok: false, error: "Contact not found" }, 404)
    if (c.client_profile_id !== scope.subjectId)
      return withCorsJson(req, { ok: false, error: "Forbidden: pipeline edits are owner-only" }, 403)

    const b = await req.json().catch(() => null)
    const id = typeof b?.id === "string" ? b.id : ""
    if (!id) return withCorsJson(req, { ok: false, error: "which message?" }, 400)

    const { data: existing } = await supabase
      .from("network_actions").select("id, contact_id, status").eq("id", id).maybeSingle()
    if (!existing || existing.contact_id !== contactId)
      return withCorsJson(req, { ok: false, error: "Message not found" }, 404)
    if (existing.status !== "draft")
      return withCorsJson(req, { ok: false, error: "A sent message cannot be discarded." }, 409)

    const { error } = await supabase.from("network_actions").delete().eq("id", id)
    if (error) throw new Error(`Discard failed: ${error.message}`)
    return withCorsJson(req, { ok: true, discarded: id }, 200)
  } catch (err: any) {
    return routeError(req, err)
  }
}
