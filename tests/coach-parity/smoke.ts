// tests/coach-parity/smoke.ts
//
// Coach parity, end to end against a running server and DEV Supabase:
// a coach runs Positioning and Cover Letter for a client, links the client's
// job to a company on the client's board, and every refusal holds.
//
// Uses the dev fixture (scripts/seed-dev-fixture.ts): the coach and
// alex+test@example.com, plus casey+test@example.com as "another client".
// Password for all of them: dev-test-1234 (override with FIXTURE_PASSWORD).
//
// Creds from process.env only: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL),
// SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY. Aborts on any
// project but dev. BASE defaults to http://localhost:3100.
//
//   npx tsx tests/coach-parity/smoke.ts
//
// What it leaves behind ON PURPOSE, for the manual coach-page and Framer
// checks: alex's JobFit run and job ("Coach Parity Smoke Co"), and the coach-run
// Positioning and Cover Letter on it. Everything else it creates (board
// companies, a contact, messages) is deleted in `finally`, and the one access
// level it changes is restored there.

import { createClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
if (!url.includes(DEV_REF)) throw new Error(`Refusing to run: SUPABASE_URL is not dev (${DEV_REF})`)
process.env.SUPABASE_URL = url
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!SERVICE || !ANON) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY")

const BASE = process.env.BASE || "http://localhost:3100"
const PASSWORD = process.env.FIXTURE_PASSWORD || "dev-test-1234"
const COACH_EMAIL = process.env.COACH_EMAIL || "peri@localtest.com"
const CLIENT_EMAIL = "alex+test@example.com"
const OTHER_EMAIL = "casey+test@example.com"
const SMOKE_COMPANY = "Coach Parity Smoke Co"

const db = createClient(url, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ok    ${label}`) }
  else { failed++; console.log(`  FAIL  ${label}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ""}`) }
}
function step(title: string) { console.log(`\n${title}`) }

async function token(email: string): Promise<string> {
  const anon = createClient(url, ANON!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD })
  if (error || !data.session) throw new Error(`Sign-in failed for ${email}: ${error?.message}`)
  return data.session.access_token
}

async function call(method: string, path: string, jwt: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json: any = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function profileId(email: string): Promise<string> {
  const { data } = await db.from("client_profiles").select("id").eq("email", email).single()
  return data!.id as string
}

const JD = `Marketing Coordinator, Coach Parity Smoke Co.
We are hiring a Marketing Coordinator to support campaign execution across email, social and events.
Responsibilities: plan and schedule social media content; coordinate email campaigns in HubSpot;
track campaign metrics in Google Analytics and report weekly; support event logistics for three
regional trade shows; write and edit copy for newsletters and landing pages; manage the content calendar.
Requirements: Bachelor's degree in Marketing, Communications or related field; 0-2 years of experience
in marketing or communications, internships count; strong writing skills; comfort with Excel;
experience with Canva or Adobe Express a plus. Full time, hybrid, based in Chicago, IL.`

async function main() {
  const coachJwt = await token(COACH_EMAIL)
  const clientJwt = await token(CLIENT_EMAIL)
  const coachId = await profileId(COACH_EMAIL)
  const clientId = await profileId(CLIENT_EMAIL)
  const otherId = await profileId(OTHER_EMAIL)
  const q = `?client_profile_id=${clientId}`

  const { data: link } = await db.from("coach_clients").select("id, access_level")
    .eq("coach_profile_id", coachId).eq("client_profile_id", clientId).eq("status", "active").single()
  if (!link || link.access_level !== "full") throw new Error("Fixture coach needs an active FULL link to alex")

  const cleanup: (() => Promise<unknown>)[] = []
  try {
    // ── 0. Setup: alex runs JobFit as a client, which tracks the job ──────────
    step("0. Setup: the client runs JobFit on a job (reused if already there)")
    let { data: app } = await db.from("signal_applications").select("id, jobfit_run_id")
      .eq("profile_id", clientId).eq("company_name", SMOKE_COMPANY).not("jobfit_run_id", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (!app) {
      const jf = await call("POST", "/api/jobfit", clientJwt, { job: JD, job_title: "Marketing Coordinator", company_name: SMOKE_COMPANY })
      check("client JobFit run returns 200 with a run and a tracked job", jf.status === 200 && !!jf.json.jobfit_run_id && !!jf.json.signal_application_id, { status: jf.status, err: jf.json.error })
      app = { id: jf.json.signal_application_id, jobfit_run_id: jf.json.jobfit_run_id }
    } else {
      check("reusing alex's tracked job with a JobFit run", true)
    }
    const appId = app!.id as string
    const runId = app!.jobfit_run_id as string
    const { data: otherApp } = await db.from("signal_applications").select("id").eq("profile_id", otherId).limit(1).single()

    // ── 2. Identity ───────────────────────────────────────────────────────────
    step("2. Identity: the coach acts on the client's profile, or is refused")
    const before = new Date().toISOString()
    const pos = await call("POST", `/api/positioning${q}`, coachJwt, { application_id: appId })
    check("coach Run Positioning for the client: 200", pos.status === 200, { status: pos.status, err: pos.json.detail })
    const { data: posRow } = await db.from("positioning_runs").select("client_profile_id, jobfit_run_id, created_by_role, created_by_id")
      .eq("client_profile_id", clientId).eq("jobfit_run_id", runId).order("created_at", { ascending: false }).limit(1).maybeSingle()
    check("stored under the CLIENT's profile and this job's JobFit run", !!posRow, posRow)
    if (pos.json.reused) {
      check("(cache hit: the stored row already existed; actor checked on first run)", true)
    } else {
      check("stored with created_by_role=coach and the coach's id", posRow?.created_by_role === "coach" && posRow?.created_by_id === coachId, posRow)
    }
    const { count: coachOwn } = await db.from("positioning_runs").select("id", { count: "exact", head: true })
      .eq("client_profile_id", coachId).gte("created_at", before)
    check("nothing written under the coach's own profile", coachOwn === 0, coachOwn)

    const noApp = await call("POST", `/api/positioning${q}`, coachJwt, { job: JD })
    check("coach without application_id: 400", noApp.status === 400, noApp)

    const otherBoard = await call("POST", `/api/positioning?client_profile_id=${otherId}`, coachJwt, { application_id: appId })
    check("coach naming another linked client with this client's job: 404, no content", otherBoard.status === 404, otherBoard.status)

    const crossApp = await call("POST", `/api/positioning${q}`, coachJwt, { application_id: otherApp!.id })
    check("another client's application under this client: 404", crossApp.status === 404, crossApp.status)

    const { data: stranger } = await db.from("client_profiles").select("id").eq("is_coach", false)
      .not("id", "in", `(${(await db.from("coach_clients").select("client_profile_id").eq("coach_profile_id", coachId)).data!.map((r: any) => r.client_profile_id).join(",")})`)
      .limit(1).single()
    const unlinked = await call("POST", `/api/positioning?client_profile_id=${stranger!.id}`, coachJwt, { application_id: appId })
    check("unlinked client: 403", unlinked.status === 403, unlinked.status)

    await db.from("coach_clients").update({ access_level: "view" }).eq("id", link.id)
    cleanup.push(() => db.from("coach_clients").update({ access_level: "full" }).eq("id", link.id))
    const viewOnly = await call("POST", `/api/positioning${q}`, coachJwt, { application_id: appId })
    const viewOnlyCl = await call("POST", `/api/coverletter${q}`, coachJwt, { application_id: appId })
    await db.from("coach_clients").update({ access_level: "full" }).eq("id", link.id)
    check("view-only coach, Positioning: 403", viewOnly.status === 403, viewOnly.status)
    check("view-only coach, Cover Letter: 403", viewOnlyCl.status === 403, viewOnlyCl.status)

    const { getProfileTextById, PersonaNotOwnedError } = await import("../../app/api/_lib/authProfile")
    const { data: otherPersona } = await db.from("client_personas").select("id").eq("profile_id", otherId).limit(1).single()
    let refused: unknown = null
    try { await getProfileTextById(clientId, { personaId: otherPersona!.id, strictPersona: true }) } catch (e) { refused = e }
    check("coach + another client's persona: refused (400), never falls back", refused instanceof PersonaNotOwnedError && (refused as any).status === 400, String(refused))
    const loose = await getProfileTextById(clientId, { personaId: otherPersona!.id, strictPersona: false })
    const { data: alexDefault } = await db.from("client_personas").select("id").eq("profile_id", clientId).eq("is_default", true).maybeSingle()
    check("client's own call keeps today's fallthrough, to THEIR default persona", loose.profileId === clientId && loose.activePersonaId === (alexDefault?.id ?? null), loose.activePersonaId)

    const { data: run } = await db.from("jobfit_runs").select("result_json, persona_id").eq("id", runId).single()
    const self = await call("POST", "/api/positioning", clientJwt, {
      job: JD, jobfit_result: { ...(run!.result_json as any), jobfit_run_id: runId }, ...(run!.persona_id ? { persona_id: run!.persona_id } : {}),
    })
    check("client's own Positioning call (Framer shape, no client_profile_id): 200", self.status === 200, { status: self.status, err: self.json.detail })

    // ── 3. Cover Letter ───────────────────────────────────────────────────────
    step("3. Cover Letter: coach run, latest wins, actor stored")
    const cl = await call("POST", `/api/coverletter${q}`, coachJwt, { application_id: appId })
    check("coach Run Cover Letter: 200 with a letter", cl.status === 200 && typeof cl.json.letter === "string" && cl.json.letter.length > 100, { status: cl.status, err: cl.json.detail })
    const { data: clRow } = await db.from("coverletter_runs").select("id, created_by_role, created_by_id, result_json, updated_at")
      .eq("client_profile_id", clientId).eq("jobfit_run_id", runId).order("updated_at", { ascending: false }).limit(1).single()
    check("newest letter for this job is the coach's, under the client's profile", clRow?.created_by_role === "coach" && clRow?.created_by_id === coachId, { role: clRow?.created_by_role })
    const re = await call("POST", `/api/coverletter${q}`, coachJwt, { application_id: appId })
    check("coach Re-run: 200", re.status === 200, re.status)

    // ── 4. Positioning + what the client sees ─────────────────────────────────
    step("4. What the client sees: GET /api/runs/:id, the call Framer makes on ?run=")
    const bundle = await call("GET", `/api/runs/${runId}`, clientJwt)
    check("client bundle: 200", bundle.status === 200, bundle.status)
    check("client bundle carries the positioning", !!bundle.json.positioning?.role_angle, Object.keys(bundle.json.positioning ?? {}))
    check("client bundle carries the cover letter", typeof bundle.json.coverLetter?.letter === "string")
    check("coverLetterBy = coach (Framer shows 'Generated by your coach')", bundle.json.coverLetterBy === "coach", bundle.json.coverLetterBy)
    const { data: latestPos } = await db.from("positioning_runs").select("created_by_role")
      .eq("client_profile_id", clientId).eq("jobfit_run_id", runId).order("created_at", { ascending: false }).limit(1).single()
    check("positioningBy matches the newest positioning row", bundle.json.positioningBy === (latestPos?.created_by_role ?? null), { bundle: bundle.json.positioningBy, row: latestPos?.created_by_role })
    const coachBundle = await call("GET", `/api/runs/${runId}`, coachJwt)
    check("the bundle stays the client's own: coach gets 403", coachBundle.status === 403, coachBundle.status)

    const detail = await call("GET", `/api/coach/clients/${clientId}/applications/${appId}/detail`, coachJwt)
    check("coach panel detail: positioning + cover letter + who ran them + can_run", detail.status === 200 && !!detail.json.positioning && !!detail.json.coverLetter && detail.json.coverLetterBy === "coach" && detail.json.can_run === true,
      { status: detail.status, pb: detail.json.positioningBy, cb: detail.json.coverLetterBy, can: detail.json.can_run })

    // ── 5. Networking: application -> company (and contact, through it) ──────
    step("5. Networking: coach links the client's job to a company on the client's board")
    const coA = await call("POST", `/api/network/companies${q}`, coachJwt, { name: "Smoke Board Co A" })
    check("coach adds a company to the client's board: 201", coA.status === 201, coA)
    const coAId = coA.json.company?.id
    cleanup.push(() => db.from("network_companies").delete().eq("id", coAId))

    const linkA = await call("POST", `/api/network/companies/link-application${q}`, coachJwt, { application_id: appId, company_id: coAId })
    const { data: linkedRow } = await db.from("signal_applications").select("company_id").eq("id", appId).single()
    check("coach links the job to that company: 200 and company_id set", linkA.status === 200 && linkedRow?.company_id === coAId, { status: linkA.status, err: linkA.json.error })

    const byName = await call("POST", `/api/network/companies/link-application${q}`, coachJwt, { application_id: appId, company_name: "Smoke Board Co B" })
    const coBId = byName.json.company?.id
    if (coBId) cleanup.push(() => db.from("network_companies").delete().eq("id", coBId))
    const { data: coB } = coBId ? await db.from("network_companies").select("client_profile_id, created_by_role, created_by_id").eq("id", coBId).single() : { data: null }
    check("link by name creates the company on the CLIENT's board, attributed to the coach", byName.status === 200 && byName.json.created === true && coB?.client_profile_id === clientId && coB?.created_by_role === "coach" && coB?.created_by_id === coachId, { status: byName.status, coB })

    const { data: otherCo } = await db.from("network_companies").insert({ client_profile_id: otherId, name: "Smoke Other Client Co" }).select("id").single()
    cleanup.push(() => db.from("network_companies").delete().eq("id", otherCo!.id))
    const cross = await call("POST", `/api/network/companies/link-application${q}`, coachJwt, { application_id: appId, company_id: otherCo!.id })
    const { data: stillB } = await db.from("signal_applications").select("company_id").eq("id", appId).single()
    check("linking to ANOTHER client's company is refused and writes nothing", cross.status >= 400 && cross.status < 500 && stillB?.company_id === coBId, { status: cross.status, company_id: stillB?.company_id })

    const picker = await call("GET", `/api/applications?company_id=${coBId}&client_profile_id=${clientId}`, coachJwt)
    check("coach's job picker lists the client's job at that company", picker.status === 200 && picker.json.applications?.some((a: any) => a.id === appId), { status: picker.status, n: picker.json.applications?.length })
    const fullList = await call("GET", `/api/applications?client_profile_id=${clientId}`, coachJwt)
    check("the full tracker list is NOT opened to the coach: 400", fullList.status === 400, fullList.status)
    const pickerStranger = await call("GET", `/api/applications?company_id=${coBId}&client_profile_id=${stranger!.id}`, coachJwt)
    check("picker for an unlinked client: 403", pickerStranger.status === 403, pickerStranger.status)

    // Contact -> job goes through the contact's company (decision C).
    const contact = await call("POST", `/api/network/contacts${q}`, coachJwt, { first_name: "Smoke", last_name: "Contact", company_name: "Smoke Board Co B" })
    const contactId = contact.json.contact?.id
    if (contactId) cleanup.push(() => db.from("network_contacts").delete().eq("id", contactId))
    check("coach adds a contact at the linked company: the job is reachable through it", contact.status === 201 && contact.json.contact?.company_id === coBId, { status: contact.status, co: contact.json.contact?.company_id })

    const badMsg = await call("POST", `/api/network/contacts/${contactId}/messages${q}`, coachJwt, { body: "hi", channel: "email", application_id: otherApp!.id })
    check("a message tagged with ANOTHER client's job: 403 (was accepted before)", badMsg.status === 403, badMsg.status)
    const goodMsg = await call("POST", `/api/network/contacts/${contactId}/messages${q}`, coachJwt, { body: "hi", channel: "email", application_id: appId })
    check("a message tagged with the client's own job: 201", goodMsg.status === 201, { status: goodMsg.status, err: goodMsg.json.error })
    const patchBad = await call("PATCH", `/api/network/contacts/${contactId}/messages${q}`, coachJwt, { id: goodMsg.json.message?.id, application_id: otherApp!.id })
    check("editing a draft onto another client's job: 403", patchBad.status === 403, patchBad.status)

    const unlink = await call("POST", `/api/network/companies/link-application${q}`, coachJwt, { application_id: appId, company_id: null })
    const { data: afterUnlink } = await db.from("signal_applications").select("company_id").eq("id", appId).single()
    check("coach unlinks: 200 and company_id cleared", unlink.status === 200 && afterUnlink?.company_id === null, unlink.status)

    const selfLink = await call("POST", "/api/network/companies/link-application", clientJwt, { application_id: appId, company_id: coAId })
    check("the client's own link (Framer shape, no client_profile_id) still works", selfLink.status === 200, { status: selfLink.status, err: selfLink.json.error })
    await call("POST", "/api/network/companies/link-application", clientJwt, { application_id: appId, company_id: null })
  } finally {
    // Promise.resolve: a supabase query builder is a thenable, not a Promise.
    for (const undo of cleanup.reverse()) await Promise.resolve(undo()).catch((e) => console.log("cleanup error:", e))
    const { data: restored } = await db.from("coach_clients").select("access_level").eq("id", link.id).single()
    console.log(`\ncleanup done; coach link access_level = ${restored?.access_level}`)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
