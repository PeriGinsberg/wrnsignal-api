// scripts/verify-jobfit-lookup-schema.mjs
//
// Pre-D2 schema verification on dev. Three checks:
//   A. Sample jobfit_runs row → confirm column names (indirect, since
//      information_schema isn't reachable via Supabase JS client)
//   B. Sample signal_applications row → same purpose
//   C. The actual user-supplied query 3: join sample to verify
//      application_id resolves cleanly to signal_applications
//
// information_schema queries 1 and 2 must still be pasted from SQL Editor
// — Supabase JS can't reach pg_catalog without an RPC.

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

// =========================================================================
console.log("\n=== A. jobfit_runs column list (SELECT * LIMIT 1) ===")
// =========================================================================
{
  const { data, error } = await sb.from("jobfit_runs").select("*").limit(1)
  if (error) {
    console.log(`  ✗ SELECT failed: ${error.message}`)
  } else if (!data?.length) {
    console.log(`  (no rows in jobfit_runs on dev — columns not directly observable)`)
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
    const expected = ["profile_id", "company", "job_title", "application_id", "result_json", "created_at", "verdict"]
    for (const e of expected) {
      const present = cols.includes(e)
      console.log(`    ${present ? "✓" : "✗"} ${e}${present ? "" : "  (ABSENT)"}`)
    }
  }
}

// =========================================================================
console.log("\n=== B. signal_applications column list (SELECT * LIMIT 1) ===")
// =========================================================================
{
  const { data, error } = await sb.from("signal_applications").select("*").limit(1)
  if (error) {
    console.log(`  ✗ SELECT failed: ${error.message}`)
  } else if (!data?.length) {
    console.log(`  (no rows in signal_applications on dev)`)
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
  }
}

// =========================================================================
console.log("\n=== C. Query 3: jobfit_runs join signal_applications via application_id ===")
// =========================================================================
{
  // Two-step join (avoids PostgREST FK-metadata dependency)
  const { data: jrs, error: jrErr } = await sb
    .from("jobfit_runs")
    .select("id, application_id, created_at")
    .not("application_id", "is", null)
    .limit(5)
  if (jrErr) {
    console.log(`  ✗ jobfit_runs SELECT failed: ${jrErr.message}`)
  } else if (!jrs?.length) {
    console.log(`  ✗ no jobfit_runs rows with application_id IS NOT NULL on dev`)
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
      console.log(`  ${jrs.length} jobfit_runs row(s) with application_id; ${apps?.length ?? 0} resolved:`)
      for (const jr of jrs) {
        const app = byId.get(jr.application_id)
        if (app) {
          console.log(
            `    ✓ jobfit_run ${jr.id.slice(0, 8)}…  app=${app.id.slice(0, 8)}…  company=${JSON.stringify(app.company_name)}  title=${JSON.stringify(app.job_title)}`,
          )
        } else {
          console.log(
            `    ✗ jobfit_run ${jr.id.slice(0, 8)}…  app=${jr.application_id?.slice(0, 8)}…  → no matching signal_applications row (ORPHAN)`,
          )
        }
      }
    }
  }
}

// =========================================================================
console.log("\n=== Remaining: paste from SQL Editor ===")
console.log(`  Q1: information_schema.columns for signal_applications (data_type, is_nullable)`)
console.log(`  Q2: jobfit_runs FK constraints (constraint_column_usage)`)
