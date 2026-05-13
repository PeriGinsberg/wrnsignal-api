// scripts/verify-positioning-runs-v2-empty.mjs
//
// Pre-D3 verification: confirm zero existing positioning_runs_v2 rows on dev.
// Read-only. Hits dev via .env.development.local.

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const env = Object.fromEntries(
  readFileSync(".env.development.local", "utf8")
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

console.log(`Dev project: ${env.SUPABASE_URL}`)

const { count, error } = await sb
  .from("positioning_runs_v2")
  .select("*", { count: "exact", head: true })

if (error) {
  console.log(`  ✗ COUNT failed: ${error.message}`)
  process.exit(1)
}

console.log(`  positioning_runs_v2 row count: ${count}`)
if (count !== 0) {
  console.log(`  ⚠ EXPECTED 0 — table was just created in Stage 1a, no rows should exist yet`)
  process.exit(1)
}
console.log(`  ✓ clean slate confirmed (0 rows)`)
