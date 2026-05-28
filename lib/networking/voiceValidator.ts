// lib/networking/voiceValidator.ts
//
// Shape-and-voice validator for networking plan output. Catches the
// failure modes the prompt can't enforce mechanically: bloat, banned
// phrases, and unfilled bracket placeholders.
//
// NOT a grounding/fabrication validator (cf. Phase 2's groundingValidator)
// — networking messages make almost no specific claims. The relevant
// failure modes here are voice and shape, not factual drift.
//
// Caps calibrated 2026-05-28 against NW-DVP62ET3 (v7 lean-voice baseline,
// Josh Rosenblatt / SMS International). Headroom set so prompt-aligned
// output passes comfortably while catastrophic bloat (1000c+ resume
// dumps) trips length_chars.
//
// Used by app/api/networking/route.ts after normalizePlan(), before the
// networking_runs insert. On validation failure the route regenerates
// once at higher temperature; if the retry still fails it accepts the
// best-effort output and logs a structured violation marker.
//
// Known limitation (explicit non-goal): cannot catch semantic drift like
// Move 1 vs Move 3 ask-calibration mismatch. The prompt owns voice
// quality; this validator catches the mechanical failure modes only.

/**
 * Banned phrases (case-insensitive substring match). Mirrors the prompt's
 * BANNED PHRASES (backstop) line; exported as a named const so callers
 * (or future tests) can extend or override without forking this file.
 */
export const BANNED_PHRASES: readonly string[] = [
  "pick your brain",
  "I hope you're well",
  "I'd love to learn more",
  "I'd value your perspective",
  "would appreciate",
  "admire your background",
  "love your journey",
  "any advice would help",
]

/**
 * Per-field length caps. `chars` is the hard char cap; `sentences` is the
 * hard sentence cap (null = no sentence cap for that field).
 *
 * conversation_openers intentionally absent — depth is wanted there, no
 * cap applied.
 */
export const LENGTH_CAPS: Record<
  string,
  { chars: number; sentences: number | null }
> = {
  linkedin_connection_request: { chars: 300, sentences: null },
  linkedin_message: { chars: 700, sentences: 7 },
  email_body: { chars: 700, sentences: 7 },
  follow_up_message: { chars: 300, sentences: 4 },
}

export type ViolationReason =
  | "length_chars"
  | "length_sentences"
  | "banned_phrase"
  | "bracket_leak"

export type Violation = {
  /** move_id as emitted by the model (or synthetic move_N fallback). */
  move_id: string
  /** 1-based move index for log readability. */
  move_index: number
  /** Field name that violated. */
  field: string
  reason: ViolationReason
  /** Human-readable detail: char counts, banned phrase matched, placeholder text. */
  detail: string
}

export type ValidationResult = {
  ok: boolean
  violations: Violation[]
}

/**
 * Validate a normalized networking plan. Pure function — no I/O.
 *
 * Empty/whitespace fields are skipped (a channel_plan that legitimately
 * picks LinkedIn-only will produce empty email_body — that is not a
 * violation).
 */
export function validatePlan(plan: unknown): ValidationResult {
  const violations: Violation[] = []

  const moves =
    plan && typeof plan === "object" && Array.isArray((plan as { moves?: unknown }).moves)
      ? ((plan as { moves: unknown[] }).moves as Record<string, unknown>[])
      : []

  moves.forEach((move, idx) => {
    const moveId =
      typeof move?.move_id === "string" && move.move_id.trim()
        ? move.move_id.trim()
        : `move_${idx + 1}`

    for (const [field, cap] of Object.entries(LENGTH_CAPS)) {
      const raw = move?.[field]
      const text = typeof raw === "string" ? raw.trim() : ""
      if (!text) continue // empty field → skip all checks

      // Length: chars
      if (text.length > cap.chars) {
        violations.push({
          move_id: moveId,
          move_index: idx + 1,
          field,
          reason: "length_chars",
          detail: `${text.length} chars > ${cap.chars} cap`,
        })
      }

      // Length: sentences (when capped)
      if (cap.sentences != null) {
        const sCount = countSentences(text)
        if (sCount > cap.sentences) {
          violations.push({
            move_id: moveId,
            move_index: idx + 1,
            field,
            reason: "length_sentences",
            detail: `${sCount} sentences > ${cap.sentences} cap`,
          })
        }
      }

      // Banned phrases (case-insensitive substring)
      const lower = text.toLowerCase()
      for (const banned of BANNED_PHRASES) {
        if (lower.includes(banned.toLowerCase())) {
          violations.push({
            move_id: moveId,
            move_index: idx + 1,
            field,
            reason: "banned_phrase",
            detail: `contains "${banned}"`,
          })
        }
      }

      // Bracket leaks: any [...] except [name] (case-insensitive).
      // [Name] is the intended recipient-fill slot the user resolves at
      // send time; all other brackets should have been filled by the
      // generator.
      const brackets = text.match(/\[[^\]]+\]/g) ?? []
      for (const b of brackets) {
        const inner = b.slice(1, -1).trim().toLowerCase()
        if (inner !== "name") {
          violations.push({
            move_id: moveId,
            move_index: idx + 1,
            field,
            reason: "bracket_leak",
            detail: `unfilled placeholder ${b}`,
          })
        }
      }
    }
  })

  return { ok: violations.length === 0, violations }
}

/**
 * Count sentences via a simple terminator-split heuristic. Matches the
 * calibration probe so cap values are comparable to measured counts.
 */
function countSentences(s: string): number {
  return s.split(/[.!?]+/).filter((t) => t.trim().length > 0).length
}
