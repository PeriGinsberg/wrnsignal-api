// scripts/create-practice-round.ts
//
// Creates a practice round for a client as a DRAFT, the same rows the coach's
// "New round" builder writes (POST /api/coach/clients/[clientId]/practice-rounds).
// The coach then reviews it and presses Send on the client's Practice tab, which
// is what emails the client. This script never sends.
//
// The questions come from a workbook's Markdown source: the numbered list under
// its "Practice Round" heading. That keeps the round and the workbook it goes
// with written in one place.
//
//   npx tsx scripts/create-practice-round.ts <client_profile_id> --from-md <workbook.md> [--title "..."] [--coach <coach_profile_id>] [--yes]
//
// Credentials come from process.env only (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// this file never reads a .env file. Without --yes it validates and prints what
// it would write, and writes nothing. It also says whether the practice tables
// exist on the target project: on 2026-09-30 they exist on dev only.

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { ANSWER_SECONDS, cleanQuestions } from "../lib/practice/model"

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

/** The numbered items under the first heading that mentions "Practice Round". */
export function practiceQuestionsFromMarkdown(md: string): string[] {
  const lines = md.split(/\r?\n/)
  const start = lines.findIndex((l) => /^#{1,6}\s.*practice round/i.test(l))
  if (start < 0) return []
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line) || /^\*{3,}\s*$|^-{3,}\s*$/.test(line)) break
    const m = /^\s*\d+[.)]\s+(.+?)\s*$/.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment")
  const ref = new URL(url).hostname.split(".")[0]
  console.log(`Target Supabase project: ${ref}`)
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const VALUE_FLAGS = new Set(["--from-md", "--title", "--coach"])
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !VALUE_FLAGS.has(all[i - 1]))
  const [clientId] = positional
  const mdPath = arg("--from-md")
  if (!clientId || !mdPath) throw new Error("Usage: create-practice-round.ts <client_profile_id> --from-md <workbook.md> [--title ...] [--coach id] [--yes]")

  const questions = practiceQuestionsFromMarkdown(readFileSync(mdPath, "utf8"))
  const cleaned = cleanQuestions(questions)
  if (!cleaned.ok) throw new Error(`Questions from ${mdPath}: ${cleaned.error}`)

  const { data: client, error: cErr } = await db.from("client_profiles").select("id, name, email").eq("id", clientId).maybeSingle()
  if (cErr) throw new Error(cErr.message)
  if (!client) throw new Error(`No client_profiles row ${clientId}`)

  // Same gate as the builder: practice is full-access only.
  const coachArg = arg("--coach")
  let q = db.from("coach_clients").select("id, coach_profile_id").eq("client_profile_id", clientId)
    .eq("status", "active").eq("access_level", "full")
  if (coachArg) q = q.eq("coach_profile_id", coachArg)
  const { data: links, error: lErr } = await q
  if (lErr) throw new Error(lErr.message)
  if (!links?.length) throw new Error("No active full-access coach for this client (practice rounds are full-access only)")
  if (links.length > 1) throw new Error(`Several full-access coaches; pass --coach with one of: ${links.map((l) => l.coach_profile_id).join(", ")}`)
  const link = links[0]

  // Does the target even have practice rounds? A HEAD select answers without
  // reading a row, and names the missing table rather than failing on insert.
  const { error: tErr } = await db.from("practice_rounds").select("id", { count: "exact", head: true }).limit(1)
  const tablesExist = !tErr
  const { data: existing } = tablesExist
    ? await db.from("practice_rounds").select("id, title, status").eq("client_profile_id", clientId).is("deleted_at", null)
    : { data: null }

  const title = arg("--title")?.trim() || "Practice round"
  console.log(`\nClient: ${client.name ?? clientId} <${client.email ?? "no email"}>`)
  console.log(`Coach relationship: ${link.id} (coach ${link.coach_profile_id})`)
  console.log(`Round: "${title}", draft, ${cleaned.questions.length} questions`)
  for (const qq of cleaned.questions) console.log(`  ${qq.position + 1}. ${qq.text}`)
  console.log(`Timing: ${ANSWER_SECONDS} seconds per answer, the fixed limit for every round. There is no think timer and no per-round setting.`)
  console.log(`Practice tables on ${ref}: ${tablesExist ? "present" : `MISSING (${tErr?.message})`}`)
  if (existing?.length) {
    console.log(`This client already has ${existing.length} round(s): ${existing.map((r) => `"${r.title}" (${r.status})`).join(", ")}`)
  }

  if (!process.argv.includes("--yes")) {
    console.log("\nDry run. Re-run with --yes to create it as a draft. Send it from the client's Practice tab.")
    return
  }
  if (!tablesExist) throw new Error(`The practice tables do not exist on ${ref}. Apply the practice migrations first.`)

  const { data: round, error } = await db.from("practice_rounds").insert({
    coach_client_id: link.id,
    client_profile_id: clientId,
    coach_profile_id: link.coach_profile_id,
    title,
  }).select("id").single()
  if (error) throw new Error(error.message)
  const { error: qErr } = await db.from("practice_questions")
    .insert(cleaned.questions.map((qq) => ({ ...qq, round_id: round.id })))
  if (qErr) {
    await db.from("practice_rounds").delete().eq("id", round.id)
    throw new Error(qErr.message)
  }
  console.log(`Created draft round ${round.id}. Review and send it from the client's Practice tab.`)
}

// Only when run, so a test can import the parser without a database.
if (process.argv[1]?.includes("create-practice-round")) {
  main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
}
