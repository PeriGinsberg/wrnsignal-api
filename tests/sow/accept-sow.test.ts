#!/usr/bin/env tsx
// Let's Go: accepting the SOW, and everything it starts.
// Run: npx tsx tests/sow/accept-sow.test.ts

import { makeFakeDb } from "../_lib/fakeSupabase"
import { acceptSow } from "../../lib/sow/accept"
import { getSowByToken } from "../../lib/sow/public"
import { sendClientSow, type SendEmail } from "../../lib/sow/send"
import { defaultSowEmailBody } from "../../lib/sow/email"
import { WORKSPACE_SUBFOLDERS, type DriveApi } from "../../lib/sow/workspace"
import { applyTaskAction, getPlan } from "../../lib/plan/service"
import { taskTitle } from "../../lib/plan/model"
import { letsGoBody, type LetsGoEmail } from "../../lib/email/sendLetsGoEmail"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-1"
const CC = "cc-1"
const ROOT = "root"

function seed(over: { workspace?: string | null; networking?: string | null; lifecycle?: string } = {}) {
  const task = (id: string, d: string, name: string, owner: string, sort_order: number) =>
    ({ id, engagement_deliverable_id: d, name, owner, state: "upcoming", sort_order, assignee_profile_id: null, due_date: null, released_at: null, is_signoff: false, welcome_release: false })
  return makeFakeDb({
    coach_clients: [{
      id: CC, coach_profile_id: COACH, name: "Aiden Park", client_profile_id: null, status: "active",
      invited_email: "aiden@example.com", parent_email: null, lifecycle_status: over.lifecycle ?? "Prospect", current_stage_key: "consult_completed",
      workspace_folder_id: over.workspace ?? null, drive_folder_id: over.networking ?? null,
    }],
    client_profiles: [{ id: COACH, coach_org: "Workforce Ready Now", is_coach: true, name: "Peri", email: "peri@example.com" }],
    coach_packages: [],
    coach_client_engagements: [{ id: "eng-1", coach_client_id: CC, name: "Run the Search", discount_cents: null, source_package_id: null, proposal_status: "draft", attached_at: "2026-10-01" }],
    coach_client_engagement_deliverables: [
      { id: "d-dna", engagement_id: "eng-1", name: "Your SIGNAL DNA Report", phase_id: "ph-know", not_needed: false, sort_order: 1, fee_cents: 15000, source_milestone_id: null },
      { id: "d-ws", engagement_id: "eng-1", name: "Resume Workshop", phase_id: "ph-build", not_needed: false, sort_order: 2, fee_cents: 10000, source_milestone_id: null },
    ],
    coach_client_engagement_activities: [
      task("t1", "d-dna", "Prepare Your SIGNAL DNA report", "coach", 1),
      task("t2", "d-ws", "Book Resume Workshop", "client", 1),
      task("t3", "d-ws", "Run Resume Workshop", "coach", 2),
    ],
    coach_milestones: [],
    coach_phases: [
      { id: "ph-know", coach_profile_id: COACH, label: "Know", sow_subtitle: null, sow_note: null, sort_order: 1, active: true, phase_key: "know" },
      { id: "ph-build", coach_profile_id: COACH, label: "Build", sow_subtitle: null, sow_note: null, sort_order: 2, active: true, phase_key: "build" },
    ],
    client_phase_status: [],
    coach_pipeline_stages: ["consult_completed", "sow_drafted", "sow_sent", "sow_executed", "onboarding", "invoice_sent"].map((k, i) => ({
      coach_profile_id: COACH, stage_key: k, label: k, sort_order: i + 1, is_terminal: false, active: true,
    })),
    prospect_stage_progress: [{ coach_client_id: CC, stage_key: "consult_completed", reached_at: "2026-10-01" }],
  })
}
type Db = ReturnType<typeof seed>

function fakeDrive(failOn: "create" | "share" | null = null) {
  const made: { id: string; parent: string; name: string }[] = []
  const shares: { id: string; email: string }[] = []
  let n = 0
  const drive: DriveApi = {
    freeChildFolderName: async (parent, name) => {
      if (failOn === "create") throw new Error("Drive is down")
      let candidate = name
      for (let i = 2; made.some((m) => m.parent === parent && m.name === candidate); i++) candidate = `${name} (${i})`
      return candidate
    },
    createFolder: async (parent, name) => { const id = `f${++n}`; made.push({ id, parent, name }); return { id } },
    shareWithUser: async (id, email) => {
      if (failOn === "share") throw new Error("Sharing is blocked")
      shares.push({ id, email }); return { permissionId: "p1", role: "writer" }
    },
  }
  return { drive, made, shares }
}

async function sendOne(db: Db): Promise<string> {
  let link = ""
  const send: SendEmail = async (a) => {
    link = String((a.model as any).body_text).match(/\/sow\/([A-Za-z0-9_-]{43})/)![1]
    return { ok: true, to: a.to, redirected: true, messageId: "m1" }
  }
  const r = await sendClientSow(db.client as any, {
    coachClientId: CC, engagementId: "eng-1", actingIds: [COACH], actor: COACH, appUrl: "https://app", send,
    subject: "Your plan", body: defaultSowEmailBody("Aiden Park", "Run the Search"), ccParent: false,
  })
  if (!r.ok) throw new Error(r.error)
  return link
}

const t = (db: Db, id: string) => db.tables.coach_client_engagement_activities.find((x) => x.id === id)!
const todos = (db: Db) => db.tables.coach_tasks.filter((x) => x.status === "open")
const events = (db: Db, type: string) => db.tables.coach_client_events.filter((e) => e.event_type === type)

async function main() {
  console.log("Let's Go")
  {
    const db = seed()
    const token = await sendOne(db)
    const d = fakeDrive()
    const mails: { to: string; e: LetsGoEmail }[] = []
    const r = await acceptSow(db.client as any, token, "  Aiden   Park ", { drive: d.drive, rootId: ROOT, notify: async (to, e) => { mails.push({ to, e }); return { ok: true } }, appUrl: "https://app" })
    ok("accepts", r.ok && !r.already && r.accepted_name === "Aiden Park" && r.first_name === "Aiden" && r.workspace_ready, r.ok ? "" : r.error)
    const sow = db.tables.client_sows[0]
    ok("the name and time are recorded on the SOW", sow.status === "accepted" && sow.accepted_name === "Aiden Park" && !!sow.accepted_at)
    ok("the package is Approved, with History", db.tables.coach_client_engagements[0].proposal_status === "approved" && events(db, "proposal_approved").length === 1)
    ok("plan tasks activate as on approval: the first task is Active", t(db, "t1").state === "active")
    ok("the prospect moves through SOW executed to Onboarding", db.tables.coach_clients[0].current_stage_key === "onboarding"
      && db.tables.prospect_stage_progress.some((p) => p.stage_key === "sow_executed"))
    ok("the workspace: [First Last] under the clients folder, with the seven subfolders",
      d.made[0].parent === ROOT && d.made[0].name === "Aiden Park" && d.made.slice(1).map((m) => m.name).join() === WORKSPACE_SUBFOLDERS.join())
    const cc = db.tables.coach_clients[0]
    ok("saved on the record; the empty Networking folder takes its Networking subfolder", cc.workspace_folder_id === "f1"
      && cc.drive_folder_id === d.made.find((m) => m.name === "Networking")!.id)
    ok("nothing shared yet", d.shares.length === 0)
    ok("the first client task is the welcome task, Active out of order", t(db, "t2").welcome_release === true && t(db, "t2").state === "active")
    ok("its To-Do item reads Send welcome email (releases: ...)", todos(db).some((x) => x.title === "Send welcome email (releases: Book Resume Workshop)"))
    const plan = await getPlan(db.client as any, CC)
    ok("the Plan shows it the same way", taskTitle(plan.flatMap((p) => p.tasks).find((x) => x.id === "t2")!) === "Send welcome email (releases: Book Resume Workshop)")
    const inv = todos(db).find((x) => x.title === "Send invoice to Aiden Park")
    ok("a Send invoice task with the accepted price and terms", !!inv && inv.description.includes("$250") && inv.description.includes("due in full when you click Let's Go")
      && inv.link === `/dashboard/coach/prospects/${CC}`)
    ok("History: SOW accepted by the typed name", events(db, "sow_accepted")[0]?.context.accepted_name === "Aiden Park" && events(db, "sow_accepted")[0].context.changed_after_send === false
      && events(db, "workspace_created").length === 1)
    ok("the coach is emailed, with the workspace link", mails.length === 1 && mails[0].to === "peri@example.com" && mails[0].e.workspaceUrl === "https://drive.google.com/drive/folders/f1"
      && mails[0].e.welcomeTask === "Book Resume Workshop")
    ok("sow.accepted is emitted, ending the follow-up", db.tables.coach_automation_events.some((e) => e.event_key === "sow.accepted"))
    const pub = await getSowByToken(db.client as any, token)
    ok("the link now reads accepted, by whom", !!pub && pub.status === "accepted" && pub.accepted_name === "Aiden Park")

    const again = await acceptSow(db.client as any, token, "Someone Else", { drive: d.drive, rootId: ROOT, notify: async () => ({ ok: true }) })
    ok("a second click changes nothing", again.ok && again.already && again.accepted_name === "Aiden Park" && mails.length === 1
      && d.made.length === 8 && events(db, "sow_accepted").length === 1)

    console.log("\nreleasing the welcome task")
    const rel = await applyTaskAction(db.client as any, { coachClientId: CC, taskId: "t2", action: "release", actor: COACH })
    // the share runs through lib/sow/workspace with the real Drive; check the fake one below instead
    ok("the task is released to the client", rel.ok && t(db, "t2").state === "waiting_on_client")
  }

  console.log("\nthe share, on release")
  {
    const { onWelcomeReleased } = await import("../../lib/sow/workspace")
    const db = seed({ workspace: "ws-1" })
    const d = fakeDrive()
    await onWelcomeReleased(db.client as any, CC, { drive: d.drive })
    ok("shares the workspace with the client's email", d.shares.length === 1 && d.shares[0].id === "ws-1" && d.shares[0].email === "aiden@example.com"
      && events(db, "workspace_shared")[0]?.context.email === "aiden@example.com")
    const db2 = seed({ workspace: "ws-1" })
    await onWelcomeReleased(db2.client as any, CC, { drive: fakeDrive("share").drive })
    ok("Drive refuses: a task to share it by hand", db2.tables.coach_tasks.some((x) => x.title === "Share Drive folder with Aiden Park" && x.description.includes("Sharing is blocked")))
    const db3 = seed()
    await onWelcomeReleased(db3.client as any, CC, { drive: fakeDrive().drive })
    ok("no workspace: a task to share it by hand", db3.tables.coach_tasks.some((x) => x.title === "Share Drive folder with Aiden Park"))
  }

  console.log("\nthe workspace")
  {
    const db = seed({ workspace: "existing", networking: "pasted" })
    const token = await sendOne(db)
    const d = fakeDrive()
    const r = await acceptSow(db.client as any, token, "Aiden Park", { drive: d.drive, rootId: ROOT, notify: async () => ({ ok: true }) })
    ok("a record with a workspace keeps it; no new folder", r.ok && d.made.length === 0 && db.tables.coach_clients[0].workspace_folder_id === "existing")
    ok("and a pasted Networking folder is never overwritten", db.tables.coach_clients[0].drive_folder_id === "pasted")

    const db2 = seed()
    const token2 = await sendOne(db2)
    const d2 = fakeDrive()
    await d2.drive.createFolder(ROOT, "Aiden Park")
    await acceptSow(db2.client as any, token2, "Aiden Park", { drive: d2.drive, rootId: ROOT, notify: async () => ({ ok: true }) })
    ok("a folder with the same name already there: the new one is (2)", d2.made[1].name === "Aiden Park (2)" && db2.tables.coach_clients[0].workspace_folder_id === d2.made[1].id)

    const db3 = seed()
    const token3 = await sendOne(db3)
    const mails: LetsGoEmail[] = []
    const r3 = await acceptSow(db3.client as any, token3, "Aiden Park", { drive: fakeDrive("create").drive, rootId: ROOT, notify: async (_to, e) => { mails.push(e); return { ok: true } } })
    ok("Drive down: Let's Go still succeeds, workspace not ready", r3.ok && !r3.workspace_ready && db3.tables.client_sows[0].status === "accepted"
      && db3.tables.coach_client_engagements[0].proposal_status === "approved")
    ok("and a task to create the folder; the coach's email says why", db3.tables.coach_tasks.some((x) => x.title === "Create Drive folder for Aiden Park")
      && mails[0].workspaceUrl === null && mails[0].workspaceError === "Drive is down")
  }

  console.log("\nchanged after sending")
  {
    const db = seed()
    const token = await sendOne(db)
    db.tables.coach_client_engagement_deliverables[1].fee_cents = 20000
    const mails: LetsGoEmail[] = []
    await acceptSow(db.client as any, token, "Aiden Park", { drive: fakeDrive().drive, rootId: ROOT, notify: async (_to, e) => { mails.push(e); return { ok: true } } })
    ok("still accepted; History and the email warn", db.tables.client_sows[0].status === "accepted" && events(db, "sow_accepted")[0].context.changed_after_send === true
      && mails[0].changedAfterSend && letsGoBody(mails[0]).text.includes("Heads up"))
    const inv = db.tables.coach_tasks.find((x) => x.title === "Send invoice to Aiden Park")!
    ok("the invoice task uses the accepted SOW's price, not the changed one", inv.description.includes("$250") && !inv.description.includes("$350"))
  }

  console.log("\nrefused")
  {
    const db = seed()
    const token = await sendOne(db)
    const go = (tok: unknown, name: unknown) => acceptSow(db.client as any, tok, name, { drive: fakeDrive().drive, rootId: ROOT, notify: async () => ({ ok: true }) })
    ok("a name of one letter", !(await go(token, "A")).ok)
    ok("no name", !(await go(token, "   ")).ok)
    ok("a name over 200 characters", !(await go(token, "x".repeat(201))).ok)
    ok("an unknown link", !(await go("B".repeat(43), "Aiden Park")).ok)
    ok("a malformed link", !(await go("short", "Aiden Park")).ok)
    ok("none of that accepted anything", db.tables.client_sows[0].status === "sent")
    const db2 = seed({ lifecycle: "Active" })
    const tok2 = await sendOne(db2)
    await acceptSow(db2.client as any, tok2, "Aiden Park", { drive: fakeDrive().drive, rootId: ROOT, notify: async () => ({ ok: true }) })
    ok("a client (not a prospect) moves no stage", db2.tables.coach_clients[0].current_stage_key === "consult_completed" && db2.tables.client_sows[0].status === "accepted")
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
