#!/usr/bin/env tsx
// tests/jobfit-regression/inspect-prod-runs.ts
//
// Read-only inspection of historical jobfit_runs data in Supabase.
//
// PURPOSE
//   Convert hundreds of historical production runs into a structural-bug
//   hunt list. Does NOT replay anything against the current scoring engine
//   (the raw jobText is not preserved in jobfit_runs). Instead, it analyses
//   the stored result_json blobs directly to find decisions that look broken
//   on their face.
//
// USAGE
//   npx tsx tests/jobfit-regression/inspect-prod-runs.ts
//   npx tsx tests/jobfit-regression/inspect-prod-runs.ts --limit 200
//   npx tsx tests/jobfit-regression/inspect-prod-runs.ts --since 2026-03-01
//   npx tsx tests/jobfit-regression/inspect-prod-runs.ts --inspect <row-id>
//
// The --inspect mode pulls a single row by id and prints its full
// decision-cascade shape (decision, gate, family, all WHY codes, all RISK
// codes, score breakdown, debug). Use it to drill into outliers surfaced
// by the structural rules in default mode.
//
// REQUIREMENTS
//   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (the same vars
//   the API route uses).
//
// SAFETY
//   Read-only. Issues only SELECT queries. Never inserts, updates, or
//   deletes. Does not print raw resume text or PII; only IDs, decisions,
//   scores, and structural shape information.

import { createClient } from "@supabase/supabase-js"
import { existsSync } from "node:fs"
import { join } from "node:path"

// ── Env loading ─────────────────────────────────────────────────────────────
// Node 20.6+ has process.loadEnvFile. Use it if available; otherwise rely on
// the caller to have already exported the env vars in their shell.
function loadEnvLocal() {
  const candidates = [".env.local", ".env.development.local"]
  for (const name of candidates) {
    const path = join(process.cwd(), name)
    if (!existsSync(path)) continue
    try {
      // @ts-ignore — Node 20.6+
      if (typeof process.loadEnvFile === "function") {
        // @ts-ignore
        process.loadEnvFile(path)
        return
      }
    } catch {
      // ignore — env may already be set in shell
    }
  }
}
loadEnvLocal()

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set " +
      "(check .env.local or export them in your shell)."
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function argValue(name: string): string | null {
  const i = args.indexOf(name)
  if (i < 0 || i + 1 >= args.length) return null
  return args[i + 1]
}
const LIMIT = Number(argValue("--limit") || "1000")
const SINCE = argValue("--since") // ISO date
const INSPECT_ID = argValue("--inspect") // single-row deep dive

// ── Quality-direct-WHY check (mirrors decision.ts isQualityDirectWhy) ───────
const MIN_QUALITY_DIRECT_WEIGHT = 75

function isSkillsListBoilerplate(profileFact: string | null | undefined): boolean {
  if (!profileFact) return false
  const f = String(profileFact).trim()
  if (!f) return false
  const pipeCount = (f.match(/\|/g) || []).length
  if (pipeCount >= 3) return true
  if (
    /^(strengths?|skills?|competenc(?:y|ies)|tools?|certifications?|proficiencies|areas of expertise)\s*:/i.test(
      f
    )
  ) {
    return true
  }
  if (/\bproficient (in|with)\b/i.test(f) && (f.match(/,/g) || []).length >= 2) {
    return true
  }
  return false
}

function isQualityDirectWhy(w: any): boolean {
  if (!w) return false
  if (w.match_strength !== "direct") return false
  if ((w.weight ?? 0) < MIN_QUALITY_DIRECT_WEIGHT) return false
  if (isSkillsListBoilerplate(w.profile_fact)) return false
  return true
}

// ── Outlier rules ───────────────────────────────────────────────────────────
// Each rule is a pure function over a row. Returns a short reason string if
// the row matches the pattern, or null otherwise.
type Row = {
  id: string
  client_profile_id: string
  verdict: string
  result_json: any
  created_at: string
  application_id: string | null
  persona_id: string | null
}

type OutlierRule = {
  key: string
  description: string
  check: (row: Row) => string | null
}

const RULES: OutlierRule[] = [
  {
    key: "apply_no_quality_directs",
    description:
      "Apply / Priority Apply with no quality direct WHYs (the new guardrail would have downgraded these)",
    check: (row) => {
      const r = row.result_json || {}
      const decision = r.decision || row.verdict
      if (decision !== "Apply" && decision !== "Priority Apply") return null
      const whys = (r.why_codes || []) as any[]
      if (whys.length === 0) return null // covered by zero-WHY rule
      const quality = whys.filter(isQualityDirectWhy)
      if (quality.length === 0) {
        const directs = whys.filter((w) => w.match_strength === "direct").length
        return `decision=${decision} score=${r.score} whyCount=${whys.length} directs=${directs} quality=0`
      }
      return null
    },
  },
  {
    key: "apply_zero_whys",
    description: "Apply / Priority Apply with zero WHY codes (should be capped at Pass)",
    check: (row) => {
      const r = row.result_json || {}
      const decision = r.decision || row.verdict
      if (decision !== "Apply" && decision !== "Priority Apply") return null
      const whys = (r.why_codes || []) as any[]
      if (whys.length === 0) return `decision=${decision} score=${r.score} whyCount=0`
      return null
    },
  },
  {
    key: "priority_apply_with_high_risk",
    description: "Priority Apply with one or more high-severity risks",
    check: (row) => {
      const r = row.result_json || {}
      const decision = r.decision || row.verdict
      if (decision !== "Priority Apply") return null
      const risks = (r.risk_codes || []) as any[]
      const highs = risks.filter((rk) => rk.severity === "high")
      if (highs.length > 0) {
        return `score=${r.score} highRisks=${highs.length} codes=[${highs
          .map((h) => h.code)
          .join(",")}]`
      }
      return null
    },
  },
  {
    key: "pass_with_family_match",
    description:
      "Pass with profile.targetFamilies including job.jobFamily AND no force_pass gate (probable false negative)",
    check: (row) => {
      const r = row.result_json || {}
      const decision = r.decision || row.verdict
      if (decision !== "Pass") return null
      // Exclude rows where a hard gate forced the Pass — those are correct
      // Pass decisions overriding the family match (no-remote vs remote,
      // contract conflict, location mismatch, etc.).
      if (r.gate_triggered?.type === "force_pass") return null
      const jobFamily = r.job_signals?.jobFamily
      const targetFamilies = r.profile_signals?.targetFamilies || []
      if (!jobFamily || !Array.isArray(targetFamilies)) return null
      if (targetFamilies.includes(jobFamily)) {
        return `score=${r.score} jobFamily=${jobFamily} targets=[${targetFamilies.join(",")}]`
      }
      return null
    },
  },
  {
    key: "score_band_boundary",
    description:
      "Score sitting on a decision-band boundary (73-75 or 95-96) — coin flip cases worth manual review",
    check: (row) => {
      const r = row.result_json || {}
      const score = r.score
      if (typeof score !== "number") return null
      if (score === 74 || score === 75 || score === 95 || score === 96) {
        return `score=${score} decision=${r.decision || row.verdict}`
      }
      return null
    },
  },
  {
    key: "training_program_below_floor",
    description:
      "Training program with family match but score < 65 AND no force_pass gate (the training-program floor in scoring.ts:864 should have raised this to 65)",
    check: (row) => {
      const r = row.result_json || {}
      if (!r.job_signals?.isTrainingProgram) return null
      // Skip force_pass — the score=25 cap from a hard gate is correct.
      if (r.gate_triggered?.type === "force_pass") return null
      // The floor only fires when familyMatch is true, so check that too.
      const jobFamily = r.job_signals?.jobFamily
      const targetFamilies = r.profile_signals?.targetFamilies || []
      const familyMatch =
        jobFamily && Array.isArray(targetFamilies) && targetFamilies.includes(jobFamily)
      if (!familyMatch) return null
      const score = r.score
      if (typeof score !== "number") return null
      if (score < 65) {
        return `score=${score} decision=${r.decision || row.verdict} family=${jobFamily}`
      }
      return null
    },
  },
  {
    key: "review_score_above_apply_floor",
    description:
      "Review decision with score >= 75 (Apply threshold) — guardrail or downgrade fired; check if intentional",
    check: (row) => {
      const r = row.result_json || {}
      const decision = r.decision || row.verdict
      if (decision !== "Review") return null
      const score = r.score
      if (typeof score !== "number") return null
      if (score >= 75) return `score=${score} (capped from raw)`
      return null
    },
  },
]

// ── Single-row deep-dive (--inspect <id>) ──────────────────────────────────
// Pulls one jobfit_runs row by id and prints its full decision-cascade
// shape: identity, decision/score, gate, family, all WHY codes, all RISK
// codes, score_breakdown components, and any debug fields. Used to drill
// into outliers surfaced by the structural rules above.
async function inspectOne(id: string): Promise<void> {
  console.log(`=== Inspect jobfit_run ${id} ===\n`)
  const { data, error } = await supabase
    .from("jobfit_runs")
    .select(
      "id,client_profile_id,verdict,result_json,created_at,application_id,persona_id,fingerprint_code"
    )
    .eq("id", id)
    .maybeSingle()

  if (error) {
    console.error("FAILED to fetch row:", error.message)
    process.exit(1)
  }
  if (!data) {
    console.error(`No row found with id=${id}`)
    process.exit(1)
  }

  const r = data.result_json || {}
  const js = r.job_signals || {}
  const ps = r.profile_signals || {}

  console.log("Row metadata:")
  console.log(`  created_at        ${data.created_at}`)
  console.log(`  client_profile_id ${data.client_profile_id}`)
  console.log(`  persona_id        ${data.persona_id ?? "-"}`)
  console.log(`  application_id    ${data.application_id ?? "-"}`)
  console.log(`  fingerprint_code  ${data.fingerprint_code}`)
  console.log(`  verdict           ${data.verdict}`)
  console.log()

  console.log("Decision:")
  console.log(`  decision          ${r.decision}`)
  console.log(`  score             ${r.score}`)
  console.log(`  gate.type         ${r.gate_triggered?.type ?? "none"}`)
  console.log(`  gate.code         ${r.gate_triggered?.gateCode ?? "-"}`)
  console.log()

  console.log("Job signals:")
  console.log(`  jobTitle          ${js.jobTitle ?? "-"}`)
  console.log(`  companyName       ${js.companyName ?? "-"}`)
  console.log(`  jobFamily         ${js.jobFamily ?? "-"}`)
  console.log(`  financeSubFamily  ${js.financeSubFamily ?? "-"}`)
  console.log(`  isTrainingProgram ${js.isTrainingProgram ?? false}`)
  console.log(`  isSeniorRole      ${js.isSeniorRole ?? false}`)
  console.log(`  yearsRequired     ${js.yearsRequired ?? "-"}`)
  console.log(`  function_tags     ${JSON.stringify(js.function_tags || [])}`)
  console.log(`  location          ${JSON.stringify(js.location || {})}`)
  console.log()

  console.log("Profile signals:")
  console.log(`  targetFamilies    ${JSON.stringify(ps.targetFamilies || [])}`)
  console.log(`  financeSubFamily  ${ps.financeSubFamily ?? "-"}`)
  console.log(`  yearsExperience   ${ps.yearsExperienceApprox ?? "-"}`)
  console.log(`  gradYear          ${ps.gradYear ?? "-"}`)
  console.log()

  const whys = (r.why_codes || []) as any[]
  console.log(`WHY codes (${whys.length}):`)
  for (const w of whys) {
    const isQuality = isQualityDirectWhy(w)
    const flag = isQuality ? "✓" : w.match_strength === "direct" ? "!" : " "
    console.log(
      `  ${flag} [${w.code}] ${w.match_key} (${w.match_strength}, w=${w.weight})`
    )
    console.log(`      job  : ${String(w.job_fact || "").slice(0, 140)}`)
    console.log(`      prof : ${String(w.profile_fact || "").slice(0, 140)}`)
  }
  console.log("  Legend: ✓ = quality direct, ! = direct but low-quality (boilerplate or weight<75)")
  console.log()

  const risks = (r.risk_codes || []) as any[]
  console.log(`RISK codes (${risks.length}):`)
  for (const rk of risks) {
    console.log(`  [${rk.code}] sev=${rk.severity} w=${rk.weight}`)
    console.log(`      ${String(rk.risk || "").slice(0, 200)}`)
  }
  console.log()

  const sb = r.score_breakdown
  if (sb) {
    console.log("Score breakdown:")
    console.log(`  raw_score         ${sb.raw_score}`)
    console.log(`  clamped_score     ${sb.clamped_score}`)
    if (Array.isArray(sb.components)) {
      for (const c of sb.components) {
        console.log(`  - ${String(c.label).padEnd(22)} pts=${c.points} note=${c.note}`)
      }
    }
    console.log()
  }

  if (r.debug) {
    console.log("Debug:")
    for (const [k, v] of Object.entries(r.debug)) {
      const vs = typeof v === "string" ? v : JSON.stringify(v)
      console.log(`  ${k.padEnd(28)} ${String(vs).slice(0, 120)}`)
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (INSPECT_ID) {
    await inspectOne(INSPECT_ID)
    return
  }

  console.log("=== JobFit production-run inspection ===")
  console.log(
    `Connecting to ${SUPABASE_URL!.replace(/https?:\/\//, "").replace(/\..*/, "")}...`
  )

  // 1. Row counts
  const { count: runCount, error: countErr } = await supabase
    .from("jobfit_runs")
    .select("*", { count: "exact", head: true })

  if (countErr) {
    console.error("FAILED to count jobfit_runs:", countErr.message)
    process.exit(1)
  }

  const { count: appCount } = await supabase
    .from("signal_applications")
    .select("*", { count: "exact", head: true })

  console.log(`\njobfit_runs total: ${runCount}`)
  console.log(`signal_applications total: ${appCount}`)
  console.log(`Inspection limit: ${LIMIT}${SINCE ? ` since=${SINCE}` : ""}`)

  // 2. Pull rows for analysis
  let q = supabase
    .from("jobfit_runs")
    .select("id,client_profile_id,verdict,result_json,created_at,application_id,persona_id")
    .order("created_at", { ascending: false })
    .limit(LIMIT)
  if (SINCE) q = q.gte("created_at", SINCE)

  const { data: rows, error: rowsErr } = await q
  if (rowsErr) {
    console.error("FAILED to fetch rows:", rowsErr.message)
    process.exit(1)
  }
  if (!rows || rows.length === 0) {
    console.log("No rows returned. Exiting.")
    return
  }
  console.log(`Pulled ${rows.length} rows for analysis.\n`)

  // 3. Schema confirmation — top-level keys of one sample result_json
  const sample = rows[0]
  const sampleKeys = Object.keys(sample.result_json || {}).sort()
  console.log("Sample result_json top-level keys:")
  console.log("  " + sampleKeys.join(", "))
  console.log()

  // 4. Decision distribution
  const decisionCounts: Record<string, number> = {}
  for (const r of rows as Row[]) {
    const d = String(r.result_json?.decision || r.verdict || "unknown")
    decisionCounts[d] = (decisionCounts[d] || 0) + 1
  }
  console.log("Decision distribution:")
  const decisionOrder = ["Priority Apply", "Apply", "Review", "Pass", "unknown"]
  const allDecisionKeys = Object.keys(decisionCounts).sort(
    (a, b) =>
      (decisionOrder.indexOf(a) === -1 ? 99 : decisionOrder.indexOf(a)) -
      (decisionOrder.indexOf(b) === -1 ? 99 : decisionOrder.indexOf(b))
  )
  for (const k of allDecisionKeys) {
    const pct = ((decisionCounts[k] / rows.length) * 100).toFixed(1)
    console.log(`  ${k.padEnd(20)} ${String(decisionCounts[k]).padStart(5)}  (${pct}%)`)
  }
  console.log()

  // 5. Score histogram (10-point bins)
  const scoreBins: Record<string, number> = {}
  for (const r of rows as Row[]) {
    const s = r.result_json?.score
    if (typeof s !== "number") continue
    const lo = Math.floor(s / 10) * 10
    const key = `${lo}-${lo + 9}`
    scoreBins[key] = (scoreBins[key] || 0) + 1
  }
  console.log("Score histogram (10-point bins):")
  const binKeys = Object.keys(scoreBins).sort()
  const maxBin = Math.max(...Object.values(scoreBins))
  for (const k of binKeys) {
    const bar = "█".repeat(Math.round((scoreBins[k] / maxBin) * 30))
    console.log(`  ${k.padEnd(8)} ${String(scoreBins[k]).padStart(5)} ${bar}`)
  }
  console.log()

  // 6. Family distribution — job classification vs profile target
  const jobFamilyCounts: Record<string, number> = {}
  const profileFamilyCounts: Record<string, number> = {}
  // Track per-profile-id to avoid counting the same user N times if they
  // ran multiple jobs. We want "what do users WANT" not "how many runs
  // targeted each family".
  const seenProfiles = new Set<string>()

  for (const r of rows as Row[]) {
    const jf = String(r.result_json?.job_signals?.jobFamily || "unknown")
    jobFamilyCounts[jf] = (jobFamilyCounts[jf] || 0) + 1

    const targets = (r.result_json?.profile_signals?.targetFamilies || []) as string[]
    if (!seenProfiles.has(r.client_profile_id)) {
      seenProfiles.add(r.client_profile_id)
      for (const t of targets) {
        profileFamilyCounts[t] = (profileFamilyCounts[t] || 0) + 1
      }
    }
  }

  const allFamilies = Array.from(
    new Set([...Object.keys(jobFamilyCounts), ...Object.keys(profileFamilyCounts)])
  ).sort((a, b) => (jobFamilyCounts[b] || 0) - (jobFamilyCounts[a] || 0))

  console.log(
    "Family distribution — Job classification vs Profile targets"
  )
  console.log(
    `  (${rows.length} runs, ${seenProfiles.size} unique profiles)\n`
  )
  console.log(
    `  ${"Family".padEnd(20)} ${"Jobs".padStart(6)}  ${"(%)".padStart(7)}   ${"Profiles".padStart(8)}  ${"(%)".padStart(7)}`
  )
  console.log("  " + "─".repeat(58))
  for (const f of allFamilies) {
    const jc = jobFamilyCounts[f] || 0
    const jpct = ((jc / rows.length) * 100).toFixed(1)
    const pc = profileFamilyCounts[f] || 0
    const ppct = seenProfiles.size > 0 ? ((pc / seenProfiles.size) * 100).toFixed(1) : "0.0"
    const skew =
      jc > 0 && pc > 0
        ? (jc / rows.length / (pc / seenProfiles.size)).toFixed(1) + "x"
        : "-"
    console.log(
      `  ${f.padEnd(20)} ${String(jc).padStart(6)}  ${jpct.padStart(6)}%   ${String(pc).padStart(8)}  ${ppct.padStart(6)}%   skew=${skew}`
    )
  }
  console.log(
    "\n  skew = job% / profile%. >2x means jobs are classified to this family\n" +
      "  much more often than users target it (possible over-routing).\n" +
      "  <0.5x means users target this family but few jobs get classified there.\n"
  )

  // 7. Structural outlier detection
  console.log("=== Structural outliers ===\n")
  for (const rule of RULES) {
    const hits: Array<{ id: string; reason: string; created_at: string }> = []
    for (const r of rows as Row[]) {
      const reason = rule.check(r)
      if (reason) {
        hits.push({ id: r.id, reason, created_at: r.created_at })
      }
    }
    const pct = ((hits.length / rows.length) * 100).toFixed(1)
    console.log(`[${rule.key}] ${hits.length} of ${rows.length} (${pct}%)`)
    console.log(`  ${rule.description}`)
    if (hits.length > 0) {
      const examples = hits.slice(0, 3)
      for (const ex of examples) {
        console.log(`  - ${ex.id} ${ex.created_at.slice(0, 10)} :: ${ex.reason}`)
      }
      if (hits.length > 3) {
        console.log(`  ... and ${hits.length - 3} more`)
      }
    }
    console.log()
  }

  // 8. Stub for outcome cross-tab (will be meaningful in N weeks)
  console.log("=== Outcome cross-tab (NOT YET MEANINGFUL) ===")
  console.log(
    "application_status was just introduced; historical data is mostly empty.\n" +
      "This section will become useful as users adopt the new tracking feature.\n"
  )

  // Disambiguate the FK — there are TWO foreign keys between these tables:
  //   jobfit_runs.application_id -> signal_applications.id
  //   signal_applications.jobfit_run_id -> jobfit_runs.id
  // PostgREST won't auto-pick. Use the explicit constraint name from the
  // jobfit_runs schema: jobfit_runs_application_id_fkey.
  const { data: appJoin, error: joinErr } = await supabase
    .from("jobfit_runs")
    .select(
      "verdict, application_id, signal_applications!jobfit_runs_application_id_fkey(application_status)"
    )
    .not("application_id", "is", null)
    .limit(2000)

  if (joinErr) {
    console.warn("(skipped: join failed —", joinErr.message + ")")
  } else if (!appJoin || appJoin.length === 0) {
    console.log("(no rows with application linkage found)")
  } else {
    const crosstab: Record<string, Record<string, number>> = {}
    for (const row of appJoin as any[]) {
      const verdict = String(row.verdict || "unknown")
      const status = String((row.signal_applications as any)?.application_status || "none")
      if (!crosstab[verdict]) crosstab[verdict] = {}
      crosstab[verdict][status] = (crosstab[verdict][status] || 0) + 1
    }
    console.log("Decision × application_status:")
    for (const [verdict, statuses] of Object.entries(crosstab)) {
      const inner = Object.entries(statuses)
        .map(([s, c]) => `${s}=${c}`)
        .join(", ")
      console.log(`  ${verdict.padEnd(20)} ${inner}`)
    }
  }

  console.log("\n=== Done ===")
  console.log(
    "Next: pick a row id from any outlier above and drill in:\n" +
      "  npx tsx tests/jobfit-regression/inspect-prod-runs.ts --inspect <row-id>"
  )
}

main().catch((err) => {
  console.error("FATAL:", err)
  process.exit(1)
})
