// app/api/coach/briefs/[briefId]/route.ts
//
// GET    one brief, with its chain.
// PATCH  edit it, or submit it.
// DELETE soft-delete a draft.
//
// SUBMITTING IS A PATCH TO status, not an endpoint of its own, because the
// coach presses Submit on a form they have been editing and the last edit and
// the submission are one action. Splitting them would let a submitted brief
// carry the values from before the final keystroke.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin, resolveCoach } from "@/app/api/_lib/coachAuth"
import {
  BRIEF_COLUMNS,
  LIST_FIELDS,
  TEXT_FIELDS,
  toList,
  validateBriefWrite,
  validateForSubmit,
  type CampaignBrief,
} from "@/lib/briefs/model"
import { emitAndRun } from "@/lib/automation/run"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest, { params }: { params: Promise<{ briefId: string }> }) {
  try {
    const { briefId } = await params
    const { error } = await resolveCoach(req)
    if (error) return error

    const db = getSupabaseAdmin()
    const { data, error: qErr } = await db.from("networking_campaign_briefs")
      .select(BRIEF_COLUMNS).eq("id", briefId).is("deleted_at", null).maybeSingle()
    if (qErr) return withCorsJson(req, { ok: false, error: qErr.message }, 500)
    if (!data) return withCorsJson(req, { ok: false, error: "That campaign no longer exists." }, 404)

    const { data: tasks } = await db.from("coach_tasks")
      .select("id, title, status, decision, assignee_profile_id, due_at, template_id, completed_at")
      .eq("brief_id", briefId).is("deleted_at", null)
      .order("created_at", { ascending: true })

    return withCorsJson(req, { ok: true, brief: data, tasks: tasks ?? [] }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/briefs GET one]", err?.stack || msg)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ briefId: string }> }) {
  try {
    const { briefId } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const db = getSupabaseAdmin()
    const { data: before } = await db.from("networking_campaign_briefs")
      .select(BRIEF_COLUMNS).eq("id", briefId).is("deleted_at", null).maybeSingle()
    if (!before) return withCorsJson(req, { ok: false, error: "That campaign no longer exists." }, 404)

    const brief = before as unknown as CampaignBrief
    const body = await req.json().catch(() => ({}))
    const submitting = body?.status === "submitted"

    // A SUBMITTED BRIEF IS NOT EDITED. Erin may already be building from it,
    // and a target list that changed underneath her would make the review
    // meaningless: she would be reviewed against a brief she never read. To
    // change a submitted campaign, start another one.
    if (brief.status === "submitted") {
      return withCorsJson(req, {
        ok: false,
        error: "This campaign has been submitted and can no longer be edited. Start a new campaign instead.",
      }, 409)
    }

    const errors = validateBriefWrite(body, { partial: true })
    if (errors.length) return withCorsJson(req, { ok: false, error: errors[0], errors }, 400)

    const patch: Record<string, any> = { updated_at: new Date().toISOString() }
    if (Object.prototype.hasOwnProperty.call(body, "name")) patch.name = String(body.name).trim()
    for (const f of LIST_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, f)) patch[f] = toList(body[f])
    }
    for (const f of TEXT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(body, f)) continue
      patch[f] = body[f] == null ? null : String(body[f]).trim() || null
    }

    if (submitting) {
      // Validated against the brief AS IT WILL BE, not as it was: the coach may
      // be adding the first primary role in the same request that submits.
      const merged = { ...brief, ...patch }
      const submitErrors = validateForSubmit(merged)
      if (submitErrors.length) {
        return withCorsJson(req, { ok: false, error: submitErrors[0], errors: submitErrors }, 400)
      }
      patch.status = "submitted"
      patch.submitted_at = new Date().toISOString()
      patch.submitted_by_id = coachProfileId
    }

    const { data, error: upErr } = await db.from("networking_campaign_briefs")
      .update(patch).eq("id", briefId).is("deleted_at", null)
      .select(BRIEF_COLUMNS).maybeSingle()
    if (upErr) return withCorsJson(req, { ok: false, error: upErr.message }, 500)
    if (!data) return withCorsJson(req, { ok: false, error: "That campaign no longer exists." }, 404)

    // THE EVENT IS EMITTED AFTER THE ROW IS SAVED, never before. A chain
    // started against a brief whose write then failed would hand Erin a task
    // pointing at nothing.
    let started: string | null = null
    if (submitting) {
      const results = await emitAndRun(db, "campaign_brief.submitted", {
        brief_id: briefId,
        coach_client_id: brief.coach_client_id,
      }, brief.client_profile_id)

      // Reported rather than assumed. If no rule fired, the coach needs to know
      // the campaign was saved and nothing was assigned, because otherwise they
      // will wait for a task that is not coming.
      const created = results.find((r) => r.outcome === "created")
      started = created ? "started" : (results[0]?.outcome ?? "no_rule")
    }

    return withCorsJson(req, { ok: true, brief: data, chain: started }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/briefs PATCH]", err?.stack || msg)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ briefId: string }> }) {
  try {
    const { briefId } = await params
    const { error } = await resolveCoach(req)
    if (error) return error

    const db = getSupabaseAdmin()
    const { data: brief } = await db.from("networking_campaign_briefs")
      .select("id, status").eq("id", briefId).is("deleted_at", null).maybeSingle()
    if (!brief) return withCorsJson(req, { ok: false, error: "That campaign no longer exists." }, 404)

    // Only a draft. A submitted brief has tasks and possibly a plan hanging off
    // it, and deleting it would orphan work somebody is doing.
    if (brief.status === "submitted") {
      return withCorsJson(req, {
        ok: false,
        error: "This campaign has been submitted, so it cannot be deleted.",
      }, 409)
    }

    const { error: delErr } = await db.from("networking_campaign_briefs")
      .update({ deleted_at: new Date().toISOString() }).eq("id", briefId)
    if (delErr) return withCorsJson(req, { ok: false, error: delErr.message }, 500)

    return withCorsJson(req, { ok: true }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/briefs DELETE]", err?.stack || msg)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}
