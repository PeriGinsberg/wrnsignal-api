// lib/notes/edit.ts
//
// Editing and deleting one note, for both note route pairs.
//
// The client route (note-feed/[noteId]) and the prospect route
// (prospects/[id]/notes/[noteId]) carried the same PUT body twice. The routes
// still own who may do this (their access checks differ); what an edit MEANS
// is here, once.
//
// A note never touches a task. An old action-item note's task was made from it
// once (lib/notes/actionItems.ts) and lives on its own from then: editing or
// deleting the note leaves the task as it is, and the task is ticked on the
// task list, not on the note.

import type { SupabaseClient } from "@supabase/supabase-js"
import { withNoteTasks } from "./actionItems"
import { NOTE_COLUMNS, parseNoteTopic, parseNoteType, type StoredNoteType, type NoteTopic } from "./model"

export { NOTE_COLUMNS }

export type ExistingNote = {
  id: string
  coach_client_id: string
  client_profile_id: string | null
  type: StoredNoteType
  topic?: NoteTopic | null
  body: string
  priority: string | null
  completed_at: string | null
}

export type EditResult = { status: number; json: Record<string, unknown> }

const bad = (error: string): EditResult => ({ status: 400, json: { ok: false, error } })

/**
 * Apply a PUT body to a note the caller has already been allowed to edit.
 *
 * Accepted keys: body, type (session_recap or other), topic (phase,
 * deliverable, milestone, or null to clear). Anything else is ignored, so an
 * old screen that still sends priority or completed_at changes nothing.
 */
export async function editNote(
  db: SupabaseClient,
  existing: ExistingNote,
  body: Record<string, unknown>,
): Promise<EditResult> {
  const updates: Record<string, unknown> = {}

  if ("body" in body) {
    const trimmed = typeof body.body === "string" ? body.body.trim() : ""
    if (!trimmed) return bad("body cannot be empty")
    if (trimmed !== existing.body) updates.body = trimmed
  }

  if ("type" in body && body.type !== existing.type) {
    const t = parseNoteType(body.type, undefined)
    if (!t.ok) return bad(t.error)
    if (t.value) {
      updates.type = t.value
      // The CHECKs allow priority and completed_at only on action items, so an
      // old action item edited into another type drops both.
      if (existing.priority !== null) updates.priority = null
      if (existing.completed_at !== null) updates.completed_at = null
    }
  }

  if ("topic" in body) {
    const t = parseNoteTopic(body.topic)
    if (!t.ok) return bad(t.error)
    if (t.value !== (existing.topic ?? null)) updates.topic = t.value
  }

  if (!Object.keys(updates).length) {
    // Nothing changed is not an error when the caller sent real fields: a save
    // with no edits answers with the note as it stands.
    const sentAny = ["body", "type", "topic"].some((k) => k in body)
    if (!sentAny) return bad("No fields to update")
    const [note] = await withNoteTasks(db, [existing])
    return { status: 200, json: { ok: true, note } }
  }

  updates.updated_at = new Date().toISOString()
  const { data, error } = await db.from("coach_client_notes")
    .update(updates).eq("id", existing.id).select(NOTE_COLUMNS).single()
  if (error) throw new Error(`Note update failed: ${error.message}`)
  const [note] = await withNoteTasks(db, [data as ExistingNote])
  return { status: 200, json: { ok: true, note } }
}

/** Soft-delete a note. An old action item's task is left alone: it is its own record now. */
export async function deleteNote(db: SupabaseClient, noteId: string): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await db.from("coach_client_notes")
    .update({ deleted_at: now, updated_at: now }).eq("id", noteId)
  if (error) throw new Error(`Note delete failed: ${error.message}`)
}
