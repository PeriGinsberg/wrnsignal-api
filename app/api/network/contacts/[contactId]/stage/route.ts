// app/api/network/contacts/[contactId]/stage/route.ts
// POST: change a contact's stage. OWNER-ONLY. The client sets the stage (and,
// on 'outcome', outcome_type); the engine computes the due date for the NEW
// stage ONCE. A stage change is a fresh touch, so last_action_at resets to now
// (the new stage's interval measures from the change).
//
// v3: 11-stage vocabulary; responded_branch is retired (the declined case is
// the manual move to dormant_declined). A move into either dormant stage stamps
// dormant_since; a move into sequence_active starts a fresh outreach cycle.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { routeError } from "../../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveOwnerScope } from "@/lib/collab/scope"
import { computeNextDue, type ContactStage } from "@/lib/network-tracker/reminder-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STAGES = new Set<ContactStage>([
  "identified", "intro_requested", "sequence_active", "replied", "chat_scheduled",
  "chat_done", "nurture", "ask_made", "outcome", "dormant_no_answer", "dormant_declined",
])
const DORMANT = new Set(["dormant_no_answer", "dormant_declined"])
const OUTCOMES = new Set(["referral", "intro", "lead"])

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const { contactId } = await params
    // Owner-only by design; resolveOwnerScope never consults the query
    // string, so this cannot widen into coach access by accident.
    const scope = await resolveOwnerScope(req)
    const supabase = getSupabaseAdmin()

    const { data: c } = await supabase
      .from("network_contacts")
      .select("id, client_profile_id, stage, created_at, reminder_override, dormant_since, cycle_started_at, first_touch_at, first_replied_at, first_chat_at")
      .eq("id", contactId).maybeSingle()
    if (!c) return withCorsJson(req, { ok: false, error: "Contact not found" }, 404)
    if (c.client_profile_id !== scope.subjectId)
      return withCorsJson(req, { ok: false, error: "Forbidden: pipeline edits are owner-only" }, 403)

    const body = await req.json().catch(() => null)
    const stage = body?.stage
    if (typeof stage !== "string" || !STAGES.has(stage as ContactStage))
      return withCorsJson(req, { ok: false, error: "invalid stage" }, 400)
    if (body?.outcome_type != null && !OUTCOMES.has(body.outcome_type))
      return withCorsJson(req, { ok: false, error: "invalid outcome_type" }, 400)

    const now = new Date()
    // A manual move into either dormant stage stamps dormant_since if not set.
    let dormantSince: string | null = c.dormant_since
    if (DORMANT.has(stage) && !dormantSince) dormantSince = now.toISOString()

    // A transition INTO sequence_active starts a new outreach cycle. Only touches
    // logged from this instant count toward the ladder, so re-engaging a contact
    // that went dormant does not flip it straight back. Re-saving a stage that is
    // already sequence_active is not a transition — the existing cycle stands.
    const enteringSequence = stage === "sequence_active" && c.stage !== "sequence_active"
    const cycleStartedAt = enteringSequence ? now.toISOString() : c.cycle_started_at

    const { data: acts } = await supabase.from("network_actions").select("type, action_date").eq("contact_id", contactId)
    const due = computeNextDue({
      stage: stage as ContactStage, createdAt: c.created_at, lastActionAt: now,   // fresh clock on a stage change
      reminderOverride: c.reminder_override, dormantSince,
      pokeEnabled: false, actions: acts ?? [],
      cycleStartedAt,
      pipelineActivity: true,   // a stage change satisfies a snooze too
    })

    const patch: Record<string, any> = {
      stage,
      last_action_at: now.toISOString(),
      next_due_at: due.nextDueAt ? due.nextDueAt.toISOString() : null,
      next_due_reason: due.nextDueReason,
      dormant_since: dormantSince,
      cycle_started_at: cycleStartedAt,
    }
    if (body?.outcome_type !== undefined) patch.outcome_type = body.outcome_type
    if (due.stage) patch.stage = due.stage                       // engine's sequence_active->dormant flip wins
    if (due.dormantSince) patch.dormant_since = due.dormantSince.toISOString()
    if (due.clearOverride) patch.reminder_override = null        // the snooze has been served

    // First-reached milestones — stamped ONCE (only when NULL), never recomputed,
    // so reply/chat rates don't fall as a contact progresses. (first_touch_at is
    // also stamped by the actions route on a touch_1 log — whichever fires first.)
    if (stage === "sequence_active" && !c.first_touch_at) patch.first_touch_at = now.toISOString()
    if (stage === "replied" && !c.first_replied_at) patch.first_replied_at = now.toISOString()
    if (stage === "chat_scheduled" && !c.first_chat_at) patch.first_chat_at = now.toISOString()

    const { data: updated, error: updErr } = await supabase
      .from("network_contacts").update(patch).eq("id", contactId)
      .select("id, stage, outcome_type, last_action_at, next_due_at, next_due_reason, dormant_since, reminder_override, cycle_started_at, first_touch_at, first_replied_at, first_chat_at").single()
    if (updErr) throw new Error(`Update failed: ${updErr.message}`)

    return withCorsJson(req, { ok: true, contact: updated }, 200)
  } catch (err: any) {
    return routeError(req, err)
  }
}
