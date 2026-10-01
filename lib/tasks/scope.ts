// lib/tasks/scope.ts
//
// "Every task belonging to this client", asked the same way everywhere.
//
// A TASK IS TIED TO A CLIENT BY EITHER OF TWO COLUMNS, and both are legitimate:
//
//   client_profile_id   the person. Set on anything created against a client.
//   coach_client_id     the relationship. Set on anything created against a
//                       coach-client row, which includes every prospect-era
//                       task written before the person had a profile at all
//                       ("Send SIGNAL invite to Eva Garcia"). On production 25
//                       tasks have this and no client_profile_id.
//
// Matching on one column alone loses the other set. Needs Your Attention
// matched on coach_client_id and so hid a hand-written task that carried only
// client_profile_id; switching it to client_profile_id would instead have
// hidden all 25 prospect-era ones. The answer is both, and it is written once
// here so two surfaces cannot drift into disagreeing about whose task this is.
//
// THE WRITE PATH FILLS THE GAP TOO. createTask now resolves coach_client_id
// whenever a client is named, so new rows carry both. This filter is what keeps
// the old rows visible, and what keeps a future row visible if that resolution
// ever fails.

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveDelegation } from "../collab/delegation"

/**
 * A PostgREST `or` expression selecting every task tied to this client.
 *
 * Returns null when the client has no relationships AND no id to match on,
 * which cannot happen in practice but would otherwise build `or=()`.
 */
export async function clientTaskFilter(
  db: SupabaseClient,
  clientProfileId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("coach_clients").select("id").eq("client_profile_id", clientProfileId)
  if (error) {
    // Reported, not swallowed into a narrower filter. Silently dropping the
    // relationship half would hide the prospect-era tasks and look like they
    // had been completed.
    console.error("[tasks] could not read the client's relationships:", error.message)
  }
  const ccIds = (data ?? []).map((r: { id: string }) => r.id)

  const parts = [`client_profile_id.eq.${clientProfileId}`]
  if (ccIds.length) parts.push(`coach_client_id.in.(${ccIds.join(",")})`)
  return parts.join(",")
}

/**
 * The relationship a task on this client belongs to, for the write path.
 *
 * ACTIVE FIRST. A client can carry a revoked relationship beside a live one
 * (a coach handover), and a new task belongs to the live one. Falls back to any
 * relationship rather than none: a task on a revoked relationship still shows
 * on the client's page, which is better than a task tied to nothing.
 *
 * Null when the client has no relationship at all, which is a real state: an
 * owner's own board has no coach.
 */
export async function coachClientIdForTask(
  db: SupabaseClient,
  clientProfileId: string,
): Promise<string | null> {
  const { data } = await db
    .from("coach_clients").select("id, status").eq("client_profile_id", clientProfileId)
    // Ordered, so two relationships do not resolve differently run to run.
    // coach_clients has no created_at; id is the stable tiebreak.
    .order("id", { ascending: true })
  const rows = (data ?? []) as { id: string; status: string }[]
  return rows.find((r) => r.status === "active")?.id ?? rows[0]?.id ?? null
}

// ---------------------------------------------------------------------------
// Whose tasks a coach may see at all
// ---------------------------------------------------------------------------
//
// THE HOLE THIS CLOSES. The list applied `assignee_profile_id = <me>` and
// nothing else, and `assignee=all` set that to null: every task in the
// database, for every coach and every client, returned to any authenticated
// coach. The single-task PATCH and DELETE checked nothing at all. The symptom
// was a task for a client the caller had no relationship with sitting in their
// queue with a Go button that returned Forbidden, which is the product telling
// somebody to do work it will not let them do.
//
// THE RULE, and it is deliberately the same one the pages enforce: a task is
// reachable if it belongs to a client in the caller's book. `coach_clients`
// with status='active' is what every client-scoped page resolves against, so
// scoping here on the same rows is what makes the Go button's promise true.
//
// A TASK WITH NO CLIENT ("Renew the Postmark domain") belongs to nobody's
// book, so it falls back to the rule the table's own RLS policy already
// states: the assignee, or whoever wrote it.
//
// ACCESS LEVEL IS NOT PART OF THIS, and that is a real limit rather than an
// oversight. The client record needs a relationship; the networking board
// needs `full`. Every row in both environments is `full` today, so the two
// coincide, and the day a `view`-level grant exists a networking task's Go
// button could still outrun it. Widening this to compare levels per
// destination needs each link to declare what it requires, which is a change
// to lib/tasks/links.ts and not to this filter.

export type TaskReach = {
  /** Coaches this caller acts as: themselves, plus principals they delegate for. */
  actingIds: string[]
  /** client_profile_id values in the caller's book. */
  clientIds: string[]
  /** coach_clients row ids in the caller's book. */
  coachClientIds: string[]
}

export async function resolveTaskReach(
  db: SupabaseClient,
  callerId: string,
): Promise<TaskReach> {
  const { actingIds } = await resolveDelegation(db, callerId)

  const { data, error } = await db
    .from("coach_clients")
    .select("id, client_profile_id")
    .in("coach_profile_id", actingIds)
    .eq("status", "active")
  if (error) {
    // NOT swallowed into an empty book. An empty book here would read as "this
    // coach has no tasks", which is indistinguishable from having finished
    // them all. Thrown, so the request fails loudly instead.
    throw new Error(`could not read the caller's clients: ${error.message}`)
  }

  const rows = (data ?? []) as { id: string; client_profile_id: string | null }[]
  return {
    actingIds,
    clientIds: [...new Set(rows.map((r) => r.client_profile_id).filter(Boolean) as string[])],
    coachClientIds: [...new Set(rows.map((r) => r.id))],
  }
}

/**
 * The PostgREST `or` expression selecting every task this caller may reach.
 *
 * Built as a string rather than applied here because the list composes it with
 * its other filters, and because the single-row guard reuses the same sets.
 */
export function taskReachFilter(reach: TaskReach): string {
  const parts: string[] = []
  if (reach.clientIds.length) parts.push(`client_profile_id.in.(${reach.clientIds.join(",")})`)
  if (reach.coachClientIds.length) parts.push(`coach_client_id.in.(${reach.coachClientIds.join(",")})`)
  // The client-less tasks. `and(...)` inside `or(...)` is PostgREST's own
  // grouping syntax; without the nesting the null checks would widen the whole
  // expression instead of narrowing this one branch.
  parts.push(
    `and(client_profile_id.is.null,coach_client_id.is.null,assignee_profile_id.in.(${reach.actingIds.join(",")}))`,
  )
  return parts.join(",")
}

/** Is this one task inside the caller's reach? For the single-row routes. */
export function taskIsReachable(
  reach: TaskReach,
  task: { client_profile_id: string | null; coach_client_id: string | null; assignee_profile_id: string },
): boolean {
  if (task.client_profile_id && reach.clientIds.includes(task.client_profile_id)) return true
  if (task.coach_client_id && reach.coachClientIds.includes(task.coach_client_id)) return true
  if (!task.client_profile_id && !task.coach_client_id) {
    return reach.actingIds.includes(task.assignee_profile_id)
  }
  return false
}

// ---------------------------------------------------------------------------
// Who a task on this client may be handed to
// ---------------------------------------------------------------------------
//
// THE OTHER HALF OF THE REACH RULE. The list hides a task from a coach outside
// the client's book; nothing stopped the task being assigned to that coach in
// the first place. The assignee picker listed every coach on the platform, and
// the Networking chain hands every campaign to fixed people, so work could land
// with somebody whose Go button then returned Forbidden and whose overdue
// digest nagged them about a task their list would not show.
//
// Same rows as resolveTaskReach, read from the client's side: every coach with
// an active relationship to this client, plus every coach delegating for one of
// them. A task with no client is reachable by whoever it is assigned to, so any
// coach may take it and this returns null.

export type TaskClient = { client_profile_id?: string | null; coach_client_id?: string | null }

export async function coachesWhoCanReach(
  db: SupabaseClient,
  client: TaskClient,
): Promise<Set<string> | null> {
  const parts: string[] = []
  if (client.client_profile_id) parts.push(`client_profile_id.eq.${client.client_profile_id}`)
  if (client.coach_client_id) parts.push(`id.eq.${client.coach_client_id}`)
  if (!parts.length) return null

  const { data, error } = await db
    .from("coach_clients").select("coach_profile_id")
    .or(parts.join(","))
    .eq("status", "active")
  if (error) throw new Error(`could not read the client's coaches: ${error.message}`)
  const principals = [...new Set((data ?? []).map((r: { coach_profile_id: string }) => r.coach_profile_id))]
  if (!principals.length) return new Set()

  const { data: dels, error: dErr } = await db
    .from("coach_delegates").select("delegate_coach_profile_id")
    .in("principal_coach_profile_id", principals)
    .eq("status", "active")
  if (dErr) throw new Error(`could not read the client's delegates: ${dErr.message}`)

  return new Set([
    ...principals,
    ...(dels ?? []).map((r: { delegate_coach_profile_id: string }) => r.delegate_coach_profile_id),
  ])
}

/** The refusal for handing a task to a coach who cannot open its client. */
export const UNREACHABLE_ASSIGNEE =
  "That coach cannot open this client, so they could not act on the task. Choose a coach who works with this client."
