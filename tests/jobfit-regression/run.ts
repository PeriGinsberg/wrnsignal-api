#!/usr/bin/env tsx
// tests/jobfit-regression/run.ts
//
// JobFit regression test harness. Reads fixture JSON files from ./fixtures,
// calls the real /api/jobfit endpoint for each, and compares actual results
// against expected values. Exit code 0 if all pass, non-zero otherwise.
//
// Usage:
//   SIGNAL_API_BASE=https://wrnsignal-api.vercel.app \
//   SIGNAL_BEARER_TOKEN=eyJ... \
//   npx tsx tests/jobfit-regression/run.ts [--fixture ID] [--update-baseline]
//
// The bearer token should be a Supabase session token for a test user
// whose client_profiles row can be used for the scoring runs.

import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, basename } from "node:path"

// ── Types ────────────────────────────────────────────────────────────────
type Fixture = {
  id: string
  description: string
  profile: {
    text?: string
    targetRoles?: string
    // If you want to use an existing profile row, specify its ID:
    profileId?: string
  }
  job: {
    text: string
    companyName?: string
    jobTitle?: string
  }
  expected: {
    decision?: "Priority Apply" | "Apply" | "Review" | "Pass"
    scoreRange?: [number, number]
    requiredWhyKeys?: string[]
    requiredRiskCodes?: string[]
    forbiddenWhyKeys?: string[]
    forbiddenRiskCodes?: string[]
    requiredJobFamily?: string
    forbiddenJobFamily?: string
    notes?: string
  }
}

type ResultRow = {
  id: string
  status: "PASS" | "FAIL" | "ERROR"
  decision?: string
  score?: number
  issues: string[]
  raw?: any
}

// ── CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const singleFixture = args.includes("--fixture")
  ? args[args.indexOf("--fixture") + 1]
  : null
const updateBaseline = args.includes("--update-baseline")

// ── Env ──────────────────────────────────────────────────────────────────
const API_BASE = process.env.SIGNAL_API_BASE || "https://wrnsignal-api.vercel.app"
const BEARER = process.env.SIGNAL_BEARER_TOKEN || ""

if (!BEARER) {
  console.error(
    "❌ Missing SIGNAL_BEARER_TOKEN env var. Set it to a Supabase session " +
      "token for a test user profile."
  )
  process.exit(2)
}

// ── Load fixtures ────────────────────────────────────────────────────────
const FIXTURES_DIR = join(__dirname, "fixtures")

function loadFixtures(): Fixture[] {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  const fixtures: Fixture[] = []
  for (const f of files) {
    const path = join(FIXTURES_DIR, f)
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Fixture
      if (!parsed.id) parsed.id = basename(f, ".json")
      fixtures.push(parsed)
    } catch (e: any) {
      console.error(`⚠️  Failed to parse ${f}: ${e.message}`)
    }
  }
  return fixtures
}

// ── Runner ───────────────────────────────────────────────────────────────
async function runFixture(fx: Fixture): Promise<ResultRow> {
  const row: ResultRow = { id: fx.id, status: "PASS", issues: [] }

  try {
    const body: any = {
      job: fx.job.text,
      force: true, // always bypass cache for regression runs
    }
    if (fx.profile.text) body.profileText = fx.profile.text
    if (fx.job.companyName) body.company_name = fx.job.companyName
    if (fx.job.jobTitle) body.job_title = fx.job.jobTitle

    const res = await fetch(`${API_BASE}/api/jobfit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BEARER}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      row.status = "ERROR"
      row.issues.push(`HTTP ${res.status}: ${text.slice(0, 200)}`)
      return row
    }

    const result = await res.json()
    row.raw = result
    row.decision = String(result?.decision ?? "")
    row.score = Number(result?.score ?? 0)

    // ── Assertions ─────────────────────────────────────────────
    const exp = fx.expected

    if (exp.decision && row.decision !== exp.decision) {
      row.issues.push(`decision expected '${exp.decision}', got '${row.decision}'`)
    }

    if (exp.scoreRange) {
      const [min, max] = exp.scoreRange
      if (row.score == null || row.score < min || row.score > max) {
        row.issues.push(`score ${row.score} out of range [${min}, ${max}]`)
      }
    }

    const whyKeys = (result?.why_codes ?? []).map((w: any) => String(w?.match_key ?? ""))
    for (const key of exp.requiredWhyKeys ?? []) {
      if (!whyKeys.includes(key)) {
        row.issues.push(`missing required why key: ${key}`)
      }
    }
    for (const key of exp.forbiddenWhyKeys ?? []) {
      if (whyKeys.includes(key)) {
        row.issues.push(`forbidden why key present: ${key}`)
      }
    }

    const riskCodes = (result?.risk_codes ?? []).map((r: any) => String(r?.code ?? ""))
    for (const code of exp.requiredRiskCodes ?? []) {
      if (!riskCodes.includes(code)) {
        row.issues.push(`missing required risk code: ${code}`)
      }
    }
    for (const code of exp.forbiddenRiskCodes ?? []) {
      if (riskCodes.includes(code)) {
        row.issues.push(`forbidden risk code present: ${code}`)
      }
    }

    // Also check gate_triggered — it's a separate field
    const gate = result?.gate_triggered?.gateCode
    if (gate) {
      for (const code of exp.forbiddenRiskCodes ?? []) {
        if (gate === code) {
          row.issues.push(`forbidden gate triggered: ${code}`)
        }
      }
    }

    const jobFamily = result?.job_signals?.jobFamily
    if (exp.requiredJobFamily && jobFamily !== exp.requiredJobFamily) {
      row.issues.push(
        `jobFamily expected '${exp.requiredJobFamily}', got '${jobFamily}'`
      )
    }
    if (exp.forbiddenJobFamily && jobFamily === exp.forbiddenJobFamily) {
      row.issues.push(`forbidden jobFamily present: ${exp.forbiddenJobFamily}`)
    }

    if (row.issues.length > 0) row.status = "FAIL"
  } catch (err: any) {
    row.status = "ERROR"
    row.issues.push(`exception: ${err?.message ?? String(err)}`)
  }

  return row
}

// ── Report ───────────────────────────────────────────────────────────────
function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n)
  return s + " ".repeat(n - s.length)
}

function printReport(rows: ResultRow[]) {
  console.log()
  console.log(
    pad("FIXTURE", 32) +
      pad("STATUS", 8) +
      pad("DECISION", 16) +
      pad("SCORE", 8) +
      "ISSUES"
  )
  console.log("-".repeat(100))
  for (const r of rows) {
    const statusColor =
      r.status === "PASS" ? "\x1b[32m" : r.status === "FAIL" ? "\x1b[31m" : "\x1b[33m"
    const reset = "\x1b[0m"
    console.log(
      pad(r.id, 32) +
        statusColor +
        pad(r.status, 8) +
        reset +
        pad(r.decision ?? "—", 16) +
        pad(String(r.score ?? "—"), 8) +
        (r.issues.length > 0 ? r.issues.join("; ") : "—")
    )
  }
  console.log()
  const pass = rows.filter((r) => r.status === "PASS").length
  const fail = rows.filter((r) => r.status === "FAIL").length
  const err = rows.filter((r) => r.status === "ERROR").length
  console.log(`Summary: ${pass} passed, ${fail} failed, ${err} errored (of ${rows.length})`)
}

// ── Baseline ─────────────────────────────────────────────────────────────
function updateBaselineFiles(rows: ResultRow[]) {
  const baselinePath = join(__dirname, "baseline.json")
  const baseline: Record<string, any> = {}
  for (const r of rows) {
    if (r.status === "ERROR") continue
    baseline[r.id] = {
      decision: r.decision,
      score: r.score,
      updatedAt: new Date().toISOString(),
    }
  }
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2))
  console.log(`\n✓ Baseline updated at ${baselinePath}`)
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  let fixtures = loadFixtures()
  if (singleFixture) {
    fixtures = fixtures.filter((f) => f.id === singleFixture)
    if (fixtures.length === 0) {
      console.error(`❌ No fixture with id '${singleFixture}'`)
      process.exit(2)
    }
  }

  if (fixtures.length === 0) {
    console.log("No fixtures found in tests/jobfit-regression/fixtures/")
    console.log("See README.md for the fixture format.")
    process.exit(0)
  }

  console.log(`Running ${fixtures.length} fixture(s) against ${API_BASE}...\n`)

  const rows: ResultRow[] = []
  for (const fx of fixtures) {
    process.stdout.write(`  ${fx.id}... `)
    const row = await runFixture(fx)
    process.stdout.write(`${row.status}\n`)
    rows.push(row)
  }

  printReport(rows)

  if (updateBaseline) updateBaselineFiles(rows)

  const failed = rows.filter((r) => r.status !== "PASS").length
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(2)
})
