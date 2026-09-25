// tests/briefs/prefill-probe.ts
//
// What a Campaign Brief form would actually open with, for one client.
//
// Costs one model call. Read-only: it writes nothing.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
//     npx tsx tests/briefs/prefill-probe.ts <client_profile_id>
//
// WHAT TO LOOK FOR. Suggestions must only ever cover fields the profile left
// empty, and each one must quote the phrase it came from. A suggestion with no
// evidence is the model inferring rather than extracting, which is the failure
// mode this prompt is written against.

import { createClient } from "@supabase/supabase-js"
import { buildPrefill } from "../../lib/briefs/prefill"

async function main() {
  const id = process.argv[2]
  if (!id) throw new Error("Pass a client_profile_id")
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  const db = createClient(url, key, { auth: { persistSession: false } })

  const { data: p } = await db.from("client_profiles").select("name").eq("id", id).maybeSingle()
  console.log(`${p?.name ?? "?"}  (${id})\n`)

  const t0 = Date.now()
  const pre = await buildPrefill(db, id)
  console.log(`read in ${Math.round((Date.now() - t0) / 100) / 10}s\n`)

  console.log("from the profile:")
  for (const f of pre.prefilled_fields) {
    console.log(`  ${f.padEnd(22)} ${JSON.stringify((pre.values as any)[f])}`)
  }
  if (!pre.prefilled_fields.length) console.log("  (nothing)")

  console.log("\nsuggested, for the coach to confirm:")
  for (const s of pre.suggestions) {
    console.log(`  ${s.field.padEnd(22)} ${JSON.stringify(s.value)}`)
    console.log(`  ${"".padEnd(22)} evidence: ${s.evidence || "(NONE — this one is inferred, not extracted)"}`)
  }
  if (!pre.suggestions.length) console.log("  (nothing)")
  if (pre.suggestions_error) console.log(`\nerror: ${pre.suggestions_error}`)

  const overlap = pre.suggestions.filter((s) => pre.prefilled_fields.includes(s.field as any))
  console.log(overlap.length
    ? `\nFAIL: ${overlap.length} suggestion(s) for fields the profile already answered`
    : "\nok   no suggestion overrides a field the profile answered")
  process.exit(overlap.length ? 1 : 0)
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
