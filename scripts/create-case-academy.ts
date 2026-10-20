// scripts/create-case-academy.ts
//
// Assigns a Casing Academy track to a client: a workbook and the case round it
// leads to, linked to each other. Both are created as DRAFTS. When the coach
// presses "Send to <client>" on the workbook (Workbooks tab), the workbook
// goes to the client and the case round opens with it; no second send.
//
//   npx tsx scripts/create-case-academy.ts --find "Friedman"
//   npx tsx scripts/create-case-academy.ts <client_profile_id> --workbook <content.json> --case <case_id> [--coach <coach_profile_id>] [--yes]
//
// The workbook's practice link carries __PRACTICE_ROUND_ID__, replaced here
// with the new round's id, so the link opens exactly this round.
//
// Credentials come from process.env only (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// this file never reads a .env file. Without --yes it validates everything and
// prints what it would write, and writes nothing. On this machine:
//   node --use-system-ca --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/create-case-academy.ts ...

import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { allFieldKeys, validateContent } from "../lib/workbook/content"
import { caseErrors, getCase, CASES } from "../lib/academy/cases"

const TOKEN = "__PRACTICE_ROUND_ID__"

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment")
  const ref = new URL(url).hostname.split(".")[0]
  console.log(`Target Supabase project: ${ref}`)
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const find = arg("--find")
  if (find) {
    const { data, error } = await db.from("client_profiles").select("id, name, email, is_coach").ilike("name", `%${find}%`).limit(20)
    if (error) throw new Error(error.message)
    for (const p of data ?? []) {
      const { data: links } = await db.from("coach_clients").select("coach_profile_id, status, access_level").eq("client_profile_id", p.id)
      console.log(`${p.id}  ${p.name}  <${p.email}>${p.is_coach ? "  (coach)" : ""}`)
      for (const l of links ?? []) console.log(`    coach ${l.coach_profile_id}  ${l.status}/${l.access_level}`)
    }
    if (!data?.length) console.log("No matching client_profiles")
    return
  }

  const VALUE_FLAGS = new Set(["--workbook", "--case", "--coach"])
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !VALUE_FLAGS.has(all[i - 1]))
  const [clientId] = positional
  const file = arg("--workbook")
  const caseId = arg("--case")
  if (!clientId || !file || !caseId) throw new Error("Usage: create-case-academy.ts <client_profile_id> --workbook <content.json> --case <case_id> [--coach id] [--yes]")

  const def = getCase(caseId)
  if (!def) throw new Error(`No case "${caseId}". Cases: ${Object.keys(CASES).join(", ")}`)
  const cErrs = caseErrors(def)
  if (cErrs.length) throw new Error(`Case is not valid:\n  - ${cErrs.join("\n  - ")}`)

  const { data: client, error: cErr } = await db.from("client_profiles").select("id, name").eq("id", clientId).maybeSingle()
  if (cErr) throw new Error(cErr.message)
  if (!client) throw new Error(`No client_profiles row ${clientId}`)

  const coachArg = arg("--coach")
  let q = db.from("coach_clients").select("id, coach_profile_id").eq("client_profile_id", clientId).eq("status", "active").eq("access_level", "full")
  if (coachArg) q = q.eq("coach_profile_id", coachArg)
  const { data: links, error: lErr } = await q
  if (lErr) throw new Error(lErr.message)
  if (!links?.length) throw new Error("No active full-access coach for this client")
  if (links.length > 1) throw new Error(`Several full-access coaches; pass --coach with one of: ${links.map((l) => l.coach_profile_id).join(", ")}`)
  const link = links[0]
  const { data: coach } = await db.from("client_profiles").select("name").eq("id", link.coach_profile_id).maybeSingle()

  const roundId = randomUUID()
  const rawText = readFileSync(file, "utf8")
  if (!rawText.includes(TOKEN)) throw new Error(`The workbook has no ${TOKEN} link, so it would not lead to the case`)
  const parsed = validateContent(JSON.parse(rawText.split(TOKEN).join(roundId)))
  if (!parsed.ok) throw new Error(`Workbook is not valid:\n  - ${parsed.errors.join("\n  - ")}`)
  const content = parsed.content
  if (client.name && !client.name.toLowerCase().includes(content.client.first_name.toLowerCase()) && !client.name.toLowerCase().includes(content.client.full_name.split(" ").pop()!.toLowerCase())) {
    console.warn(`WARNING: content is for "${content.client.full_name}" but the profile is "${client.name}"`)
  }

  // The case columns exist only once 20261020_case_academy.sql is applied.
  const { error: colErr } = await db.from("practice_rounds").select("kind, case_id, workbook_id").limit(1)
  const { data: existing } = await db.from("workbooks").select("id").eq("client_profile_id", clientId).eq("slug", content.slug).maybeSingle()

  console.log(`\nClient: ${client.name ?? clientId}`)
  console.log(`Coach: ${coach?.name ?? link.coach_profile_id} (${link.coach_profile_id}); content says coach "${content.coach.first_name}"`)
  console.log(`Workbook: "${content.title}" (${content.slug}), ${content.sections.length} modules, ${allFieldKeys(content).length} fields, draft`)
  console.log(`Case round ${roundId}: "${def.round_title}" (${def.id}, ${def.type}, ${def.difficulty}), draft until the workbook is sent`)
  for (const [i, qq] of def.questions.entries()) {
    console.log(`  ${i + 1}. [${qq.prep_seconds ?? 0}s think, ${qq.answer_seconds}s answer] ${qq.title}${qq.exhibit ? " (with exhibit)" : ""}`)
  }
  console.log(`Self-assessment: ${def.self_assessment.length} questions`)
  console.log(`Case columns on ${ref}: ${colErr ? `MISSING (${colErr.message}). Apply 20261020_case_academy.sql first.` : "present"}`)
  if (existing) console.log(`This client already has a workbook with slug "${content.slug}" (${existing.id}); creating would fail.`)

  if (!process.argv.includes("--yes")) {
    console.log("\nDry run. Re-run with --yes to create both as drafts. Then send the workbook from the client's Workbooks tab.")
    return
  }
  if (colErr) throw new Error("The case columns are missing on this project. Apply the migration first.")
  if (existing) throw new Error("Workbook slug already used for this client")

  const { error: rErr } = await db.from("practice_rounds").insert({
    id: roundId, coach_client_id: link.id, client_profile_id: clientId, coach_profile_id: link.coach_profile_id,
    title: def.round_title, status: "draft", kind: "case", case_id: def.id, scenario: def.scenario,
  })
  if (rErr) throw new Error(`round: ${rErr.message}`)
  const { error: qErr } = await db.from("practice_questions").insert(def.questions.map((qq, i) => ({
    round_id: roundId, position: i, text: qq.text, source: "preset", qkey: qq.qkey, title: qq.title,
    exhibit: qq.exhibit ?? null, answer_seconds: qq.answer_seconds, prep_seconds: qq.prep_seconds ?? 0,
  })))
  if (qErr) { await db.from("practice_rounds").delete().eq("id", roundId); throw new Error(`questions: ${qErr.message}`) }

  const { data: wb, error: wErr } = await db.from("workbooks").insert({
    coach_client_id: link.id, client_profile_id: clientId, signal_interview_id: null,
    slug: content.slug, content, status: "draft", created_by: link.coach_profile_id,
  }).select("id").single()
  if (wErr) { await db.from("practice_rounds").delete().eq("id", roundId); throw new Error(`workbook: ${wErr.message}`) }

  const { error: uErr } = await db.from("practice_rounds").update({ workbook_id: wb.id }).eq("id", roundId)
  if (uErr) throw new Error(`linking round to workbook: ${uErr.message}`)

  console.log(`\nCreated draft workbook ${wb.id} and draft case round ${roundId}, linked.`)
  console.log("Next: open the client's Workbooks tab, check it, and press Send. The case opens for the client at the same moment.")
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
