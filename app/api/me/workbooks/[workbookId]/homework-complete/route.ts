// app/api/me/workbooks/[workbookId]/homework-complete/route.ts
//
// POST — the client marks a session workbook's homework complete.
//
// FOUR EFFECTS, IN THIS ORDER, AND ONLY THE FIRST IS GUARANTEED:
//   1. workbook_mark_homework_complete() stamps the workbook, in one
//      transaction. It reports `fired` true only for the call that actually set
//      the timestamp, so a second press (or a second tab) changes nothing. That
//      one-shot is what every step below relies on not to happen twice.
//   2. On `fired`, a History event.
//   3. On `fired`, and only for a session with a preset (see
//      lib/practice/presets.ts), SIGNAL builds that session's fixed practice
//      round, marks it sent, and emails the client straight away.
//   4. On `fired`, the coach's task. Its wording and its Go destination depend
//      on whether step 3 actually sent: read the homework, or build a round.
//   5. On `fired`, and only for a session WITHOUT a preset, this posts to
//      GHL_HOMEWORK_WEBHOOK_URL. Where SIGNAL sends its own round it has
//      already done the job that webhook exists to trigger, and firing both
//      would put two practice links in one inbox.
//
// Nothing after step 1 may cost the client their completion, so each is
// best-effort: failures are logged and reported, never retried in a loop, and
// never roll step 1 back. homework_webhook_at stays empty until a POST lands.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { workbookError } from "../../../../_lib/workbookError"
import { logCoachClientEvent } from "../../../../_lib/coachClientEvents"
import { clientWorkbookScope, rpcError } from "@/lib/workbook/server"
import { raiseCoachTask } from "@/lib/practice/server"
import { clientLink, workbookLink } from "@/lib/tasks/links"
import { presetForSession } from "@/lib/practice/presets"
import { createAndSendPresetRound } from "@/lib/practice/autoRound"
import { getSupabaseAdmin } from "../../../../_lib/coachAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WEBHOOK_TIMEOUT_MS = 8000

/**
 * Which session this workbook is, for the webhook.
 *
 * The template STATES it (content.session). The regex over template_id is only
 * for workbooks created before templates did that, and it is not a fallback for
 * "no idea": a workbook that can answer neither is reported, loudly, rather than
 * being sent as Session 1, which is what this code used to do to anything
 * without a template_id.
 */
function sessionNumber(stated: number | null, templateId: string | null, workbookId: string): number {
  if (typeof stated === "number" && Number.isInteger(stated) && stated > 0) return stated
  const m = (templateId ?? "").match(/session-(\d+)/i)
  if (m) return Number(m[1])
  console.error(
    "[homework-complete] no session number on workbook", workbookId,
    `(template_id: ${templateId ?? "none"}); reporting 1`,
  )
  return 1
}

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ workbookId: string }> }) {
  try {
    const { workbookId } = await params
    const { supabase, actorId } = await clientWorkbookScope(req)

    const { data, error } = await supabase.rpc("workbook_mark_homework_complete", { p_workbook: workbookId })
    if (error) throw rpcError("mark homework complete", error)
    const r = data as {
      fired: boolean; completed_at: string; webhook_sent_at: string | null
      email: string; first_name: string; last_name: string | null
      template_id: string | null; session: number | null; title: string
      coach_client_id: string | null
    }
    const session = sessionNumber(r.session, r.template_id, workbookId)

    // On the History timeline once, for the call that actually completed it.
    if (r.fired && r.coach_client_id) {
      await logCoachClientEvent({
        coachClientId: r.coach_client_id,
        eventType: "homework_complete",
        actorProfileId: actorId,
        context: { title: r.title, session },
      })
    }

    // ── One task, not two ─────────────────────────────────────────────
    //
    // A REAL TASK, not a coach_client_notes action_item. needs-attention
    // stopped counting those on 2026-09-26, so the note this RPC still writes
    // does not reach the coach's queue; this is what actually surfaces.
    //
    // THE RPC USED TO RAISE ONE TOO, and the two said the same thing in
    // different words: "X finished the homework: <title>" pointing at the
    // Workbooks tab, and "Build a practice round for X" pointing at Practice.
    // Reading the homework and deciding what to practise is one job, so it is
    // one row now and the RPC's insert is gone.
    //
    // Fired once, with the completion, and never retried: a duplicate reminder
    // is worse than a late one, and the coach can always start a round by hand.
    // The same one-shot guard is what stops a client pressing the button twice
    // from being sent two practice rounds.

    // Non-null when this session sends its own round. Read here rather than
    // inside the block because the webhook further down needs it too.
    const preset = presetForSession(session)

    if (r.fired && r.coach_client_id) {
      const admin = getSupabaseAdmin()
      // The RPC does not return these and changing its signature would mean a
      // production migration for a staging feature, so they are read here.
      const { data: cc } = await admin
        .from("coach_clients")
        .select("client_profile_id, coach_profile_id")
        .eq("id", r.coach_client_id)
        .maybeSingle()
      if (cc?.client_profile_id && cc?.coach_profile_id) {
        // WHOSE NAME THIS IS, and why it is not the RPC's.
        //
        // The function reads content.client.first_name first, which is a
        // snapshot taken when the workbook was created. On staging Jordan
        // Demo's Session 1 workbook carries "Ryan", so the coach's task read
        // "Ryan finished Session 1 homework" about a client called Jordan.
        //
        // The snapshot is right for the workbook's own prose, which is a
        // document addressed to whoever it was written for. It is wrong for
        // naming a client to their coach, and wrong for greeting them in an
        // email: the profile is the live record of who this person is. So the
        // profile wins here, and the RPC's value is the fallback for a profile
        // with no name on it.
        const { data: clientProfile } = await admin
          .from("client_profiles").select("name").eq("id", cc.client_profile_id).maybeSingle()
        const first =
          String(clientProfile?.name ?? "").trim().split(/\s+/)[0] ||
          (r.first_name ?? "your client").trim()

        // ── The automatic round, for sessions that have a preset ────────
        //
        // BEFORE THE TASK, so the task can tell the truth. Its wording says
        // the round "was sent automatically", and raising that before the
        // send has happened would make it a claim rather than a report. If
        // the send fails the coach gets the ordinary build-it-yourself task
        // instead, which is the correct fallback and needs no other handling.
        let autoSent = false
        if (preset) {
          const { data: coach } = await admin
            .from("client_profiles").select("name").eq("id", cc.coach_profile_id).maybeSingle()
          const sent = await createAndSendPresetRound(admin, {
            preset,
            coachClientId: r.coach_client_id,
            clientProfileId: cc.client_profile_id,
            coachProfileId: cc.coach_profile_id,
            clientEmail: r.email ?? null,
            clientFirstName: first,
            coachName: String(coach?.name ?? "").trim().split(/\s+/)[0] || "Your coach",
          })
          autoSent = sent.ok
          if (!sent.ok) {
            console.error("[homework-complete] preset round failed:", sent.reason, "workbook:", workbookId)
          }
        }

        await raiseCoachTask(admin, {
          coachClientId: r.coach_client_id,
          clientProfileId: cc.client_profile_id,
          assigneeProfileId: cc.coach_profile_id,
          // ONE SENTENCE EACH, split at the wording's own full stop. The
          // title is what happened and the description is what to do about
          // it, which is the shape every other task has and the shape TaskRow
          // renders: title on one line, description as the snippet under it.
          // Kept as one long title it would have been ellipsised on the
          // dashboard card, which is the surface most coaches read first.
          title: `${first} finished Session ${session} homework`,
          description: autoSent
            ? "Review it. Their practice round was sent automatically."
            : "Review it and build their practice round.",
          // WHERE THE WORK IS. When the round went by itself there is nothing
          // to build, so the job is reading the homework and the link opens
          // that workbook. When it did not, the job is building a round, and
          // the Practice tab is where that happens.
          link: autoSent
            ? workbookLink(cc.client_profile_id, workbookId)
            : clientLink(cc.client_profile_id, "practice"),
        })
      }
    }

    // ── GHL, for the sessions SIGNAL does not own yet ───────────────────
    //
    // The webhook exists to make GoHighLevel send the homework-complete email
    // with the VideoAsk link. For a session with a preset, SIGNAL has just
    // done that job itself, with its own email and its own round: firing the
    // webhook as well would put two practice links in the same inbox, minutes
    // apart, pointing at two different systems.
    //
    // KEYED ON THE PRESET, not on `session === 1`. The day Session 3 gets a
    // preset, its webhook stops too, and nobody has to remember this line.
    // Sessions that are still coach-built keep firing it unchanged.
    let webhook: "sent" | "skipped" | "not_configured" | "failed" | "superseded" =
      r.fired ? "not_configured" : "skipped"
    const url = process.env.GHL_HOMEWORK_WEBHOOK_URL
    if (r.fired && preset) webhook = "superseded"

    if (r.fired && url && !preset) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: r.email,
            first_name: r.first_name,
            last_name: r.last_name ?? "",
            session,
            event: "homework_complete",
            workbook_id: workbookId,
          }),
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`webhook responded ${res.status}`)
        webhook = "sent"
        const { error: stampErr } = await supabase.rpc("workbook_record_homework_webhook", { p_workbook: workbookId })
        if (stampErr) console.error("[homework-complete] stamp failed:", stampErr.message)
      } catch (e: any) {
        // The completion stands; only the notification is missing.
        webhook = "failed"
        console.error("[homework-complete] webhook failed:", e?.message ?? e, "workbook:", workbookId)
        // A silent failure is the reason this event exists: the coach is
        // otherwise told nothing, and a console line is not somewhere they
        // look. Logged with no actor, because nobody did it: the system tried
        // and the far end did not answer.
        if (r.coach_client_id) {
          await logCoachClientEvent({
            coachClientId: r.coach_client_id,
            eventType: "homework_webhook_failed",
            actorProfileId: null,
            context: { title: r.title, session, reason: String(e?.message ?? e).slice(0, 200) },
          })
        }
      }
    }

    return withCorsJson(req, { ok: true, completed_at: r.completed_at, first_time: r.fired, webhook }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
