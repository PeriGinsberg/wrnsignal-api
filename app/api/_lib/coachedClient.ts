// app/api/_lib/coachedClient.ts
//
// The coached-account gate — the foundational primitive every coached-client
// feature keys off. Answers, for a logged-in D2C client: "is this account being
// coached right now?"
//
// Definition: an ACTIVE coached relationship is a coach_clients row WHERE
// client_profile_id = <this client> AND status = 'active'. We key on `status`
// (active/paused/revoked/pending), NOT lifecycle_status — paused/revoked/pending
// (and no row) are all "not coached".
//
// This is the plain-CLIENT side: it takes the client's own client_profile_id and
// scopes explicitly on it (service-role bypasses RLS, so the filter — not the
// policy — is the guard). It is NOT coachAuth — no is_coach / access_level here.
//
// Shape note: today a client has at most one coach, so we return a single active
// relationship. Kept query-shaped for a future multi-coach fan-out (drop the
// limit and return the array) without changing callers' mental model.

import { type SupabaseClient } from "@supabase/supabase-js"

export type CoachRelationship = {
  id: string
  coach_profile_id: string
  access_level: string
  status: string
  lifecycle_status: string
}

const RELATIONSHIP_SELECT = "id, coach_profile_id, access_level, status, lifecycle_status"

// Return this client's active coach relationship, or null if not coached.
// Uses the reverse-direction index idx_coach_clients_client_profile_id
// (migration 20260606_coached_client_slice1.sql).
export async function getActiveCoachRelationship(
  supabase: SupabaseClient,
  clientProfileId: string,
): Promise<CoachRelationship | null> {
  const { data, error } = await supabase
    .from("coach_clients")
    .select(RELATIONSHIP_SELECT)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
    .order("accepted_at", { ascending: true, nullsFirst: true })
    .limit(1) // one coach today; drop for multi-coach fan-out later
  if (error) throw new Error(`Coached-gate lookup failed: ${error.message}`)
  return (data && data.length > 0 ? (data[0] as CoachRelationship) : null)
}

// Boolean convenience over getActiveCoachRelationship.
export async function isCoached(
  supabase: SupabaseClient,
  clientProfileId: string,
): Promise<boolean> {
  return (await getActiveCoachRelationship(supabase, clientProfileId)) !== null
}
