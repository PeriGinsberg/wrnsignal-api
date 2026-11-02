// Job Queue practice isolation, against DEV only (refuses any other project).
//
//   NODE_OPTIONS=--use-system-ca npx tsx tests/jobqueue/practice-isolation.dev.mts
//
// The rule: coaches in a practice (a principal plus their active delegates,
// coach_delegates) see and act on every client of that practice; a coach
// outside it sees and acts on their own clients only: queue, flags, saved
// links, decisions, proposals. Dev stands in for prod's Workforce Ready Now
// practice with its dev coach (principal) and Erin (delegate).
//
// Sets up an outside coach's client X that shares one posting S with a WRN
// client W, checks every path, and removes everything it added (also on
// failure). Needs 20261122_posting_coach_flags_by_practice.sql on dev.
// Reads .env.phase0. Exit 1 on any failure.
import { readFileSync } from "fs"
for (const l of readFileSync(".env.phase0", "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2") }
if (!process.env.SUPABASE_URL?.includes("zydrqckpwidipwbhrfgd")) throw new Error("practice-isolation runs against dev only")
const idm: any = await import("../../lib/collab/identity.ts"); const { getSupabaseAdmin } = idm.default ?? idm
const jqm: any = await import("../../lib/match/jobQueue.ts"); const jq = jqm.default ?? jqm
const sb = getSupabaseAdmin()

const WRN = "cadc73c9-84f2-4406-914b-000ef5cc9c09"      // dev coach: the practice's principal
const DELEGATE = "81062c92-2dff-4cc5-a685-9155b780e9f8" // Erin: active delegate of WRN on dev
const FIXTURE_EMAIL = "practice-isolation-fixture@example.invalid"

let failed = 0
const ok = (label: string, cond: boolean, detail = "") => { console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`); if (!cond) failed++ }
const rejects = async (label: string, f: () => Promise<unknown>, status = 403) => {
  try { await f(); ok(label, false, "was allowed") } catch (e: any) { ok(label, e?.status === status, `${e?.status} ${e?.message}`) }
}
const queueRow = async (client: string, posting: string) =>
  (await sb.from("client_match_queue").select("posting_id, coach_flag, apply_url, bad_link").eq("client_profile_id", client).eq("posting_id", posting).maybeSingle()).data

// --- fixtures -------------------------------------------------------------
const { data: outsideRow } = await sb.from("client_profiles").select("id, is_coach").like("email", "peri+devcoach2@%").single()
const outside: string = outsideRow?.id
if (!outside || !outsideRow?.is_coach) throw new Error("dev outside coach (peri+devcoach2) not found")
const { data: od } = await sb.from("coach_delegates").select("id").or(`delegate_coach_profile_id.eq.${outside},principal_coach_profile_id.eq.${outside}`).eq("status", "active")
if (od?.length) throw new Error("the outside coach must not be in any delegation")

const wrnClients = (await jq.coachClients(sb, WRN)).map((c: any) => c.clientProfileId) as string[]
const { data: wq } = await sb.from("client_match_queue").select("client_profile_id, posting_id, match_id").in("client_profile_id", wrnClients).gte("score", 50).order("rank").limit(2)
if (!wq || wq.length < 2) throw new Error("need two WRN queue rows on dev")
const W: string = wq[0].client_profile_id, S: string = wq[0].posting_id
const { data: wq2 } = await sb.from("client_match_queue").select("posting_id").eq("client_profile_id", W).neq("posting_id", S).limit(1).single()
const T: string = wq2!.posting_id // only WRN has it

// X: a client with no WRN link and no criteria, linked to the outside coach for the test.
const { data: links } = await sb.from("coach_clients").select("client_profile_id, coach_profile_id").eq("status", "active").not("client_profile_id", "is", null)
const wrnSet = new Set(wrnClients)
const { data: crit } = await sb.from("client_match_criteria").select("client_profile_id")
const hasCrit = new Set((crit ?? []).map((c: any) => c.client_profile_id))
const X: string | undefined = (links ?? []).map((l: any) => l.client_profile_id).find((id: string) => !wrnSet.has(id) && !hasCrit.has(id))
if (!X) throw new Error("no spare dev client for the outside coach")

const added: { link?: string; crit?: boolean; match?: string } = {}
try {
  const { data: link, error: lErr } = await sb.from("coach_clients").insert({ coach_profile_id: outside, client_profile_id: X, status: "active", access_level: "full", invited_email: FIXTURE_EMAIL, accepted_at: new Date().toISOString() }).select("id").single()
  if (lErr) throw lErr
  added.link = link.id
  const { data: wc } = await sb.from("client_match_criteria").select("*").eq("client_profile_id", W).single()
  const { created_at: _a, updated_at: _b, ...critCopy } = wc as any
  const { error: cErr } = await sb.from("client_match_criteria").insert({ ...critCopy, client_profile_id: X, seeded_from_lane_id: null, judge_examples: null, examples_taken_at: null })
  if (cErr) throw cErr
  added.crit = true
  const { data: wm } = await sb.from("posting_matches").select("score, judge_reason, judge_evidence, criteria_hash, rule_failures, preferred_market, first_queued_at").eq("id", wq[0].match_id).single()
  const { data: xm, error: mErr } = await sb.from("posting_matches").insert({ ...wm, client_profile_id: X, posting_id: S }).select("id").single()
  if (mErr) throw mErr
  added.match = xm.id

  console.log("Job Queue practice isolation (dev)")
  // --- the queue -----------------------------------------------------------
  const oq = await jq.loadJobQueue(sb, outside)
  ok("outside coach's queue lists only their own client", oq.clients.length === 1 && oq.clients[0].id === X, JSON.stringify(oq.clients.map((c: any) => c.id)))
  ok("outside coach's queue has no WRN client's chip", oq.jobs.every((j: any) => j.m.every((c: any) => c.c === X)))
  ok("outside coach's queue has only their client's postings", oq.jobs.every((j: any) => j.postingIds.every((p: string) => p === S)))
  const pq = await jq.loadJobQueue(sb, WRN), eq = await jq.loadJobQueue(sb, DELEGATE)
  const ids = (q: any) => q.clients.map((c: any) => c.id).sort().join()
  ok("WRN delegate sees the same full client list as the principal", ids(eq) === ids(pq) && pq.clients.length > 1, `${eq.clients.length} vs ${pq.clients.length}`)
  ok("WRN queue does not show the outside client", !pq.clients.some((c: any) => c.id === X) && pq.jobs.every((j: any) => j.m.every((c: any) => c.c !== X)))

  // --- decisions, posting text, proposals (all gate on assertFullAccess / coachClients)
  await rejects("outside coach cannot decide on a WRN client", () => jq.assertFullAccess(sb, outside, W))
  ok("outside coach's proposal scope excludes WRN clients", !(await jq.coachClients(sb, outside)).some((c: any) => wrnSet.has(c.clientProfileId)))
  await rejects("recordDecision refuses a WRN match id for the outside client", () => jq.recordDecision(sb, { clientProfileId: X, matchIds: [wq[0].match_id], action: "dismiss", reason: "wrong_function", actorId: outside }), 400)
  await jq.assertFullAccess(sb, DELEGATE, W).then(() => ok("WRN delegate can decide on a WRN client", true), (e: any) => ok("WRN delegate can decide on a WRN client", false, e.message))

  // --- flags and saved links -------------------------------------------------
  await rejects("outside coach cannot flag a posting only WRN clients have", () => jq.assertPostingAccess(sb, outside, [T]))
  await jq.assertPostingAccess(sb, outside, [S])
  await jq.setPostingFlag(sb, { postingIds: [S], flag: "closed", actorId: outside })
  ok("outside coach's Closed takes the job out of their own client's queue", (await queueRow(X, S)) === null)
  const w1 = await queueRow(W, S)
  ok("outside coach's Closed leaves the WRN client's queue alone", !!w1 && !w1.coach_flag, JSON.stringify(w1))
  await jq.setPostingFlag(sb, { postingIds: [S], applyUrl: "https://example.invalid/outside-link", actorId: outside })
  const w2 = await queueRow(W, S)
  ok("outside coach's saved link is not shown to the WRN client", !!w2 && w2.apply_url !== "https://example.invalid/outside-link")
  ok("outside coach's saved link is not returned for a WRN match", (await jq.savedLinkFor(sb, S, W)) === null)
  ok("outside coach's saved link is returned for their own client", (await jq.savedLinkFor(sb, S, X)) === "https://example.invalid/outside-link")

  await jq.setPostingFlag(sb, { postingIds: [S], flag: "bad_link", actorId: DELEGATE })
  const { data: fl } = await sb.from("posting_coach_flags").select("practice_coach_id, flag").eq("posting_id", S)
  ok("a delegate's flag is stored under the WRN practice", (fl ?? []).some((r: any) => r.practice_coach_id === WRN && r.flag === "bad_link"), JSON.stringify(fl))
  const w3 = await queueRow(W, S)
  ok("a delegate's flag shows on the WRN client's queue", w3?.coach_flag === "bad_link" && w3?.bad_link === true, JSON.stringify(w3))
  ok("the outside practice's own row is untouched by the delegate", (fl ?? []).some((r: any) => r.practice_coach_id === outside && r.flag === "closed"))
} finally {
  await sb.from("posting_coach_flags").delete().eq("posting_id", S)
  if (added.match) await sb.from("posting_matches").delete().eq("id", added.match)
  if (added.crit) await sb.from("client_match_criteria").delete().eq("client_profile_id", X)
  if (added.link) await sb.from("coach_clients").delete().eq("id", added.link)
  const { count } = await sb.from("coach_clients").select("id", { count: "exact", head: true }).eq("invited_email", FIXTURE_EMAIL)
  console.log(`  cleanup: fixtures removed${count ? ` (WARNING: ${count} fixture link(s) left)` : ""}`)
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed")
process.exit(failed ? 1 : 0)
