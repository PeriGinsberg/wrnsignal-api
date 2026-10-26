// tests/workbooks/networking-smoke.ts
//
// NETWORKING WORKBOOKS, END TO END ON DEV: the create route, one per contact,
// the lead-coach send, and the no-coach path. Drives the real route over HTTP
// with real client JWTs, then checks the rows with the service role.
//
// DEV ONLY: refuses to run against the prod project. Needs the dev server
// running from this checkout (BASE_URL, default http://localhost:3000) and
// 20261026_networking_workbooks.sql applied to dev.
//
// Creates temporary contacts on fixture clients A and B and deletes them, their
// workbooks and the Required Actions rows at the end. Temporarily pauses B's
// coach links to prove the no-coach path, and restores them.
//
// Credentials from process.env only. Run from your terminal:
//   node --use-system-ca --env-file=.env.local node_modules/tsx/dist/cli.mjs tests/workbooks/networking-smoke.ts
// with COACH_EMAIL set to the fixture coach (scripts/seed-dev-fixture.ts).

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const PASSWORD = "dev-test-1234"
const CLIENT_A = process.env.FIXTURE_CLIENT_A || "alex+test@example.com"
const CLIENT_B = process.env.FIXTURE_CLIENT_B || "brooke+test@example.com"
const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "")

const url = process.env.SUPABASE_URL || ""
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
const coachEmail = (process.env.COACH_EMAIL || "").trim().toLowerCase()
if (!url || !service || !anon || !coachEmail) {
  console.error("Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY and COACH_EMAIL")
  process.exit(1)
}
if (url.includes(PROD_REF)) { console.error("Refusing to run against prod."); process.exit(1) }

let failures = 0
function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok    ${label}`)
  else { failures++; console.error(`  FAIL  ${label}`, detail ?? "") }
}

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

async function signIn(email: string): Promise<{ sb: SupabaseClient; token: string }> {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: PASSWORD })
  if (error || !data.session) throw new Error(`sign in ${email}: ${error?.message}`)
  return { sb, token: data.session.access_token }
}

async function profileId(email: string): Promise<string> {
  const { data, error } = await admin.from("client_profiles").select("id").eq("email", email).maybeSingle()
  if (error || !data) throw new Error(`no profile for ${email}`)
  return data.id
}

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) as any }
}

async function main() {
  console.log(`Target: ${new URL(url).hostname.split(".")[0]}  Server: ${BASE_URL}`)
  const [aId, bId, coachId] = await Promise.all([profileId(CLIENT_A), profileId(CLIENT_B), profileId(coachEmail)])

  const stamp = Date.now()
  const { data: made, error: cErr } = await admin.from("network_contacts").insert([
    { client_profile_id: aId, first_name: "Smoke", last_name: `Alpha${stamp}`, title: "Director {of} Things" },
    { client_profile_id: bId, first_name: "Smoke", last_name: `Bravo${stamp}` },
  ]).select("id, client_profile_id")
  if (cErr || !made) throw new Error(`create contacts: ${cErr?.message}`)
  const contactA = made.find((c) => c.client_profile_id === aId)!.id as string
  const contactB = made.find((c) => c.client_profile_id === bId)!.id as string

  const { data: bLinks } = await admin.from("coach_clients")
    .select("id, status").eq("client_profile_id", bId).eq("status", "active")
  const workbookIds: string[] = []

  try {
    const [A, B, C] = await Promise.all([signIn(CLIENT_A), signIn(CLIENT_B), signIn(coachEmail)])

    console.log("create, with a coach")
    const first = await call(A.token, "POST", "/api/me/workbooks/networking", { contact_id: contactA })
    ok("creates it (201)", first.status === 201 && first.body.workbook?.id, first)
    const W = first.body.workbook?.id as string
    if (W) workbookIds.push(W)
    const again = await call(A.token, "POST", "/api/me/workbooks/networking", { contact_id: contactA })
    ok("a second press returns the same workbook", again.status === 200 && again.body.existing === true && again.body.workbook?.id === W, again)
    const theirs = await call(A.token, "POST", "/api/me/workbooks/networking", { contact_id: contactB })
    ok("someone else's contact reads as not found", theirs.status === 404, theirs)
    const none = await call(A.token, "POST", "/api/me/workbooks/networking", {})
    ok("no contact is a 400", none.status === 400, none)

    const { data: row } = await admin.from("workbooks").select("*").eq("id", W).single()
    const { data: lead } = await admin.from("coach_clients").select("id, coach_profile_id")
      .eq("client_profile_id", aId).eq("status", "active").eq("access_level", "full")
      .order("accepted_at", { ascending: true, nullsFirst: false }).limit(1).maybeSingle()
    ok("starts with the client, not as a draft", row?.status === "with_client", row?.status)
    ok("hangs off the lead coach", !!lead && row?.coach_client_id === lead.id, { row: row?.coach_client_id, lead: lead?.id })
    ok("created by the client", row?.created_by === aId)
    ok("linked to the contact", row?.network_contact_id === contactA)
    ok("is the networking kind", row?.content?.kind === "networking")
    ok("titled with the contact", row?.content?.title === `Networking Call: Smoke Alpha${stamp}`, row?.content?.title)
    ok("braces in a record value do not survive", !JSON.stringify(row?.content).includes("{of}"))

    console.log("reads")
    const forClient = (await A.sb.rpc("workbook_for_client", { p_workbook: W })).data as any
    ok("client can read it", !!forClient)
    ok("has_coach is true", forClient?.has_coach === true, forClient?.has_coach)
    ok("live coach name is returned", typeof forClient?.coach_first_name === "string" && forClient.coach_first_name.length > 0, forClient?.coach_first_name)
    const list = ((await A.sb.rpc("workbook_client_list")).data ?? []) as any[]
    ok("client list shows it as networking", list.some((r) => r.id === W && r.kind === "networking" && r.network_contact_id === contactA))
    const contacts = await call(A.token, "GET", "/api/network/contacts")
    ok("roster carries the workbook id", (contacts.body.contacts ?? []).some((c: any) => c.id === contactA && c.workbook_id === W))
    const record = await call(A.token, "GET", `/api/network/contacts/${contactA}`)
    ok("contact record carries the workbook id", record.body.contact?.workbook_id === W, record.body.contact?.workbook_id)
    ok("coach can see it", ((await C.sb.from("workbooks").select("id").eq("id", W)).data ?? []).length === 1)

    console.log("answers")
    const ans = await A.sb.from("workbook_answers").insert({
      workbook_id: W, field_key: "contact.common", value: "Both Wolverines", updated_by_role: "client", updated_by_id: aId,
    })
    ok("client can answer What you have in common", !ans.error, ans.error)

    console.log("RLS")
    const direct = await A.sb.from("workbooks").insert({
      client_profile_id: aId, slug: `smoke-direct-${stamp}`, content: row?.content, status: "with_client", created_by: aId,
    }).select("id")
    ok("client cannot insert a workbook directly", !!direct.error, direct.data)
    for (const r of direct.data ?? []) workbookIds.push((r as any).id)

    console.log("send to coach")
    const sent = await A.sb.rpc("workbook_send_to_coach", { p_workbook: W })
    ok("client sends it", !sent.error, sent.error)
    const { data: send } = await admin.from("workbook_sends").select("coach_note_id").eq("workbook_id", W).eq("direction", "to_coach").maybeSingle()
    const { data: note } = await admin.from("coach_client_notes").select("coach_profile_id, coach_client_id, link_tab").eq("id", send?.coach_note_id ?? "").maybeSingle()
    ok("the Required Action belongs to the lead coach, not the client",
      !!lead && note?.coach_profile_id === lead.coach_profile_id && note?.coach_profile_id !== aId, note)
    ok("on the Workbooks tab", note?.link_tab === "workbooks")

    console.log("no coach")
    if ((bLinks ?? []).length) {
      await admin.from("coach_clients").update({ status: "paused" }).in("id", bLinks!.map((l) => l.id))
    }
    const bMade = await call(B.token, "POST", "/api/me/workbooks/networking", { contact_id: contactB })
    ok("a client with no coach can create one", bMade.status === 201, bMade)
    const WB = bMade.body.workbook?.id as string
    if (WB) workbookIds.push(WB)
    const { data: bRow } = await admin.from("workbooks").select("coach_client_id, content").eq("id", WB).single()
    ok("hangs off no relationship", bRow?.coach_client_id === null)
    ok("coach name falls back", bRow?.content?.coach?.first_name === "Your coach", bRow?.content?.coach)
    const bRead = (await B.sb.rpc("workbook_for_client", { p_workbook: WB })).data as any
    ok("has_coach is false", bRead?.has_coach === false, bRead?.has_coach)
    const bSend = await B.sb.rpc("workbook_send_to_coach", { p_workbook: WB })
    ok("send is refused", !!bSend.error && bSend.error.code === "22023", bSend.error)
    const { data: bAfter } = await admin.from("workbooks").select("status").eq("id", WB).single()
    ok("and changes nothing", bAfter?.status === "with_client", bAfter?.status)

    if ((bLinks ?? []).length) {
      console.log("coach arrives later")
      await admin.from("coach_clients").update({ status: "active" }).in("id", bLinks!.map((l) => l.id))
      const bRead2 = (await B.sb.rpc("workbook_for_client", { p_workbook: WB })).data as any
      ok("has_coach turns true", bRead2?.has_coach === true)
      const bSend2 = await B.sb.rpc("workbook_send_to_coach", { p_workbook: WB })
      ok("send now works", !bSend2.error, bSend2.error)
      const { data: bRow2 } = await admin.from("workbooks").select("coach_client_id, status").eq("id", WB).single()
      ok("and attaches the lead coach", !!bRow2?.coach_client_id && bRow2?.status === "with_coach", bRow2)
    } else {
      console.log("  skip  coach arrives later (fixture B has no coach link)")
    }

    console.log("contact closed out")
    await admin.from("network_contacts").delete().eq("id", contactA)
    const { data: kept } = await admin.from("workbooks").select("id, network_contact_id").eq("id", W).maybeSingle()
    ok("the workbook survives", !!kept)
    ok("and drops the link", kept?.network_contact_id === null)
  } finally {
    if ((bLinks ?? []).length) {
      await admin.from("coach_clients").update({ status: "active" }).in("id", bLinks!.map((l) => l.id))
    }
    if (workbookIds.length) {
      const { data: sends } = await admin.from("workbook_sends").select("coach_note_id").in("workbook_id", workbookIds)
      const notes = (sends ?? []).map((s: any) => s.coach_note_id).filter(Boolean)
      await admin.from("workbooks").delete().in("id", workbookIds)
      if (notes.length) await admin.from("coach_client_notes").delete().in("id", notes)
    }
    await admin.from("network_contacts").delete().in("id", [contactA, contactB])
  }

  console.log(failures ? `\n${failures} FAILED\n` : "\nall networking workbook checks passed\n")
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
