// lib/workbook/server.ts
//
// Shared by the coach and client workbook routes. Access comes from
// resolveActor/resolveScope (spec: no new inline checks); every data query goes
// through the caller-JWT client so the workbook tables' RLS is what enforces it.

import type { SupabaseClient } from "@supabase/supabase-js"
import { getCallerClient } from "@/lib/supabase/caller"
import { ForbiddenError, resolveActor, resolveScope, type Scope } from "@/lib/collab/scope"
import { must } from "@/app/api/_lib/must"

export class ConflictError extends Error {
  readonly status = 409
  constructor(message: string, readonly current?: unknown) {
    super(message)
    this.name = "ConflictError"
  }
}

/**
 * A coach acting on one client. Workbooks are full-access only, so this asks
 * resolveScope for "write" (which refuses view and annotate) and refuses a
 * caller reaching their own id through the coach route.
 */
export async function coachWorkbookScope(
  req: Request,
  clientId: string,
): Promise<{ supabase: SupabaseClient; scope: Scope }> {
  const actor = await resolveActor(req)
  if (!actor.isCoach) throw new ForbiddenError("Forbidden")
  const supabase = getCallerClient(req)
  const scope = await resolveScope(supabase, actor, { subject: clientId, require: "write" })
  if (scope.actorRole !== "coach") throw new ForbiddenError("Forbidden")
  return { supabase, scope }
}

/** The client acting on their own workbooks. RLS scopes every row to them. */
export async function clientWorkbookScope(req: Request): Promise<{ supabase: SupabaseClient; actorId: string }> {
  const actor = await resolveActor(req)
  return { supabase: getCallerClient(req), actorId: actor.actorId }
}

/** RPC errors raised by the workbook functions, mapped to the route layer's types. */
export function rpcError(what: string, err: { code?: string; message: string }): Error {
  if (err.code === "42501") return new ForbiddenError("Forbidden")
  if (err.code === "22023") return new ConflictError(err.message)
  return new Error(`${what}: ${err.message}`)
}

export type CommentRow = {
  id: string
  section_id: string
  field_key: string | null
  kind: "coach_comment" | "coach_suggestion" | "client_question" | "coach_answer"
  parent_id: string | null
  body: string
  suggested_value: unknown
  suggestion_status: "pending" | "accepted" | "kept_own" | null
  author_role: "client" | "coach"
  author_id: string
  released_at: string | null
  created_at: string
  updated_at: string
}

export const COMMENT_COLUMNS =
  "id, section_id, field_key, kind, parent_id, body, suggested_value, suggestion_status, author_role, author_id, released_at, created_at, updated_at"

export async function loadAnswers(supabase: SupabaseClient, workbookId: string) {
  const rows = must(
    await supabase
      .from("workbook_answers")
      .select("field_key, value, updated_at, updated_by_role")
      .eq("workbook_id", workbookId),
    "read workbook answers",
  ) as { field_key: string; value: unknown; updated_at: string; updated_by_role: string }[]
  const answers: Record<string, { value: unknown; updated_at: string }> = {}
  for (const r of rows ?? []) answers[r.field_key] = { value: r.value, updated_at: r.updated_at }
  return answers
}

export async function loadComments(supabase: SupabaseClient, workbookId: string): Promise<CommentRow[]> {
  return (must(
    await supabase
      .from("workbook_comments")
      .select(COMMENT_COLUMNS)
      .eq("workbook_id", workbookId)
      .order("created_at", { ascending: true }),
    "read workbook comments",
  ) ?? []) as CommentRow[]
}

export async function loadSends(supabase: SupabaseClient, workbookId: string) {
  return (must(
    await supabase
      .from("workbook_sends")
      .select("id, direction, sent_by, sent_at, item_count, opened_at")
      .eq("workbook_id", workbookId)
      .order("sent_at", { ascending: false }),
    "read workbook sends",
  ) ?? []) as { id: string; direction: "to_coach" | "to_client"; sent_by: string; sent_at: string; item_count: number; opened_at: string | null }[]
}
