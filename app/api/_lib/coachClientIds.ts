// app/api/_lib/coachClientIds.ts
//
// Every coach_clients.id sharing a client_profile_id. The Shape-1 collaboration
// re-scope reads notes / documents / action-items across ALL of a client's
// coach relationships, so both coaches — and a soft-revoked coach's historical
// notes — stay in one shared feed.
//
//   activeOnly: true  → current collaborators only (coach list + guards).
//   activeOnly: false → all statuses (default). A revoked coach's authored
//     notes persist, which is the whole point of soft-revoke.
//
// Byte-identical for a genuinely single-coach client: the (coach_profile_id,
// client_profile_id) unique constraint means exactly one row exists, so the set
// == today's single coach_client_id. The only place the set grows is a client
// that has a second (or prior-revoked) coach — the intended collaboration case.

import type { SupabaseClient } from "@supabase/supabase-js"

export async function coachClientIdsForClient(
  supabase: SupabaseClient,
  clientProfileId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<string[]> {
  let q = supabase
    .from("coach_clients")
    .select("id")
    .eq("client_profile_id", clientProfileId)
  if (opts.activeOnly) q = q.eq("status", "active")
  const { data, error } = await q
  if (error) throw new Error(`coachClientIdsForClient failed: ${error.message}`)
  return (data ?? []).map((r: { id: string }) => r.id)
}
