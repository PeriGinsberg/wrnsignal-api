// scripts/migrate-candidate-targeting/verify-premed-patch.mjs
//
// Read-only verification of the PreMed flag patch. Confirms:
//   - All 4 expected profile_ids have status_premed=true
//   - primary_lane is UNCHANGED (whatever the migration chose, not forced
//     to healthcare)
//   - Show name + lane + sublane for each

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const env = Object.fromEntries(
  readFileSync(".env.production.local", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=")
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const PATCHED_IDS = [
  "381e4d41-c1b5-4846-92b2-b318af775d80",
  "91e418e9-c271-4353-9258-48c0b7f8e26f",
  "97bb24a8-da58-495b-b15d-b8c7ea214be4",
  "1843e9e5-11ad-4bee-8991-558458a35323",
]

console.log(`Prod: ${env.SUPABASE_URL}\n`)

// 1. Count of all status_premed=true rows
console.log("=== Count of status_premed=true rows ===")
const { count } = await sb
  .from("candidate_targeting")
  .select("id", { count: "exact", head: true })
  .eq("status_premed", true)
console.log(`  ${count} total rows with status_premed=true\n`)

// 2. Details for the 4 patched profiles
console.log("=== Spot-check: each patched profile ===")
for (const id of PATCHED_IDS) {
  const { data: target } = await sb
    .from("candidate_targeting")
    .select("primary_lane, primary_sublane, status_premed, source")
    .eq("profile_id", id)
    .maybeSingle()
  const { data: profile } = await sb
    .from("client_profiles")
    .select("name")
    .eq("id", id)
    .maybeSingle()
  console.log(`  ${id.slice(0, 8)}… (${profile?.name ?? "?"})`)
  console.log(`    lane:           ${target?.primary_lane ?? "?"}`)
  console.log(`    sublane:        ${target?.primary_sublane ?? "(null)"}`)
  console.log(`    status_premed:  ${target?.status_premed}`)
  console.log(`    source:         ${target?.source ?? "?"}`)
}

console.log("\nDone (read-only).")
