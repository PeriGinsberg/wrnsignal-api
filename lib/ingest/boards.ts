/**
 * The configured boards, loaded from ingest_boards.
 *
 * WAS A CONSTANT, now a table (20260918_ingest_boards.sql), so adding a board
 * or pausing one that has started failing is a row change rather than a deploy.
 *
 * The source -> adapter mapping stays in code, because it IS code: a slug with
 * no adapter is a programming error, not a data error, and it should fail
 * loudly here rather than silently skipping a board somebody configured and
 * expects results from.
 */

import { type SupabaseClient } from "@supabase/supabase-js"
import type { SourceAdapter } from "./types"
import { greenhouseAdapter } from "./greenhouse"
import { smartRecruitersAdapter } from "./smartrecruiters"

export type SourceConfig = {
  adapter: SourceAdapter
  boards: string[]
}

/** Every adapter this build knows how to run, keyed by its source slug. */
export const ADAPTERS: Record<string, SourceAdapter> = {
  [greenhouseAdapter.source]: greenhouseAdapter,
  [smartRecruitersAdapter.source]: smartRecruitersAdapter,
}

/**
 * Active boards, grouped by source, in a stable order.
 *
 * An empty table is a real state and is returned as such: the sweep then finds
 * nothing, reports found=0 and trips the zero-found alert, which is the
 * correct outcome for "nothing is configured".
 */
export async function loadSources(sb: SupabaseClient): Promise<SourceConfig[]> {
  const { data, error } = await sb
    .from("ingest_boards")
    .select("source, org_slug")
    .eq("active", true)
    .order("source")
    .order("org_slug")
  if (error) throw new Error(`could not load ingest_boards: ${error.message}`)

  const bySource = new Map<string, string[]>()
  for (const row of data || []) {
    if (!bySource.has(row.source)) bySource.set(row.source, [])
    bySource.get(row.source)!.push(row.org_slug)
  }

  const out: SourceConfig[] = []
  const unknown: string[] = []
  for (const [source, boards] of bySource) {
    const adapter = ADAPTERS[source]
    if (!adapter) {
      unknown.push(source)
      continue
    }
    out.push({ adapter, boards })
  }

  // A configured board nobody can run is worse than a missing one: it looks
  // configured and silently produces nothing. Fail rather than skip.
  if (unknown.length) {
    throw new Error(
      `ingest_boards names source(s) with no adapter in this build: ${unknown.join(", ")}. ` +
        `Known: ${Object.keys(ADAPTERS).join(", ")}`
    )
  }
  return out
}
