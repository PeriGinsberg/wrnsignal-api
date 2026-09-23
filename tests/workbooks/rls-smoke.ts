// tests/workbooks/rls-smoke.ts
//
// THE WORKBOOK POLICIES, PROVEN WITH REAL JWTS. The workbook routes are the only
// routes in the repo that run under RLS instead of the service role, so the
// policies are the access control and nothing else catches a hole in them.
// This signs in as the dev fixture coach and two fixture clients and drives the
// database directly, exactly as a browser holding the anon key could.
//
// DEV ONLY: refuses to run against the prod project. Creates one temporary
// workbook (Ryan's content) on fixture client A and deletes it at the end,
// together with the Required Actions row it produced. Temporarily lowers the
// coach's access level to prove view/annotate get nothing, and restores it.
//
// Credentials from process.env only. Run from your terminal:
//   node --use-system-ca --env-file=.env.local node_modules/tsx/dist/cli.mjs tests/workbooks/rls-smoke.ts
// with COACH_EMAIL set to the fixture coach (scripts/seed-dev-fixture.ts).

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const PASSWORD = "dev-test-1234"
const CLIENT_A = process.env.FIXTURE_CLIENT_A || "alex+test@example.com"
const CLIENT_B = process.env.FIXTURE_CLIENT_B || "brooke+test@example.com"

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

async function signIn(email: string): Promise<SupabaseClient> {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign in ${email}: ${error.message}`)
  return sb
}

async function profileId(email: string): Promise<string> {
  const { data, error } = await admin.from("client_profiles").select("id").eq("email", email).maybeSingle()
  if (error || !data) throw new Error(`no profile for ${email}`)
  return data.id
}

async function main() {
  console.log(`Target: ${new URL(url).hostname.split(".")[0]}`)
  const content = JSON.parse(readFileSync(join(__dirname, "../../docs/workbooks-v1/workbooks-v1/ryan-hecht_skyhawks-le-coordinator.json"), "utf8"))

  const [aId, bId, coachId] = await Promise.all([profileId(CLIENT_A), profileId(CLIENT_B), profileId(coachEmail)])
  const { data: link, error: linkErr } = await admin.from("coach_clients")
    .select("id, access_level").eq("coach_profile_id", coachId).eq("client_profile_id", aId).eq("status", "active").maybeSingle()
  if (linkErr || !link) throw new Error("fixture coach has no active link to client A (run scripts/seed-dev-fixture.ts)")
  const originalLevel = link.access_level

  const slug = `rls-smoke-${Date.now()}`
  const { data: wb, error: wbErr } = await admin.from("workbooks").insert({
    coach_client_id: link.id, client_profile_id: aId, slug, content: { ...content, slug }, status: "draft", created_by: coachId,
  }).select("id").single()
  if (wbErr) throw new Error(`create workbook: ${wbErr.message}`)
  const W = wb.id as string
  let noteId: string | null = null
  let hwNoteId: string | null = null

  try {
    const [A, B, C] = await Promise.all([signIn(CLIENT_A), signIn(CLIENT_B), signIn(coachEmail)])

    console.log("draft")
    ok("client cannot see a draft", !(await A.rpc("workbook_for_client", { p_workbook: W })).data)
    ok("client cannot answer a draft",
      !!(await A.from("workbook_answers").insert({ workbook_id: W, field_key: "hook.q1", value: "x", updated_by_role: "client", updated_by_id: aId })).error)
    ok("coach sees the draft", ((await C.from("workbooks").select("id").eq("id", W)).data ?? []).length === 1)

    console.log("first share")
    const share = await C.rpc("workbook_send_to_client", { p_workbook: W })
    ok("coach shares it", !share.error, share.error)

    console.log("content")
    const view = await A.rpc("workbook_for_client", { p_workbook: W })
    ok("client can read it now", !!view.data)
    ok("coach_only text never reaches the client", !JSON.stringify(view.data).includes("Hawks Smile Maker"))
    ok("client has no direct read of workbooks.content", ((await A.from("workbooks").select("content").eq("id", W)).data ?? []).length === 0)
    ok("client list shows it", ((await A.rpc("workbook_client_list")).data ?? []).some((r: any) => r.id === W))
    ok("other client cannot read it", !(await B.rpc("workbook_for_client", { p_workbook: W })).data)
    ok("other client does not list it", !((await B.rpc("workbook_client_list")).data ?? []).some((r: any) => r.id === W))

    console.log("answers")
    const ins = await A.from("workbook_answers")
      .insert({ workbook_id: W, field_key: "hook.final", value: "has been to Antarctica", updated_by_role: "client", updated_by_id: aId })
      .select("updated_at").single()
    ok("client writes an answer", !ins.error, ins.error)
    const stale = await A.from("workbook_answers").update({ value: "stale", updated_by_role: "client", updated_by_id: aId })
      .eq("workbook_id", W).eq("field_key", "hook.final").eq("updated_at", "2000-01-01T00:00:00+00:00").select("id")
    ok("a stale updated_at writes nothing (clash check)", (stale.data ?? []).length === 0)
    ok("client cannot write as someone else",
      !!(await A.from("workbook_answers").insert({ workbook_id: W, field_key: "hook.q2", value: "x", updated_by_role: "client", updated_by_id: coachId })).error)
    ok("other client cannot write it",
      !!(await B.from("workbook_answers").insert({ workbook_id: W, field_key: "hook.q3", value: "x", updated_by_role: "client", updated_by_id: bId })).error)
    ok("other client cannot read the answers", ((await B.from("workbook_answers").select("id").eq("workbook_id", W)).data ?? []).length === 0)
    ok("coach cannot write answers",
      !!(await C.from("workbook_answers").insert({ workbook_id: W, field_key: "hook.q4", value: "x", updated_by_role: "coach", updated_by_id: coachId })).error)
    ok("coach reads the live answer", ((await C.from("workbook_answers").select("value").eq("workbook_id", W).eq("field_key", "hook.final")).data ?? [])[0]?.value === "has been to Antarctica")
    ok("history row was written by trigger", ((await A.from("workbook_answer_history").select("id").eq("workbook_id", W)).data ?? []).length === 1)
    ok("nobody can write history directly",
      !!(await A.from("workbook_answer_history").insert({ workbook_id: W, field_key: "x", new_value: "x", changed_by_role: "client", changed_by_id: aId })).error)

    console.log("drafts stay private")
    const q = await A.from("workbook_comments").insert({ workbook_id: W, section_id: "hook", field_key: "hook.final", kind: "client_question", body: "Is this weird enough?", author_role: "client", author_id: aId }).select("id").single()
    ok("client saves a question draft", !q.error, q.error)
    ok("coach cannot see the unsent question", ((await C.from("workbook_comments").select("id").eq("workbook_id", W).eq("author_role", "client")).data ?? []).length === 0)
    ok("client cannot pre-release a question",
      !!(await A.from("workbook_comments").insert({ workbook_id: W, section_id: "hook", kind: "client_question", body: "x", author_role: "client", author_id: aId, released_at: new Date().toISOString() })).error)
    ok("client cannot write a coach comment",
      !!(await A.from("workbook_comments").insert({ workbook_id: W, section_id: "hook", kind: "coach_comment", body: "x", author_role: "coach", author_id: aId })).error)

    const cm = await C.from("workbook_comments").insert({ workbook_id: W, section_id: "hook", field_key: "hook.final", kind: "coach_comment", body: "Good start", author_role: "coach", author_id: coachId }).select("id").single()
    const sg = await C.from("workbook_comments").insert({ workbook_id: W, section_id: "hook", field_key: "hook.final", kind: "coach_suggestion", body: "", suggested_value: "has stood on Antarctica", suggestion_status: "pending", author_role: "coach", author_id: coachId }).select("id").single()
    ok("coach saves a comment and a suggestion as drafts", !cm.error && !sg.error, cm.error ?? sg.error)
    ok("client cannot see coach drafts", ((await A.from("workbook_comments").select("id").eq("workbook_id", W).eq("author_role", "coach")).data ?? []).length === 0)

    console.log("send to coach")
    const s1 = await A.rpc("workbook_send_to_coach", { p_workbook: W })
    ok("client sends", !s1.error && (s1.data as any)?.open_questions === 1, s1.error ?? s1.data)
    ok("coach now sees the question", ((await C.from("workbook_comments").select("id").eq("workbook_id", W).eq("author_role", "client")).data ?? []).length === 1)
    const { data: send } = await admin.from("workbook_sends").select("coach_note_id").eq("workbook_id", W).eq("direction", "to_coach").single()
    noteId = send?.coach_note_id ?? null
    const { data: note } = await admin.from("coach_client_notes").select("type, priority, body, link_tab, completed_at").eq("id", noteId ?? "").maybeSingle()
    ok("one Required Actions row, linking to Workbooks", note?.type === "action_item" && note?.link_tab === "workbooks" && !note?.completed_at, note)
    ok("it counts the question", /\(1 question\)$/.test(note?.body ?? ""), note?.body)
    const s2 = await A.rpc("workbook_send_to_coach", { p_workbook: W })
    const { data: notes } = await admin.from("workbook_sends").select("coach_note_id").eq("workbook_id", W).eq("direction", "to_coach")
    ok("sending again refreshes the same row", !s2.error && new Set((notes ?? []).map((n) => n.coach_note_id)).size === 1)
    ok("client cannot send it back to themselves", (await A.rpc("workbook_send_to_client", { p_workbook: W })).error?.code === "42501")
    ok("other client cannot send it", (await B.rpc("workbook_send_to_coach", { p_workbook: W })).error?.code === "42501")

    console.log("send back")
    const back = await C.rpc("workbook_send_to_client", { p_workbook: W })
    ok("coach sends back, releasing 2", !back.error && (back.data as any)?.released === 2, back.error ?? back.data)
    ok("client sees the comment and the suggestion", ((await A.from("workbook_comments").select("id").eq("workbook_id", W).eq("author_role", "coach")).data ?? []).length === 2)
    ok("Required Actions row is completed", !!(await admin.from("coach_client_notes").select("completed_at").eq("id", noteId ?? "").single()).data?.completed_at)
    ok("a released comment cannot be edited",
      ((await C.from("workbook_comments").update({ body: "changed" }).eq("id", cm.data!.id).select("id")).data ?? []).length === 0)

    console.log("suggestion")
    ok("other client cannot accept it", (await B.rpc("workbook_resolve_suggestion", { p_comment: sg.data!.id, p_accept: true })).error?.code === "42501")
    const acc = await A.rpc("workbook_resolve_suggestion", { p_comment: sg.data!.id, p_accept: true })
    ok("client accepts", !acc.error, acc.error)
    ok("the answer now holds the suggestion", ((await A.from("workbook_answers").select("value").eq("workbook_id", W).eq("field_key", "hook.final")).data ?? [])[0]?.value === "has stood on Antarctica")
    ok("history records it as accepted_suggestion",
      ((await A.from("workbook_answer_history").select("source").eq("workbook_id", W).order("changed_at", { ascending: false }).limit(1)).data ?? [])[0]?.source === "accepted_suggestion")
    ok("it cannot be resolved twice", (await A.rpc("workbook_resolve_suggestion", { p_comment: sg.data!.id, p_accept: false })).error?.code === "22023")

    console.log("opened")
    ok("client marks it opened", !(await A.rpc("workbook_mark_opened", { p_workbook: W })).error)
    ok("the latest send-back is stamped",
      !!((await A.rpc("workbook_client_list")).data ?? []).find((r: any) => r.id === W)?.last_to_client_opened_at)

    console.log("homework")
    ok("another client cannot mark my homework complete",
      (await B.rpc("workbook_mark_homework_complete", { p_workbook: W })).error?.code === "42501")
    const hw1 = await A.rpc("workbook_mark_homework_complete", { p_workbook: W })
    ok("client marks homework complete", !hw1.error && (hw1.data as any)?.fired === true, hw1.error ?? hw1.data)
    ok("it carries the details the webhook needs",
      !!(hw1.data as any)?.email && !!(hw1.data as any)?.first_name && !!(hw1.data as any)?.completed_at, hw1.data)
    const hw2 = await A.rpc("workbook_mark_homework_complete", { p_workbook: W })
    ok("a second press does not fire again", !hw2.error && (hw2.data as any)?.fired === false, hw2.error ?? hw2.data)
    ok("the completion time does not move",
      (hw2.data as any)?.completed_at === (hw1.data as any)?.completed_at)
    {
      const { data: notes } = await admin.from("coach_client_notes")
        .select("id, body, link_tab, type, completed_at")
        .eq("coach_client_id", link.id).ilike("body", "%marked homework complete%")
      ok("exactly one Required Actions row for the coach", (notes ?? []).length === 1, notes)
      hwNoteId = notes?.[0]?.id ?? null
      ok("it opens the Workbooks tab", notes?.[0]?.link_tab === "workbooks" && notes?.[0]?.type === "action_item")
    }
    ok("the webhook stamp is owner-only",
      (await B.rpc("workbook_record_homework_webhook", { p_workbook: W })).error?.code === "42501")
    ok("the owner can stamp the webhook", !(await A.rpc("workbook_record_homework_webhook", { p_workbook: W })).error)
    ok("the client read reports the completion",
      !!((await A.rpc("workbook_for_client", { p_workbook: W })).data as any)?.homework_completed_at)

    console.log("access levels")
    for (const level of ["annotate", "view"]) {
      await admin.from("coach_clients").update({ access_level: level }).eq("id", link.id)
      ok(`${level} coach cannot read the workbook`, ((await C.from("workbooks").select("id").eq("id", W)).data ?? []).length === 0)
      ok(`${level} coach cannot read answers`, ((await C.from("workbook_answers").select("id").eq("workbook_id", W)).data ?? []).length === 0)
      ok(`${level} coach cannot send`, (await C.rpc("workbook_send_to_client", { p_workbook: W })).error?.code === "42501")
    }
  } finally {
    await admin.from("coach_clients").update({ access_level: originalLevel }).eq("id", link.id)
    await admin.from("workbooks").delete().eq("id", W)
    for (const id of [noteId, hwNoteId]) if (id) await admin.from("coach_client_notes").delete().eq("id", id)
  }

  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
  console.log("\nall passed (temporary workbook and its action item removed)")
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
