// app/api/_lib/clientHistoryBoundary.ts
//
// Single chokepoint for the returning-client "clean slate" rule. There is no
// shared client-read path today, which is why old data leaks onto a returning
// client's own view; this centralizes the filter so every client-hung read
// inherits the boundary identically.
//
// The boundary lives on client_profiles.history_boundary_at (NULL = show all).
// It is stamped at engagement start for a returning client so their OWN Coaches
// Hub / job tracker / run history render only rows with created_at >= boundary.
// Coach-side reads (scoped by client_profile_id) are deliberately NOT filtered.

import type { SupabaseClient } from "@supabase/supabase-js"

// Resolve the boundary for a client profile. NULL = show all history.
// One small read; routes that already fetch the profile row may instead select
// history_boundary_at inline and skip this call.
export async function getHistoryBoundary(
  supabase: SupabaseClient,
  profileId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("client_profiles")
    .select("history_boundary_at")
    .eq("id", profileId)
    .maybeSingle<{ history_boundary_at: string | null }>()
  return data?.history_boundary_at ?? null
}

// Apply the boundary to any client-hung read. No-op when boundaryAt is null, so
// every existing user (boundary null) is byte-identical. Every client-hung
// table has a created_at column (verified in recon). Q is preserved so the
// caller keeps chaining .order/.limit/.maybeSingle; the (as any).gte cast
// sidesteps Supabase's narrowly-typed column generics without loosening the
// caller's type.
export function applyHistoryBoundary<Q>(query: Q, boundaryAt: string | null): Q {
  return boundaryAt ? (query as any).gte("created_at", boundaryAt) : query
}
