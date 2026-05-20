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
 * Gap compositional outcome literal union. Originally 4 values in C1;
 * expanded to 9 in C2 for shape-routed section inserts.
 *
 * Set on a gap item when the user accepts and picks how that gap should
 * flow into the revised resume. Mirrors PhaseTwoGapItem.compositional_
 * outcome in lib/positioning/v2/phase2/types.ts (the two declarations
 * are kept in lockstep at every commit — duplication is intentional, see
 * the per-field JSDoc on PhaseTwoGapItem for the cross-module type-cycle
 * rationale).
 *
 * Composer behavior (resumeComposer.ts) per outcome:
 *   - reword_existing_bullet: locate-and-replace on target_bullet_text
 *   - add_new_bullet:         append after last bullet-bearing line
 *   - add_to_skills_list:     append to skills / core-competencies section (B3/B4)
 *   - add_certification:      insert under certifications header (B3/B4)
 *   - add_tool_or_software:   append to tools line / skills section (B3/B4)
 *   - add_language:           append to languages line (B3/B4)
 *   - add_to_coursework:      append to coursework list in education (B3/B4)
 *   - note_for_cover_letter:  no resume change; surfaced on completion screen
 *   - acknowledge_genuine_gap:no resume change; surfaced on completion screen
 */
export type CompositionalOutcome =
  | "reword_existing_bullet"
  | "add_new_bullet"
  | "add_to_skills_list"
  | "add_certification"
  | "add_tool_or_software"
  | "add_language"
  | "add_to_coursework"
  | "note_for_cover_letter"
  | "acknowledge_genuine_gap"

/**
 * Canonical set of valid compositional outcome strings. Exported so
 * (a) route.ts validateBody can reject unknown strings without
 * duplicating the literal-union list, and (b) future call sites (e.g.
 * frontend D1 if it ever wants the canonical set, or analytics
 * pipelines) can import a single source of truth.
 *
 * Add new outcomes to BOTH this set and the CompositionalOutcome union
 * above. The `satisfies ReadonlySet<CompositionalOutcome>` clause
 * type-checks the membership at compile time — drift between the union
 * and the set produces a tsc error rather than a runtime divergence.
 */
export const VALID_OUTCOMES: ReadonlySet<CompositionalOutcome> = new Set<CompositionalOutcome>([
  "reword_existing_bullet",
  "add_new_bullet",
  "add_to_skills_list",
  "add_certification",
  "add_tool_or_software",
  "add_language",
  "add_to_coursework",
  "note_for_cover_letter",
  "acknowledge_genuine_gap",
])

/**
 * The decision-relevant fields from a POST /decide request body.
 *
 * The full request body also has `item_id` (which the route uses to look
 * up the item before calling this resolver). item_id is excluded from
 * this shape since the resolver receives the already-looked-up `item`.
 *
 * C1 adds `compositional_outcome` + `target_bullet_text`. These are
 * meaningful ONLY on gap items with `decision: "accept"`:
 *   - On a gap accept: `compositional_outcome` is REQUIRED. If
 *     `compositional_outcome === "reword_existing_bullet"`,
 *     `target_bullet_text` is also REQUIRED and must appear verbatim in
 *     `resumeText` (resumeComposer locate-and-replace dependency, FRD
 *     section 6.10).
 *   - On non-gap items OR on decline/skip: both fields are IGNORED
 *     permissively (no 400). The resolver logs a console warning on
 *     unused-field presence so frontend bugs are debuggable.
 */
export type DecideRequestFields = {
  decision: "accept" | "decline" | "skip"
  edited_text?: string
  selected_draft_index?: number
  manual_entry?: boolean
  /** C1: required on gap accept; ignored on non-gap or decline/skip. */
  compositional_outcome?: CompositionalOutcome
  /** C1: required when compositional_outcome === "reword_existing_bullet". */
  target_bullet_text?: string
}

/**
 * Outcome of resolving the decision into a concrete `final_text` plus
 * any gap-specific persistence fields the route must write to state.items.
 *
 * On success:
 *   - decline/skip: final_text=null, compositional_outcome=null,
 *     target_bullet_text=null
 *   - non-gap accept (headline/bullet): final_text=<resolved>,
 *     compositional_outcome=null, target_bullet_text=null
 *   - gap accept: final_text=<resolved>, compositional_outcome=<the
 *     payload's outcome>, target_bullet_text=<the payload's value if
 *     outcome is "reword_existing_bullet", else null>
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
      /**
       * C1: set on gap accept; null otherwise. Route writes to
       * state.items[i].compositional_outcome.
       */
      compositional_outcome: CompositionalOutcome | null
      /**
       * C1: set on gap accept with outcome="reword_existing_bullet"; null
       * otherwise. Always a verbatim substring of resumeText when
       * non-null (resolver enforced the invariant). Route writes to
       * state.items[i].target_bullet_text.
       */
      target_bullet_text: string | null
    }
  | {
      ok: false
      /** Snake_case error code; route returns 400 with this verbatim. */
      error: string
    }

/**
 * Resolve the final accepted text from a /decide request, plus any
 * gap-specific persistence fields (C1).
 *
 * Resolution precedence (per FRD §6.5.4 + the 2026-05-16 design
 * conversation's decision table):
 *
 * decline/skip:
 *   - final_text=null regardless of any other request fields
 *   - compositional_outcome=null, target_bullet_text=null (C1: ignore
 *     any payload values; log warning if present)
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
 *   - C1 fields ignored permissively (warn if present)
 *
 * accept on bullet (Pattern B):
 *   - selected_draft_index present → 400
 *     `selected_draft_index_only_for_headlines` (frontend bug)
 *   - edited_text present: final_text=edited_text
 *   - edited_text absent, item.draft present: final_text=item.draft
 *   - both absent → 400 `missing_draft_or_edit`
 *   - C1 fields ignored permissively (warn if present)
 *
 * accept on gap (Pattern C, C1):
 *   - All Pattern B resolution rules apply for final_text.
 *   - compositional_outcome REQUIRED:
 *     • missing → 400 `compositional_outcome_required`
 *   - If compositional_outcome === "reword_existing_bullet":
 *     • target_bullet_text REQUIRED → missing → 400
 *       `target_bullet_text_required`
 *     • target_bullet_text MUST be a verbatim substring of resumeText →
 *       non-verbatim → 400 `target_bullet_not_verbatim`
 *   - Other compositional_outcome values ignore target_bullet_text. If
 *     target_bullet_text is present anyway, warn but do not 400; we
 *     persist target_bullet_text=null on the item regardless.
 *
 * Notes the route handler must apply OUTSIDE this resolver:
 *   - Set item.accepted/declined/skipped based on decision
 *   - Set item.decided_at = now()
 *   - For headline accept: if selected_draft_index provided, set
 *     item.selected_draft_index; if edited_text provided WITHOUT
 *     selected_draft_index, set item.user_override_text = edited_text
 *   - For gap accept: write resolver-returned compositional_outcome +
 *     target_bullet_text to the item (retroactively populates legacy
 *     rows that don't have these fields yet; A2 default reads default
 *     `?? null`).
 *   - For bullet accept: no extra mutations beyond final_text
 *
 * @param item The item being decided (looked up from state.items by item_id)
 * @param req The decision-relevant fields from the request body
 * @param resumeText Full persona.resume_text. Used only when validating
 *                   the verbatim invariant for gap reword
 *                   (compositional_outcome === "reword_existing_bullet").
 *                   Pass any string for paths that don't exercise it
 *                   (decline/skip, headline, bullet, gap non-reword).
 * @returns Resolution result — ok=true with all persistence fields, OR
 *          ok=false with an error code
 */
export function resolveFinalText(
  item: PhaseTwoItem,
  req: DecideRequestFields,
  resumeText: string,
): ResolveFinalTextResult {
  // ── decline / skip — no content resolution needed ─────────────────────
  if (req.decision === "decline" || req.decision === "skip") {
    // C1: warn (don't 400) if the frontend sent gap-specific fields on a
    // path that ignores them. This is a frontend bug indicator, not a
    // user-facing failure.
    if (req.compositional_outcome !== undefined || req.target_bullet_text !== undefined) {
      console.warn(
        `[decisionResolver] decision=${req.decision} received compositional_outcome/target_bullet_text — ignoring (frontend bug?)`,
      )
    }
    return {
      ok: true,
      final_text: null,
      manual_entry: false,
      compositional_outcome: null,
      target_bullet_text: null,
    }
  }

  // ── accept — manual_entry validation (cross-cutting) ──────────────────
  if (req.manual_entry === true && !req.edited_text) {
    return { ok: false, error: "edited_text_required_for_manual_entry" }
  }

  // ── accept on headline (Pattern A) ────────────────────────────────────
  if (item.type === "headline") {
    // C1 fields are gap-only; warn on headline.
    if (req.compositional_outcome !== undefined || req.target_bullet_text !== undefined) {
      console.warn(
        `[decisionResolver] item.type=headline received compositional_outcome/target_bullet_text — ignoring (frontend bug?)`,
      )
    }
    // edited_text takes precedence (overrides selected_draft_index even
    // if both provided — user picked then edited)
    if (req.edited_text !== undefined) {
      return {
        ok: true,
        final_text: req.edited_text,
        manual_entry: req.manual_entry === true,
        compositional_outcome: null,
        target_bullet_text: null,
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
        compositional_outcome: null,
        target_bullet_text: null,
      }
    }
    return { ok: false, error: "missing_selection" }
  }

  // ── accept on bullet or gap (Patterns B and C) ────────────────────────
  // Reject selected_draft_index on non-headlines (frontend bug)
  if (req.selected_draft_index !== undefined) {
    return { ok: false, error: "selected_draft_index_only_for_headlines" }
  }

  // C1 fields are gap-only. On bullet accept, warn and ignore.
  if (item.type === "bullet") {
    if (req.compositional_outcome !== undefined || req.target_bullet_text !== undefined) {
      console.warn(
        `[decisionResolver] item.type=bullet received compositional_outcome/target_bullet_text — ignoring (frontend bug?)`,
      )
    }
  }

  // C1 gap-specific validation (BEFORE final_text resolution so the
  // failure mode is predictable regardless of edited_text/draft state).
  let compositional_outcome: CompositionalOutcome | null = null
  let target_bullet_text: string | null = null
  if (item.type === "gap") {
    if (req.compositional_outcome === undefined) {
      return { ok: false, error: "compositional_outcome_required" }
    }
    compositional_outcome = req.compositional_outcome
    if (compositional_outcome === "reword_existing_bullet") {
      if (req.target_bullet_text === undefined) {
        return { ok: false, error: "target_bullet_text_required" }
      }
      // Verbatim invariant — must be a character-for-character substring
      // of the current persona.resume_text. resumeComposer's locate-and-
      // replace (FRD section 6.10) depends on this; same architectural
      // invariant the populator enforces on bullet anchoring.
      if (!resumeText.includes(req.target_bullet_text)) {
        return { ok: false, error: "target_bullet_not_verbatim" }
      }
      target_bullet_text = req.target_bullet_text
    } else {
      // For every non-reword outcome (C1's add_new_bullet,
      // note_for_cover_letter, acknowledge_genuine_gap + C2's
      // add_to_skills_list, add_certification, add_tool_or_software,
      // add_language, add_to_coursework): target_bullet_text is
      // meaningless because the composer doesn't locate-and-replace on
      // an existing bullet for these paths. Warn if present, persist null.
      if (req.target_bullet_text !== undefined) {
        console.warn(
          `[decisionResolver] compositional_outcome=${compositional_outcome} received target_bullet_text — ignoring (frontend bug?)`,
        )
      }
      target_bullet_text = null
    }
  }

  // ── final_text resolution (bullet and gap share this branch) ──────────
  if (req.edited_text !== undefined) {
    return {
      ok: true,
      final_text: req.edited_text,
      manual_entry: req.manual_entry === true,
      compositional_outcome,
      target_bullet_text,
    }
  }

  if (item.draft === null) {
    return { ok: false, error: "missing_draft_or_edit" }
  }

  return {
    ok: true,
    final_text: item.draft,
    manual_entry: false,
    compositional_outcome,
    target_bullet_text,
  }
}
