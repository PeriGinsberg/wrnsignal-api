// scripts/migrate-candidate-targeting/investigate-premed-misclass.mjs
//
// Read-only investigation of why the 4 patched profiles got status_premed=true.
// Pulls ALL successful jobfit_runs for each, extracts jobFamily/jobTitle/
// companyName, prints grouped by profile.
//
// Goal: see whether PreMed classifications were one-off anomalies or
// consistent across runs.
//
// NO writes.

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

const TARGET_IDS = [
  { id: "381e4d41-c1b5-4846-92b2-b318af775d80", name: "Danielle Keyes" },
  { id: "91e418e9-c271-4353-9258-48c0b7f8e26f", name: "lily stein" },
  { id: "97bb24a8-da58-495b-b15d-b8c7ea214be4", name: "ryan rudnet" },
  { id: "1843e9e5-11ad-4bee-8991-558458a35323", name: "catherine2 lees2" },
]

console.log(`Prod: ${env.SUPABASE_URL}\n`)

for (const { id, name } of TARGET_IDS) {
  const { data, error } = await sb
    .from("jobfit_runs")
    .select(
      "id, created_at, verdict, job_url, result_json",
    )
    .eq("client_profile_id", id)
    .neq("verdict", "error")
    .order("created_at", { ascending: true })

  if (error) {
    console.log(`${name} (${id.slice(0, 8)}…): ERROR ${error.message}\n`)
    continue
  }

  const runs = data ?? []
  const premedCount = runs.filter((r) => {
    const sig = r.result_json?.job_signals
    return sig?.jobFamily === "PreMed"
  }).length

  console.log(`═══ ${name} (${id.slice(0, 8)}…) ═══`)
  console.log(`Total successful runs: ${runs.length}  | PreMed-classified: ${premedCount}`)
  console.log()

  for (const r of runs) {
    const sig = r.result_json?.job_signals ?? {}
    const jf = sig.jobFamily ?? "(null)"
    const title = (sig.jobTitle ?? "").trim() || "(no title)"
    const company = (sig.companyName ?? "").trim() || "(no company)"
    const url = (r.job_url ?? "").trim().slice(0, 70)
    const flag = jf === "PreMed" ? " ⚠ PREMED" : ""
    console.log(`  ${r.created_at.slice(0, 10)}  jf=${String(jf).padEnd(14)} ${title.slice(0, 45).padEnd(45)} @ ${company.slice(0, 30)}${flag}`)
    if (url) console.log(`               url: ${url}${url.length === 70 ? "…" : ""}`)
  }
  console.log()
}

console.log("Done (read-only).")
