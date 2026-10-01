// lib/practice/server.ts
//
// Who is allowed to touch a practice round, and the loader both sides share.
//
// AUTHORISATION AND DATA ACCESS ARE SEPARATE HERE. Access is decided by
// resolveActor/resolveScope, the same as the workbook routes; the queries then
// run as the service role, because the practice tables carry SELECT-only RLS
// and inserting a take is a write. That split is deliberate: the RLS policies
// exist so the tables are safe if something ever reads them directly, and the
// scope check is what actually guards the routes.

import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabaseAdmin } from "@/app/api/_lib/coachAuth"
import { ForbiddenError, resolveActor, resolveScope } from "@/lib/collab/scope"
import type { PracticeQuestion, PracticeRound, PracticeTake } from "./model"
import { createTask, setTaskStatus } from "@/lib/tasks/service"
import { practiceRoundLink } from "@/lib/tasks/links"

export class NotFoundError extends Error {
  readonly status = 404
  constructor(message = "Not found") {
    super(message)
    this.name = "NotFoundError"
  }
}

export const ROUND_COLUMNS =
  "id, coach_client_id, client_profile_id, coach_profile_id, title, status, created_at, sent_at, submitted_at, fb_overall, feedback_sent_at"

/**
 * A coach acting on one client, full access only.
 *
 * Also resolves the coach_clients row, which Scope does not carry and which
 * every practice row needs. The row belongs to `viaCoachId` when a delegate is
 * acting, so a round built by a delegate still hangs off the principal's
 * relationship rather than creating a second one.
 */
export async function coachPracticeScope(req: Request, clientId: string) {
  const actor = await resolveActor(req)
  if (!actor.isCoach) throw new ForbiddenError("Forbidden")
  const scope = await resolveScope(await callerFor(req), actor, { subject: clientId, require: "write" })
  if (scope.actorRole !== "coach") throw new ForbiddenError("Forbidden")

  const db = getSupabaseAdmin()
  const owningCoach = scope.viaCoachId ?? actor.actorId
  const { data: cc, error } = await db
    .from("coach_clients")
    .select("id")
    .eq("client_profile_id", scope.subjectId)
    .eq("coach_profile_id", owningCoach)
    // NO deleted_at ON THIS TABLE. It uses `status` ('active', 'revoked'),
    // and a revoked relationship is not one you may send practice rounds
    // through. Assumed the soft-delete column and got a 500 on staging.
    .eq("status", "active")
    .maybeSingle()
  if (error) throw new Error(`resolve coach_client: ${error.message}`)
  if (!cc) throw new ForbiddenError("Forbidden")

  return { db, scope, actorId: actor.actorId, coachClientId: cc.id as string, owningCoach }
}

/** The client acting on their own round. */
export async function clientPracticeScope(req: Request) {
  const actor = await resolveActor(req)
  return { db: getSupabaseAdmin(), actorId: actor.actorId }
}

// resolveScope wants a caller-JWT client to read the relationship through RLS.
async function callerFor(req: Request): Promise<SupabaseClient> {
  const { getCallerClient } = await import("@/lib/supabase/caller")
  return getCallerClient(req)
}

/**
 * Load a round with its questions and takes, and check the caller is on it.
 *
 * `as` decides which side of the relationship is being claimed. A client
 * reaching a draft gets a 404 rather than a 403: a round the coach has not
 * sent should not be discoverable at all, and "not found" is the honest answer
 * to "is there a round here for me".
 */
export async function loadRound(
  db: SupabaseClient,
  roundId: string,
  viewer: { id: string; as: "coach" | "client" },
): Promise<{ round: PracticeRound; takes: PracticeTake[] }> {
  const { data: r, error } = await db
    .from("practice_rounds")
    .select(ROUND_COLUMNS)
    .eq("id", roundId)
    .is("deleted_at", null)
    .maybeSingle()
  if (error) throw new Error(`load round: ${error.message}`)
  if (!r) throw new NotFoundError()

  if (viewer.as === "client") {
    if (r.client_profile_id !== viewer.id) throw new NotFoundError()
    if (r.status === "draft") throw new NotFoundError()
  }

  const { data: qs, error: qErr } = await db
    .from("practice_questions")
    .select("id, position, text, source, fb_works, fb_fix")
    .eq("round_id", roundId)
    .order("position", { ascending: true })
  if (qErr) throw new Error(`load questions: ${qErr.message}`)

  const { data: ts, error: tErr } = await db
    .from("practice_takes")
    .select("id, question_id, storage_path, mime, duration_ms, created_at")
    .eq("round_id", roundId)
    .order("created_at", { ascending: true })
  if (tErr) throw new Error(`load takes: ${tErr.message}`)

  return {
    round: { ...(r as any), questions: (qs ?? []) as PracticeQuestion[] },
    takes: (ts ?? []) as PracticeTake[],
  }
}

/**
 * A short-lived signed URL per take, so the coach can play them back.
 *
 * The bucket is private, so this is the only way in. Ten minutes is long
 * enough to watch six ninety-second answers and short enough that a URL
 * pasted somewhere stops working.
 */
export async function signTakes(
  db: SupabaseClient,
  takes: PracticeTake[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!takes.length) return out
  const { data, error } = await db.storage
    .from("practice-takes")
    .createSignedUrls(takes.map((t) => t.storage_path), 600)
  if (error) {
    console.error("[practice] signing playback URLs failed:", error.message)
    return out
  }
  ;(data ?? []).forEach((d, i) => {
    if (d.signedUrl) out[takes[i].id] = d.signedUrl
  })
  return out
}

/**
 * Raise a Required Action for the coach.
 *
 * coach_tasks, NOT coach_client_notes. Needs-attention stopped counting
 * action_item notes on 2026-09-26 when those rows were migrated into
 * coach_tasks, so a note written today would never surface. See the header of
 * app/api/coach/clients/[clientId]/needs-attention/route.ts.
 *
 * THROUGH createTask, NOT A RAW INSERT. The insert this replaced skipped the
 * audit event, the History line, the assignment email and the is-a-coach
 * check, because those live in lib/tasks/service.ts and nowhere else. The
 * actor is null: SIGNAL raised this, not the coach it is for.
 */
export async function raiseCoachTask(
  db: SupabaseClient,
  args: {
    coachClientId: string
    clientProfileId: string
    assigneeProfileId: string
    title: string
    description?: string
    /** Where the work is done. Required: this raises a system task. */
    link: string
  },
): Promise<string | null> {
  const r = await createTask(db, {
    coach_client_id: args.coachClientId,
    client_profile_id: args.clientProfileId,
    assignee_profile_id: args.assigneeProfileId,
    title: args.title,
    description: args.description ?? null,
    source: "auto",
    link: args.link,
  }, null)
  if (!r.ok) {
    // The work that triggered this still happened. A missing task is a missing
    // reminder, not a reason to fail the request.
    console.error("[practice] raising coach task failed:", r.error)
    return null
  }
  return r.data.id
}

/**
 * Close the "Watch <name>'s practice round" task once feedback is released.
 *
 * FOUND BY ITS LINK, which is built by the same practiceRoundLink the submit
 * route used to create it. The first cut matched the round id inside the
 * description; the id moved out of the description into `link` on 2026-09-29
 * and the match silently found nothing, so no feedback ever closed its task.
 *
 * Closed through setTaskStatus, so it gets the audit event, the History line
 * and the task.completed automation event every other completion gets.
 * Returns how many tasks were closed. Never throws.
 */
export async function closePracticeRoundTask(
  db: SupabaseClient,
  round: { id: string; coach_client_id: string },
  actorId: string,
): Promise<number> {
  const { data, error } = await db
    .from("coach_tasks")
    .select("id")
    .eq("coach_client_id", round.coach_client_id)
    .eq("link", practiceRoundLink(round.id))
    .eq("status", "open")
    .is("deleted_at", null)
  if (error) {
    console.error("[practice] finding the round's task failed:", error.message)
    return 0
  }
  let closed = 0
  for (const t of data ?? []) {
    const r = await setTaskStatus(db, t.id, "done", actorId)
    if (r.ok) closed++
    else console.error("[practice] closing the round's task failed:", r.error)
  }
  return closed
}
