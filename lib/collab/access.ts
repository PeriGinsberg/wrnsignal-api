// lib/collab/access.ts
//
// Shared coach-access check for coach-collaboration routes.
//
// Lifted EXACTLY from the inline `verifyCoachAccess` duplicated across the
// coach API routes. Rules are unchanged:
//   - the relationship row must exist in coach_clients for
//     (coach_profile_id, client_profile_id) with status = 'active'
//   - the row's access_level must satisfy the requested level, where
//       view     is granted by view | annotate | full
//       annotate is granted by annotate | full
//       full     is granted by full
// Returns the matched { id, access_level, status } row, or null on deny.
//
// The only change from the inline copies is the `supabase` param type
// (any -> SupabaseClient); the runtime query and branching are identical.

import { type SupabaseClient } from "@supabase/supabase-js"

export async function verifyCoachAccess(
  coachProfileId: string,
  clientProfileId: string,
  requiredLevel: string,
  supabase: SupabaseClient,
) {
  const levels: Record<string, string[]> = { view: ["view", "annotate", "full"], annotate: ["annotate", "full"], full: ["full"] }
  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status")
    .eq("coach_profile_id", coachProfileId)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
    .maybeSingle()
  if (!data) return null
  if (!levels[requiredLevel]?.includes(data.access_level)) return null
  return data
}
