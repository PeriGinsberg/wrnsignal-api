// scripts/verify-jobfit-company-source.mjs (v2)
//
// Broader inspection — initial query returned 0 non-error rows on dev.
// Check what's actually there.

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

console.log(`Dev project: ${env.SUPABASE_URL}\n`)

// ── Total rows in jobfit_runs ────────────────────────────────────────────
const { count: total } = await sb
  .from("jobfit_runs")
  .select("*", { count: "exact", head: true })
console.log(`=== Total jobfit_runs rows: ${total} ===\n`)

if (!total || total === 0) {
  console.log("Dev jobfit_runs table is empty. Falling back to prod sampling.")
  console.log("Reading SUPABASE_URL/KEY for prod from .env.local...")

  let prodEnv
  try {
    prodEnv = Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=")
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
        }),
    )
  } catch (e) {
    console.log(`  ✗ .env.local not readable: ${e.message}`)
    process.exit(1)
  }

  const prod = createClient(prodEnv.SUPABASE_URL, prodEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
  console.log(`Prod project: ${prodEnv.SUPABASE_URL}\n`)

  await inspect(prod, "PROD")
} else {
  await inspect(sb, "DEV")
}

async function inspect(client, label) {
  // Verdict breakdown
  console.log(`=== ${label}: verdict distribution ===`)
  const { data: verdictRows } = await client
    .from("jobfit_runs")
    .select("verdict")
    .limit(2000)
  const verdictCounts = {}
  for (const r of verdictRows ?? []) {
    const v = r.verdict ?? "(null)"
    verdictCounts[v] = (verdictCounts[v] ?? 0) + 1
  }
  for (const [v, c] of Object.entries(verdictCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.padEnd(20)} ${c}`)
  }

  // application_id coverage
  console.log(`\n=== ${label}: application_id coverage (verdict != 'error') ===`)
  const { count: totalNonError } = await client
    .from("jobfit_runs")
    .select("*", { count: "exact", head: true })
    .neq("verdict", "error")
  const { count: withAppId } = await client
    .from("jobfit_runs")
    .select("*", { count: "exact", head: true })
    .neq("verdict", "error")
    .not("application_id", "is", null)
  const withoutAppId = (totalNonError ?? 0) - (withAppId ?? 0)
  console.log(`  total non-error:        ${totalNonError}`)
  console.log(`  with application_id:    ${withAppId}`)
  console.log(`  without application_id: ${withoutAppId}`)
  console.log(
    `  coverage:               ${totalNonError ? ((100 * (withAppId ?? 0)) / totalNonError).toFixed(1) : "n/a"}%`,
  )

  // job_signals shape (5 samples)
  console.log(`\n=== ${label}: result_json.job_signals samples (5 latest non-error) ===`)
  const { data: samples } = await client
    .from("jobfit_runs")
    .select("id, verdict, application_id, result_json")
    .neq("verdict", "error")
    .order("created_at", { ascending: false })
    .limit(5)
  for (const row of samples ?? []) {
    const js = row.result_json?.job_signals ?? null
    console.log(`  id=${row.id.slice(0, 8)}…  verdict=${row.verdict}  app_id=${row.application_id ? row.application_id.slice(0, 8) + "…" : "null"}`)
    console.log(`    job_signals present:  ${js !== null && js !== undefined}`)
    console.log(`    jobTitle:    ${JSON.stringify(js?.jobTitle ?? null)}`)
    console.log(`    companyName: ${JSON.stringify(js?.companyName ?? null)}`)
  }

  // Wide presence stats
  console.log(`\n=== ${label}: jobTitle / companyName presence (500-row sample) ===`)
  const { data: wide } = await client
    .from("jobfit_runs")
    .select("id, result_json")
    .neq("verdict", "error")
    .order("created_at", { ascending: false })
    .limit(500)
  const n = wide?.length ?? 0
  let hasJs = 0
  let titleNonEmpty = 0
  let companyNonEmpty = 0
  for (const row of wide ?? []) {
    const js = row.result_json?.job_signals
    if (js) hasJs++
    const t = js?.jobTitle
    const c = js?.companyName
    if (typeof t === "string" && t.trim().length > 0) titleNonEmpty++
    if (typeof c === "string" && c.trim().length > 0) companyNonEmpty++
  }
  console.log(`  sample size:                ${n}`)
  console.log(`  has job_signals:            ${hasJs}  (${n ? ((100 * hasJs) / n).toFixed(1) : "n/a"}%)`)
  console.log(`  jobTitle non-empty string:  ${titleNonEmpty}  (${n ? ((100 * titleNonEmpty) / n).toFixed(1) : "n/a"}%)`)
  console.log(`  companyName non-empty:      ${companyNonEmpty}  (${n ? ((100 * companyNonEmpty) / n).toFixed(1) : "n/a"}%)`)
}

console.log("\n=== Done ===")
