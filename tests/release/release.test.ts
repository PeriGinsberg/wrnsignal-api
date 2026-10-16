#!/usr/bin/env tsx
// The Release-step email: the fields SIGNAL fills, the [bracket] guard, the
// workbook loader's parse, the templates in Settings, which plan steps offer
// Send email, the draft, the send (which releases the step), and the
// workbook's library changes.
// Run: npx tsx tests/release/release.test.ts

import { readFileSync } from "node:fs"
import { makeFakeDb } from "../_lib/fakeSupabase"
import { fillReleaseFields, leftoverBrackets, releaseProblem } from "../../lib/release/model"
import {
  deleteReleaseTemplate,
  getReleaseSteps,
  loadReleaseDraft,
  saveReleaseTemplate,
  sendReleaseEmail,
  tasksWithReleaseEmail,
} from "../../lib/release/service"
import type { MessageProvider, OutboundEmail } from "../../lib/messaging/types"
import { parseWorkbook } from "./load-release-emails"
import { applyWorkbookLibrary, planWorkbookLibrary } from "../package-seed/apply-workbook-library"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const PERI = "coach-peri"
const ERIN = "coach-erin"
const OTHER = "coach-other"
const CC = "cc-1"
const DRIVE = "https://drive.google.com/drive/folders/ws-1"
const CAL = "https://calendly.com/peri/wrn-resume-workshop"

function fakeProvider(result: "ok" | "fail" = "ok") {
  const sent: OutboundEmail[] = []
  const provider: MessageProvider = {
    name: "postmark",
    async sendEmail(m) { sent.push(m); return result === "ok" ? { ok: true, providerMessageId: "pm-1" } : { ok: false, error: "Postmark is down" } },
  }
  return { provider, sent }
}

function seed(over: { drive?: boolean; state?: string; welcome?: boolean; source?: string | null } = {}) {
  return makeFakeDb({
    coach_clients: [{
      id: CC, coach_profile_id: PERI, name: "Park, Aiden", client_profile_id: null, status: "active",
      invited_email: "aiden@example.com", parent_email: null, parent_name: null, phone: null, lifecycle_status: "Active",
      workspace_folder_url: over.drive === false ? null : DRIVE,
    }],
    client_profiles: [
      { id: PERI, is_coach: true, name: "Peri", email: "peri@workforcereadynow.com" },
      { id: ERIN, is_coach: true, name: "Erin", email: "erin+coach@workforcereadynow.com" },
    ],
    coach_messaging_settings: [
      { coach_profile_id: PERI, sending_email: "peri@workforcereadynow.com", signature: "Peri Ginsberg", provider: "postmark" },
      { coach_profile_id: ERIN, sending_email: "erin@workforcereadynow.com", signature: "Erin Condon", provider: "postmark" },
    ],
    client_emails: [],
    // The library: Peri's and another coach's.
    coach_milestones: [
      { id: "m-ws", coach_profile_id: PERI, name: "Resume Workshop", sort_order: 2, active: true, phase_id: "ph-build" },
      { id: "m-dna", coach_profile_id: PERI, name: "Your SIGNAL DNA Assessment", sort_order: 1, active: true, phase_id: "ph-know" },
      { id: "m-x", coach_profile_id: OTHER, name: "Theirs", sort_order: 1, active: true, phase_id: null },
    ],
    coach_milestone_activities: [
      { id: "a-book", milestone_id: "m-ws", name: "Book Resume Workshop", owner: "client", sort_order: 1 },
      { id: "a-prep", milestone_id: "m-ws", name: "Prepare for Resume Workshop", owner: "coach", sort_order: 2 },
      { id: "a-dna", milestone_id: "m-dna", name: "Book Your SIGNAL DNA Assessment", owner: "client", sort_order: 1 },
      { id: "a-x", milestone_id: "m-x", name: "Their client step", owner: "client", sort_order: 1 },
    ],
    coach_release_templates: [
      { activity_id: "a-book", coach_profile_id: PERI, subject: "Time to schedule your Resume Workshop, [First Name]",
        body: "Hi [First Name],\n\nYour folder: [Drive folder link]\n\nBook here: [Scheduling link]", scheduling_link: CAL },
    ],
    // The client's plan.
    coach_client_engagements: [{ id: "eng-1", coach_client_id: CC, name: "Foundations", proposal_status: "approved" }],
    coach_client_engagement_deliverables: [
      { id: "d-ws", engagement_id: "eng-1", name: "Resume Workshop", phase_id: "ph-build", not_needed: false, sort_order: 1, source_milestone_id: "m-ws" },
    ],
    coach_client_engagement_activities: [
      { id: "t1", engagement_deliverable_id: "d-ws", name: "Book Resume Workshop", owner: "client", state: over.state ?? "active", sort_order: 1,
        assignee_profile_id: PERI, due_date: null, released_at: null, is_signoff: false, welcome_release: over.welcome ?? false,
        source_activity_id: over.source === undefined ? "a-book" : over.source, details: null },
      { id: "t2", engagement_deliverable_id: "d-ws", name: "Prepare for Resume Workshop", owner: "coach", state: "upcoming", sort_order: 2,
        assignee_profile_id: PERI, due_date: null, released_at: null, is_signoff: false, welcome_release: false, source_activity_id: "a-prep", details: null },
    ],
    coach_phases: [
      { id: "ph-know", coach_profile_id: PERI, label: "Know", sort_order: 1, active: true, phase_key: "know" },
      { id: "ph-build", coach_profile_id: PERI, label: "Build", sort_order: 2, active: true, phase_key: "build" },
    ],
    client_phase_status: [],
    coach_tasks: [{ id: "todo-1", title: "Release: Book Resume Workshop", status: "open", plan_activity_id: "t1",
      coach_client_id: CC, client_profile_id: null, assignee_profile_id: PERI, deleted_at: null }],
    coach_client_events: [],
  })
}
type Db = ReturnType<typeof seed>
const task = (db: Db, id = "t1") => db.tables.coach_client_engagement_activities.find((x) => x.id === id)!
const events = (db: Db, type: string) => db.tables.coach_client_events.filter((e) => e.event_type === type)

async function main() {
  console.log("the fields")
  {
    const f = fillReleaseFields("Hi [First Name], [ first  name ]: [Drive folder link] [Scheduling link] [TRACK]", { firstName: "Aiden", drive: DRIVE, scheduling: CAL })
    ok("first name, Drive and scheduling filled, any case and spacing", f === `Hi Aiden, Aiden: ${DRIVE} ${CAL} [TRACK]`, f)
    ok("no name reads there", fillReleaseFields("Hi [First Name]", { firstName: "", drive: null, scheduling: null }) === "Hi there")
    ok("no Drive or link: the field stays for the guard", fillReleaseFields("[Drive folder link] [Scheduling link]", { firstName: "A", drive: null, scheduling: null }) === "[Drive folder link] [Scheduling link]")
    ok("brackets listed once each, in order", leftoverBrackets("[A] x [B] [A]").join(",") === "[A],[B]")
    ok("a bracket in the subject counts", !!releaseProblem("Your [TRACK] draft", "Hi"))
    ok("the guard names what to fill", releaseProblem("s", "See [RESUME LINK] and [EXAMPLES]") === "Fill in [RESUME LINK], [EXAMPLES] before sending.")
    ok("no Drive workspace gets its own reason", /no Drive workspace/.test(releaseProblem("s", "[Drive folder link]") ?? ""))
    ok("no scheduling link gets its own reason", /no scheduling link/.test(releaseProblem("s", "[Scheduling link]") ?? ""))
    ok("nothing left: nothing to fix", releaseProblem("Subject", "Hi Aiden") === null)
  }

  console.log("\nthe workbook")
  {
    const sheets = parseWorkbook(readFileSync("docs/WRN Coaching Workflow Workbook.md", "utf8"))
    const emails = sheets.filter((s) => s.body)
    ok("18 Release steps, 13 with an email", sheets.length === 18 && emails.length === 13, `${sheets.length}/${emails.length}`)
    ok("R5, R10, R12, R14 and R16 have none", sheets.filter((s) => !s.body).map((s) => s.code).join(",") === "R5,R10,R12,R14,R16")
    ok("every email has a subject and starts Hi [First Name],", emails.every((s) => !!s.subject && s.body!.startsWith("Hi [First Name],")))
    ok("Best, Peri dropped", emails.every((s) => !/Best,\s*Peri/.test(s.body!)))
    ok("no {{merge}} syntax, Markdown escape or bold is left", emails.every((s) => !/\{\{|\\|\*\*/.test(s.body! + s.subject!)))
    const r1 = sheets.find((s) => s.code === "R1")!
    ok("the booking link becomes [Scheduling link] and is kept as the link",
      r1.booking === "https://calendly.com/peri-workforcereadynow/your-signal-dna-assessment" && r1.body!.includes("here: [Scheduling link]") && !r1.body!.includes("calendly.com"))
    const r4 = sheets.find((s) => s.code === "R4")!
    ok("R4 keeps the coach's brackets", r4.subject === "Your [TRACK] resume draft is ready for review" && r4.body!.includes("[RESUME LINK]") && r4.body!.includes("[EXAMPLES]"))
    ok("R8 uses the Drive folder", sheets.find((s) => s.code === "R8")!.body!.includes("[Drive folder link]"))
    ok("bullets read as dashes", sheets.find((s) => s.code === "R11")!.body!.includes("\n- Complete your homework"))
    ok("sheet names match the renamed steps", sheets.some((s) => s.step === "Book Career Planning Decoded session") && sheets.some((s) => s.step === "Book Job Search Strategy Session"))
  }

  console.log("\nSettings")
  {
    const db = seed()
    const steps = await getReleaseSteps(db.client as any, PERI)
    ok("client steps only, in library order, with their emails", steps.map((s) => s.name).join("|") === "Book Your SIGNAL DNA Assessment|Book Resume Workshop"
      && steps[1].template?.scheduling_link === CAL && steps[0].template === null)
    const theirs = await saveReleaseTemplate(db.client as any, PERI, { activity_id: "a-x", subject: "s", body: "b" })
    ok("another coach's step is refused", !theirs.ok && theirs.status === 404)
    const coachStep = await saveReleaseTemplate(db.client as any, PERI, { activity_id: "a-prep", subject: "s", body: "b" })
    ok("a coach step is refused", !coachStep.ok)
    const badLink = await saveReleaseTemplate(db.client as any, PERI, { activity_id: "a-dna", subject: "s", body: "b", scheduling_link: "calendly.com/x" })
    ok("a scheduling link must be a web address", !badLink.ok && /https/.test(badLink.error))
    const saved = await saveReleaseTemplate(db.client as any, PERI, { activity_id: "a-dna", subject: " Time to book \n", body: "Hi\r\nthere", scheduling_link: "" })
    ok("saved, trimmed, blank link is none", saved.ok && saved.data.subject === "Time to book" && saved.data.body === "Hi\nthere" && saved.data.scheduling_link === null)
    ok("stored against the coach", db.tables.coach_release_templates.find((t) => t.activity_id === "a-dna")?.coach_profile_id === PERI)
    const again = await saveReleaseTemplate(db.client as any, PERI, { activity_id: "a-dna", subject: "New", body: "Hi" })
    ok("a second save updates, not duplicates", again.ok && db.tables.coach_release_templates.filter((t) => t.activity_id === "a-dna").length === 1
      && db.tables.coach_release_templates.find((t) => t.activity_id === "a-dna")?.subject === "New")
    const del = await deleteReleaseTemplate(db.client as any, PERI, "a-dna")
    ok("removed", del.ok && !db.tables.coach_release_templates.some((t) => t.activity_id === "a-dna"))
  }

  console.log("\nwhich steps offer Send email")
  {
    const db = seed()
    const has = await tasksWithReleaseEmail(db.client as any, CC, ["t1", "t2"])
    ok("the client step with a template does; the coach step doesn't", has.has("t1") && !has.has("t2"))
    const noSource = seed({ source: null })
    ok("a step with no library source has none", !(await tasksWithReleaseEmail(noSource.client as any, CC, ["t1"])).has("t1"))
    const otherCoach = seed()
    otherCoach.tables.coach_release_templates[0].coach_profile_id = ERIN
    ok("only the main coach's templates count", !(await tasksWithReleaseEmail(otherCoach.client as any, CC, ["t1"])).has("t1"))
  }

  console.log("\nthe draft")
  {
    const db = seed()
    const d = await loadReleaseDraft(db.client as any, CC, "t1")
    ok("fields filled from the record and the template", d.ok && d.data.subject === "Time to schedule your Resume Workshop, Aiden"
      && d.data.body === `Hi Aiden,\n\nYour folder: ${DRIVE}\n\nBook here: ${CAL}`, d.ok ? JSON.stringify(d.data) : d.error)
    const noDrive = await loadReleaseDraft(seed({ drive: false }).client as any, CC, "t1")
    ok("no Drive workspace: the field stays, and the guard says why", noDrive.ok && noDrive.data.body.includes("[Drive folder link]")
      && /no Drive workspace/.test(releaseProblem(noDrive.data.subject, noDrive.data.body) ?? ""))
    const welcome = await loadReleaseDraft(seed({ welcome: true }).client as any, CC, "t1")
    ok("the welcome task has its own email", !welcome.ok && welcome.status === 409)
    const released = await loadReleaseDraft(seed({ state: "waiting_on_client" }).client as any, CC, "t1")
    ok("an already released step has none", !released.ok && released.status === 409)
    const coachTask = await loadReleaseDraft(db.client as any, CC, "t2")
    ok("a coach step has none", !coachTask.ok)
    const wrongClient = await loadReleaseDraft(db.client as any, "cc-other", "t1")
    ok("another client's step is not found", !wrongClient.ok && wrongClient.status === 404)
  }

  console.log("\nthe send")
  {
    const db = seed()
    const p = fakeProvider()
    const left = await sendReleaseEmail(db.client as any, { coachClientId: CC, taskId: "t1", actor: PERI, subject: "Your [TRACK] draft", body: "Hi", provider: p.provider })
    ok("a bracket left: refused, nothing sent, nothing released", !left.ok && p.sent.length === 0 && task(db).state === "active" && db.tables.client_emails.length === 0)

    const r = await sendReleaseEmail(db.client as any, { coachClientId: CC, taskId: "t1", actor: ERIN, subject: "Time to book, Aiden", body: "Hi Aiden,\n\nBook here.", provider: p.provider })
    ok("sent", r.ok, r.ok ? "" : r.error)
    ok("from the signed-in coach, with their signature", p.sent[0]?.from === "erin@workforcereadynow.com" && p.sent[0]?.text.includes("Erin Condon"))
    ok("saved to Communications", db.tables.client_emails.length === 1 && db.tables.client_emails[0].email_type === "coach_message")
    ok("the step is released", task(db).state === "waiting_on_client")
    ok("History says so", events(db, "release_email_sent")[0]?.context.task === "Book Resume Workshop")

    const db2 = seed()
    const down = fakeProvider("fail")
    const failed = await sendReleaseEmail(db2.client as any, { coachClientId: CC, taskId: "t1", actor: PERI, subject: "s", body: "b", provider: down.provider })
    ok("the email fails: nothing changes", !failed.ok && failed.status === 502 && task(db2).state === "active" && events(db2, "release_email_sent").length === 0)
  }

  console.log("\nthe workbook's library changes")
  {
    const db = makeFakeDb({
      coach_milestones: [
        { id: "m-dna", coach_profile_id: PERI, name: "Your SIGNAL DNA Assessment", phase_id: "ph-know" },
        { id: "m-dec", coach_profile_id: PERI, name: "Your SIGNAL DNA Decode and Career Path Session", phase_id: "ph-know" },
        { id: "m-ws", coach_profile_id: PERI, name: "Resume Workshop", phase_id: "ph-build" },
        { id: "m-res", coach_profile_id: PERI, name: "Resume", phase_id: "ph-build" },
        { id: "m-jss", coach_profile_id: PERI, name: "SIGNAL Setup and Job Search Strategy", phase_id: "ph-search" },
      ],
      coach_milestone_activities: [
        { id: "a1", milestone_id: "m-dec", name: "Book Decode session", owner: "client" },
        { id: "a2", milestone_id: "m-dec", name: "Prepare for Decode session", owner: "coach" },
        { id: "a3", milestone_id: "m-dec", name: "Run Decode session", owner: "coach" },
        { id: "a4", milestone_id: "m-jss", name: "Book Job Search Strategy/Networking session", owner: "client" },
      ],
      coach_phases: [
        { id: "ph-know", coach_profile_id: PERI, phase_key: "know" },
        { id: "ph-build", coach_profile_id: PERI, phase_key: "build" },
        { id: "ph-search", coach_profile_id: PERI, phase_key: "search" },
      ],
      coach_packages: [
        { id: "p-kwa", coach_profile_id: PERI, name: "Know Where to Aim" },
        { id: "p-dna", coach_profile_id: PERI, name: "Your SIGNAL DNA" },
      ],
      coach_package_milestones: [
        { id: "l1", package_id: "p-kwa", milestone_id: "m-dna", sort_order: 0 },
        { id: "l2", package_id: "p-kwa", milestone_id: "m-dec", sort_order: 1 },
        { id: "l3", package_id: "p-kwa", milestone_id: "m-ws", sort_order: 2 },
        { id: "l4", package_id: "p-kwa", milestone_id: "m-res", sort_order: 3 },
        { id: "l5", package_id: "p-dna", milestone_id: "m-dna", sort_order: 0 },
        { id: "l6", package_id: "p-dna", milestone_id: "m-dec", sort_order: 1 },
      ],
      coach_clients: [{ id: CC, coach_profile_id: PERI }],
      coach_client_engagements: [{ id: "eng-1", coach_client_id: CC }],
      coach_client_engagement_deliverables: [
        { id: "d1", engagement_id: "eng-1", name: "Your SIGNAL DNA Decode and Career Path Session", phase_id: "ph-know", sort_order: 1, not_needed: false },
        { id: "d2", engagement_id: "eng-1", name: "Resume Workshop", phase_id: "ph-build", sort_order: 2, not_needed: false },
      ],
      coach_client_engagement_activities: [
        { id: "t1", engagement_deliverable_id: "d1", name: "Book Decode session", owner: "client", state: "active", sort_order: 1, welcome_release: false, assignee_profile_id: PERI, due_date: null },
        { id: "t2", engagement_deliverable_id: "d1", name: "Run Decode session", owner: "coach", state: "upcoming", sort_order: 2, welcome_release: false, assignee_profile_id: PERI, due_date: null },
      ],
      coach_tasks: [{ id: "todo-1", title: "Release: Book Decode session", status: "open", plan_activity_id: "t1", coach_client_id: CC,
        client_profile_id: null, assignee_profile_id: PERI, deleted_at: null, due_at: null }],
      coach_client_events: [],
    })
    const plan = await planWorkbookLibrary(db.client as any, PERI)
    ok("a dry run writes nothing", db.tables.coach_milestones.find((m) => m.id === "m-dec")?.name === "Your SIGNAL DNA Decode and Career Path Session")
    await applyWorkbookLibrary(db.client as any, plan)
    const dec = db.tables.coach_milestones.find((m) => m.id === "m-dec")!
    ok("the deliverable is Career Planning Decoded, in Build", dec.name === "Career Planning Decoded" && dec.phase_id === "ph-build")
    ok("its steps and the strategy step are renamed", db.tables.coach_milestone_activities.map((a) => a.name).join("|")
      === "Book Career Planning Decoded session|Prepare for Career Planning Decoded|Run Career Planning Decoded|Book Job Search Strategy Session")
    const order = (pkg: string) => db.tables.coach_package_milestones.filter((l) => l.package_id === pkg).sort((a, b) => a.sort_order - b.sort_order).map((l) => l.milestone_id).join(",")
    ok("Know Where to Aim: Career Planning Decoded after Resume Workshop", order("p-kwa") === "m-dna,m-ws,m-dec,m-res", order("p-kwa"))
    ok("Your SIGNAL DNA keeps its order", order("p-dna") === "m-dna,m-dec")
    const d1 = db.tables.coach_client_engagement_deliverables.find((d) => d.id === "d1")!
    ok("a client's plan gets the names, not the order or phase", d1.name === "Career Planning Decoded" && d1.sort_order === 1 && d1.phase_id === "ph-know"
      && task(db as any, "t1").name === "Book Career Planning Decoded session" && task(db as any, "t2").name === "Run Career Planning Decoded")
    ok("the open To-Do item is retitled", db.tables.coach_tasks.find((t) => t.id === "todo-1")?.title === "Release: Book Career Planning Decoded session",
      db.tables.coach_tasks.find((t) => t.id === "todo-1")?.title)
    ok("a second pass finds nothing to do", (await planWorkbookLibrary(db.client as any, PERI)).changes.length === 0)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
