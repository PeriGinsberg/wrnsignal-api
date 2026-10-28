// Run (DEV ONLY), after 20261115_client_supporters.sql,
// 20261116_suggestion_job_description.sql and
// 20261117_supporter_extraction_usage.sql are applied on dev and
// feature_modes.supporters is set to 'free' there:
//
//   set -a; . <(grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY|ANTHROPIC_API_KEY)=' .env.local | sed 's/\r$//'); set +a
//   NODE_OPTIONS=--use-system-ca npx tsx tests/supporters/smoke-dev.ts
//
// The supporter flow end to end against the real dev database, by calling the
// route handlers in-process with real JWTs. It creates its own throwaway client
// and supporter logins (@example.com) and deletes everything it made at the end,
// pass or fail.
//
// NO EMAIL IS SENT: POSTMARK_API_KEY is cleared below, so every send fails
// gracefully and the routes report email_sent / client_emailed false.
//
// ONE AI CALL: the auto-fill paste check sends one long posting to Claude
// Haiku through parse-job-text's code (a few cents). The link checks read a
// page served from this process, so they make no AI call and touch no
// outside site.

import { createClient } from "@supabase/supabase-js"
import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

delete process.env.POSTMARK_API_KEY

const URL_ = process.env.SUPABASE_URL ?? ""
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
if (!URL_.includes("zydrqckpwidipwbhrfgd")) {
  console.error(`Refusing to run: SUPABASE_URL is not dev (${URL_ || "unset"}).`)
  process.exit(2)
}
if (!SERVICE || !ANON || !process.env.ANTHROPIC_API_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY and ANTHROPIC_API_KEY are required.")
  process.exit(2)
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const BASE = "http://localhost:3000"
const RUN = Date.now().toString(36)
const CLIENT_EMAIL = `supporter-smoke-client-${RUN}@example.com`
const MOM_EMAIL = `supporter-smoke-mom-${RUN}@example.com`
const DAD_EMAIL = `supporter-smoke-dad-${RUN}@example.com`
const THIRD_EMAIL = `supporter-smoke-third-${RUN}@example.com`
const PASSWORD = `smoke-${randomBytes(9).toString("base64url")}`
const SECRET_NOTE = `PRIVATE-NOTE-${RUN}`
const SECRET_IV_NOTE = `PRIVATE-IV-${RUN}`

let failures = 0
function ok(label: string, cond: boolean, detail?: unknown) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}${detail !== undefined ? `\n        ${JSON.stringify(detail).slice(0, 400)}` : ""}`) }
  else console.log(`  ok    ${label}`)
}

const made = { users: [] as string[], profileId: null as string | null }

// A job page with JSON-LD, and one that blocks us, both on 127.0.0.1.
const JOB_PAGE_DESC = `Posting-${RUN}. You will reconcile accounts, build monthly reporting for the controller, and support the audit. Requirements: a degree in accounting or finance and strong Excel.`
const jobPages = createServer((req, res) => {
  if (req.url === "/job") {
    const ld = {
      "@context": "https://schema.org", "@type": "JobPosting", title: "Staff Accountant",
      hiringOrganization: { name: "Umbrella Corp" }, description: JOB_PAGE_DESC,
      jobLocation: { address: { addressLocality: "Raccoon City", addressRegion: "MO", addressCountry: "US" } },
    }
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(`<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>Staff Accountant</h1></body></html>`)
  } else {
    res.writeHead(403, { "Content-Type": "text/html" })
    res.end("<html><body>Access denied</body></html>")
  }
})

async function login(email: string): Promise<{ userId: string; jwt: string }> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`)
  made.users.push(data.user.id)
  const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD })
  if (sErr || !s.session) throw new Error(`signIn ${email}: ${sErr?.message}`)
  return { userId: data.user.id, jwt: s.session.access_token }
}

type Handler = (req: any, ctx?: any) => Promise<Response>
async function call(handler: Handler, opts: { path: string; jwt?: string; method?: string; body?: unknown; params?: Record<string, string> }) {
  const headers: Record<string, string> = {}
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`
  if (opts.body !== undefined) headers["Content-Type"] = "application/json"
  const req = new Request(`${BASE}${opts.path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) })
  const json = await res.json().catch(() => null)
  return { status: res.status, json, text: JSON.stringify(json) }
}

async function main() {
  const { data: mode } = await admin.from("feature_modes").select("mode").eq("feature", "supporters").maybeSingle()
  if (mode?.mode !== "free") {
    console.error(`feature_modes.supporters is '${mode?.mode ?? "missing"}' on dev; set it to 'free' first.`)
    process.exit(2)
  }

  const meSupporters = await import("../../app/api/me/supporters/route")
  const meSupporter = await import("../../app/api/me/supporters/[id]/route")
  const meSuggestions = await import("../../app/api/me/suggestions/route")
  const meSuggestion = await import("../../app/api/me/suggestions/[id]/route")
  const invite = await import("../../app/api/supporter/invite/route")
  const accept = await import("../../app/api/supporter/accept/route")
  const supMe = await import("../../app/api/supporter/me/route")
  const supTracker = await import("../../app/api/supporter/clients/[clientId]/tracker/route")
  const supApp = await import("../../app/api/supporter/clients/[clientId]/applications/[applicationId]/route")
  const supProfile = await import("../../app/api/supporter/clients/[clientId]/profile/route")
  const supSuggest = await import("../../app/api/supporter/clients/[clientId]/suggestions/route")
  const supSuggestion = await import("../../app/api/supporter/clients/[clientId]/suggestions/[id]/route")
  const supExtract = await import("../../app/api/supporter/clients/[clientId]/extract-job/route")
  const parseUrlRoute = await import("../../app/api/parse-job-url/route")
  const profileRoute = await import("../../app/api/profile/route")
  const applications = await import("../../app/api/applications/route")

  console.log("\nsetup")
  const client = await login(CLIENT_EMAIL)
  const { data: prof, error: pErr } = await admin
    .from("client_profiles")
    .insert({ user_id: client.userId, email: CLIENT_EMAIL, name: "Smoke Client", profile_text: "", resume_text: "RESUME-BODY", active: true })
    .select("id")
    .single()
  if (pErr || !prof) throw new Error(`profile insert: ${pErr?.message}`)
  made.profileId = prof.id
  const CLIENT = prof.id as string
  const { data: app } = await admin
    .from("signal_applications")
    .insert({ profile_id: CLIENT, company_name: "Acme", job_title: "Analyst", notes: SECRET_NOTE, application_status: "applied" })
    .select("id")
    .single()
  await admin.from("signal_interviews").insert({
    application_id: app!.id, profile_id: CLIENT, company_name: "Acme", job_title: "Analyst",
    interview_stage: "phone", interview_date: "2026-11-20", notes: SECRET_IV_NOTE,
  })
  ok("throwaway client created", !!CLIENT)

  console.log("\ninvite")
  const list0 = await call(meSupporters.GET, { path: "/api/me/supporters", jwt: client.jwt })
  ok("client sees supporters available", list0.json?.available === true, list0.json)
  const self = await call(meSupporters.POST, { path: "/api/me/supporters", jwt: client.jwt, method: "POST", body: { email: CLIENT_EMAIL, display_name: "Me" } })
  ok("inviting your own email is refused", self.status === 400, self.json)
  const mom = await call(meSupporters.POST, { path: "/api/me/supporters", jwt: client.jwt, method: "POST", body: { email: MOM_EMAIL, display_name: "Mom" } })
  ok("first invite lands", mom.status === 201 && mom.json?.supporter?.status === "invited", mom.json)
  ok("...and the email failed gracefully with no key", mom.json?.email_sent === false)
  ok("...and the token hash is never returned", !mom.text.includes("invite_token_hash"))
  const dup = await call(meSupporters.POST, { path: "/api/me/supporters", jwt: client.jwt, method: "POST", body: { email: MOM_EMAIL, display_name: "Mom again" } })
  ok("inviting the same person twice is refused", dup.status === 409, dup.json)
  const dad = await call(meSupporters.POST, { path: "/api/me/supporters", jwt: client.jwt, method: "POST", body: { email: DAD_EMAIL, display_name: "Dad" } })
  ok("second invite lands", dad.status === 201, dad.json)
  const third = await call(meSupporters.POST, { path: "/api/me/supporters", jwt: client.jwt, method: "POST", body: { email: THIRD_EMAIL, display_name: "Third" } })
  ok("a third live supporter is refused", third.status === 409, third.json)

  // The token is only ever emailed, so plant a known one.
  const token = randomBytes(32).toString("base64url")
  await admin
    .from("client_supporters")
    .update({ invite_token_hash: createHash("sha256").update(token).digest("hex") })
    .eq("id", mom.json.supporter.id)

  console.log("\naccept")
  const preview = await call(invite.GET, { path: `/api/supporter/invite?token=${token}` })
  ok("invite preview names the client and the invited email", preview.json?.invite?.client_first_name === "Smoke" && preview.json?.invite?.email === MOM_EMAIL, preview.json)
  const badPreview = await call(invite.GET, { path: `/api/supporter/invite?token=nope` })
  ok("a wrong token previews nothing", badPreview.status === 404)

  const momLogin = await login(MOM_EMAIL)
  const profAsMom = await call(profileRoute.GET, { path: "/api/profile", jwt: momLogin.jwt })
  ok("/api/profile refuses the supporter login", profAsMom.status === 403 && profAsMom.json?.error === "supporter_account", profAsMom.json)
  const { data: ghost } = await admin.from("client_profiles").select("id").eq("email", MOM_EMAIL)
  ok("...and did NOT create a client profile for them", (ghost ?? []).length === 0, ghost)
  const { getAuthedProfileText } = await import("../../app/api/_lib/authProfile")
  let jfErr = ""
  try { await getAuthedProfileText(new Request(`${BASE}/api/jobfit`, { headers: { Authorization: `Bearer ${momLogin.jwt}` } }) as any) } catch (e: any) { jfErr = e?.message ?? "" }
  const { data: ghost2 } = await admin.from("client_profiles").select("id").eq("email", MOM_EMAIL)
  ok("the JobFit profile lookup refuses the supporter too, creating nothing", jfErr === "Profile not found" && (ghost2 ?? []).length === 0, jfErr)

  const dadLogin = await login(DAD_EMAIL)
  const wrong = await call(accept.POST, { path: "/api/supporter/accept", jwt: dadLogin.jwt, method: "POST", body: { token } })
  ok("another login cannot accept Mom's invite", wrong.status === 403, wrong.json)
  const accepted = await call(accept.POST, { path: "/api/supporter/accept", jwt: momLogin.jwt, method: "POST", body: { token } })
  ok("Mom accepts", accepted.json?.ok === true && accepted.json?.client_profile_id === CLIENT, accepted.json)
  const { isActiveSupporterEmail: activeNow } = await import("../../lib/supporters")
  ok("an accepted supporter counts as an active supporter email (blocks client account creation)", await activeNow(admin, MOM_EMAIL))
  const again = await call(accept.POST, { path: "/api/supporter/accept", jwt: momLogin.jwt, method: "POST", body: { token } })
  ok("accepting again is idempotent", again.json?.ok === true, again.json)

  console.log("\nwhat a supporter sees")
  const me = await call(supMe.GET, { path: "/api/supporter/me", jwt: momLogin.jwt })
  ok("supporter/me lists the client", me.json?.supporting?.[0]?.client_profile_id === CLIENT, me.json)
  const tr = await call(supTracker.GET, { path: `/api/supporter/clients/${CLIENT}/tracker`, jwt: momLogin.jwt, params: { clientId: CLIENT } })
  ok("tracker loads", tr.status === 200 && tr.json?.applications?.length === 1, tr.json)
  ok("...without the client's notes", !tr.text.includes(SECRET_NOTE))
  ok("...without interview notes", !tr.text.includes(SECRET_IV_NOTE))
  ok("...with interview stage and date", tr.json?.applications?.[0]?.interviews?.[0]?.interview_stage === "phone")
  const detail = await call(supApp.GET, { path: "", jwt: momLogin.jwt, params: { clientId: CLIENT, applicationId: app!.id } })
  ok("job detail loads without notes", detail.status === 200 && !detail.text.includes(SECRET_NOTE), detail.json)
  const p = await call(supProfile.GET, { path: "", jwt: momLogin.jwt, params: { clientId: CLIENT } })
  ok("profile shows the resume", p.json?.profile?.resume_text === "RESUME-BODY", p.json)
  ok("...and not the client's email", !p.text.includes(CLIENT_EMAIL))
  const asClientRoute = await call(applications.GET, { path: "/api/applications", jwt: momLogin.jwt })
  ok("the client's own tracker route refuses the supporter", asClientRoute.status >= 400, asClientRoute.json)
  const dadTracker = await call(supTracker.GET, { path: "", jwt: dadLogin.jwt, params: { clientId: CLIENT } })
  ok("Dad, invited but not accepted, sees nothing", dadTracker.status === 403, dadTracker.json)

  console.log("\nsuggestions")
  const s1 = await call(supSuggest.POST, { path: "", jwt: momLogin.jwt, method: "POST", params: { clientId: CLIENT }, body: { company_name: "Globex", job_title: "Associate", job_url: "https://globex.example/jobs/1", note: "Saw this", job_description: `JD-TEXT-${RUN}` } })
  ok("Mom suggests a job", s1.status === 201 && s1.json?.suggestion?.status === "pending", s1.json)
  ok("...with the job description she pasted", s1.json?.suggestion?.job_description === `JD-TEXT-${RUN}`)
  const bad = await call(supSuggest.POST, { path: "", jwt: momLogin.jwt, method: "POST", params: { clientId: CLIENT }, body: { company_name: "", job_title: "x" } })
  ok("a suggestion without a company is refused", bad.status === 400)
  const edit = await call(supSuggestion.PATCH, { path: "", jwt: momLogin.jwt, method: "PATCH", params: { clientId: CLIENT, id: s1.json.suggestion.id }, body: { job_title: "Senior Associate" } })
  ok("Mom edits her pending suggestion", edit.json?.suggestion?.job_title === "Senior Associate", edit.json)
  const pending = await call(meSuggestions.GET, { path: "/api/me/suggestions", jwt: client.jwt })
  ok("the client sees it, tagged Mom", pending.json?.suggestions?.[0]?.added_by_name === "Mom", pending.json)
  const { count: before } = await admin.from("signal_applications").select("id", { count: "exact", head: true }).eq("profile_id", CLIENT)
  ok("a pending suggestion is NOT on the tracker", before === 1)

  const acc = await call(meSuggestion.POST, { path: "", jwt: client.jwt, method: "POST", params: { id: s1.json.suggestion.id }, body: { action: "accept" } })
  ok("the client accepts it", acc.json?.application?.added_by_role === "supporter", acc.json)
  const prefill = await import("../../app/api/applications/[id]/score-prefill/route")
  const pre = await call(prefill.GET, { path: "", jwt: client.jwt, params: { id: acc.json.application.id } })
  ok("Score this job now prefill carries the pasted description", pre.json?.application?.job_description === `JD-TEXT-${RUN}`, pre.json)
  const preMom = await call(prefill.GET, { path: "", jwt: momLogin.jwt, params: { id: acc.json.application.id } })
  ok("...and refuses the supporter", preMom.status >= 400, preMom.json)
  const twice = await call(meSuggestion.POST, { path: "", jwt: client.jwt, method: "POST", params: { id: s1.json.suggestion.id }, body: { action: "accept" } })
  ok("accepting twice does not make a second row", twice.status === 409)
  const lateEdit = await call(supSuggestion.PATCH, { path: "", jwt: momLogin.jwt, method: "PATCH", params: { clientId: CLIENT, id: s1.json.suggestion.id }, body: { job_title: "x" } })
  ok("Mom cannot edit it once accepted", lateEdit.status === 409, lateEdit.json)
  const lateDel = await call(supSuggestion.DELETE, { path: "", jwt: momLogin.jwt, method: "DELETE", params: { clientId: CLIENT, id: s1.json.suggestion.id } })
  ok("Mom cannot delete it once accepted", lateDel.status === 409, lateDel.json)
  const clientApps = await call(applications.GET, { path: "/api/applications", jwt: client.jwt })
  const tagged = (clientApps.json?.applications ?? []).find((a: any) => a.company_name === "Globex")
  ok("the client's tracker carries the Added by Mom tag", tagged?.added_by_name === "Mom", tagged)

  const s2 = await call(supSuggest.POST, { path: "", jwt: momLogin.jwt, method: "POST", params: { clientId: CLIENT }, body: { company_name: "Initech", job_title: "Analyst" } })
  await call(meSuggestion.POST, { path: "", jwt: client.jwt, method: "POST", params: { id: s2.json.suggestion.id }, body: { action: "dismiss" } })
  const tr2 = await call(supTracker.GET, { path: "", jwt: momLogin.jwt, params: { clientId: CLIENT } })
  const dismissed = (tr2.json?.suggestions ?? []).find((s: any) => s.id === s2.json.suggestion.id)
  ok("a passed suggestion shows to Mom as dismissed, read-only", dismissed?.status === "dismissed" && dismissed?.editable === false, dismissed)
  const s3 = await call(supSuggest.POST, { path: "", jwt: momLogin.jwt, method: "POST", params: { clientId: CLIENT }, body: { company_name: "Hooli", job_title: "PM" } })
  const del = await call(supSuggestion.DELETE, { path: "", jwt: momLogin.jwt, method: "DELETE", params: { clientId: CLIENT, id: s3.json.suggestion.id } })
  ok("Mom deletes a pending suggestion", del.json?.ok === true, del.json)

  console.log("\nauto-fill")
  await new Promise<void>((r) => jobPages.listen(0, "127.0.0.1", () => r()))
  const PAGES = `http://127.0.0.1:${(jobPages.address() as AddressInfo).port}`
  const usedToday = async () =>
    (await admin.from("supporter_extraction_usage").select("used").eq("supporter_user_id", momLogin.userId).maybeSingle()).data?.used ?? 0
  const { count: sugBefore } = await admin.from("supporter_job_suggestions").select("id", { count: "exact", head: true }).eq("client_profile_id", CLIENT)
  const extract = (jwt: string, body: unknown) => call(supExtract.POST, { path: "", jwt, method: "POST", params: { clientId: CLIENT }, body })

  const fromLink = await extract(momLogin.jwt, { url: `${PAGES}/job` })
  ok("a job link fills company, title, location, link and description", fromLink.status === 200 &&
    fromLink.json?.job?.company_name === "Umbrella Corp" && fromLink.json?.job?.job_title === "Staff Accountant" &&
    fromLink.json?.job?.location === "Raccoon City, MO, US" && fromLink.json?.job?.job_url === `${PAGES}/job` &&
    fromLink.json?.job?.job_description === JOB_PAGE_DESC, fromLink.json)
  ok("...and counts one fill", fromLink.json?.remaining === 19 && (await usedToday()) === 1, { remaining: fromLink.json?.remaining })
  const jobfitRoute = await call(parseUrlRoute.POST, { path: "/api/parse-job-url", method: "POST", body: { url: `${PAGES}/job` } })
  ok("JobFit's parse-job-url reads the same page the same way", jobfitRoute.status === 200 &&
    jobfitRoute.json?.companyName === fromLink.json?.job?.company_name && jobfitRoute.json?.jobTitle === fromLink.json?.job?.job_title &&
    jobfitRoute.json?.location === fromLink.json?.job?.location && jobfitRoute.json?.jobDescription === fromLink.json?.job?.job_description, jobfitRoute.json)

  const blocked = await extract(momLogin.jwt, { url: `${PAGES}/blocked` })
  ok("a link the site blocks asks for the description instead", blocked.status === 422 && blocked.json?.suggestion === "paste_text", blocked.json)
  ok("...and the failed fetch still counts", (await usedToday()) === 2)

  const short = await extract(momLogin.jwt, { text: "Analyst at Acme" })
  ok("a too-short paste is refused", short.status === 400, short.json)
  ok("...without costing a fill", (await usedToday()) === 2)

  // Past parse-job-text's 8,000-character description cap, with a marker at
  // the end, so a whole description proves the raised cap on this route.
  const duties = Array.from({ length: 110 }, (_, i) =>
    `- Duty ${i + 1}: reconcile general ledger account ${1000 + i}, explain any variance over the threshold, and file the support in the close binder.`)
  const longPaste = [
    "Senior Accountant", "Globex Corporation", "Springfield, OR (Hybrid)", "",
    "About the role", "Globex is hiring a Senior Accountant to own month-end close for two business units.", "",
    "Responsibilities", ...duties, "",
    // The marker sits in a requirement, not a trailing line: the model rightly
    // drops a lone reference code as not part of the description.
    "Requirements", "- Bachelor's degree in Accounting", "- 3+ years of public or corporate accounting",
    `- Experience with the END-${RUN} close checklist`,
  ].join("\n")
  const fromText = await extract(momLogin.jwt, { text: longPaste })
  const desc = String(fromText.json?.job?.job_description ?? "")
  ok("a pasted description fills company, title and location", fromText.status === 200 &&
    /globex/i.test(fromText.json?.job?.company_name ?? "") && /senior accountant/i.test(fromText.json?.job?.job_title ?? "") &&
    /springfield/i.test(fromText.json?.job?.location ?? ""), fromText.json?.job && { ...fromText.json.job, job_description: `(${desc.length} chars)` })
  ok("...and the description comes back whole, past JobFit's 8,000-character cap", desc.length > 8000 && desc.includes(`END-${RUN}`), { length: desc.length, tail: desc.slice(-120) })

  const asClient = await extract(client.jwt, { url: `${PAGES}/job` })
  ok("the client cannot use the supporter auto-fill", asClient.status === 403, asClient.json)
  const asDad = await extract(dadLogin.jwt, { url: `${PAGES}/job` })
  ok("Dad, invited but not accepted, cannot either", asDad.status === 403, asDad.json)

  const { count: runs } = await admin.from("jobfit_runs").select("id", { count: "exact", head: true }).eq("client_profile_id", CLIENT)
  ok("auto-fill scored nothing (no JobFit run)", runs === 0, { runs })
  const { count: sugAfter } = await admin.from("supporter_job_suggestions").select("id", { count: "exact", head: true }).eq("client_profile_id", CLIENT)
  ok("...and saved nothing (no new suggestion)", sugAfter === sugBefore, { sugBefore, sugAfter })

  await admin.from("supporter_extraction_usage").update({ used: 19 }).eq("supporter_user_id", momLogin.userId)
  const last = await extract(momLogin.jwt, { url: `${PAGES}/blocked` })
  ok("the 20th fill of the day goes through", last.status === 422 && last.json?.remaining === 0, last.json)
  const over = await extract(momLogin.jwt, { url: `${PAGES}/job` })
  ok("the 21st is refused with the daily limit", over.status === 429 && over.json?.code === "DAILY_LIMIT", over.json)
  ok("...and takes nothing", (await usedToday()) === 20)

  console.log("\nrevoke")
  const rev = await call(meSupporter.DELETE, { path: "", jwt: client.jwt, method: "DELETE", params: { id: mom.json.supporter.id } })
  ok("the client removes Mom", rev.json?.supporter?.status === "revoked", rev.json)
  const after = await call(supTracker.GET, { path: "", jwt: momLogin.jwt, params: { clientId: CLIENT } })
  ok("Mom is refused on her next request", after.status === 403, after.json)
  const { isActiveSupporterEmail } = await import("../../lib/supporters")
  ok("a revoked supporter is no longer an active supporter email", !(await isActiveSupporterEmail(admin, MOM_EMAIL)))
  const tagAfter = await call(applications.GET, { path: "/api/applications", jwt: client.jwt })
  ok("the Added by Mom tag survives the revoke", (tagAfter.json?.applications ?? []).some((a: any) => a.added_by_name === "Mom"))
}

async function cleanup() {
  if (made.profileId) {
    await admin.from("supporter_job_suggestions").delete().eq("client_profile_id", made.profileId)
    await admin.from("signal_interviews").delete().eq("profile_id", made.profileId)
    const { data: apps } = await admin.from("signal_applications").select("id").eq("profile_id", made.profileId)
    const ids = (apps ?? []).map((a) => a.id)
    if (ids.length) await admin.from("signal_applications_status_history").delete().in("application_id", ids)
    await admin.from("signal_applications").delete().eq("profile_id", made.profileId)
    await admin.from("client_supporters").delete().eq("client_profile_id", made.profileId)
    await admin.from("client_profiles").delete().eq("id", made.profileId)
  }
  if (made.users.length) await admin.from("supporter_extraction_usage").delete().in("supporter_user_id", made.users)
  for (const id of made.users) await admin.auth.admin.deleteUser(id)
  console.log(`\ncleaned up: profile ${made.profileId ?? "none"}, ${made.users.length} logins`)
}

main()
  .catch((e) => { failures++; console.error("  FAIL  smoke threw:", e?.message ?? e) })
  .finally(async () => {
    jobPages.close()
    await cleanup()
    console.log(`\n${failures === 0 ? "all passed" : `${failures} failed`}`)
    process.exit(failures ? 1 : 0)
  })
