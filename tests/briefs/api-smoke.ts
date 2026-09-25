// tests/briefs/api-smoke.ts
//
// The Campaign Brief over HTTP, against a running dev server.
//
// WHY THIS EXISTS SEPARATELY FROM chain-smoke.ts. That one drives the engine
// through the service layer and proves the chain walks. It never touches a
// route, so it cannot catch a wrong parameter name, a scope check that refuses
// the coach it should allow, or a submit that saves and never emits. Those are
// exactly the failures a manual test finds one click in.
//
//   npm run dev                       # in another terminal
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//     npx tsx tests/briefs/api-smoke.ts <coach-email> <client_profile_id> [base-url]
//
// The coach session is minted with the admin API and a magic-link token,
// because there is no password this script is allowed to know. POINT IT AT DEV:
// it creates a campaign, submits it, walks the chain and deletes what it made.

import { createClient } from "@supabase/supabase-js"

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !serviceKey || !anonKey) {
  throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY")
}

const COACH_EMAIL = process.argv[2]
const CLIENT_ID = process.argv[3]
const BASE = process.argv[4] ?? "http://localhost:3000"
if (!COACH_EMAIL || !CLIENT_ID) throw new Error("Pass <coach-email> <client_profile_id>")

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

let failures = 0
const ck = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? "   " + detail : ""}`)
  if (!ok) failures++
}

/** A real coach session, without knowing a password. */
async function coachToken(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  if (error || !data?.properties?.hashed_token) {
    throw new Error(`could not mint a session for ${email}: ${error?.message ?? "no token"}`)
  }
  const anon = createClient(url!, anonKey!, { auth: { persistSession: false } })
  const { data: session, error: vErr } = await anon.auth.verifyOtp({
    type: "magiclink", token_hash: data.properties.hashed_token,
  })
  if (vErr || !session?.session?.access_token) {
    throw new Error(`could not verify the session: ${vErr?.message ?? "no session"}`)
  }
  return session.session.access_token
}

async function main() {
  console.log(`project: ${new URL(url!).hostname.split(".")[0]}`)
  console.log(`server:  ${BASE}`)
  console.log(`coach:   ${COACH_EMAIL}\n`)

  const token = await coachToken(COACH_EMAIL)
  const api = async (path: string, opts: RequestInit = {}) => {
    const res = await fetch(BASE + path, {
      ...opts,
      headers: {
        ...(opts.headers ?? {}),
        Authorization: `Bearer ${token}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    })
    return { status: res.status, body: await res.json().catch(() => null) as any }
  }

  // ---- the history list
  const list = await api(`/api/coach/briefs?client_profile_id=${encodeURIComponent(CLIENT_ID)}`)
  ck("the history list answers", list.status === 200 && list.body?.ok === true,
    list.status === 200 ? "" : JSON.stringify(list.body))
  if (list.status !== 200) { console.log("\nStopping: nothing else can work."); process.exit(1) }
  const before = (list.body.briefs ?? []).length

  // ---- start one. The AI read runs here, so this is the slow call.
  const t0 = Date.now()
  const created = await api("/api/coach/briefs", {
    method: "POST",
    body: JSON.stringify({ client_profile_id: CLIENT_ID, name: "API SMOKE campaign" }),
  })
  ck("a draft is created", created.status === 201 && created.body?.ok === true,
    created.status === 201 ? `${Math.round((Date.now() - t0) / 100) / 10}s` : JSON.stringify(created.body))
  if (created.status !== 201) process.exit(1)
  const brief = created.body.brief
  ck("it starts as a draft", brief.status === "draft")
  ck("the profile prefilled something, or said it could not",
    brief.prefilled_fields.length > 0 || created.body.suggestions_error !== null ||
    created.body.suggestions.length > 0,
    `prefilled=${brief.prefilled_fields.join(",") || "none"} suggestions=${created.body.suggestions.length}`)
  // The suggestions must be OFFERED, never applied. A field the coach never
  // confirmed must still be empty on the row.
  const applied = created.body.suggestions.filter((s: any) =>
    !brief.prefilled_fields.includes(s.field) &&
    (Array.isArray(brief[s.field]) ? brief[s.field].length : brief[s.field]))
  ck("no suggestion was written into the brief", applied.length === 0,
    applied.map((s: any) => s.field).join(",") || "")

  // ---- an edit
  const edited = await api(`/api/coach/briefs/${brief.id}`, {
    method: "PATCH",
    body: JSON.stringify({ primary_industries: "Sports, sports, Media", locations: ["New York"] }),
  })
  ck("an edit saves", edited.status === 200 && edited.body?.ok === true, JSON.stringify(edited.body?.error ?? ""))
  ck("the list is de-duplicated on the way in",
    JSON.stringify(edited.body?.brief?.primary_industries) === JSON.stringify(["Sports", "Media"]),
    JSON.stringify(edited.body?.brief?.primary_industries))

  // ---- submit, which starts the chain
  const submitted = await api(`/api/coach/briefs/${brief.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "submitted", primary_roles: "Analyst" }),
  })
  ck("submitting saves", submitted.status === 200 && submitted.body?.ok === true,
    JSON.stringify(submitted.body?.error ?? ""))
  ck("and the chain started in the same request", submitted.body?.chain === "started",
    String(submitted.body?.chain))

  // ---- the task it made
  const { data: tasks } = await admin.from("coach_tasks")
    .select("id, title, status, template_id, chain_id").eq("brief_id", brief.id).is("deleted_at", null)
  ck("one task exists on the campaign", (tasks ?? []).length === 1,
    (tasks ?? []).map((t) => t.title).join(", "))

  // ---- a submitted brief is closed to editing
  const reedit = await api(`/api/coach/briefs/${brief.id}`, {
    method: "PATCH", body: JSON.stringify({ name: "changed" }),
  })
  ck("a submitted brief refuses an edit", reedit.status === 409, String(reedit.status))
  const redelete = await api(`/api/coach/briefs/${brief.id}`, { method: "DELETE" })
  ck("and refuses a delete", redelete.status === 409, String(redelete.status))

  // ---- the tasks list carries what closes each task
  const taskList = await api("/api/coach/tasks?assignee=all&status=open")
  ck("the tasks list answers", taskList.status === 200)
  ck("it reports the templates behind the rows", typeof taskList.body?.templates === "object",
    `${Object.keys(taskList.body?.templates ?? {}).length} template(s)`)

  // ---- clean up
  for (const t of tasks ?? []) await admin.from("coach_task_events").delete().eq("task_id", t.id)
  await admin.from("coach_tasks").delete().eq("brief_id", brief.id)
  await admin.from("coach_automation_events").delete().eq("event_key", "campaign_brief.submitted")
    .contains("payload", { brief_id: brief.id })
  await admin.from("networking_campaign_briefs").delete().eq("id", brief.id)

  const after = await api(`/api/coach/briefs?client_profile_id=${encodeURIComponent(CLIENT_ID)}`)
  ck("cleaned up after itself", (after.body?.briefs ?? []).length === before,
    `${(after.body?.briefs ?? []).length} vs ${before} before`)

  console.log(failures === 0 ? "\nThe brief works over HTTP." : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
