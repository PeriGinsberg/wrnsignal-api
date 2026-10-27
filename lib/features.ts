// lib/features.ts
//
// THE PLAN FLAG. One question, asked the same way everywhere: may this client
// use this feature right now?
//
// The answer lives in the database (feature_modes, one row per feature), so
// switching supporters from free to paid is an UPDATE, not a deploy:
//   off   nobody; live supporters pause, nothing is deleted
//   free  every client
//   paid  a client with a live feature_entitlements row
//
// A missing row or a failed read answers false. A feature that cannot prove it
// is on stays off.

import type { SupabaseClient } from "@supabase/supabase-js"

export type FeatureKey = "supporters"
export type FeatureMode = "off" | "free" | "paid"

export async function featureMode(supabase: SupabaseClient, feature: FeatureKey): Promise<FeatureMode> {
  const { data, error } = await supabase.from("feature_modes").select("mode").eq("feature", feature).maybeSingle()
  if (error || !data) return "off"
  const mode = String(data.mode)
  return mode === "free" || mode === "paid" ? mode : "off"
}

export async function featureAllowed(
  supabase: SupabaseClient,
  feature: FeatureKey,
  clientProfileId: string,
): Promise<boolean> {
  const mode = await featureMode(supabase, feature)
  if (mode === "off") return false
  if (mode === "free") return true
  const { data, error } = await supabase
    .from("feature_entitlements")
    .select("id")
    .eq("client_profile_id", clientProfileId)
    .eq("feature", feature)
    .is("revoked_at", null)
    .limit(1)
  if (error) return false
  return (data?.length ?? 0) > 0
}
