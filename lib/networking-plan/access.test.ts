#!/usr/bin/env tsx
// Share and Re-send are coach-only. Run: npx tsx lib/networking-plan/access.test.ts
//
// The hole this pins: a client calling share/resend with no client_profile_id
// resolves as the owner of their own board, which is exactly the board the plan
// is on, so the board check passed and they could release their own plan.

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveScope, type Scope } from "@/lib/collab/scope"
import { planActionRefusal, COACH_ONLY_MESSAGE } from "./access"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}`) }
}

async function main() {
  // The self path never touches the database, so no client is needed.
  const noDb = null as unknown as SupabaseClient
  const client = await resolveScope(noDb, { actorId: "client-1", isCoach: false }, { require: "write" })
  const coachOnOwnBoard = await resolveScope(noDb, { actorId: "coach-1", isCoach: true }, { subject: "coach-1", require: "write" })

  console.log("the scope a client actually gets on their own plan")
  ok("a client acting on their own board resolves as self", client.actorRole === "self")
  ok("and its subject is the client, so the board check alone passes", client.subjectId === "client-1")

  console.log("\nthe refusal")
  ok("a client is refused", planActionRefusal(client) === COACH_ONLY_MESSAGE)
  ok("a coach on their own board is refused too, as plan/run does", planActionRefusal(coachOnOwnBoard) !== null)
  const coachOnClient = { actorRole: "coach" } as Pick<Scope, "actorRole">
  ok("a coach acting on a client passes", planActionRefusal(coachOnClient) === null)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main()
