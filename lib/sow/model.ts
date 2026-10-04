// lib/sow/model.ts
//
// The SOW's text, as Settings stores it: bullets on each library deliverable,
// a subtitle and closing note on each phase, and the practice's standard
// sections. Shared by the server and the screens; the client's SOW (built from
// these) uses the same rules for which lines show.

export const SOW_SECTIONS = ["included", "optional", "how_we_work", "not_included"] as const
export type SowSection = (typeof SOW_SECTIONS)[number]

export const SOW_SECTION_LABEL: Record<SowSection, string> = {
  included: "Included at no charge",
  optional: "Optional addition",
  how_we_work: "How we work",
  not_included: "Not included",
}

/** When a standard line shows: always, or only with or without one phase in the plan. */
export const SOW_SHOW_FOR = ["every_plan", "phase_in_plan", "phase_not_in_plan"] as const
export type SowShowFor = (typeof SOW_SHOW_FOR)[number]

export const SOW_BULLETS_MAX = 2000
export const SOW_SUBTITLE_MAX = 80
export const SOW_NOTE_MAX = 1000
export const SOW_LINE_MAX = 1000
export const SOW_LINES_PER_SECTION = 50

export type SowLine = {
  id: string
  section: SowSection
  body: string
  show_for: SowShowFor
  phase_id: string | null
  sort_order: number
}

export function isSowSection(v: unknown): v is SowSection {
  return typeof v === "string" && (SOW_SECTIONS as readonly string[]).includes(v)
}
export function isSowShowFor(v: unknown): v is SowShowFor {
  return typeof v === "string" && (SOW_SHOW_FOR as readonly string[]).includes(v)
}

/**
 * Bullets as typed: one per line. A leading "-", "*" or "•" is dropped, blank
 * lines are dropped, and nothing left means no bullets (null).
 */
export function normalizeBullets(text: unknown): { value: string | null } | { error: string } {
  if (text === null || text === undefined) return { value: null }
  if (typeof text !== "string") return { error: "SOW bullets must be text" }
  const lines = text.split(/\r?\n/).map((l) => l.trim().replace(/^[-*•]\s*/, "").trim()).filter(Boolean)
  const value = lines.join("\n")
  if (value.length > SOW_BULLETS_MAX) return { error: `SOW bullets can be at most ${SOW_BULLETS_MAX} characters in all` }
  return { value: value || null }
}

/** The bullets of a stored value, as a list. */
export function bulletList(stored: string | null | undefined): string[] {
  return (stored ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
}

/** Optional prose: trimmed, empty is null, at most `max` characters. */
export function normalizeText(text: unknown, max: number, what: string): { value: string | null } | { error: string } {
  if (text === null || text === undefined) return { value: null }
  if (typeof text !== "string") return { error: `${what} must be text` }
  const value = text.trim()
  if (value.length > max) return { error: `${what} can be at most ${max} characters` }
  return { value: value || null }
}

/**
 * Does a standard line show on a SOW whose plan covers these phases? A line
 * tied to a phase that no longer exists reads as every plan.
 */
export function lineShows(line: Pick<SowLine, "show_for" | "phase_id">, phasesInPlan: ReadonlySet<string>): boolean {
  if (line.show_for === "every_plan" || !line.phase_id) return true
  const inPlan = phasesInPlan.has(line.phase_id)
  return line.show_for === "phase_in_plan" ? inPlan : !inPlan
}
