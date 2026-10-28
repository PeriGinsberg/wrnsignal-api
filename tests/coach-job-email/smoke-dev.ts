// Run (DEV ONLY), after 20261118_coach_job_emails.sql is applied on dev:
//
//   set -a; . <(grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY)=' .env.local | sed 's/\r$//'); set +a
//   NODE_OPTIONS=--use-system-ca npx tsx tests/coach-job-email/smoke-dev.ts
//
// "Your coach added a job" end to end against the real dev database: the
// coach adds jobs through POST /api/coach/recommend-job (in-process, real
// JWTs), then the batch sender runs at chosen times. It creates its own
// throwaway coaches and clients (@example.com) and deletes everything it made
// at the end, pass or fail.
//
// NO EMAIL IS SENT. The sender is handed a stand-in that records each email,
// and the one check that uses the real sendToClient runs with POSTMARK_API_KEY
// cleared, so it fails gracefully. No JobFit run either: every job carries a
// cached analysis, which recommend-job uses as is.

import { createClient } from "@supabase/supabase-js"
import { randomBytes } from "node:crypto"

delete process.env.POSTMARK_API_KEY

const URL_ = process.env.SUPABASE_URL ?? ""
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
if (!URL_.includes("zydrqckpwidipwbhrfgd")) {
  console.error(`Refusing to run: SUPABASE_URL is not dev (${URL_ || "unset"}).`)
  process.exit(2)
}
if (!SERVICE || !ANON) {
  console.error("SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.")
  process.exit(2)
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const BASE = "http://localhost:3000"
const APP = "https://app.example"
const RUN = Date.now().toString(36)
const PASSWORD = `smoke-${randomBytes(9).toString("base64url")}`

let failures = 0
function ok(label: string, cond: boolean, detail?: unknown) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}${detail !== undefined ? `\n        ${JSON.stringify(detail).slice(0, 500)}` : ""}`) }
  else console.log(`  ok    ${label}`)
}

const made = { users: [] as string[], profiles: [] as string[] }

async function person(tag: string, name: string, opts: { coach?: boolean; login?: boolean } = {}) {
  const email = `coachjob-smoke-${tag}-${RUN}@example.com`
  let userId: string | null = null
  let jwt = ""
  if (opts.login !== false) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`)
    userId = data.user.id
    made.users.push(userId)
    const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD })
    if (sErr || !s.session) throw new Error(`signIn ${email}: ${sErr?.message}`)
    jwt = s.session.access_token
  }
  const { data: p, error: pErr } = await admin
    .from("client_profiles")
    .insert({ user_id: userId, email, name, profile_text: "", resume_text: "RESUME", active: true, is_coach: opts.coach === true })
    .select("id")
    .single()
  if (pErr || !p) throw new Error(`profile ${email}: ${pErr?.message}`)
  made.profiles.push(p.id)
  return { id: p.id as string, email, jwt }
}

async function link(coachId: string, clientId: string, email: string) {
  const { data, error } = await admin
    .from("coach_clients")
    .insert({ coach_profile_id: coachId, client_profile_id: clientId, status: "active", access_level: "full", invited_email: email })
    .select("id")
    .single()
  if (error || !data) throw new Error(`coach_clients: ${error?.message}`)
  return data.id as string
}

type Sent = { to: string; subject: string; html: string; text: string; log: any }

async function main() {
  const recommend = await import("../../app/api/coach/recommend-job/route")
  const { sendDueCoachJobEmails } = await import("../../lib/email/sendCoachJobEmails")

  console.log("\nsetup")
  const erin = await person("erin", "Erin Smoke", { coach: true })
  const kai = await person("kai", "Kai Smoke", { coach: true })
  const sam = await person("sam", "Sam Client")
  const noLogin = await person("nologin", "Nola Client", { login: false })
  const samLink = await link(erin.id, sam.id, sam.email)
  await link(kai.id, sam.id, sam.email)
  await link(erin.id, noLogin.id, noLogin.email)
  const clients = [sam.id, noLogin.id]
  ok("throwaway coaches and clients created", true)

  async function add(coachJwt: string, clientId: string, title: string, company: string) {
    const r = await recommend.POST(new Request(`${BASE}/api/coach/recommend-job`, {
      method: "POST",
      headers: { Authorization: `Bearer ${coachJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        client_profile_id: clientId, job_title: title, company_name: company,
        job_description: `${title} at ${company}. Posting text for the smoke ${RUN}.`,
        cached_analysis: { decision: "Apply", score: 80 },
      }),
    }) as any)
    const j = await r.json()
    if (r.status !== 201) throw new Error(`recommend-job ${r.status}: ${JSON.stringify(j)}`)
    return j
  }
  const outbox: Sent[] = []
  const fakeSend = async (a: any) => {
    outbox.push({ to: a.to, subject: a.content.subject, html: a.content.html, text: a.content.text, log: a.log })
    return { ok: true as const, to: a.to, redirected: true, messageId: `fake-${outbox.length}` }
  }
  const at = (min: number) => new Date(Date.now() + min * 60_000)
  const run = (min: number, send: any = fakeSend) => sendDueCoachJobEmails(admin, { appUrl: APP, now: at(min), send, onlyClients: clients })
  const rows = async (appIds: string[]) =>
    (await admin.from("coach_job_emails").select("application_id, outcome, sent_at, detail").in("application_id", appIds)).data ?? []

  console.log("\nqueue")
  const j1 = await add(erin.jwt, sam.id, "Analyst", "Acme")
  ok("recommend-job still adds the job and says the email is queued", j1.application?.id && j1.client_email_queued === true, j1)
  ok("...one queue row for it", (await rows([j1.application.id])).length === 1)
  const early = await run(0)
  ok("nothing goes before 10 minutes", early.length === 0 && outbox.length === 0, early)

  console.log("\nbatching")
  const j2 = await add(erin.jwt, sam.id, "Associate", "Globex")
  const j3 = await add(erin.jwt, sam.id, "Planner", "Initech")
  const ids = [j1, j2, j3].map((j) => j.application.id)
  const due = await run(11)
  const mail = outbox[0]
  ok("three jobs from one coach in 10 minutes go as ONE email", due.length === 1 && outbox.length === 1 && due[0].jobs === 3, due)
  ok("...to the client", mail?.to === sam.email, mail?.to)
  ok("...naming the coach, the first job and the count", mail?.subject === "Erin Smoke added 3 jobs to your tracker: Analyst at Acme and 2 more", mail?.subject)
  ok("...linking each job on the tracker, oldest first", ids.every((id) => mail?.text.includes(`${APP}/dashboard/tracker/${id}`)) &&
    mail.text.indexOf("Analyst at Acme") < mail.text.indexOf("Associate at Globex") &&
    mail.text.indexOf("Associate at Globex") < mail.text.indexOf("Planner at Initech"), mail?.text)
  ok("...logged as coach_job, with the coach as actor (their blind copy)", mail?.log?.type === "coach_job" && mail?.log?.actor === erin.id && mail?.log?.coachClientId === samLink, mail?.log)
  ok("...and every row marked sent", (await rows(ids)).every((r: any) => r.outcome === "sent" && r.sent_at))
  const again = await run(30)
  ok("a later run sends nothing more", again.length === 0 && outbox.length === 1, again)

  console.log("\none job")
  const j4 = await add(erin.jwt, sam.id, "Buyer", "Hooli")
  await run(11)
  const solo = outbox[1]
  ok("a lone job gets its own email naming coach, title and company", solo?.subject === "Erin Smoke added a job to your tracker: Buyer at Hooli", solo?.subject)
  ok("...with its button on that job", !!solo?.html.includes(`href="${APP}/dashboard/tracker/${j4.application.id}"`))

  console.log("\nseparate coaches, deleted jobs, overlapping runs")
  outbox.length = 0
  await add(erin.jwt, sam.id, "Clerk", "Umbrella")
  const e6 = await add(erin.jwt, sam.id, "Gone", "Deleted Co")
  await add(kai.jwt, sam.id, "Scheduler", "Vandelay")
  await admin.from("signal_applications").delete().eq("id", e6.application.id)
  const [r1, r2] = await Promise.all([run(11), run(11)])
  const erinMail = outbox.find((m) => m.subject.startsWith("Erin Smoke"))
  const kaiMail = outbox.find((m) => m.subject.startsWith("Kai Smoke"))
  ok("two coaches adding jobs for one client send two emails, each naming its coach", outbox.length === 2 && !!erinMail && !!kaiMail, outbox.map((m) => m.subject))
  ok("...and two overlapping runs did not double them", r1.length + r2.length === 2, { r1, r2 })
  ok("a job deleted before the email is left out of it", !!erinMail && erinMail.subject.endsWith("Clerk at Umbrella") && !erinMail.text.includes("Deleted Co"), erinMail?.subject)
  ok("...and its queue row went with it", (await rows([e6.application.id])).length === 0)

  console.log("\nnot sent")
  const n1 = await add(erin.jwt, noLogin.id, "Teller", "Initrode")
  const skip = await run(11)
  ok("a client with no SIGNAL login yet is skipped, not emailed", skip.length === 1 && skip[0].outcome === "skipped" && outbox.length === 2, skip)
  ok("...and the row says why", (await rows([n1.application.id]))[0]?.detail === "The client has no SIGNAL login yet.")
  const j9 = await add(erin.jwt, sam.id, "Analyst II", "Acme")
  const { sendToClient } = await import("../../lib/email/send")
  const real = await run(11, sendToClient)
  ok("through the real sender with no Postmark key: recorded as failed, nothing thrown", real.length === 1 && real[0].outcome === "failed", real)
  ok("...and not retried", (await run(30, sendToClient)).length === 0 && (await rows([j9.application.id]))[0]?.outcome === "failed")
}

async function cleanup() {
  if (made.profiles.length) {
    const { data: apps } = await admin.from("signal_applications").select("id, jobfit_run_id").in("profile_id", made.profiles)
    const appIds = (apps ?? []).map((a) => a.id)
    const runIds = (apps ?? []).map((a) => a.jobfit_run_id).filter(Boolean)
    await admin.from("coach_job_emails").delete().in("client_profile_id", made.profiles)
    await admin.from("coach_job_recommendations").delete().in("client_profile_id", made.profiles)
    if (appIds.length) await admin.from("signal_applications_status_history").delete().in("application_id", appIds)
    await admin.from("signal_applications").delete().in("profile_id", made.profiles)
    if (runIds.length) await admin.from("jobfit_runs").delete().in("id", runIds)
    await admin.from("jobfit_runs").delete().in("client_profile_id", made.profiles)
    await admin.from("coach_clients").delete().in("coach_profile_id", made.profiles)
    await admin.from("client_profiles").delete().in("id", made.profiles)
  }
  for (const id of made.users) await admin.auth.admin.deleteUser(id)
  console.log(`\ncleaned up: ${made.profiles.length} profiles, ${made.users.length} logins`)
}

main()
  .catch((e) => { failures++; console.error("  FAIL  smoke threw:", e?.message ?? e) })
  .finally(async () => {
    await cleanup()
    console.log(`\n${failures === 0 ? "all passed" : `${failures} failed`}`)
    process.exit(failures ? 1 : 0)
  })
