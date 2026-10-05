#!/usr/bin/env tsx
// The welcome email: which template a plan gets, how the coach's text becomes
// the email, the templates in Settings, the doc loader's parse, and the send
// (Send and Don't send both release the task and share the Drive folder).
// Run: npx tsx tests/welcome/welcome.test.ts

import { readFileSync } from "node:fs"
import { makeFakeDb } from "../_lib/fakeSupabase"
import { isWelcomeTodo, renderWelcomeEmail, startForPhase, welcomeProblem } from "../../lib/welcome/model"
import { getWelcomeTemplates, loadWelcomeDraft, saveWelcomeTemplate, sendWelcome, type SendEmail } from "../../lib/welcome/service"
import type { DriveApi } from "../../lib/sow/workspace"
import { parse } from "./load-welcome-emails"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-1"
const CC = "cc-1"
const DRIVE_URL = "https://drive.google.com/drive/folders/ws-1"
const CAL = "https://calendly.com/peri/resume-workshop"
const BODY = "Hi [First Name],\n\nYOUR WORKSPACE\nHere it is:\n[Drive folder link]\n\nYOUR FIRST STEP\nBook here:\n[Scheduling link]\n\nLet's get started."

function seed(over: { workspace?: boolean; parent?: string | null; state?: string; welcome?: boolean; phase?: string; link?: string | null; templates?: boolean } = {}) {
  return makeFakeDb({
    coach_clients: [{
      id: CC, coach_profile_id: COACH, name: "Aiden Park", client_profile_id: null, status: "active",
      invited_email: "aiden@example.com", parent_email: over.parent === undefined ? "mom@example.com" : over.parent,
      lifecycle_status: "Active", workspace_folder_id: over.workspace === false ? null : "ws-1",
      workspace_folder_url: over.workspace === false ? null : DRIVE_URL, drive_folder_id: null,
    }],
    client_profiles: [{ id: COACH, is_coach: true, name: "Peri", email: "peri@example.com" }],
    coach_client_engagements: [{ id: "eng-1", coach_client_id: CC, name: "Foundations", proposal_status: "approved" }],
    coach_client_engagement_deliverables: [
      { id: "d-ws", engagement_id: "eng-1", name: "Resume Workshop", phase_id: over.phase ?? "ph-build", not_needed: false, sort_order: 1 },
    ],
    coach_client_engagement_activities: [
      { id: "t1", engagement_deliverable_id: "d-ws", name: "Book Resume Workshop", owner: "client", state: over.state ?? "active", sort_order: 1,
        assignee_profile_id: COACH, due_date: null, released_at: null, is_signoff: false, welcome_release: over.welcome ?? true },
      { id: "t2", engagement_deliverable_id: "d-ws", name: "Run Resume Workshop", owner: "coach", state: "upcoming", sort_order: 2,
        assignee_profile_id: COACH, due_date: null, released_at: null, is_signoff: false, welcome_release: false },
    ],
    coach_phases: [
      { id: "ph-build", coach_profile_id: COACH, label: "Build", sort_order: 2, active: true, phase_key: "build" },
      { id: "ph-prove", coach_profile_id: COACH, label: "Prove", sort_order: 3, active: true, phase_key: "prove" },
    ],
    client_phase_status: [],
    coach_welcome_templates: over.templates === false ? [] : [
      { coach_profile_id: COACH, start_key: "resume_workshop", subject: "Welcome to Workforce Ready Now", body: BODY, scheduling_link: over.link === undefined ? CAL : over.link },
      { coach_profile_id: COACH, start_key: "dna", subject: "Welcome, DNA", body: "Hi [First Name]", scheduling_link: null },
    ],
    coach_tasks: [{ id: "todo-1", title: "Send welcome email (releases: Book Resume Workshop)", status: "open", plan_activity_id: "t1",
      coach_client_id: CC, client_profile_id: null, assignee_profile_id: COACH, deleted_at: null }],
    coach_client_events: [],
  })
}
type Db = ReturnType<typeof seed>

function mailer(result: "ok" | "fail" = "ok") {
  const sent: Parameters<SendEmail>[0][] = []
  const send: SendEmail = async (a) => {
    sent.push(a)
    return result === "ok" ? { ok: true, to: a.to, redirected: false, messageId: "m-1" } : { ok: false, error: "Postmark is down" }
  }
  return { send, sent }
}
function fakeDrive() {
  const shares: { id: string; email: string }[] = []
  const drive: DriveApi = {
    freeChildFolderName: async (_p, n) => n,
    createFolder: async () => ({ id: "x" }),
    shareWithUser: async (id, email) => { shares.push({ id, email }); return { permissionId: "p", role: "writer" } },
  }
  return { drive, shares }
}

const task = (db: Db, id = "t1") => db.tables.coach_client_engagement_activities.find((x) => x.id === id)!
const events = (db: Db, type: string) => db.tables.coach_client_events.filter((e) => e.event_type === type)

async function main() {
  console.log("which template")
  ok("Know is Your SIGNAL DNA", startForPhase("know") === "dna")
  ok("any plan starting in Build is the Resume Workshop", startForPhase("build") === "resume_workshop")
  ok("Search and Land match themselves", startForPhase("search") === "search" && startForPhase("land") === "land")
  ok("Prove, a custom phase or none matches nothing", startForPhase("prove") === null && startForPhase("custom_1") === null && startForPhase(null) === null)

  console.log("\nthe email")
  {
    const r = renderWelcomeEmail(BODY.replace("[First Name]", "Aiden"), { drive: DRIVE_URL, scheduling: CAL })
    ok("a line that is only [Drive folder link] is a button", r.html.includes(`href="${DRIVE_URL}"`) && r.html.includes("Open your Drive workspace</a>") && r.html.includes("<table"))
    ok("a line that is only [Scheduling link] is a button", r.html.includes(`href="${CAL}"`) && r.html.includes("Book your session</a>"))
    ok("an all-capitals first line is bold", r.html.includes("<strong>YOUR WORKSPACE</strong>"))
    ok("no placeholder is left", !/\[(drive|scheduling)/i.test(r.html) && !/\[(drive|scheduling)/i.test(r.text))
    ok("the plain text carries the addresses", r.text.includes(DRIVE_URL) && r.text.includes(CAL))
    const inline = renderWelcomeEmail("Open [Drive folder link] today <b>", { drive: DRIVE_URL, scheduling: null })
    ok("a placeholder inside a sentence is a link, and typed markup is escaped", inline.html.includes(`Open <a href="${DRIVE_URL}"`) && inline.html.includes("&lt;b&gt;") && !inline.html.includes("<table"))
    ok("no Drive folder: can't send a message that uses it", !!welcomeProblem({ subject: "s", body: BODY, driveUrl: null, schedulingLink: CAL }))
    ok("no scheduling link: can't send a message that uses it", !!welcomeProblem({ subject: "s", body: BODY, driveUrl: DRIVE_URL, schedulingLink: null }))
    ok("neither used: nothing missing", welcomeProblem({ subject: "s", body: "Hi", driveUrl: null, schedulingLink: null }) === null)
    ok("the To-Do item is recognised by its title", isWelcomeTodo({ plan_activity_id: "t1", coach_client_id: CC, title: "Send welcome email (releases: Book Resume Workshop)" })
      && !isWelcomeTodo({ plan_activity_id: "t1", coach_client_id: CC, title: "Release: Book Resume Workshop" }))
  }

  console.log("\nthe doc")
  {
    const doc = parse(readFileSync("docs/WRN_Welcome_Emails.md", "utf8"))
    ok("four templates, in order", doc.map((d) => d.start).join(",") === "dna,resume_workshop,search,land")
    ok("each has the subject and both placeholders", doc.every((d) => d.subject === "Welcome to Workforce Ready Now" && d.body.includes("[Drive folder link]") && d.body.includes("[Scheduling link]")))
    ok("the message starts at Hi and ends at Let's get started", doc.every((d) => d.body.startsWith("Hi [First Name],") && d.body.endsWith("Let's get started.")))
    ok("Packages and Scheduling link lines stay out of the message", doc.every((d) => !d.body.includes("Packages:") && !/^Scheduling link:/m.test(d.body)))
  }

  console.log("\nSettings")
  {
    const db = seed({ templates: false })
    const bad = await saveWelcomeTemplate(db.client as any, COACH, { start_key: "land", subject: "Hi", body: "x", scheduling_link: "calendly.com/x" })
    ok("a scheduling link must be a web address", !bad.ok && /https/.test(bad.error))
    const r = await saveWelcomeTemplate(db.client as any, COACH, { start_key: "land", subject: " Hi ", body: "Body", scheduling_link: " https://calendly.com/x " })
    ok("saves, trimmed", r.ok && r.data.subject === "Hi" && r.data.scheduling_link === "https://calendly.com/x")
    await saveWelcomeTemplate(db.client as any, COACH, { start_key: "land", subject: "Hi again", body: "Body", scheduling_link: "" })
    const all = await getWelcomeTemplates(db.client as any, COACH)
    ok("saving again updates the one row; blank link is none", all.length === 1 && all[0].subject === "Hi again" && all[0].scheduling_link === null)
    ok("unknown template refused", !(await saveWelcomeTemplate(db.client as any, COACH, { start_key: "prove", subject: "a", body: "b" })).ok)
  }

  console.log("\nopening the editor")
  {
    const db = seed()
    const r = await loadWelcomeDraft(db.client as any, CC, "t1")
    ok("to, parent, first name and Drive link", r.ok && r.data.to === "aiden@example.com" && r.data.parent_email === "mom@example.com" && r.data.first_name === "Aiden" && r.data.drive_url === DRIVE_URL)
    ok("a Build plan matches the Resume Workshop", r.ok && r.data.match === "resume_workshop" && r.data.phase === "Build" && r.data.templates.length === 2)
    ok("not the welcome task: refused", !(await loadWelcomeDraft(seed({ welcome: false }).client as any, CC, "t1")).ok)
    ok("already released: refused", !(await loadWelcomeDraft(seed({ state: "waiting_on_client" }).client as any, CC, "t1")).ok)
    ok("another client's task: not found", !(await loadWelcomeDraft(seed().client as any, "cc-other", "t1")).ok)
    const prove = await loadWelcomeDraft(seed({ phase: "ph-prove" }).client as any, CC, "t1")
    ok("a Prove plan matches nothing; the coach picks", prove.ok && prove.data.match === null)
  }

  console.log("\nSend")
  {
    const db = seed()
    const m = mailer()
    const d = fakeDrive()
    const r = await sendWelcome(db.client as any, {
      coachClientId: CC, taskId: "t1", actor: COACH, send: true, start: "resume_workshop",
      subject: "Welcome, [First Name]", body: BODY, ccParent: true, mail: m.send, drive: d.drive,
    })
    ok("sends", r.ok && r.data.sent && r.data.to === "aiden@example.com" && r.data.cc === "mom@example.com", r.ok ? "" : r.error)
    ok("one email, to the client, cc the parent, the welcome template", m.sent.length === 1 && m.sent[0].to === "aiden@example.com" && m.sent[0].cc === "mom@example.com" && m.sent[0].templateAlias === "welcome-email")
    const model = m.sent[0]?.model as { subject: string; body_html: string } | undefined
    ok("[First Name] filled in the subject and the message", model?.subject === "Welcome, Aiden" && model.body_html.includes("Hi Aiden,"))
    ok("the template's scheduling link and the Drive link are in it", !!model?.body_html.includes(CAL) && model.body_html.includes(DRIVE_URL))
    ok("the task is released to the client", task(db).state === "waiting_on_client" && !!task(db).released_at)
    ok("the Drive folder is shared with the client", d.shares.length === 1 && d.shares[0].id === "ws-1" && d.shares[0].email === "aiden@example.com")
    ok("History: welcome email sent, with to, cc and template", events(db, "welcome_email_sent")[0]?.context.to === "aiden@example.com"
      && events(db, "welcome_email_sent")[0]?.context.cc === "mom@example.com" && events(db, "welcome_email_sent")[0]?.context.template === "Resume Workshop")
    ok("History: the release and the share", events(db, "plan_changed").some((e) => e.context.to === "waiting_on_client") && events(db, "workspace_shared").length === 1)
    ok("the To-Do item is closed", !db.tables.coach_tasks.some((x) => x.plan_activity_id === "t1" && x.status === "open"))
    const again = await sendWelcome(db.client as any, { coachClientId: CC, taskId: "t1", actor: COACH, send: true, start: "resume_workshop", subject: "s", body: "b", mail: m.send, drive: d.drive })
    ok("a second send is refused, nothing more goes", !again.ok && m.sent.length === 1)
  }

  console.log("\nSend, when it can't")
  {
    const db = seed()
    const m = mailer("fail")
    const d = fakeDrive()
    const r = await sendWelcome(db.client as any, { coachClientId: CC, taskId: "t1", actor: COACH, send: true, start: "resume_workshop", subject: "s", body: BODY, mail: m.send, drive: d.drive })
    ok("email fails: nothing changes", !r.ok && r.status === 502 && task(db).state === "active" && d.shares.length === 0 && events(db, "welcome_email_sent").length === 0)
    const db2 = seed({ link: null })
    const m2 = mailer()
    const r2 = await sendWelcome(db2.client as any, { coachClientId: CC, taskId: "t1", actor: COACH, send: true, start: "resume_workshop", subject: "s", body: BODY, mail: m2.send, drive: fakeDrive().drive })
    ok("no scheduling link on the template: refused, nothing sent", !r2.ok && m2.sent.length === 0 && task(db2).state === "active")
    const db3 = seed({ workspace: false })
    const r3 = await sendWelcome(db3.client as any, { coachClientId: CC, taskId: "t1", actor: COACH, send: true, start: "resume_workshop", subject: "s", body: BODY, mail: mailer().send, drive: fakeDrive().drive })
    ok("no Drive folder: refused", !r3.ok && task(db3).state === "active")
    const db4 = seed({ parent: null })
    const r4 = await sendWelcome(db4.client as any, { coachClientId: CC, taskId: "t1", actor: COACH, send: true, start: "resume_workshop", subject: "s", body: BODY, ccParent: true, mail: mailer().send, drive: fakeDrive().drive })
    ok("cc the parent with no parent email: refused", !r4.ok && /parent/.test(r4.error))
    const r5 = await sendWelcome(seed().client as any, { coachClientId: CC, taskId: "t1", actor: COACH, send: true, start: "land", subject: "s", body: "b", mail: mailer().send, drive: fakeDrive().drive })
    ok("a template not set up: refused", !r5.ok && /Land/.test(r5.error))
  }

  console.log("\nDon't send")
  {
    const db = seed({ link: null })
    const m = mailer()
    const d = fakeDrive()
    const r = await sendWelcome(db.client as any, { coachClientId: CC, taskId: "t1", actor: COACH, send: false, mail: m.send, drive: d.drive })
    ok("releases with no email", r.ok && !r.data.sent && m.sent.length === 0 && task(db).state === "waiting_on_client")
    ok("still shares the Drive folder", d.shares.length === 1)
    ok("History says it went without an email", events(db, "welcome_email_skipped")[0]?.context.task === "Book Resume Workshop" && events(db, "welcome_email_sent").length === 0)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
