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
