#!/usr/bin/env tsx
// One-shot backfill: create one is_default=true persona per client_profiles
// row whose resume_text is non-empty AND that has no existing personas.
// Idempotent (skips profiles that already have any persona row).
//
// Run AFTER applying supabase/migrations/20260507_profile_personas_pilot.sql.
//
// Usage:
//   npx tsx scripts/backfill-personas.ts            # dry-run, prints summary
//   npx tsx scripts/backfill-personas.ts --apply    # actually inserts

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createClient } from "@supabase/supabase-js"

const envPath = join(__dirname, "..", ".env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2]
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(2)
}

const APPLY = process.argv.includes("--apply")

function firstNameFrom(name: string | null): string {
  if (!name) return "Default"
  const trimmed = name.trim()
  if (!trimmed) return "Default"
  const first = trimmed.split(/\s+/)[0]
  return first || "Default"
}

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, { auth: { persistSession: false } })

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`)
  console.log(`Loading client_profiles with non-empty resume_text…`)

  // Fetch profiles in chunks to avoid blowing past the default 1000-row limit.
  const profiles: Array<{ id: string; name: string | null; resume_text: string }> = []
  let from = 0
  const PAGE = 500
  while (true) {
    const { data, error } = await supabase
      .from("client_profiles")
      .select("id, name, resume_text")
      .not("resume_text", "is", null)
      .neq("resume_text", "")
      .range(from, from + PAGE - 1)
    if (error) {
      console.error("client_profiles fetch error:", error.message)
      process.exit(2)
    }
    if (!data || data.length === 0) break
    profiles.push(...(data as any))
    if (data.length < PAGE) break
    from += PAGE
  }
  console.log(`  ${profiles.length} candidate profiles`)

  if (profiles.length === 0) {
    console.log("Nothing to backfill.")
    return
  }

  // Pull all existing personas (id + profile_id) to filter out profiles
  // that already have at least one persona row.
  const { data: existing, error: pErr } = await supabase
    .from("client_personas")
    .select("profile_id")
  if (pErr) { console.error("client_personas fetch error:", pErr.message); process.exit(2) }
  const profileIdsWithPersona = new Set((existing ?? []).map((r: any) => r.profile_id))
  console.log(`  ${profileIdsWithPersona.size} profiles already have ≥1 persona — will skip those`)

  const toInsert = profiles.filter((p) => !profileIdsWithPersona.has(p.id))
  console.log(`  ${toInsert.length} profiles need backfill`)

  if (toInsert.length === 0) {
    console.log("Nothing to do.")
    return
  }

  // Show first few for sanity-check
  console.log("\nSample (first 5):")
  for (const p of toInsert.slice(0, 5)) {
    console.log(`  - profile ${p.id.slice(0, 8)} name=${JSON.stringify(p.name)} resume_text len=${(p.resume_text || "").length}`)
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — pass --apply to actually insert ${toInsert.length} persona rows.`)
    return
  }

  // Insert in small batches.
  const BATCH = 50
  let inserted = 0
  let failed = 0
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const slice = toInsert.slice(i, i + BATCH)
    const rows = slice.map((p) => ({
      profile_id: p.id,
      name: `${firstNameFrom(p.name)}'s Resume`,
      resume_text: p.resume_text,
      is_default: true,
      display_order: 1,
    }))
    const { error } = await supabase.from("client_personas").insert(rows)
    if (error) {
      console.error(`Batch ${i}–${i + slice.length - 1} failed: ${error.message}`)
      failed += slice.length
    } else {
      inserted += slice.length
      console.log(`  Inserted batch ${i + 1}–${i + slice.length} (${inserted}/${toInsert.length})`)
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error("Fatal:", e); process.exit(2) })
