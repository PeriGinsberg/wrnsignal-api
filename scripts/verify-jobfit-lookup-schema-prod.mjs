// scripts/verify-jobfit-lookup-schema-prod.mjs
//
// PROD READ-ONLY: jobfit_runs column observation (dev table is empty so
// indirect SELECT * doesn't work there) + the join-sample query.
//
// Same script as verify-jobfit-lookup-schema.mjs but reads .env.production.local.
// No writes. Used solely for pre-D2 schema verification.

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

console.log(`Prod project: ${env.SUPABASE_URL}  (READ-ONLY)`)

console.log("\n=== A. jobfit_runs column list (PROD) ===")
{
  const { data, error } = await sb.from("jobfit_runs").select("*").limit(1)
  if (error) {
    console.log(`  ✗ SELECT failed: ${error.message}`)
  } else if (!data?.length) {
    console.log(`  (no rows in jobfit_runs on prod — unexpected)`)
  } else {
    const cols = Object.keys(data[0]).sort()
    console.log(`  ${cols.length} columns:`)
    for (const c of cols) {
      const v = data[0][c]
      const typeHint =
        v === null
          ? "null"
          : typeof v === "object"
            ? "object/jsonb"
            : typeof v
      console.log(`    - ${c.padEnd(28)}  (${typeHint})`)
    }
    console.log(`\n  Check for FRD-assumed columns:`)
    const expected = [
      "id",
      "profile_id",
      "company",
      "company_name",
      "job_title",
      "application_id",
      "result_json",
      "created_at",
      "verdict",
      "decision",
      "score",
    ]
    for (const e of expected) {
      const present = cols.includes(e)
      console.log(`    ${present ? "✓" : "✗"} ${e}${present ? "" : "  (ABSENT)"}`)
    }
  }
}

console.log("\n=== C. Query 3 sample (PROD) ===")
{
  const { data: jrs, error: jrErr } = await sb
    .from("jobfit_runs")
    .select("id, application_id, created_at")
    .not("application_id", "is", null)
    .limit(5)
  if (jrErr) {
    console.log(`  ✗ jobfit_runs SELECT failed: ${jrErr.message}`)
  } else if (!jrs?.length) {
    console.log(`  ✗ no jobfit_runs rows with application_id IS NOT NULL on prod`)
  } else {
    const appIds = jrs.map((r) => r.application_id).filter(Boolean)
    const { data: apps, error: appErr } = await sb
      .from("signal_applications")
      .select("id, company_name, job_title")
      .in("id", appIds)
    if (appErr) {
      console.log(`  ✗ signal_applications SELECT failed: ${appErr.message}`)
    } else {
      const byId = new Map((apps ?? []).map((a) => [a.id, a]))
      console.log(`  ${jrs.length} jobfit_runs row(s) sampled; ${apps?.length ?? 0} signal_applications resolved:`)
      for (const jr of jrs) {
        const app = byId.get(jr.application_id)
        if (app) {
          console.log(
            `    ✓ jobfit_run ${jr.id.slice(0, 8)}…  app=${app.id.slice(0, 8)}…  company=${JSON.stringify(app.company_name)}  title=${JSON.stringify(app.job_title)}`,
          )
        } else {
          console.log(
            `    ✗ jobfit_run ${jr.id.slice(0, 8)}…  app=${jr.application_id?.slice(0, 8)}…  → ORPHAN (no signal_applications row)`,
          )
        }
      }
    }
  }
}
