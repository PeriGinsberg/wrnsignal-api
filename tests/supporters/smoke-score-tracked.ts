// Run (DEV ONLY):
//
//   set -a; . <(grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY|ANTHROPIC_API_KEY)=' .env.local | sed 's/\r$//'); set +a
//   NODE_OPTIONS=--use-system-ca npx tsx tests/supporters/smoke-score-tracked.ts
//
// "Score this job now": POST /api/jobfit with application_id attaches the run
// to THAT tracker row and never creates one. Calls the real route in-process
// (deterministic scoring plus the bullet renderer, so it spends a few cents of
// ANTHROPIC_API_KEY). Throwaway client and login, deleted at the end.

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

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const RUN = Date.now().toString(36)
const EMAIL = `score-smoke-${RUN}@example.com`
const OTHER = `score-smoke-other-${RUN}@example.com`
const PASSWORD = `smoke-${randomBytes(9).toString("base64url")}`

const RESUME = `Jordan Smith
B.A. Economics, State University, 2026
Experience
Financial Analyst Intern, Midtown Capital, Summer 2025
- Built Excel models forecasting quarterly revenue for 12 portfolio companies
- Prepared variance analysis and presented findings to the CFO
- Automated a weekly KPI report in SQL and Tableau, saving 6 hours a week
Research Assistant, Economics Department, 2024-2025
- Cleaned and analyzed survey data in Python (pandas) for a labor market study
Skills: Excel, financial modeling, SQL, Tableau, Python, PowerPoint`

const JD = `Financial Analyst, Globex Corporation, New York, NY
About the role
Globex is hiring an entry-level Financial Analyst to join our FP&A team.
Responsibilities
- Build and maintain financial models to forecast revenue and expenses
- Prepare monthly variance analysis and present results to finance leadership
- Develop dashboards and recurring KPI reports in Tableau and SQL
Qualifications
- Bachelor's degree in Finance, Economics, Accounting or a related field
- Strong Excel and financial modeling skills
- Experience with SQL or Tableau preferred
- 0-2 years of experience, internships count`

let failures = 0
function ok(label: string, cond: boolean, detail?: unknown) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}${detail !== undefined ? `\n        ${JSON.stringify(detail).slice(0, 400)}` : ""}`) }
  else console.log(`  ok    ${label}`)
}

const made = { users: [] as string[], profiles: [] as string[] }

async function login(email: string, profile: Record<string, unknown>) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`)
  made.users.push(data.user.id)
  const { data: p, error: pErr } = await admin
    .from("client_profiles")
    .insert({ user_id: data.user.id, email, active: true, ...profile })
    .select("id")
    .single()
  if (pErr || !p) throw new Error(`profile insert: ${pErr?.message}`)
  made.profiles.push(p.id)
  const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: s } = await anon.auth.signInWithPassword({ email, password: PASSWORD })
  if (!s.session) throw new Error("signIn failed")
  return { profileId: p.id as string, jwt: s.session.access_token }
}

async function score(jwt: string, body: Record<string, unknown>) {
  const { POST } = await import("../../app/api/jobfit/route")
  const res = await POST(new Request("http://localhost:3000/api/jobfit", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any)
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function rows(profileId: string) {
  const { data } = await admin
    .from("signal_applications")
    .select("id, company_name, job_title, jobfit_run_id, signal_score, signal_decision, job_url")
    .eq("profile_id", profileId)
  return data ?? []
}

async function main() {
  const profileText = `Name: Jordan Smith\nTarget roles: Financial Analyst\nTarget locations: New York\n\nResume:\n${RESUME}`
  const me = await login(EMAIL, { name: "Jordan Smith", profile_text: profileText, resume_text: RESUME, target_roles: "Financial Analyst", profile_complete: true })
  const other = await login(OTHER, { name: "Other Person", profile_text: "", resume_text: "" })

  // An unscored tracker row whose title will NOT match what is typed in
  // JobFit, which is exactly when the old find-or-create added a duplicate.
  const { data: row } = await admin
    .from("signal_applications")
    .insert({ profile_id: me.profileId, company_name: "Globex", job_title: "Fin Analyst (from Mom)", application_status: "saved", added_by_role: "client" })
    .select("id")
    .single()
  const { data: row2 } = await admin
    .from("signal_applications")
    .insert({ profile_id: me.profileId, company_name: "Globex Corp", job_title: "FP&A Analyst", application_status: "saved" })
    .select("id")
    .single()
  const { data: foreign } = await admin
    .from("signal_applications")
    .insert({ profile_id: other.profileId, company_name: "Initech", job_title: "Analyst", application_status: "saved" })
    .select("id")
    .single()

  console.log("\nfresh scan onto a tracked row")
  const r1 = await score(me.jwt, {
    job: JD, company_name: "Globex Corporation", job_title: "Financial Analyst",
    job_url: "https://globex.example/jobs/42", application_id: row!.id,
  })
  ok("the scan succeeds", r1.status === 200 && typeof r1.json?.score === "number", { status: r1.status, err: r1.json?.error })
  ok("...and reports the tracked row as its application", r1.json?.signal_application_id === row!.id, r1.json?.signal_application_id)
  let mine = await rows(me.profileId)
  const scored = mine.find((r) => r.id === row!.id)
  ok("no new tracker row was created", mine.length === 2, mine.map((r) => r.job_title))
  ok("the row now carries the run", !!scored?.jobfit_run_id && scored.jobfit_run_id === r1.json?.jobfit_run_id, scored)
  ok("...and the score and decision", scored?.signal_score === r1.json?.score && !!scored?.signal_decision, scored)
  ok("...and the posting link it had no value for", scored?.job_url === "https://globex.example/jobs/42", scored?.job_url)
  ok("...and keeps its own title, not the one typed in JobFit", scored?.job_title === "Fin Analyst (from Mom)", scored?.job_title)

  console.log("\ncached scan onto a second tracked row")
  const r2 = await score(me.jwt, { job: JD, company_name: "Globex Corporation", job_title: "Financial Analyst", application_id: row2!.id })
  ok("the same posting is served from cache", r2.json?.reused === true, r2.json?.reused)
  ok("...and attaches to the second row", r2.json?.signal_application_id === row2!.id, r2.json?.signal_application_id)
  mine = await rows(me.profileId)
  const second = mine.find((r) => r.id === row2!.id)
  ok("still no new row", mine.length === 2, mine.length)
  ok("the second row carries the cached run and score", second?.jobfit_run_id === r1.json?.jobfit_run_id && second?.signal_score === r1.json?.score, second)

  console.log("\nsomeone else's row")
  const r3 = await score(me.jwt, { job: JD, company_name: "Globex Corporation", job_title: "Financial Analyst", application_id: foreign!.id })
  ok("an application_id that is not yours is refused", r3.status === 404, r3)
  const { data: theirs } = await admin.from("signal_applications").select("jobfit_run_id").eq("id", foreign!.id).single()
  ok("...and their row is untouched", theirs?.jobfit_run_id == null, theirs)

  console.log("\nprefill read")
  const { GET } = await import("../../app/api/applications/[id]/score-prefill/route")
  const pre = await GET(new Request("http://localhost/x", { headers: { Authorization: `Bearer ${me.jwt}` } }) as any, { params: Promise.resolve({ id: row2!.id }) })
  const pj = await pre.json()
  ok("prefill returns the row's company and title", pj?.application?.company_name === "Globex Corp" && pj?.application?.job_title === "FP&A Analyst", pj)
  const preForeign = await GET(new Request("http://localhost/x", { headers: { Authorization: `Bearer ${me.jwt}` } }) as any, { params: Promise.resolve({ id: foreign!.id }) })
  ok("prefill refuses someone else's row", preForeign.status === 404)
}

async function cleanup() {
  for (const pid of made.profiles) {
    const { data: apps } = await admin.from("signal_applications").select("id").eq("profile_id", pid)
    const ids = (apps ?? []).map((a) => a.id)
    if (ids.length) await admin.from("signal_applications_status_history").delete().in("application_id", ids)
    await admin.from("signal_applications").delete().eq("profile_id", pid)
    await admin.from("jobfit_runs").delete().eq("client_profile_id", pid)
    await admin.from("client_profiles").delete().eq("id", pid)
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
