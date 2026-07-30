// Read-mostly verification of the networking profile seed path.
//   npx tsx tests/probe-network-seed.ts <email>
// Creds from process.env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
// The save check writes one field back to the value it already holds, so it
// exercises the update+select path without changing any data.

import { createClient } from "@supabase/supabase-js"
import { ALL_FIELDS } from "../lib/network-tracker/client-profile-seed"

const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(url, key, { auth: { persistSession: false } })
const EMAIL = process.argv[2] ?? "peri@workforcereadynow.com"

const PROFILE_COLS =
  "id, client_profile_id, " + ALL_FIELDS.join(", ") +
  ", touched_fields, help_dismissed, seeded_at, resume_seed_attempted_at, created_at, updated_at"

;(async () => {
  console.log("DB:", url.split("//")[1].split(".")[0])
  const { data: cp } = await db.from("client_profiles")
    .select("id, resume_text").eq("email", EMAIL).maybeSingle()
  if (!cp) { console.log("no client_profiles row for", EMAIL); return }

  console.log("\n=== 1. THE SELECT THE GET RUNS ===")
  const { data: row, error } = await db.from("network_client_profile")
    .select(PROFILE_COLS).eq("client_profile_id", cp.id).maybeSingle()
  console.log("  error:", error ? `${error.code} ${error.message}` : "(none)")
  console.log("  data :", row ? "row returned" : "NULL")
  if (!row) return

  const r = row as Record<string, unknown>
  const filled = ALL_FIELDS.filter((f) => String(r[f] ?? "").trim().length > 0)
  console.log("\n=== 2. WHAT THE PAGE RENDERS ===")
  for (const f of filled) console.log(`  ${f.padEnd(20)} ${JSON.stringify(r[f])}`)
  console.log(`  -> ${filled.length}/17 fields`)

  console.log("\n=== 3. SAVING A FIELD (the path that 500'd) ===")
  const { data: saved, error: saveErr } = await db.from("network_client_profile")
    .update({ client_first: r.client_first })              // same value, no data change
    .eq("client_profile_id", cp.id).select(PROFILE_COLS).single()
  console.log("  error:", saveErr ? `${(saveErr as any).code} ${saveErr.message}` : "(none)")
  console.log("  returned row:", saved ? "yes" : "no")

  console.log("\n=== 4. PHASE 2 (resume -> current role / employer) ===")
  const resumeChars = (cp.resume_text ?? "").length
  const touched = new Set((r.touched_fields ?? []) as string[])
  const pending =
    !r.current_role_title && !r.current_employer &&
    !touched.has("current_role_title") && !touched.has("current_employer") &&
    !r.resume_seed_attempted_at && resumeChars > 0
  console.log("  resume_text chars       :", resumeChars)
  console.log("  current_role_title      :", r.current_role_title ?? "(null)")
  console.log("  current_employer        :", r.current_employer ?? "(null)")
  console.log("  resume_seed_attempted_at:", r.resume_seed_attempted_at ?? "(null)")
  console.log("  => GET sends resume_pending:", pending)

  console.log("\n=== 5. help_dismissed ===")
  console.log("  value:", JSON.stringify(r.help_dismissed ?? null))
})()
