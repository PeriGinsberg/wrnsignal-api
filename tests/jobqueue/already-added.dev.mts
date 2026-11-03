// Job Queue "Already added", against DEV only (refuses any other project).
//
//   NODE_OPTIONS=--use-system-ca npx tsx tests/jobqueue/already-added.dev.mts
//
// A coach marks a job a Fit because it is already in the client's tracker: the
// match becomes push with already_added, nothing is added to the tracker, the
// queue shows it as a Fit marked already added, and Undo puts it back. Needs
// 20261126_job_queue_already_added.sql on dev. Leaves the match as it found it.
import { readFileSync } from "fs"
for (const l of readFileSync(".env.phase0", "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2") }
if (!process.env.SUPABASE_URL?.includes("zydrqckpwidipwbhrfgd")) throw new Error("already-added runs against dev only")
const idm: any = await import("../../lib/collab/identity.ts"); const { getSupabaseAdmin } = idm.default ?? idm
const jqm: any = await import("../../lib/match/jobQueue.ts"); const jq = jqm.default ?? jqm
const sb = getSupabaseAdmin()
const COACH = "cadc73c9-84f2-4406-914b-000ef5cc9c09"

let failed = 0
const ok = (label: string, cond: boolean, detail = "") => { console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`); if (!cond) failed++ }

const q = await jq.loadJobQueue(sb, COACH, { minScore: 50 })
const job = q.jobs.find((j: any) => j.m.some((c: any) => !c.status))
const chip = job.m.find((c: any) => !c.status)
const { count: trackerBefore } = await sb.from("signal_applications").select("id", { count: "exact", head: true }).eq("profile_id", chip.c)
console.log(`Already added (dev): ${job.t} | ${job.co}, client ${chip.c.slice(0, 8)}, ${chip.ids.length} listing(s)`)
try {
  await jq.recordDecision(sb, { clientProfileId: chip.c, matchIds: chip.ids, action: "push", alreadyAdded: true, actorId: COACH })
  const { data: rows } = await sb.from("posting_matches").select("action, already_added, jobfit_score, signal_application_id").in("id", chip.ids)
  ok("every listing is a Fit marked already added", (rows ?? []).every((r: any) => r.action === "push" && r.already_added === true), JSON.stringify(rows))
  ok("no JobFit result recorded", (rows ?? []).every((r: any) => r.jobfit_score === null && r.signal_application_id === null))
  const { count: trackerAfter } = await sb.from("signal_applications").select("id", { count: "exact", head: true }).eq("profile_id", chip.c)
  ok("nothing added to the tracker", trackerAfter === trackerBefore, `${trackerBefore} -> ${trackerAfter}`)
  const q2 = await jq.loadJobQueue(sb, COACH, { minScore: 50, decidedSince: new Date(Date.now() - 60e3).toISOString() })
  const c2 = q2.jobs.flatMap((j: any) => j.m).find((c: any) => c.ids.some((id: string) => chip.ids.includes(id)))
  ok("the queue shows it as Fit, already added", c2?.status === "fit" && c2?.alreadyAdded === true, JSON.stringify(c2 && { status: c2.status, alreadyAdded: c2.alreadyAdded }))
  const q3 = await jq.loadJobQueue(sb, COACH, { minScore: 50 })
  ok("with decided jobs hidden, it leaves the queue", !q3.jobs.some((j: any) => j.m.some((c: any) => c.ids.some((id: string) => chip.ids.includes(id)))))
  // A row marked already added cannot become a Not a fit while still marked.
  const { error: refusedErr } = await sb.from("posting_matches").update({ action: "dismiss", dismiss_reason: "wrong_function" }).in("id", chip.ids.slice(0, 1))
  const refused = !!refusedErr
  ok("the database refuses already_added on anything but a Fit", refused)
} finally {
  await jq.recordDecision(sb, { clientProfileId: chip.c, matchIds: chip.ids, action: null, actorId: COACH })
  const { data: back } = await sb.from("posting_matches").select("action, already_added").in("id", chip.ids)
  ok("Undo puts it back to undecided", (back ?? []).every((r: any) => r.action === null && r.already_added === false), JSON.stringify(back))
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed")
process.exit(failed ? 1 : 0)
