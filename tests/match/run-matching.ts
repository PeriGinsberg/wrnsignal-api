/**
 * Matching from the command line (lib/match/runMatching.ts). No cron yet.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/match/run-matching.ts --client <client_profile_id> [--limit N] [--dry]
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/match/run-matching.ts --client <id> --seed-from-lane <lane_id> \
 *     [--max-years N] [--add-preset cincinnati]      (creates client_match_criteria from the lane and profile, then stops)
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/match/run-matching.ts --client <id> --queue [N]   (prints the ranked queue)
 *
 * Creds: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the shell, else
 * .env.phase0; ANTHROPIC_API_KEY from the shell. Writing to prod needs --prod on
 * every run (first prod run: Alex, 2026-10-25); reading the queue does not.
 *
 * WRITES: client_match_criteria (--seed-from-lane only), posting_matches, match_runs.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { seedCriteria } from "../../lib/match/criteria"
import { runMatching } from "../../lib/match/runMatching"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
const fileEnv: Record<string, string> = {}
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && m[2]) fileEnv[m[1]] = m[2] }
const env = (k: string) => process.env[k] || fileEnv[k]
const arg = (n: string) => { const i = process.argv.indexOf("--" + n); const v = process.argv[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : undefined }
const flag = (n: string) => process.argv.includes("--" + n)

const URL_ = env("SUPABASE_URL"), KEY = env("SUPABASE_SERVICE_ROLE_KEY")
if (!URL_ || !KEY) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1) }
const ref = new URL(URL_).hostname.split(".")[0]
if (ref === PROD_REF && !flag("prod") && !flag("queue")) { console.error(`Refusing to write to prod (${ref}) without --prod.`); process.exit(1) }
const client = arg("client")
if (!client) { console.error("--client <client_profile_id> required"); process.exit(1) }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

;(async () => {
  console.log(`Supabase project: ${ref}${ref === PROD_REF ? " (PROD)" : ""}`)

  const lane = arg("seed-from-lane")
  if (lane) {
    const { data: l, error } = await sb.from("search_lanes").select("id, client_profile_id, titles, location, years_max, exclusions, keyword").eq("id", lane).single()
    if (error || !l) throw new Error(`lane ${lane}: ${error?.message}`)
    if (l.client_profile_id !== client) throw new Error("lane belongs to a different client")
    const { data: p } = await sb.from("client_profiles").select("id, job_type, target_roles, target_industries, excluded_industries").eq("id", client).single()
    const overrides: any = {}
    if (arg("max-years")) overrides.maxYearsRequired = Number(arg("max-years"))
    if (arg("add-preset")) overrides.addPresets = arg("add-preset")!.split(",")
    const { criteria: c, warnings } = seedCriteria(l, p!, overrides)
    for (const w of warnings) console.log("warning:", w)
    const { error: iErr } = await sb.from("client_match_criteria").upsert({
      client_profile_id: client, markets: c.markets, radius_miles: c.radiusMiles, remote_ok: c.remoteOk,
      max_years_required: c.maxYearsRequired, job_types: c.jobTypes, excluded_title_keywords: c.excludedTitleKeywords,
      excluded_employers: c.excludedEmployers, target_roles: c.targetRoles, target_industries: c.targetIndustries,
      excluded_industries: c.excludedIndustries, seeded_from_lane_id: l.id,
    }, { onConflict: "client_profile_id" })
    if (iErr) throw new Error("criteria upsert failed: " + iErr.message)
    console.log("criteria:", JSON.stringify({ markets: c.markets.map((m) => m.name), radius: c.radiusMiles, maxYears: c.maxYearsRequired, jobTypes: c.jobTypes, excludedTitles: c.excludedTitleKeywords, targetRoles: c.targetRoles }))
    return
  }

  if (flag("queue")) {
    const n = Number(arg("queue") ?? 30)
    const { data, error } = await sb.from("client_match_queue")
      .select("rank, score, is_new, source, title, company, location, years_min, years_max, years_basis, salary_low, salary_high, salary_period, judge_reason")
      .eq("client_profile_id", client).order("rank").limit(n)
    if (error) throw error
    const years = (r: any) => r.years_basis === null ? "not stated"
      : `${r.years_min ?? "?"}${r.years_max === null ? "+" : r.years_max === r.years_min ? "" : "-" + r.years_max}${r.years_basis === "preferred" ? " pref" : ""}`
    const money = (v: any) => (v === null ? "?" : Number(v) >= 1000 ? `$${Math.round(Number(v) / 1000)}k` : `$${Number(v)}`)
    const pay = (r: any) => r.salary_low === null && r.salary_high === null ? "not stated" : `${money(r.salary_low)}-${money(r.salary_high)}${r.salary_period ? "/" + r.salary_period : ""}`
    for (const r of data ?? []) console.log(`${r.rank}\t${r.score ?? "--"}\t${r.title}\t${r.company}\t${r.location ?? "-"}\t${years(r)}\t${pay(r)}\t${r.judge_reason ?? "(not judged: no description)"}`)
    return
  }

  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY must be set"); process.exit(1) }
  const s = await runMatching(sb, { clientProfileId: client, dryRun: flag("dry"), limit: arg("limit") ? Number(arg("limit")) : undefined, triggeredBy: "manual:run-matching" })
  console.log(JSON.stringify(s))
})().catch((e) => { console.error(e); process.exit(1) })
