// Run against a LOCAL dev server and the DEV database only:
//   node --use-system-ca --env-file=.env.development.local node_modules/tsx/dist/cli.mjs tests/workbook/command-center-privacy.ts <workbook_id> [base_url]
//
// End-to-end privacy check for the Coach Command Center. Signs the workbook's
// coach and client in through admin-issued sessions (no passwords), then:
//   1. coach GET: the guide is present (the coach needs it)
//   2. coach PUT evaluation: saves; a bad rating key is refused
//   3. shares the workbook if it is still a draft
//   4. client GET /api/me/workbooks/<id>: no coach_only, no guide, no Teams
//      message text, no private working, no hints, no rubric, no evaluation
//   5. SQL wb_strip_coach_only() agrees with the TS stripCoachOnly()
// Refuses to run against anything but the dev project.

import { createClient } from "@supabase/supabase-js"
import { stripCoachOnly, type WorkbookContent } from "../../lib/workbook/content"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const [workbookId, base = "http://localhost:3013"] = process.argv.slice(2)

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) } else console.log(`  ok    ${label}`)
}

async function main() {
  const url = process.env.SUPABASE_URL!, service = process.env.SUPABASE_SERVICE_ROLE_KEY!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  if (!url?.includes(DEV_REF)) throw new Error(`Refusing: SUPABASE_URL is not the dev project (${DEV_REF})`)
  if (!workbookId) throw new Error("Pass the dev workbook id")
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error("Refusing: base must be a local dev server")
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: wb, error } = await admin.from("workbooks").select("id, status, content, client_profile_id, created_by").eq("id", workbookId).single()
  if (error) throw error
  const content = wb.content as WorkbookContent
  const { data: people } = await admin.from("client_profiles").select("id, email").in("id", [wb.client_profile_id, wb.created_by])
  const email = (id: string) => people!.find((p) => p.id === id)!.email as string

  async function session(addr: string) {
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: addr })
    if (error) throw error
    const pub = createClient(url, anon, { auth: { persistSession: false } })
    const { data: s, error: e2 } = await pub.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" })
    if (e2 || !s.session) throw e2 ?? new Error("no session")
    return s.session.access_token
  }
  const coachTok = await session(email(wb.created_by))
  const clientTok = await session(email(wb.client_profile_id))
  const call = async (tok: string, path: string, init: RequestInit = {}) => {
    const r = await fetch(base + path, { ...init, headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(init.headers ?? {}) } })
    return { status: r.status, body: await r.json().catch(() => ({})) as any }
  }

  // Every private string in the content: guide text of every coach_only block.
  const secrets = new Set<string>()
  for (const s of content.sections) for (const b of s.blocks) {
    if (b.type !== "coach_only") continue
    const walk = (v: unknown) => { if (typeof v === "string" && v.trim().length >= 6) secrets.add(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk) }
    walk(b.guide); walk(b.body)
  }
  // Text the client legitimately sees anyway (e.g. a coach note quoting a student-facing label) is not a leak.
  const clientVisible = JSON.stringify(stripCoachOnly(content))
  const mustHide = [...secrets].filter((x) => !clientVisible.includes(x))
  console.log(`${secrets.size} private strings in coach_only blocks; checking ${mustHide.length} that are not also student-facing text`)
  for (const x of secrets) if (!mustHide.includes(x)) console.log(`  (also student-facing, not a leak: "${x.slice(0, 80)}")`)

  console.log("coach")
  const cid = wb.client_profile_id
  const cg = await call(coachTok, `/api/coach/clients/${cid}/workbooks/${workbookId}`)
  ok("coach GET 200", cg.status === 200)
  ok("coach payload carries the guide", JSON.stringify(cg.body).includes("\"guide\""))
  const rubricSection = content.sections.find((s) => s.blocks.some((b) => b.type === "coach_only" && b.guide?.rubric))!
  const rubric = (rubricSection.blocks.find((b) => b.type === "coach_only" && (b as any).guide?.rubric) as any).guide.rubric
  const put = await call(coachTok, `/api/coach/clients/${cid}/workbooks/${workbookId}/evaluation`, { method: "PUT", body: JSON.stringify({
    section_id: rubricSection.id, ratings: { [rubric.items[0].key]: { rating: "independent" }, [rubric.items[4].key]: { rating: "prompted", note: "PRIVATE-EVAL-NOTE used hint 2" } }, note: "PRIVATE-EVAL-OVERALL strong close" }) })
  ok("coach saves an evaluation", put.status === 200 && put.body.evaluation?.ratings?.[rubric.items[0].key]?.rating === "independent")
  const badPut = await call(coachTok, `/api/coach/clients/${cid}/workbooks/${workbookId}/evaluation`, { method: "PUT", body: JSON.stringify({ section_id: rubricSection.id, ratings: { [rubric.items[0].key]: { rating: "excellent" } } }) })
  ok("a rating off the scale is refused (400)", badPut.status === 400)
  const cg2 = await call(coachTok, `/api/coach/clients/${cid}/workbooks/${workbookId}`)
  ok("the evaluation comes back on the coach GET", (cg2.body.evaluations ?? []).some((e: any) => e.section_id === rubricSection.id && e.note?.includes("PRIVATE-EVAL-OVERALL")))

  if (wb.status === "draft") {
    const sent = await call(coachTok, `/api/coach/clients/${cid}/workbooks/${workbookId}/send`, { method: "POST", body: "{}" })
    ok("coach shares the dev workbook", sent.status === 200)
  }

  console.log("client")
  const cl = await call(clientTok, `/api/me/workbooks/${workbookId}`)
  ok("client GET 200", cl.status === 200)
  const raw = JSON.stringify(cl.body)
  ok("no coach_only block in the client payload", !raw.includes("\"coach_only\""))
  ok("no guide in the client payload", !raw.includes("\"guide\""))
  ok("no evaluation in the client payload", !raw.includes("PRIVATE-EVAL") && !raw.includes("evaluations"))
  const leaked = mustHide.filter((x) => raw.includes(x))
  ok(`none of the ${mustHide.length} private strings appear (Teams messages, private math, hints, checklist, rubric, notes)`, leaked.length === 0)
  if (leaked.length) console.error("  leaked:", leaked.map((x) => x.slice(0, 60)))
  const prompts = content.sections.flatMap((s) => s.blocks.filter((b: any) => b.type === "text" && b.case_prompt).map((b: any) => b.body as string))
  ok(`the ${prompts.length} case prompts are in the client payload unchanged`, prompts.every((p) => raw.includes(JSON.stringify(p).slice(1, -1))))
  const norm = (v: any): any => Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v
  const got = cl.body.workbook?.content ?? cl.body.content
  if (process.env.DEBUG_DIFF) {
    console.log("  payload keys:", Object.keys(cl.body), "workbook keys:", Object.keys(cl.body.workbook ?? {}))
    const want = stripCoachOnly(content).sections
    got?.sections?.forEach((s: any, i: number) => s.blocks.forEach((b: any, j: number) => {
      const w = want[i]?.blocks[j]
      if (JSON.stringify(norm(b)) !== JSON.stringify(norm(w))) console.log(`  differs at ${s.id}[${j}]:`, JSON.stringify(b).slice(0, 160), "| want:", JSON.stringify(w).slice(0, 160))
    }))
    if (got?.sections?.length !== want.length) console.log("  section count", got?.sections?.length, want.length)
  }
  // The client API also withholds answer keys (answer, explanation, tolerance...) until a
  // question is answered. That is existing behaviour and stricter, so those fields are ignored here.
  const ANSWER_KEYS = new Set(["answer", "tolerance", "either_sign", "explanation", "correct"])
  const noKeys = (v: any): any => Array.isArray(v) ? v.map(noKeys) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !ANSWER_KEYS.has(k)).map(([k, x]) => [k, noKeys(x)])) : v
  ok("client blocks match the TS stripCoachOnly() view (key order and withheld answer keys ignored)",
    JSON.stringify(norm(noKeys(got?.sections?.map((s: any) => s.blocks)))) === JSON.stringify(norm(noKeys(stripCoachOnly(content).sections.map((s) => s.blocks)))))

  const asClient = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${clientTok}` } } })
  const direct = await asClient.from("workbook_evaluations").select("*").eq("workbook_id", workbookId)
  ok("the client reading workbook_evaluations directly gets no rows (RLS)", !direct.error && (direct.data ?? []).length === 0)
  const directWb = await asClient.from("workbooks").select("content").eq("id", workbookId)
  ok("the client reading workbooks directly gets no rows (RLS)", !directWb.error && (directWb.data ?? []).length === 0)

  console.log("SQL")
  const { data: sqlStripped, error: e3 } = await admin.rpc("wb_strip_coach_only", { p_content: content })
  ok("wb_strip_coach_only() runs", !e3)
  ok("SQL strip and TS strip agree", JSON.stringify(norm(sqlStripped)) === JSON.stringify(norm(stripCoachOnly(content))))

  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
  console.log("\nall privacy checks pass")
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
