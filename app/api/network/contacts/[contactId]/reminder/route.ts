// app/api/network/contacts/[contactId]/reminder/route.ts
// POST: set (or clear) the manual reminder override. OWNER-ONLY. Runs computeNextDue()
// ONCE: a set override wins over everything -> next_due_reason 'manual'; clearing it
// (null) folds back to the stage's engine-computed due.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { computeNextDue } from "@/lib/network-tracker/reminder-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const { contactId } = await params
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()

    const { data: c } = await supabase
      .from("network_contacts")
      .select("id, client_profile_id, stage, created_at, last_action_at, dormant_since, cycle_started_at")
      .eq("id", contactId).maybeSingle()
    if (!c) return withCorsJson(req, { ok: false, error: "Contact not found" }, 404)
    if (c.client_profile_id !== profileId)
      return withCorsJson(req, { ok: false, error: "Forbidden: pipeline edits are owner-only" }, 403)

    const body = await req.json().catch(() => null)
    // reminder_override: an ISO date to set, or null to clear.
    let override: string | null = null
    if (body?.reminder_override != null) {
      const d = new Date(body.reminder_override)
      if (Number.isNaN(d.getTime())) return withCorsJson(req, { ok: false, error: "invalid reminder_override" }, 400)
      override = d.toISOString()
    }

    const { data: acts } = await supabase.from("network_actions").select("type, action_date").eq("contact_id", contactId)
    // NO pipelineActivity here: this route is where the override is SET, so
    // consuming it would clear the snooze on the way in.
    const due = computeNextDue({
      stage: c.stage, createdAt: c.created_at, lastActionAt: c.last_action_at,
      reminderOverride: override, dormantSince: c.dormant_since,
      pokeEnabled: false, actions: acts ?? [],
      cycleStartedAt: c.cycle_started_at,
    })

    const patch: Record<string, any> = {
      reminder_override: override,
      next_due_at: due.nextDueAt ? due.nextDueAt.toISOString() : null,
      next_due_reason: due.nextDueReason,
    }
    if (due.stage) patch.stage = due.stage
    if (due.dormantSince) patch.dormant_since = due.dormantSince.toISOString()

    const { data: updated, error: updErr } = await supabase
      .from("network_contacts").update(patch).eq("id", contactId)
      .select("id, stage, reminder_override, next_due_at, next_due_reason, dormant_since").single()
    if (updErr) throw new Error(`Update failed: ${updErr.message}`)

    return withCorsJson(req, { ok: true, contact: updated }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
