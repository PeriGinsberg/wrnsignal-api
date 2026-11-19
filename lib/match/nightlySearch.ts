// Which clients the nightly job-sourcing run includes. Same condition the run
// uses to pick its clients (lib/pipeline/tick.ts, lib/pipeline/pairs.ts): a
// client_match_criteria row with active = true. Drives the "Nightly Search"
// pill on the coach client page and the My Clients list.

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * The subset of `clientProfileIds` the nightly run includes, in ONE query.
 * A failed read is logged and returns an empty set: the pill is informational,
 * so it hides rather than breaking the page.
 */
export async function nightlySearchClientIds(sb: SupabaseClient, clientProfileIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(clientProfileIds.filter(Boolean))]
  if (!ids.length) return new Set()
  const { data, error } = await sb
    .from("client_match_criteria")
    .select("client_profile_id")
    .in("client_profile_id", ids)
    .eq("active", true)
  if (error) {
    console.error("[nightlySearch] client_match_criteria:", error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r: { client_profile_id: string }) => r.client_profile_id))
}
