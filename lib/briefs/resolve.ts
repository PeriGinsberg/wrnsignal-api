// lib/briefs/resolve.ts
//
// Which campaign does this upload, plan or share belong to?
//
// THE DEFAULT IS THE MOST RECENT OPEN CAMPAIGN, and it has to be, because the
// importer and the Build button predate campaigns entirely. Making the coach
// pick every time would put a required question in front of an action that
// already worked, for the sake of a value that is almost always obvious: a
// client has one campaign running at a time.
//
// NULL IS A VALID ANSWER. A client who has never had a brief still has plans,
// and a plan with no brief_id is a plan built the old way. Nothing downstream
// requires one: the automation rules fall back to matching on the client.

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * The campaign a plan action belongs to.
 *
 * In order: what the caller said, then what the stored source was uploaded
 * for, then the newest submitted brief on this relationship.
 */
export async function resolveBriefId(
  db: SupabaseClient,
  coachClientId: string,
  explicit?: string | null,
): Promise<string | null> {
  if (explicit) {
    // Checked, not trusted. An id from a form that points at another client's
    // campaign would attach this plan to the wrong history.
    const { data } = await db.from("networking_campaign_briefs")
      .select("id").eq("id", explicit).eq("coach_client_id", coachClientId)
      .is("deleted_at", null).maybeSingle()
    if (data) return data.id as string
  }

  const { data: src } = await db.from("networking_plan_sources")
    .select("brief_id").eq("coach_client_id", coachClientId).maybeSingle()
  if (src?.brief_id) return src.brief_id as string

  const { data: latest } = await db.from("networking_campaign_briefs")
    .select("id").eq("coach_client_id", coachClientId).eq("status", "submitted")
    .is("deleted_at", null)
    .order("submitted_at", { ascending: false }).limit(1).maybeSingle()
  return (latest?.id as string) ?? null
}

/** The campaigns an import screen can choose between, newest first. */
export async function openCampaigns(
  db: SupabaseClient,
  coachClientId: string,
): Promise<{ id: string; name: string; submitted_at: string | null }[]> {
  const { data } = await db.from("networking_campaign_briefs")
    .select("id, name, submitted_at")
    .eq("coach_client_id", coachClientId).eq("status", "submitted")
    .is("deleted_at", null)
    .order("submitted_at", { ascending: false })
  return (data ?? []) as { id: string; name: string; submitted_at: string | null }[]
}
