// scripts/create-workbook.ts
//
// Creates a workbook from a content file, as a DRAFT the coach then shares from
// the Workbooks tab. There is no upload UI (spec: out of scope), so this is how
// a workbook comes into being.
//
// Two kinds of content file:
//   - a per-client file, written for one person and one interview
//   - a TEMPLATE ("template": true), the same for every client, carrying
//     {first_name}, {full_name} and {coach_first_name}. Those are filled from the
//     client and coach records here, once, and the result is frozen on the
//     workbook like any other content.
//
//   npx tsx scripts/create-workbook.ts --find "Ryan Hecht"
//   npx tsx scripts/create-workbook.ts <client_profile_id> <content.json> [--interview <signal_interview_id>] [--coach <coach_profile_id>] [--slug <slug>] [--client-first-name <name>] [--coach-first-name <name>] [--yes]
//
// The first names come from the profile records: the first word of each name.
// That is wrong whenever a profile stores something else ("Coach: Peri Ginsberg"
// gives "Coach:", and "Dupuy, Alex" gives "Dupuy,"), and the filled content is
// frozen on the workbook, so the overrides exist to fix it BEFORE writing. A dry
// run prints every line either name lands in.
//
// Credentials come from process.env only (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// this file never reads a .env file. Without --yes it validates and prints what
// it would write, and writes nothing. On this machine Node needs the system CA:
//   node --use-system-ca --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/create-workbook.ts ...

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { allFieldKeys, applyTemplate, unresolvedPlaceholders, validateContent } from "../lib/workbook/content"

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

  const VALUE_FLAGS = new Set(["--interview", "--coach", "--find", "--slug", "--client-first-name", "--coach-first-name"])
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !VALUE_FLAGS.has(all[i - 1]))
  const [clientId, file] = positional
  if (!clientId || !file) throw new Error("Usage: create-workbook.ts <client_profile_id> <content.json> [--interview id] [--coach id] [--yes]")

  const raw = JSON.parse(readFileSync(file, "utf8"))

  const { data: client, error: cErr } = await db.from("client_profiles").select("id, name").eq("id", clientId).maybeSingle()
  if (cErr) throw new Error(cErr.message)
  if (!client) throw new Error(`No client_profiles row ${clientId}`)

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

  // A template is filled in from the records before anything is validated, so the
  // checks below run against exactly what the client will see.
  let source = raw
  if (raw?.template) {
    const { data: coach } = await db.from("client_profiles").select("name").eq("id", link.coach_profile_id).maybeSingle()
    const fullName = (client.name ?? "").trim()
    const firstName = arg("--client-first-name")?.trim() || fullName.split(/\s+/)[0] || ""
    const coachFirst = arg("--coach-first-name")?.trim() || (coach?.name ?? "").trim().split(/\s+/)[0] || ""
    if (!firstName) throw new Error(`Client ${clientId} has no name to fill {first_name} from; pass --client-first-name`)
    if (!coachFirst) throw new Error(`Coach ${link.coach_profile_id} has no name to fill {coach_first_name} from; pass --coach-first-name`)
    const values = { first_name: firstName, full_name: fullName, coach_first_name: coachFirst }
    source = applyTemplate(raw, values)
    const left = unresolvedPlaceholders(source)
    if (left.length) throw new Error(`Template still has unfilled placeholders: ${left.join(", ")}`)
    console.log(`Template ${raw.template_id}: client "${firstName}" / "${fullName}", coach "${coachFirst}"`)
    if (!process.argv.includes("--yes")) {
      // Every line the client will read with a name in it, before it is frozen.
      const hits: string[] = []
      const walk = (v: unknown, path: string) => {
        if (typeof v === "string") {
          if ([firstName, coachFirst, fullName].some((n) => n && v.includes(n))) {
            hits.push(`  ${path}: ${v.length > 160 ? v.slice(0, 160) + "..." : v}`)
          }
        } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k)
      }
      walk(source, "")
      console.log(`
Every line carrying a name (${hits.length}):`)
      for (const h of hits) console.log(h)
      console.log("")
    }
  }

  const slugArg = arg("--slug")
  if (slugArg) source = { ...source, slug: slugArg }

  const parsed = validateContent(source)
  if (!parsed.ok) {
    console.error("Content file is not valid:")
    for (const e of parsed.errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  const content = parsed.content

  if (!raw?.template && client.name && !client.name.toLowerCase().includes(content.client.first_name.toLowerCase())) {
    console.warn(`WARNING: content is for "${content.client.full_name}" but the profile is "${client.name}"`)
  }

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
