// lib/positioning/v2/phase2/resumeComposer.ts
//
// Deterministic recomposition of the revised resume text from the original
// persona resume_text + the user's accepted decisions on phase2_runs.state
// .items. Called after every /decide accept by the POST
// /api/positioning/v2/phase2/[id]/decide endpoint (FRD §6.5.4).
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §6.10 — revised resume composition (the canonical algorithm)
//   §6.5.4 — /decide endpoint that triggers recomposition
//
// Types: ./types.ts (PhaseTwoItem discriminated union)
//
// Determinism contract: same (originalResumeText, items) always produces
// the same output. The composer reads only from its inputs — no I/O, no
// time-of-day dependence, no random ordering. This lets the UI request
// a preview after edit without persisting intermediate state, and lets
// the server treat phase2_runs.state.items as the single source of truth
// (revised_resume_text is always recomputable).
//
// SKELETON — Phase 2a commit. Real composition logic (headline replace,
// bullet replace, gap append with section-anchor inference) lands in a
// later Stage 2 commit. Stub returns originalResumeText unchanged so
// callers can wire up safely without behavior changes.

import type { PhaseTwoItem } from "./types"

/**
 * Recompose the revised resume from the original resume text and the
 * user's accepted decisions.
 *
 * FRD §6.10 algorithm:
 *   1. Start with originalResumeText as the base
 *   2. For each item in items where accepted=true:
 *      - Headline: replace the original headline line in the resume with
 *        item.final_text
 *      - Bullet: locate the original_bullet text in the resume body and
 *        replace it with item.final_text
 *      - Gap: append item.final_text to the appropriate resume section
 *        per the anchor rule below
 *   3. Return the composed text
 *
 * Declined and skipped items have no effect on the output. Items still
 * in_progress (no decision yet) also have no effect — only accepted=true
 * contributes to the revised text.
 *
 * Source of truth for accepted content: item.final_text.
 *   - final_text is null at populator emit and set at /decide accept time
 *     (FRD §6.5.4 — the /decide handler resolves selected_draft_index,
 *     user_override_text, edited_text, or draft into the single final_text
 *     value the composer reads).
 *   - The composer does NOT re-resolve the draft-vs-override-vs-edit
 *     branch — that's the /decide handler's responsibility. Composer
 *     treats final_text as authoritative.
 *   - Accepted item with final_text=null is a state-corruption signal
 *     (decide handler bug); composer should log and skip rather than
 *     silently fall through to draft or original.
 *
 * Gap anchor inference (v0.1 default per FRD §6.10):
 *   - Skill-type gaps (e.g., "JD asks for Excel") → append to Skills section
 *   - Bullet-type gaps (e.g., new bullet on past experience) → append to
 *     the most-recent experience entry
 *   - Open question per FRD §12.5: validation with real data may surface
 *     a more nuanced anchor rule
 *
 * Edge cases:
 *   - Empty items array: returns originalResumeText unchanged
 *   - All items declined/skipped: returns originalResumeText unchanged
 *   - Item targeting text not found in resume: log + skip that item (no
 *     partial replacement; this is a state-corruption signal)
 *   - Accepted item with final_text=null: log + skip (decide handler bug)
 *
 * @param originalResumeText The base resume text (typically persona.resume_text)
 * @param items All items from phase2_runs.state.items, decided or not
 * @returns The recomposed revised resume text. Always returns a string;
 *          returns originalResumeText unchanged when no items have been
 *          accepted.
 */
export function composeRevisedResume(
  originalResumeText: string,
  items: PhaseTwoItem[],
): string {
  // TODO(phase-2-stage-2b): implement per FRD §6.10.
  // Skeleton returns the original text so callers can integrate without
  // behavior change. The /decide endpoint will call this on every accept
  // but the returned value will be identical to the input until real
  // composition lands.
  void items
  return originalResumeText
}
