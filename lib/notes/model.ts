// lib/notes/model.ts
//
// What a note on a client or prospect is, for both note route pairs:
// app/api/coach/clients/[clientId]/note-feed and app/api/coach/prospects/[id]/notes.
//
// A note is a Session Recap or Other, with an optional topic. Work to do is a
// task, added with the record's Add Task button, never a note.
//
// ACTION ITEM IS READ-ONLY HISTORY. It was a note type until 2026-10-01. Rows
// that still say action_item each have a task (see lib/notes/actionItems.ts and
// 20260930_action_item_note_catchup.sql), keep rendering, and can be edited
// into another type; nothing can create one or turn a note into one.

export const NOTE_TYPES = ["session_recap", "other"] as const
export type NoteType = (typeof NOTE_TYPES)[number]
/** Every type a stored row may carry, the retired one included. */
export type StoredNoteType = NoteType | "action_item"

export const NOTE_TOPICS = ["phase", "deliverable", "milestone"] as const
export type NoteTopic = (typeof NOTE_TOPICS)[number]

export const NOTE_COLUMNS =
  "id, type, topic, body, priority, completed_at, created_at, updated_at, coach_client_id, client_profile_id"

export const ACTION_ITEM_RETIRED =
  "Action Item is no longer a note type. Add a task instead."

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** A type sent on create or edit. Missing or empty means `fallback`. */
export function parseNoteType(v: unknown, fallback: NoteType | undefined): Parsed<NoteType | undefined> {
  if (v === undefined || v === null || v === "") return { ok: true, value: fallback }
  if (v === "action_item") return { ok: false, error: ACTION_ITEM_RETIRED }
  if (typeof v !== "string" || !(NOTE_TYPES as readonly string[]).includes(v)) return { ok: false, error: "Invalid type" }
  return { ok: true, value: v as NoteType }
}

/** A topic sent on create or edit. null or "" clears it. */
export function parseNoteTopic(v: unknown): Parsed<NoteTopic | null> {
  if (v === null || v === "" || v === undefined) return { ok: true, value: null }
  if (typeof v !== "string" || !(NOTE_TOPICS as readonly string[]).includes(v)) return { ok: false, error: "Invalid topic" }
  return { ok: true, value: v as NoteTopic }
}

/**
 * A create request's body, ready to insert. `priority` and `completed_at` are
 * never written: they belong to the retired type.
 */
export function parseNoteCreate(body: Record<string, unknown>):
  Parsed<{ type: NoteType; topic: NoteTopic | null; body: string }> {
  const text = typeof body.body === "string" ? body.body.trim() : ""
  if (!text) return { ok: false, error: "body is required" }
  const type = parseNoteType(body.type, "session_recap")
  if (!type.ok) return type
  const topic = parseNoteTopic(body.topic)
  if (!topic.ok) return topic
  return { ok: true, value: { type: type.value!, topic: topic.value, body: text } }
}
