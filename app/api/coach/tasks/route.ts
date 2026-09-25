// app/api/coach/tasks/route.ts
//
// GET   the full list, and the dashboard card, and Required Actions. One query
//       shape serves all three, because they are the same question asked with
//       different filters and a different limit.
// POST  create a task.
//
// WHY THE FILTERING IS SPLIT BETWEEN SQL AND TYPESCRIPT. Assignee, status,
// client, source and search are all plain column predicates and go to Postgres.
// The view tabs (overdue / due today / upcoming) are NOT: "overdue" depends on
// due_has_time, because a task given a day rather than a moment is late only
// once that whole day is over. Expressing that in PostgREST would mean encoding
// the rule twice, in two languages, and the two would drift. So the view is
// applied in lib/tasks/model.ts, which is the same code the digest and the card
// use.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveCoach } from "@/app/api/_lib/coachAuth"
import {
  CARD_LIMIT,
  cardTasks,
  isTaskStatus,
  isTaskView,
  matchesView,
  validateTaskWrite,
  type Task,
  type TaskView,
} from "@/lib/tasks/model"
import { createTask } from "@/lib/tasks/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

const TASK_COLUMNS =
  "id, title, description, client_profile_id, coach_client_id, assignee_profile_id, " +
  "created_by_profile_id, due_at, due_has_time, status, completed_at, source, template_id, " +
  "chain_id, brief_id, decision, legacy_note_id, created_at, updated_at, deleted_at"

export async function GET(req: NextRequest) {
  try {
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const db = getSupabaseAdmin()
    const url = new URL(req.url)
    const q = url.searchParams

    // ASSIGNEE DEFAULTS TO ME. A coach opening the list wants their own work;
    // seeing everyone's by default makes the page useless on arrival. "all" is
    // explicit, because it is a deliberate act to look at someone else's queue.
    const assigneeParam = q.get("assignee") ?? "me"
    const assignee =
      assigneeParam === "me" ? coachProfileId : assigneeParam === "all" ? null : assigneeParam

    const statusParam = q.get("status")
    const client = q.get("client")
    const source = q.get("source")
    const search = (q.get("search") ?? "").trim()
    const viewParam = q.get("view") ?? "all"
    const view: TaskView = isTaskView(viewParam) ? viewParam : "all"
    const card = q.get("card") === "1"

    let sel = db.from("coach_tasks").select(TASK_COLUMNS).is("deleted_at", null)

    if (assignee) sel = sel.eq("assignee_profile_id", assignee)
    if (client) sel = sel.eq("client_profile_id", client)
    if (source === "manual" || source === "auto") sel = sel.eq("source", source)

    if (statusParam && statusParam !== "all") {
      if (!isTaskStatus(statusParam)) {
        return withCorsJson(req, { ok: false, error: "Unknown status filter." }, 400)
      }
      sel = sel.eq("status", statusParam)
    } else if (!statusParam) {
      // No status filter means open work. Done and cancelled tasks are history
      // and would otherwise swamp the list within a month.
      sel = sel.eq("status", "open")
    }

    if (search) {
      // Escape the PostgREST or() metacharacters. A title containing a comma
      // would otherwise be read as a second filter and 400 the whole request.
      const safe = search.replace(/[(),*]/g, " ").trim()
      if (safe) sel = sel.or(`title.ilike.*${safe}*,description.ilike.*${safe}*`)
    }

    const { data, error: qErr } = await sel.order("due_at", { ascending: true, nullsFirst: false })
    if (qErr) return withCorsJson(req, { ok: false, error: qErr.message }, 500)

    const all = (data ?? []) as unknown as Task[]
    const now = new Date()

    // The templates behind whatever came back, keyed by id.
    //
    // WHY THE LIST NEEDS THEM. "Review Networking Campaign" is closed with
    // Approve or Request Changes rather than a checkbox, and the only place
    // that fact is recorded is coach_task_templates.decision_options. Without
    // this the row would have to hard-code which titles get buttons, which is
    // the chain-in-code the engine exists to avoid.
    const templateIds = Array.from(new Set(all.map((t) => t.template_id).filter(Boolean))) as string[]
    const { data: templateRows } = templateIds.length
      ? await db.from("coach_task_templates").select("id, key, decision_options").in("id", templateIds)
      : { data: [] as any[] }
    const templates: Record<string, { key: string; decision_options: string[] | null }> = {}
    for (const t of templateRows ?? []) {
      templates[t.id] = { key: t.key, decision_options: t.decision_options ?? null }
    }

    if (card) {
      // cardTasks does the banding and the cap. `total` is EVERY open task the
      // coach has, not the number shown, because the footer link reports how
      // much work exists rather than how much of it fitted on the card.
      const { shown, total } = cardTasks(all, now)
      return withCorsJson(req, {
        ok: true,
        tasks: shown,
        total,
        has_more: total > CARD_LIMIT,
        templates,
      }, 200)
    }

    const tasks = view === "all" ? all : all.filter((t) => matchesView(t, view, now))
    return withCorsJson(req, { ok: true, tasks, total: tasks.length, templates }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/tasks GET]", err?.stack || msg)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => ({}))

    // An unspecified assignee means me. The field is required on the row, but
    // making the coach pick themselves every time would be a toll on the
    // commonest case.
    const input = {
      ...body,
      assignee_profile_id: body?.assignee_profile_id || coachProfileId,
    }

    const errors = validateTaskWrite(input)
    if (errors.length) return withCorsJson(req, { ok: false, error: errors[0], errors }, 400)

    const db = getSupabaseAdmin()
    const created = await createTask(db, {
      title: String(input.title),
      description: input.description ?? null,
      client_profile_id: input.client_profile_id ?? null,
      coach_client_id: input.coach_client_id ?? null,
      assignee_profile_id: String(input.assignee_profile_id),
      due_at: input.due_at ?? null,
      due_has_time: input.due_has_time ?? false,
      source: "manual",
    }, coachProfileId)

    if (!created.ok) return withCorsJson(req, { ok: false, error: created.error }, created.status)
    return withCorsJson(req, { ok: true, task: created.data }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/tasks POST]", err?.stack || msg)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}
