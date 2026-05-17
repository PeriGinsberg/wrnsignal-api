// lib/positioning/v2/phase2/draftCache.ts
//
// Pure helpers for the /draft endpoint's caching layer. The endpoint
// stores AI-generated drafts on phase2_runs.state.items
// (draft_options for headlines, draft for bullets/gaps) and uses these
// fields as a cache to avoid re-calling AI on every page-load.
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §6.5.3 — /draft endpoint spec; `regenerate?: boolean` flag bypasses
//            cache when explicitly set
//
// Types: ./types.ts (PhaseTwoItem discriminated union)
//
// Pure functions — no I/O, no async, no Supabase. Same (item, regenerate)
// always produces the same result.

import type { PhaseTwoItem } from "./types"

/**
 * Decide whether the /draft endpoint should return cached drafts or call
 * the AI client.
 *
 * Returns true (use cache, don't call AI) when:
 *   - regenerate flag is NOT true (true forces bypass), AND
 *   - cached drafts exist on the item:
 *     • Headline: draft_options.length > 0
 *     • Bullet/Gap: draft !== null
 *
 * Returns false (call AI) when:
 *   - regenerate === true (explicit bypass)
 *   - OR no cached drafts present
 *
 * Notes:
 *   - regenerate=undefined or regenerate=false both mean "use cache if
 *     available." Only regenerate===true forces bypass.
 *   - Cache bypass does NOT clear the existing cache — the new AI drafts
 *     simply overwrite them in state.items via the /draft handler's
 *     state-write step.
 */
export function shouldUseCachedDrafts(
  item: PhaseTwoItem,
  regenerate: boolean | undefined,
): boolean {
  if (regenerate === true) return false
  if (item.type === "headline") return item.draft_options.length > 0
  return item.draft !== null
}

/**
 * Extract the cached drafts from an item in a uniform array shape.
 * For Pattern A (headline): returns draft_options directly (1-3 elements).
 * For Patterns B/C: returns [item.draft] (1 element) if draft is set,
 * else empty array.
 *
 * Caller should check shouldUseCachedDrafts() first — calling this on an
 * item without cached drafts returns an empty array, which is not a valid
 * /draft response shape (frontend would render nothing).
 */
export function getCachedDrafts(item: PhaseTwoItem): string[] {
  if (item.type === "headline") return item.draft_options
  if (item.draft !== null) return [item.draft]
  return []
}
