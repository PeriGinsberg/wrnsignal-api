// lib/positioning/v2/phase2/decisionResolver.ts
//
// Pure function that resolves the final accepted text from a /decide request
// + the current state of the item being decided. Extracted from the route
// handler so the decision-resolution logic (which has many branches and
// edge cases) can be unit-tested in isolation without DB or HTTP fixtures.
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §6.5.4 — /decide endpoint request semantics
//   §6.9.1 — manual-entry mode flow (manual_entry flag origin)
// Types: ./types.ts (PhaseTwoItem discriminated union)
//
// Pure function — no I/O, no async, no Supabase, no time-of-day.
// Same (item, request) always produces the same result.

import type { PhaseTwoItem } from "./types"

/**
 * The decision-relevant fields from a POST /decide request body.
 *
 * The full request body also has `item_id` (which the route uses to look
 * up the item before calling this resolver). item_id is excluded from
 * this shape since the resolver receives the already-looked-up `item`.
 */
export type DecideRequestFields = {
  decision: "accept" | "decline" | "skip"
  edited_text?: string
  selected_draft_index?: number
  manual_entry?: boolean
}

/**
 * Outcome of resolving the decision into a concrete `final_text`.
 *
 * On success:
 *   - decline/skip: final_text=null (no content contributed to resume)
 *   - accept: final_text=<the resolved string>
 *
 * On failure: route should return 400 with `error` as the error code.
 */
export type ResolveFinalTextResult =
  | {
      ok: true
      /** null for decline/skip; the resolved string for accept. */
      final_text: string | null
      /** True only when accept came via manual-entry-mode flow (§6.9.1). */
      manual_entry: boolean
    }
  | {
      ok: false
      /** Snake_case error code; route returns 400 with this verbatim. */
      error: string
    }

/**
 * Resolve the final accepted text from a /decide request.
 *
 * Resolution precedence (per FRD §6.5.4 + the 2026-05-16 design
 * conversation's decision table):
 *
 * decline/skip:
 *   - final_text=null regardless of any other request fields
 *
 * accept (cross-cutting):
 *   - manual_entry=true requires edited_text; otherwise → 400
 *     `edited_text_required_for_manual_entry`
 *
 * accept on headline (Pattern A):
 *   - edited_text present: final_text=edited_text (overrides any
 *     selected_draft_index; user picked then edited, or typed from scratch)
 *   - edited_text absent, selected_draft_index present:
 *     final_text=item.draft_options[selected_draft_index]
 *     • out-of-range index → 400 `selected_draft_index_out_of_range`
 *     • empty string at that index → 400 `invalid_selected_draft`
 *       (defensive: a populated index pointing at "" indicates AI returned
 *       empty draft; refuse to compose an empty headline)
 *   - both absent → 400 `missing_selection`
 *
 * accept on bullet or gap (Patterns B and C):
 *   - selected_draft_index present → 400
 *     `selected_draft_index_only_for_headlines` (frontend bug)
 *   - edited_text present: final_text=edited_text
 *   - edited_text absent, item.draft present: final_text=item.draft
 *   - both absent → 400 `missing_draft_or_edit` (no /draft called yet
 *     and no manual edit provided)
 *
 * Notes the route handler must apply OUTSIDE this resolver:
 *   - Set item.accepted/declined/skipped based on decision
 *   - Set item.decided_at = now()
 *   - For headline accept: if selected_draft_index provided, set
 *     item.selected_draft_index; if edited_text provided WITHOUT
 *     selected_draft_index, set item.user_override_text = edited_text
 *     (user typed from scratch)
 *   - For bullet/gap accept: no extra mutations beyond final_text
 *
 * @param item The item being decided (looked up from state.items by item_id)
 * @param req The decision-relevant fields from the request body
 * @returns Resolution result — ok=true with final_text + manual_entry, OR
 *          ok=false with an error code
 */
export function resolveFinalText(
  item: PhaseTwoItem,
  req: DecideRequestFields,
): ResolveFinalTextResult {
  // ── decline / skip — no content resolution needed ─────────────────────
  if (req.decision === "decline" || req.decision === "skip") {
    return { ok: true, final_text: null, manual_entry: false }
  }

  // ── accept — manual_entry validation (cross-cutting) ──────────────────
  if (req.manual_entry === true && !req.edited_text) {
    return { ok: false, error: "edited_text_required_for_manual_entry" }
  }

  // ── accept on headline (Pattern A) ────────────────────────────────────
  if (item.type === "headline") {
    // edited_text takes precedence (overrides selected_draft_index even
    // if both provided — user picked then edited)
    if (req.edited_text !== undefined) {
      return {
        ok: true,
        final_text: req.edited_text,
        manual_entry: req.manual_entry === true,
      }
    }
    if (req.selected_draft_index !== undefined) {
      const idx = req.selected_draft_index
      if (idx < 0 || idx >= item.draft_options.length) {
        return { ok: false, error: "selected_draft_index_out_of_range" }
      }
      const draft = item.draft_options[idx]
      if (draft === "") {
        return { ok: false, error: "invalid_selected_draft" }
      }
      return {
        ok: true,
        final_text: draft,
        manual_entry: false,
      }
    }
    return { ok: false, error: "missing_selection" }
  }

  // ── accept on bullet or gap (Patterns B and C) ────────────────────────
  // Reject selected_draft_index on non-headlines (frontend bug)
  if (req.selected_draft_index !== undefined) {
    return { ok: false, error: "selected_draft_index_only_for_headlines" }
  }

  if (req.edited_text !== undefined) {
    return {
      ok: true,
      final_text: req.edited_text,
      manual_entry: req.manual_entry === true,
    }
  }

  if (item.draft === null) {
    return { ok: false, error: "missing_draft_or_edit" }
  }

  return {
    ok: true,
    final_text: item.draft,
    manual_entry: false,
  }
}
