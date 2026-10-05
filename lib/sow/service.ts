// lib/sow/service.ts
//
// The practice's standard SOW sections on the server. Takes the client it is
// given, so the rules run against tests/_lib/fakeSupabase.ts as well. The
// vocabulary and the rules are in ./model.ts.

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  SOW_LINE_MAX,
  SOW_OPENING_MAX,
  normalizeText,
  SOW_LINES_PER_SECTION,
  SOW_SECTIONS,
  SOW_SECTION_LABEL,
  isSowSection,
  isSowShowFor,
  type SowLine,
} from "./model"

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number }
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status })

const LINE_COLUMNS = "id, section, body, show_for, phase_id, sort_order"

/** The coach's standard lines, by section and order. */
export async function getSowLines(db: SupabaseClient, coachId: string): Promise<SowLine[]> {
  const { data, error } = await db.from("coach_sow_lines").select(LINE_COLUMNS).eq("coach_profile_id", coachId)
  if (error) throw new Error(`Failed to read SOW lines: ${error.message}`)
  const rank = (s: string) => SOW_SECTIONS.indexOf(s as SowLine["section"])
  return ((data ?? []) as SowLine[]).sort((a, b) => rank(a.section) - rank(b.section) || a.sort_order - b.sort_order)
}

/**
 * Save the coach's standard lines as listed: the list IS the new set, in
 * order within each section. The new rows go in first and the old ones come
 * out after, so a failed save leaves the previous lines in place.
 */
export async function saveSowLines(db: SupabaseClient, coachId: string, input: unknown): Promise<Result<SowLine[]>> {
  if (!Array.isArray(input)) return fail("lines must be a list")
  const { data: phases, error: pe } = await db.from("coach_phases").select("id").eq("coach_profile_id", coachId)
  if (pe) return fail(`Failed to read phases: ${pe.message}`, 500)
  const own = new Set(((phases ?? []) as { id: string }[]).map((p) => p.id))

  const counts = new Map<string, number>()
  const rows: Record<string, unknown>[] = []
  for (const raw of input) {
    const r = (raw ?? {}) as Record<string, unknown>
    if (!isSowSection(r.section)) return fail("Unknown SOW section.")
    const body = typeof r.body === "string" ? r.body.trim() : ""
    if (!body) return fail("Every line needs text. Remove empty lines.")
    if (body.length > SOW_LINE_MAX) return fail(`A line can be at most ${SOW_LINE_MAX} characters.`)
    const showFor = r.show_for ?? "every_plan"
    if (!isSowShowFor(showFor)) return fail("Unknown \"Show for\" choice.")
    let phaseId: string | null = null
    if (showFor !== "every_plan") {
      if (typeof r.phase_id !== "string" || !own.has(r.phase_id)) return fail("A line tied to a phase needs one of your phases.")
      phaseId = r.phase_id
    }
    const n = (counts.get(r.section) ?? 0) + 1
    if (n > SOW_LINES_PER_SECTION) return fail(`${SOW_SECTION_LABEL[r.section]} can have at most ${SOW_LINES_PER_SECTION} lines.`)
    counts.set(r.section, n)
    rows.push({ coach_profile_id: coachId, section: r.section, body, show_for: showFor, phase_id: phaseId, sort_order: n })
  }

  const before = await getSowLines(db, coachId)
  if (rows.length) {
    const { error } = await db.from("coach_sow_lines").insert(rows)
    if (error) return fail(`Failed to save SOW lines: ${error.message}`, 500)
  }
  if (before.length) {
    const { error } = await db.from("coach_sow_lines").delete().in("id", before.map((l) => l.id)).eq("coach_profile_id", coachId)
    if (error) return fail(`Saved the new lines, but couldn't remove the old ones: ${error.message}`, 500)
  }
  return { ok: true, data: await getSowLines(db, coachId) }
}

// ── The coach's SOW settings ─────────────────────────────────────────────────

/** The opening paragraph new client SOWs start with, or null. */
export async function getDefaultOpening(db: SupabaseClient, coachId: string): Promise<string | null> {
  const { data, error } = await db.from("coach_sow_settings").select("default_opening").eq("coach_profile_id", coachId).maybeSingle()
  if (error) throw new Error(`Failed to read SOW settings: ${error.message}`)
  return (data as { default_opening: string | null } | null)?.default_opening ?? null
}

/** Save the default opening paragraph. Blank clears it. SOWs already saved keep theirs. */
export async function saveDefaultOpening(db: SupabaseClient, coachId: string, input: unknown): Promise<Result<string | null>> {
  const v = normalizeText(input, SOW_OPENING_MAX, "The default opening paragraph")
  if ("error" in v) return fail(v.error)
  const { data: existing } = await db.from("coach_sow_settings").select("coach_profile_id").eq("coach_profile_id", coachId).maybeSingle()
  const { error } = existing
    ? await db.from("coach_sow_settings").update({ default_opening: v.value }).eq("coach_profile_id", coachId)
    : await db.from("coach_sow_settings").insert({ coach_profile_id: coachId, default_opening: v.value })
  if (error) return fail(`Failed to save the default opening: ${error.message}`, 500)
  return { ok: true, data: v.value }
}
