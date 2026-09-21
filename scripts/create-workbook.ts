// scripts/create-workbook.ts
//
// Creates an interview workbook from a content file, as a DRAFT the coach then
// shares from the Workbooks tab. v1 has no upload UI (spec: out of scope), so
// this is how a workbook comes into being.
//
//   npx tsx scripts/create-workbook.ts --find "Ryan Hecht"
//   npx tsx scripts/create-workbook.ts <client_profile_id> <content.json> [--interview <signal_interview_id>] [--coach <coach_profile_id>] [--yes]
//
// Credentials come from process.env only (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// this file never reads a .env file. Without --yes it validates and prints what
// it would write, and writes nothing. On this machine Node needs the system CA:
//   node --use-system-ca --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/create-workbook.ts ...

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { allFieldKeys, validateContent } from "../lib/workbook/content"

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
    const { data, error } = await db.from("client_profiles")
      .select("id, name, email, is_coach").ilike("name", `%${find}%`).limit(20)
    if (error) throw new Error(error.message)
    for (const p of data ?? []) {
      const { data: links } = await db.from("coach_clients")
        .select("coach_profile_id, status, access_level").eq("client_profile_id", p.id)
      console.log(`${p.id}  ${p.name}  <${p.email}>${p.is_coach ? "  (coach)" : ""}`)
      for (const l of links ?? []) console.log(`    coach ${l.coach_profile_id}  ${l.status}/${l.access_level}`)
    }
    if (!data?.length) console.log("No matching client_profiles")
    return
  }

  const VALUE_FLAGS = new Set(["--interview", "--coach", "--find"])
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !VALUE_FLAGS.has(all[i - 1]))
  const [clientId, file] = positional
  if (!clientId || !file) throw new Error("Usage: create-workbook.ts <client_profile_id> <content.json> [--interview id] [--coach id] [--yes]")

  const parsed = validateContent(JSON.parse(readFileSync(file, "utf8")))
  if (!parsed.ok) {
    console.error("Content file is not valid:")
    for (const e of parsed.errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  const content = parsed.content

  const { data: client, error: cErr } = await db.from("client_profiles").select("id, name").eq("id", clientId).maybeSingle()
  if (cErr) throw new Error(cErr.message)
  if (!client) throw new Error(`No client_profiles row ${clientId}`)
  if (client.name && !client.name.toLowerCase().includes(content.client.first_name.toLowerCase())) {
    console.warn(`WARNING: content is for "${content.client.full_name}" but the profile is "${client.name}"`)
  }

  const coachArg = arg("--coach")
  let q = db.from("coach_clients").select("id, coach_profile_id").eq("client_profile_id", clientId)
    .eq("status", "active").eq("access_level", "full")
  if (coachArg) q = q.eq("coach_profile_id", coachArg)
  const { data: links, error: lErr } = await q
  if (lErr) throw new Error(lErr.message)
  if (!links?.length) throw new Error("No active full-access coach for this client (workbooks are full-access only)")
  if (links.length > 1) {
    throw new Error(`Several full-access coaches; pass --coach with one of: ${links.map((l) => l.coach_profile_id).join(", ")}`)
  }
  const link = links[0]

  const interviewId = arg("--interview")
  if (interviewId) {
    const { data: iv, error } = await db.from("signal_interviews").select("id").eq("id", interviewId).eq("profile_id", clientId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!iv) throw new Error(`Interview ${interviewId} does not belong to this client`)
  }

  const row = {
    coach_client_id: link.id,
    client_profile_id: clientId,
    signal_interview_id: interviewId,
    slug: content.slug,
    content,
    status: "draft",
    created_by: link.coach_profile_id,
  }
  console.log(`Workbook "${content.slug}" for ${client.name ?? clientId}: ${content.sections.length} sections, ${allFieldKeys(content).length} fields, coach ${link.coach_profile_id}${interviewId ? `, interview ${interviewId}` : ""}`)

  if (!process.argv.includes("--yes")) {
    console.log("Dry run. Re-run with --yes to create it as a draft.")
    return
  }
  const { data, error } = await db.from("workbooks").insert(row).select("id").single()
  if (error) throw new Error(error.code === "23505" ? `This client already has a workbook with slug "${content.slug}"` : error.message)
  console.log(`Created draft workbook ${data.id}. Share it from the client's Workbooks tab.`)
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
