// lib/workbook/notes.ts
//
// Coach Notes on workbook sections (20261128_workbook_coach_notes.sql). Every
// read goes through the caller-JWT client, so RLS decides: any coach on the
// client reads every coach's notes; only the author edits or deletes. Nothing
// here filters by the logged-in coach.

import type { SupabaseClient } from "@supabase/supabase-js"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { must } from "@/app/api/_lib/must"

export type NoteRow = {
  id: string
  workbook_id: string
  section_id: string
  coach_profile_id: string
  body: string
  created_at: string
  updated_at: string
}

export const NOTE_COLUMNS = "id, workbook_id, section_id, coach_profile_id, body, created_at, updated_at"

export const NOTE_MAX = 20000

export async function loadNotes(supabase: SupabaseClient, workbookId: string): Promise<NoteRow[]> {
  return (must(
    await supabase.from("workbook_coach_notes").select(NOTE_COLUMNS)
      .eq("workbook_id", workbookId).order("created_at").order("id"),
    "read coach notes",
  ) ?? []) as NoteRow[]
}

/**
 * Display names for note authors. A coach cannot read another coach's
 * client_profiles row, so names come from the service role, and only for ids
 * the caller already reached through the notes RLS.
 */
export async function authorNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)]
  if (!unique.length) return {}
  const rows = (must(
    await getSupabaseAdmin().from("client_profiles").select("id, name, email").in("id", unique),
    "read note authors",
  ) ?? []) as { id: string; name: string | null; email: string | null }[]
  return Object.fromEntries(rows.map((r) => [r.id, r.name?.trim() || r.email || "Coach"]))
}
