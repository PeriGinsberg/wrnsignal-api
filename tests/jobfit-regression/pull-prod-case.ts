// tests/jobfit-regression/pull-prod-case.ts
//
// Pull one JobFit run into an eval case folder (evals/jobfit/cases/<id>/) for
// the jobfit-case diagnosis method. READ-ONLY: selects only.
//
// Creds come from the shell, never from .env files (those point at dev):
//   $env:SUPABASE_URL = "https://<prod-ref>.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<prod service role key>"
//   $env:NODE_OPTIONS = "--use-system-ca"
//
// Find the run (lists matches, writes nothing):
//   npx tsx tests/jobfit-regression/pull-prod-case.ts --person Zivitz --job UBS
// Write the case folder for one run:
//   npx tsx tests/jobfit-regression/pull-prod-case.ts --run <jobfit_runs.id> --case C005
//
// Files written: run-row.json, result.json, jd.txt, resume.txt (the persona's
// résumé when the run used one, else the profile's), profile_text.txt.

import { createClient } from "@supabase/supabase-js"
import fs from "fs"
import path from "path"

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("Export SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this shell first.")
  process.exit(1)
}
const ref = new URL(url).hostname.split(".")[0]
console.log(`Supabase project: ${ref}`)

const sb = createClient(url, key, { auth: { persistSession: false } })
const args = process.argv.slice(2)
const arg = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] ?? null : null }

async function find(person: string, job: string | null) {
  const { data: people, error } = await sb.from("client_profiles")
    .select("id, name, email").ilike("name", `%${person}%`)
  if (error) throw new Error(error.message)
  if (!people?.length) { console.log(`No profile matches "${person}".`); return }
  for (const p of people) {
    console.log(`\n${p.name} <${p.email}>  profile ${p.id}`)
    const { data: runs, error: rErr } = await sb.from("jobfit_runs")
      .select("id, created_at, verdict, job_title, company_name, job_url, persona_id, job_description, result_json")
      .eq("client_profile_id", p.id).order("created_at", { ascending: false }).limit(200)
    if (rErr) throw new Error(rErr.message)
    const needle = job?.toLowerCase()
    for (const r of runs ?? []) {
      const res = (r.result_json ?? {}) as Record<string, any>
      const hay = [r.job_title, r.company_name, r.job_url, (r.job_description ?? "").slice(0, 600)].join(" ").toLowerCase()
      if (needle && !hay.includes(needle)) continue
      const title = r.job_title || (r.job_description ?? "").replace(/\s+/g, " ").slice(0, 70)
      console.log(`  ${r.id}  ${r.created_at.slice(0, 16)}  ${r.verdict ?? res.decision ?? "?"}/${res.score ?? "?"}  ` +
        `risks:${(res.risk_codes ?? []).length}  ${r.company_name ?? ""} | ${title}`)
    }
  }
}

async function pull(runId: string, caseId: string) {
  const dir = path.join("evals", "jobfit", "cases", caseId)
  if (fs.existsSync(dir)) { console.error(`${dir} already exists; pick another case id.`); process.exit(1) }
  const { data: run, error } = await sb.from("jobfit_runs").select("*").eq("id", runId).single()
  if (error || !run) throw new Error(error?.message ?? "run not found")
  const { data: prof } = await sb.from("client_profiles")
    .select("resume_text, profile_text").eq("id", run.client_profile_id).single()
  let resume = prof?.resume_text ?? ""
  if (run.persona_id) {
    const { data: persona } = await sb.from("client_personas").select("*").eq("id", run.persona_id).single()
    if (persona?.resume_text) resume = persona.resume_text
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "persona.json"), JSON.stringify(persona, null, 2))
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "run-row.json"), JSON.stringify(run, null, 2))
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(run.result_json, null, 2))
  fs.writeFileSync(path.join(dir, "jd.txt"), run.job_description ?? "")
  fs.writeFileSync(path.join(dir, "resume.txt"), resume)
  fs.writeFileSync(path.join(dir, "profile_text.txt"), prof?.profile_text ?? "")
  console.log(`Wrote ${dir} (jd ${String(run.job_description ?? "").length} chars, resume ${resume.length} chars)`)
}

async function main() {
  const run = arg("--run")
  if (run) return pull(run, arg("--case") ?? (() => { throw new Error("--case <id> is required with --run") })())
  const person = arg("--person")
  if (!person) { console.error("Pass --person <name> [--job <text>], or --run <id> --case <id>."); process.exit(1) }
  return find(person, arg("--job"))
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
