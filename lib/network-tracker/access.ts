// lib/network-tracker/access.ts
//
// The Network Tracker access gate. Reads may be done by the board OWNER or by a
// COACH with an active coach_clients link (via verifyCoachAccess). MUTATIONS are
// owner-only in v1 — a coach cannot mutate the pipeline — so mutation routes gate
// on ownership directly and do not call this with a coach path.

import { type SupabaseClient } from "@supabase/supabase-js"
import { verifyCoachAccess } from "@/lib/collab/access"

export type BoardAccess = {
  ownerClientId: string
  actingProfileId: string
  actingRole: "client" | "coach"
}

// Can `callerProfileId` reach `ownerClientId`'s board at `level`?
//   - owner (self) → always, as 'client'
//   - otherwise a coach with an active coach_clients link at >= level → 'coach'
//   - else null (403 at the call site)
export async function assertBoardAccess(
  supabase: SupabaseClient,
  callerProfileId: string,
  ownerClientId: string,
  level: "view" | "annotate" | "full",
): Promise<BoardAccess | null> {
  if (ownerClientId === callerProfileId) {
    return { ownerClientId, actingProfileId: callerProfileId, actingRole: "client" }
  }
  const access = await verifyCoachAccess(callerProfileId, ownerClientId, level, supabase)
  if (!access) return null
  return { ownerClientId, actingProfileId: callerProfileId, actingRole: "coach" }
}
