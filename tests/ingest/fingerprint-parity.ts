/**
 * Does the TypeScript fingerprint agree with the one Postgres generated?
 *
 * Recomputes every stored posting's fingerprint from its own title, company and
 * location columns and compares against the generated column. Read-only.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/fingerprint-parity.ts
 *
 * WHY IT MATTERS. lib/ingest/fingerprint.ts duplicates three SQL functions so
 * the runner can fold duplicates before sending a batch. Duplicated logic
 * drifts; this is what makes the drift fail loudly instead of silently, and it
 * checks against real stored data rather than invented cases, so it covers the
 * location spellings the sources actually produce.
 *
 * A mismatch does NOT corrupt data (the database still computes the real
 * fingerprint and still owns identity). It costs a rejected batch. But a
 * rejected batch fails a whole sweep, so this runs before the runner is trusted.
 */

import { createClient } from "@supabase/supabase-js"
import { fingerprintOf, normLocation, normText } from "../../lib/ingest/fingerprint"

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

;(async () => {
  console.log("database: " + process.env.SUPABASE_URL)

  const rows: any[] = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("postings")
      .select("id, source, title, company, location, fingerprint").range(f, f + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  console.log("postings checked: " + rows.length + "\n")

  const bad: any[] = []
  for (const r of rows) {
    const mine = fingerprintOf({ title: r.title, company: r.company, location: r.location })
    if (mine !== r.fingerprint) bad.push({ r, mine })
  }

  if (bad.length) {
    console.log("MISMATCHES: " + bad.length + "\n")
    for (const b of bad.slice(0, 25)) {
      console.log("  " + b.r.source + "  " + JSON.stringify(b.r.title).slice(0, 60))
      console.log("    company  : " + JSON.stringify(b.r.company))
      console.log("    location : " + JSON.stringify(b.r.location))
      console.log("    norm     : " + JSON.stringify(
        normText(b.r.title) + "|" + normText(b.r.company) + "|" + normLocation(b.r.location)))
      console.log("    postgres : " + b.r.fingerprint)
      console.log("    typescript: " + b.mine)
    }
    if (bad.length > 25) console.log("  ... and " + (bad.length - 25) + " more")
  }

  // The locations actually present, so a reader can see what the check covered
  // rather than trusting that the sample was interesting.
  const shapes = new Map<string, number>()
  for (const r of rows) {
    const l = String(r.location ?? "")
    const shape = l === "" ? "(empty)" : l.split(",").length + " comma-part(s)"
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1)
  }
  console.log("LOCATION SHAPES COVERED")
  for (const [k, v] of [...shapes].sort((a, b) => b[1] - a[1])) console.log("  " + String(v).padStart(5) + "  " + k)
  const distinctNorm = new Set(rows.map((r) => normLocation(r.location)))
  console.log("  distinct normalized locations: " + distinctNorm.size)

  console.log("\n" + (bad.length === 0
    ? "PASS: all " + rows.length + " fingerprints match Postgres."
    : "FAIL: " + bad.length + " of " + rows.length + " disagree."))
  process.exit(bad.length === 0 ? 0 : 1)
})().catch((e) => { console.error("FAILED: " + e.message); process.exit(1) })
