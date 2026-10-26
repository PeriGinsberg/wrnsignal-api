// tests/jobfit-smoke/hornets-industry-smoke.ts
//
// Smoke test for the employer-name industry rule (43cc4cca) on a deployed
// build. Posts a Charlotte Hornets JobFit run as a TEST account and checks:
//   - job_signals.jobIndustry is "sports" (the name decided it: the posting
//     itself only mentions sports in a candidate wish list)
//   - WHY_INDUSTRY_MATCH is never in risk_codes
//   - WHY_INDUSTRY_MATCH is in why_codes when the account's saved profile
//     targets sports (reported, not failed, when it does not)
//
// Writes one jobfit_runs row and may auto-create a saved application on the
// account, so use a test account only. Credentials come from process.env:
//   SMOKE_BASE_URL         the deployment, e.g. https://<preview>.vercel.app
//   SIGNAL_BEARER_TOKEN    a session token for the test account, or
//   SMOKE_EMAIL + SMOKE_PASSWORD with SUPABASE_URL + SUPABASE_ANON_KEY to sign in
//   VERCEL_PROTECTION_BYPASS  optional, for a protected Preview
//
//   NODE_OPTIONS=--use-system-ca npx tsx tests/jobfit-smoke/hornets-industry-smoke.ts

import { createClient } from "@supabase/supabase-js"

const JOB = `Charlotte Hornets Graphic Designer

We are looking for a Graphic Designer to join our in-house creative team.

Responsibilities:
- Design game-night graphics, social assets and in-arena signage
- Keep brand standards consistent across every channel

Qualifications:
- 2+ years of graphic design experience
- Experience in sports, lifestyle, entertainment, or consumer brands
- Proficiency in Adobe Creative Cloud`

async function token(): Promise<string> {
  if (process.env.SIGNAL_BEARER_TOKEN) return process.env.SIGNAL_BEARER_TOKEN
  const { SMOKE_EMAIL, SMOKE_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env
  if (!SMOKE_EMAIL || !SMOKE_PASSWORD || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Set SIGNAL_BEARER_TOKEN, or SMOKE_EMAIL + SMOKE_PASSWORD + SUPABASE_URL + SUPABASE_ANON_KEY")
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email: SMOKE_EMAIL, password: SMOKE_PASSWORD })
  if (error || !data.session) throw new Error(`Sign-in failed: ${error?.message ?? "no session"}`)
  return data.session.access_token
}

async function main() {
  const base = process.env.SMOKE_BASE_URL
  if (!base) throw new Error("Set SMOKE_BASE_URL")
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${await token()}`,
  }
  if (process.env.VERCEL_PROTECTION_BYPASS) headers["x-vercel-protection-bypass"] = process.env.VERCEL_PROTECTION_BYPASS

  const version = await fetch(`${base}/api/version`, { headers }).then((r) => r.json()).catch(() => null)
  console.log(`target ${base}  git_sha ${version?.git_sha ?? "(unreadable)"}`)

  const res = await fetch(`${base}/api/jobfit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ job: JOB, job_title: "Graphic Designer", company_name: "Charlotte Hornets", force_rerun: true }),
  })
  const body: any = await res.json().catch(() => null)
  if (!res.ok || !body) throw new Error(`POST /api/jobfit -> ${res.status}: ${JSON.stringify(body)?.slice(0, 300)}`)

  const whys = (body.why_codes ?? []).map((w: any) => w.code)
  const risks = (body.risk_codes ?? []).map((r: any) => r.code)
  const industry = body.job_signals?.jobIndustry
  console.log(`decision ${body.decision}  score ${body.score}  jobIndustry ${industry}`)
  console.log(`why_codes  ${whys.join(", ") || "(none)"}`)
  console.log(`risk_codes ${risks.join(", ") || "(none)"}`)

  let fail = 0
  const check = (label: string, cond: boolean) => { console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}`); if (!cond) fail++ }
  check('jobIndustry is "sports" from the employer name', industry === "sports")
  check("WHY_INDUSTRY_MATCH is not a risk", !risks.includes("WHY_INDUSTRY_MATCH"))
  if (whys.includes("WHY_INDUSTRY_MATCH")) {
    check("WHY_INDUSTRY_MATCH is the last WHY", whys[whys.length - 1] === "WHY_INDUSTRY_MATCH")
  } else {
    console.log("  note  no WHY_INDUSTRY_MATCH: this account's saved profile does not target sports")
  }
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
