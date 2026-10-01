#!/usr/bin/env tsx
// Notes on clients and prospects: types, topics, and the old action items.
// Run: npx tsx tests/notes/notes.test.ts
//
// Logic only, against tests/_lib/fakeSupabase.ts. The routes are thin: they
// check access and call lib/notes/*, which is what is exercised here.
//
// Pinned (2026-10-01):
//   - Action Item is no longer a note type: creating one, or turning a note
//     into one, is refused with a sentence pointing at Add Task;
//   - a note carries an optional topic (phase, deliverable, milestone);
//   - an old action-item note keeps rendering with its task's state, can be
//     edited into another type, and editing or deleting it leaves the task be;
//   - SIGNAL's own workbook-review notes still get, retitle and close a task,
//     and ticking that task closes the note (the RPC reads the stamp).

import { makeFakeDb, type Row } from "../_lib/fakeSupabase"
import { closeTasksForNotes, ensureSystemNoteTask, taskTextFromNote, withNoteTasks } from "../../lib/notes/actionItems"
import { deleteNote, editNote, type ExistingNote } from "../../lib/notes/edit"
import { ACTION_ITEM_RETIRED, parseNoteCreate, parseNoteTopic } from "../../lib/notes/model"
import { createTask, setTaskStatus } from "../../lib/tasks/service"
import { noteLink, cleanTaskLink } from "../../lib/tasks/links"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-1"
const CLIENT = "client-1"

function seed(notes: Row[] = []) {
  return makeFakeDb({
    client_profiles: [
      { id: COACH, name: "Peri Ginsberg", is_coach: true },
      { id: CLIENT, name: "Client One", is_coach: false },
    ],
    coach_clients: [
      { id: "cc-client", coach_profile_id: COACH, client_profile_id: CLIENT, status: "active" },
      { id: "cc-prospect", coach_profile_id: COACH, client_profile_id: null, status: "active" },
    ],
    coach_delegates: [],
    coach_client_notes: notes,
    coach_tasks: [],
    coach_task_events: [],
    coach_automation_events: [],
  })
}

const note = (over: Row = {}): Row => ({
  id: "n-1", coach_client_id: "cc-prospect", client_profile_id: null, coach_profile_id: COACH,
  type: "session_recap", topic: null, body: "Discovery call went well", priority: null,
  completed_at: null, deleted_at: null, ...over,
})
const noteRow = (db: ReturnType<typeof seed>, id = "n-1") =>
  db.tables.coach_client_notes.find((n) => n.id === id)!
const taskOf = (db: ReturnType<typeof seed>, noteId = "n-1") =>
  db.tables.coach_tasks.find((t) => t.legacy_note_id === noteId && !t.deleted_at)

/** An old action item, as the catch-up leaves it: the note and its task. */
async function seedOldActionItem(over: Row = {}) {
  const db = seed([note({ type: "action_item", body: "Draft SOW", priority: "this_week", ...over })])
  const r = await createTask(db.client, {
    title: "Draft SOW", client_profile_id: null, coach_client_id: "cc-prospect",
    assignee_profile_id: COACH, source: "manual", legacy_note_id: "n-1",
    link: "/dashboard/coach/prospects/cc-prospect#note-n-1",
  }, COACH)
  if (!r.ok) throw new Error(r.error)
  return db
}

async function main() {
  const warn = console.warn
  console.warn = () => {}

  console.log("creating a note")
  {
    const recap = parseNoteCreate({ body: "  Discovery call  " })
    ok("type defaults to Session Recap, body is trimmed",
      recap.ok && recap.value.type === "session_recap" && recap.value.body === "Discovery call" && recap.value.topic === null)
    const other = parseNoteCreate({ body: "x", type: "other", topic: "milestone" })
    ok("Other with a topic", other.ok && other.value.type === "other" && other.value.topic === "milestone")
    const item = parseNoteCreate({ body: "Draft SOW", type: "action_item" })
    ok("Action Item is refused, pointing at Add Task", !item.ok && item.error === ACTION_ITEM_RETIRED)
    ok("an unknown type is refused", !parseNoteCreate({ body: "x", type: "todo" }).ok)
    ok("an empty body is refused", !parseNoteCreate({ body: "   " }).ok)
    const stale = parseNoteCreate({ body: "x", priority: "urgent", completed_at: "2026-10-01T00:00:00Z" })
    ok("a stale priority or tick from an old screen is not written",
      stale.ok && !("priority" in stale.value) && !("completed_at" in stale.value))
  }

  console.log("\ntopics")
  {
    for (const t of ["phase", "deliverable", "milestone"]) {
      const r = parseNoteTopic(t)
      ok(`"${t}" is a topic`, r.ok && r.value === t)
    }
    ok("empty means no topic", (() => { const r = parseNoteTopic(""); return r.ok && r.value === null })())
    ok("null means no topic", (() => { const r = parseNoteTopic(null); return r.ok && r.value === null })())
    ok("anything else is refused", !parseNoteTopic("stage").ok && !parseNoteTopic(3).ok)
  }

  console.log("\nediting a note")
  {
    const db = seed([note()])
    const r1 = await editNote(db.client, noteRow(db) as ExistingNote, { topic: "phase" })
    ok("a topic can be set", r1.status === 200 && noteRow(db).topic === "phase")
    ok("the response carries it", (r1.json.note as Row)?.topic === "phase")

    await editNote(db.client, noteRow(db) as ExistingNote, { topic: "deliverable", type: "other", body: "Scoped the resume" })
    ok("topic, type and text change together",
      noteRow(db).topic === "deliverable" && noteRow(db).type === "other" && noteRow(db).body === "Scoped the resume")

    await editNote(db.client, noteRow(db) as ExistingNote, { topic: null })
    ok("null clears the topic", noteRow(db).topic === null)

    const bad = await editNote(db.client, noteRow(db) as ExistingNote, { topic: "stage" })
    ok("a bad topic is refused", bad.status === 400 && noteRow(db).topic === null)

    const toItem = await editNote(db.client, noteRow(db) as ExistingNote, { type: "action_item" })
    ok("a note cannot be turned into an action item",
      toItem.status === 400 && toItem.json.error === ACTION_ITEM_RETIRED && noteRow(db).type === "other")
    ok("and no task appears", db.tables.coach_tasks.length === 0)

    const empty = await editNote(db.client, noteRow(db) as ExistingNote, {})
    ok("an edit with no fields is refused", empty.status === 400)
    const same = await editNote(db.client, noteRow(db) as ExistingNote, { body: "Scoped the resume" })
    ok("a save with nothing changed answers with the note", same.status === 200 && (same.json.note as Row)?.id === "n-1")
    const tick = await editNote(db.client, noteRow(db) as ExistingNote, { completed_at: new Date().toISOString() })
    ok("a tick from an old screen changes nothing", tick.status === 400 && noteRow(db).completed_at === null)
  }

  console.log("\nan old action item is history, its task stands alone")
  {
    const db = await seedOldActionItem()
    const [card] = await withNoteTasks(db.client, [noteRow(db)] as Array<Row & { id: string; type: string }>)
    ok("the card carries its task's state and owner",
      card.task?.status === "open" && card.task?.assignee_name === "Peri Ginsberg")

    await editNote(db.client, noteRow(db) as ExistingNote, { body: "Draft SOW v2", topic: "deliverable" })
    ok("its text and topic can be edited", noteRow(db).body === "Draft SOW v2" && noteRow(db).topic === "deliverable")
    ok("the task's title is left alone", taskOf(db)?.title === "Draft SOW")
    ok("and it stays an action item", noteRow(db).type === "action_item")

    await setTaskStatus(db.client, taskOf(db)!.id, "done", COACH)
    await editNote(db.client, noteRow(db) as ExistingNote, { type: "session_recap" })
    ok("it can be edited into another type", noteRow(db).type === "session_recap")
    ok("which drops the priority and tick the CHECKs forbid there",
      noteRow(db).priority === null && noteRow(db).completed_at === null)
    ok("and the task is untouched", taskOf(db)?.status === "done")
  }
  {
    const db = await seedOldActionItem()
    const task = taskOf(db)!
    task.deleted_at = new Date().toISOString()   // deleted from the task list
    const [card] = await withNoteTasks(db.client, [noteRow(db)] as Array<Row & { id: string; type: string }>)
    ok("a deleted task still reaches the card, flagged deleted, not as 'no task'",
      card.task?.id === task.id && card.task?.deleted === true)
  }
  {
    const db = await seedOldActionItem()
    const [card] = await withNoteTasks(db.client, [noteRow(db)] as Array<Row & { id: string; type: string }>)
    ok("a live task is not flagged deleted", card.task?.deleted === false)
  }
  {
    const db = await seedOldActionItem()
    await deleteNote(db.client, "n-1")
    ok("deleting the note soft-deletes it", !!noteRow(db).deleted_at)
    ok("and leaves its open task open", taskOf(db)?.status === "open")
  }
  {
    const db = seed([note({ id: "n-9" })])
    const out = await withNoteTasks(db.client, [noteRow(db, "n-9")] as Array<Row & { id: string; type: string }>)
    ok("a recap carries no task", out[0].task === null)
  }

  console.log("\nthe catch-up's link back to the note")
  {
    const pLink = noteLink({ id: "n-1", coach_client_id: "cc-prospect", client_profile_id: null })
    ok("a prospect's note links to the prospect page", pLink === "/dashboard/coach/prospects/cc-prospect#note-n-1")
    const cLink = noteLink({ id: "n-2", coach_client_id: "cc-client", client_profile_id: CLIENT })
    ok("a client's note links to the Notes tab", cLink === "/dashboard/coach/clients/client-1?tab=notes#note-n-2")
    ok("both are valid Go links", cleanTaskLink(pLink) === pLink && cleanTaskLink(cLink) === cLink)
    ok("title rule matches the backfill",
      JSON.stringify(taskTextFromNote("Draft SOW\nwith pricing")) ===
      JSON.stringify({ title: "Draft SOW", description: "Draft SOW\nwith pricing" }))
  }

  console.log("\nworkbook review notes SIGNAL writes still get a task")
  {
    const db = seed([note({ id: "n-wb", type: "action_item", coach_client_id: "cc-client", client_profile_id: CLIENT,
      body: "Maya sent the workbook for review", priority: "this_week" })])
    const link = "/dashboard/coach/clients/client-1?tab=workbooks&workbook=wb-1"
    const made = await ensureSystemNoteTask(db.client, "n-wb", { link })
    const t = taskOf(db, "n-wb")
    ok("a system task is created", made.ok && t?.source === "auto" && t?.created_by_profile_id === null)
    ok("linked to the workbook", t?.link === link)
    noteRow(db, "n-wb").body = "Maya sent the workbook for review (2 questions)"
    await ensureSystemNoteTask(db.client, "n-wb", { link })
    ok("a refreshed note retitles the same task",
      taskOf(db, "n-wb")?.title === "Maya sent the workbook for review (2 questions)"
      && db.tables.coach_tasks.filter((x) => x.legacy_note_id === "n-wb").length === 1)
    const closed = await closeTasksForNotes(db.client, ["n-wb"], COACH)
    ok("sending the workbook back closes it", closed === 1 && taskOf(db, "n-wb")?.status === "done")
  }
  {
    const db = seed([note({ id: "n-wb", type: "action_item", coach_client_id: "cc-client", client_profile_id: CLIENT,
      body: "Maya sent the workbook for review", priority: "this_week" })])
    await ensureSystemNoteTask(db.client, "n-wb", { link: "/dashboard/coach/clients/client-1?tab=workbooks&workbook=wb-1" })
    await setTaskStatus(db.client, taskOf(db, "n-wb")!.id, "done", COACH)
    ok("ticking the review task closes its note, so the next send writes a new one",
      !!noteRow(db, "n-wb").completed_at)
    await setTaskStatus(db.client, taskOf(db, "n-wb")!.id, "open", COACH)
    ok("reopening it reopens the note", noteRow(db, "n-wb").completed_at === null)
  }

  console.warn = warn
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main()
