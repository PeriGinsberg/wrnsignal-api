// lib/resumeWorkshop/coachNotes.ts
//
// Coach Notes on Resume Workshop tabs (20261129_resume_workshop_coach_notes.sql).
// The caller is already authorized on the relationship by the route (coach or
// delegate, active). Reads span every coach_clients row of the same client, so
// each coach on the client sees every coach's notes; nothing here filters by
// the logged-in coach. Edits and deletes match the author.

import type { SupabaseClient } from "@supabase/supabase-js"
import { coachClientIdsForClient } from "@/app/api/_lib/coachClientIds"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { TABS } from "./model"

const TABLE = "resume_workshop_coach_notes"
const COLUMNS = "id, coach_client_id, tab, coach_profile_id, body, created_at, updated_at"
const NOTE_TABS = new Set<string>([...TABS, "general"])

export const NOTE_MAX = 20000

/**
 * Display names for note authors. Only ids the caller already reached through
 * the workshop's access check; the service role reads the names.
 */
async function authorNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)]
  if (!unique.length) return {}
  const { data, error } = await getSupabaseAdmin().from("client_profiles").select("id, name, email").in("id", unique)
  if (error) throw new Error(`read note authors: ${error.message}`)
  return Object.fromEntries((data ?? []).map((r: any) => [r.id, (r.name as string | null)?.trim() || r.email || "Coach"]))
}

type Row = { id: string; coach_client_id: string; tab: string; coach_profile_id: string; body: string; created_at: string; updated_at: string }
/** The shape the shared Coach Notes panel reads (section_id = the tab). */
const out = (r: Row) => ({ ...r, section_id: r.tab })

type R<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

/** Every relationship of this relationship's client: whose notes the caller reads. */
export async function clientRelationshipIds(db: SupabaseClient, coachClientId: string): Promise<string[]> {
  const { data, error } = await db.from("coach_clients").select("client_profile_id").eq("id", coachClientId).maybeSingle()
  if (error) throw new Error(`Relationship lookup failed: ${error.message}`)
  const client = data?.client_profile_id as string | null | undefined
  if (!client) return [coachClientId]
  const ids = await coachClientIdsForClient(db, client)
  return ids.includes(coachClientId) ? ids : [coachClientId, ...ids]
}

export async function listNotes(db: SupabaseClient, coachClientId: string, me: string) {
  const ids = await clientRelationshipIds(db, coachClientId)
  const { data, error } = await db.from(TABLE).select(COLUMNS).in("coach_client_id", ids).order("created_at").order("id")
  if (error) throw new Error(`read coach notes: ${error.message}`)
  const rows = (data ?? []) as Row[]
  return {
    notes: rows.map(out),
    authors: await authorNames([me, ...rows.map((r) => r.coach_profile_id)]),
    me,
    realtime_filter: `coach_client_id=in.(${ids.join(",")})`,
  }
}

export async function addNote(db: SupabaseClient, coachClientId: string, tab: unknown, body: unknown, me: string): Promise<R<unknown>> {
  if (typeof tab !== "string" || !NOTE_TABS.has(tab)) return { ok: false, status: 400, error: "Unknown tab" }
  if (typeof body !== "string" || !body.trim()) return { ok: false, status: 400, error: "Write something first" }
  if (body.length > NOTE_MAX) return { ok: false, status: 400, error: "That note is too long" }
  const { data, error } = await db.from(TABLE).insert({ coach_client_id: coachClientId, tab, coach_profile_id: me, body })
    .select(COLUMNS).single()
  if (error) throw new Error(`save note: ${error.message}`)
  return { ok: true, data: out(data as Row) }
}

const NOT_YOURS = "Note not found, or it is another coach's note."

export async function saveNote(db: SupabaseClient, coachClientId: string, noteId: string, body: unknown, me: string): Promise<R<unknown>> {
  if (typeof body !== "string") return { ok: false, status: 400, error: "body is required" }
  if (body.length > NOTE_MAX) return { ok: false, status: 400, error: "That note is too long" }
  const ids = await clientRelationshipIds(db, coachClientId)
  const { data, error } = await db.from(TABLE).update({ body })
    .eq("id", noteId).eq("coach_profile_id", me).in("coach_client_id", ids).select(COLUMNS)
  if (error) throw new Error(`save note: ${error.message}`)
  if (!data?.length) return { ok: false, status: 404, error: NOT_YOURS }
  return { ok: true, data: out(data[0] as Row) }
}

export async function deleteNote(db: SupabaseClient, coachClientId: string, noteId: string, me: string): Promise<R<null>> {
  const ids = await clientRelationshipIds(db, coachClientId)
  const { data, error } = await db.from(TABLE).delete()
    .eq("id", noteId).eq("coach_profile_id", me).in("coach_client_id", ids).select("id")
  if (error) throw new Error(`delete note: ${error.message}`)
  if (!data?.length) return { ok: false, status: 404, error: NOT_YOURS }
  return { ok: true, data: null }
}
