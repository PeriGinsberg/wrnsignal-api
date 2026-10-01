// tests/automation/claim-race-smoke.ts
//
// Two runners claim the same automation event at the same instant, against a
// real database, and exactly one must win. The in-memory tests cannot prove
// this: the guarantee is Postgres's row lock on the conditional UPDATE.
//
// Needs 20260929_automation_event_claims.sql applied first. Inserts one event
// with a key no rule listens to, and deletes it again.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... NODE_OPTIONS=--use-system-ca npx tsx tests/automation/claim-race-smoke.ts
//
// POINT IT AT DEV. It writes.

import { createClient } from "@supabase/supabase-js"
import { claimEvent } from "../../lib/automation/run"

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

// Two clients, so the two claims travel as two separate requests.
const a = createClient(url, key, { auth: { persistSession: false } })
const b = createClient(url, key, { auth: { persistSession: false } })

async function main() {
  console.log(`project: ${new URL(url!).hostname.split(".")[0]}`)
  let failures = 0

  for (let round = 1; round <= 20; round++) {
    const { data: ev, error } = await a.from("coach_automation_events")
      .insert({ event_key: "smoke.claim_race", payload: { round } }).select("id").single()
    if (error) throw new Error(`insert failed (is the migration applied?): ${error.message}`)

    const [ra, rb] = await Promise.all([claimEvent(a, ev.id), claimEvent(b, ev.id)])
    const winners = [ra, rb].filter(Boolean).length
    if (winners !== 1) {
      failures++
      console.error(`  FAIL  round ${round}: ${winners} runners claimed the event`)
    }
    await a.from("coach_automation_events").delete().eq("id", ev.id)
  }

  console.log(failures ? `\n${failures} of 20 rounds failed` : "\n20 of 20 rounds: exactly one runner claimed each event")
  if (failures) process.exit(1)
}

main()
