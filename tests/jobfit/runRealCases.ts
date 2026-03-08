import fs from "fs"
import path from "path"

import { extractJobSignals, extractProfileSignals } from "../../app/api/jobfit/extract"
import { evaluateGates } from "../../app/api/jobfit/constraints"
import { scoreJobFit } from "../../app/api/jobfit/scoring"
import { decisionFromScore, applyGateOverrides, applyRiskDowngrades } from "../../app/api/jobfit/decision"
import { renderBulletsV4 } from "../../app/api/jobfit/deterministicBulletRendererV4"
import type {
  EvalOutput,
  JobFamily,
  LocationConstraint,
  LocationMode,
} from "../../app/api/jobfit/signals"

type RealCase = {
  id: string
  label: string
  profileText: string
  jobText: string
  profileOverrides?: {
    targetFamilies?: JobFamily[]
    locationPreference?: {
      constrained?: boolean
      mode?: LocationMode
      allowedCities?: string[]
    }
    constraints?: {
      hardNoHourlyPay?: boolean
      prefFullTime?: boolean
      hardNoContract?: boolean
      hardNoSales?: boolean
      hardNoGovernment?: boolean
      hardNoFullyRemote?: boolean
      preferNotAnalyticsHeavy?: boolean
    }
    tools?: string[]
    gradYear?: number | null
    yearsExperienceApprox?: number | null
  }
  metadata?: {
    profile_id?: string
    job_id?: string
    job_label?: string
    expected_direction?: string
  }
}

type ResultRow = {
  id: string
  label: string
  profile_id: string
  job_id: string
  job_label: string
  expected_direction: string
  score: number
  penaltySum: number
  decision_initial: string
  decision_after_gate: string
  decision_final: string
  gate_type: string
  gate_code: string
  gate_detail: string
  why_code_list: string
  risk_code_list: string
  rendered_why_bullets: string[]
  rendered_risk_bullets: string[]
  why_bullet_count: number
  risk_bullet_count: number
  why_bullets_joined: string
  risk_bullets_joined: string
  job_family: string
  job_location_mode: string
  job_location_city: string
  profile_location_mode: string
  profile_location_constrained: string
}

const repoRoot = process.cwd()
const casesDir = path.join(repoRoot, "tests", "jobfit", "real_cases")
const resultsDir = path.join(repoRoot, "tests", "jobfit", "results")
const jsonOut = path.join(resultsDir, "real_case_results.json")
const csvOut = path.join(resultsDir, "real_case_results.csv")

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "")
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toCodeList(items: Array<{ code: string }> | undefined): string {
  if (!Array.isArray(items) || items.length === 0) return ""
  return items.map((x) => x.code).join("|")
}

function readCases(): RealCase[] {
  if (!fs.existsSync(casesDir)) {
    throw new Error(`Missing real cases directory: ${casesDir}`)
  }

  const files = fs
    .readdirSync(casesDir)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))

  return files.map((file) => {
    const fullPath = path.join(casesDir, file)
    const raw = fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "")
    return JSON.parse(raw) as RealCase
  })
}

function main() {
  ensureDir(resultsDir)

  const cases = readCases()
  const fullResults: any[] = []
  const csvRows: ResultRow[] = []

  for (const c of cases) {
    const jobSignals = extractJobSignals(c.jobText || "")
    const profileSignals = extractProfileSignals(c.profileText || "", (c.profileOverrides || {}) as any)

    const gate = evaluateGates(jobSignals, profileSignals)
    const scoreResult = scoreJobFit(jobSignals, profileSignals)

    const decisionInitial = decisionFromScore(scoreResult.score)
    const decisionAfterGate = applyGateOverrides(decisionInitial, gate)
    const decisionFinal = applyRiskDowngrades(decisionAfterGate, scoreResult.penaltySum)

    const fullResult = {
      id: c.id,
      label: c.label,
      metadata: c.metadata || {},
      decision_initial: decisionInitial,
      decision_after_gate: decisionAfterGate,
      decision_final: decisionFinal,
      score: scoreResult.score,
      penaltySum: scoreResult.penaltySum,
      gate_triggered: gate,
      why_codes: scoreResult.whyCodes,
      risk_codes: scoreResult.riskCodes,
      job_signals: jobSignals,
      profile_signals: profileSignals,
    }

    const renderInput: EvalOutput = {
      decision: decisionFinal,
      score: scoreResult.score,
      bullets: [],
      risk_flags: [],
      next_step: "",
      location_constraint: (
        profileSignals.locationPreference?.constrained ? "constrained" : "not_constrained"
      ) as LocationConstraint,
      why_codes: scoreResult.whyCodes,
      risk_codes: scoreResult.riskCodes,
      gate_triggered: gate,
      job_signals: jobSignals,
      profile_signals: profileSignals,
    }

    const rendered = renderBulletsV4(renderInput)

    const fullResultWithRendered = {
      ...fullResult,
      rendered_why_bullets: rendered.why,
      rendered_risk_bullets: rendered.risk,
      renderer_debug: rendered.renderer_debug,
      why_bullet_count: rendered.why.length,
      risk_bullet_count: rendered.risk.length,
      why_bullets_joined: rendered.why.join(" | "),
      risk_bullets_joined: rendered.risk.join(" | "),
    }

    fullResults.push(fullResultWithRendered)

    csvRows.push({
      id: c.id,
      label: c.label,
      profile_id: c.metadata?.profile_id ?? "",
      job_id: c.metadata?.job_id ?? "",
      job_label: c.metadata?.job_label ?? "",
      expected_direction: c.metadata?.expected_direction ?? "",
      score: scoreResult.score,
      penaltySum: scoreResult.penaltySum,
      decision_initial: decisionInitial,
      decision_after_gate: decisionAfterGate,
      decision_final: decisionFinal,
      gate_type: gate?.type ?? "",
      gate_code: "gateCode" in gate ? gate.gateCode : "",
      gate_detail: "detail" in gate ? gate.detail : "",
      why_code_list: toCodeList(scoreResult.whyCodes),
      risk_code_list: toCodeList(scoreResult.riskCodes),
      rendered_why_bullets: rendered.why,
      rendered_risk_bullets: rendered.risk,
      why_bullet_count: rendered.why.length,
      risk_bullet_count: rendered.risk.length,
      why_bullets_joined: rendered.why.join(" | "),
      risk_bullets_joined: rendered.risk.join(" | "),
      job_family: jobSignals?.jobFamily ?? "",
      job_location_mode: jobSignals?.location?.mode ?? "",
      job_location_city: jobSignals?.location?.city ?? "",
      profile_location_mode: profileSignals?.locationPreference?.mode ?? "",
      profile_location_constrained: String(Boolean(profileSignals?.locationPreference?.constrained)),
    })
  }

  fs.writeFileSync(jsonOut, JSON.stringify(fullResults, null, 2), "utf8")

  const headers = [
    "id",
    "label",
    "profile_id",
    "job_id",
    "job_label",
    "expected_direction",
    "score",
    "penaltySum",
    "decision_initial",
    "decision_after_gate",
    "decision_final",
    "gate_type",
    "gate_code",
    "gate_detail",
    "why_code_list",
    "risk_code_list",
    "rendered_why_bullets",
    "rendered_risk_bullets",
    "why_bullet_count",
    "risk_bullet_count",
    "why_bullets_joined",
    "risk_bullets_joined",
    "job_family",
    "job_location_mode",
    "job_location_city",
    "profile_location_mode",
    "profile_location_constrained",
  ]

  const lines = [
    headers.join(","),
    ...csvRows.map((r) =>
      [
        r.id,
        r.label,
        r.profile_id,
        r.job_id,
        r.job_label,
        r.expected_direction,
        r.score,
        r.penaltySum,
        r.decision_initial,
        r.decision_after_gate,
        r.decision_final,
        r.gate_type,
        r.gate_code,
        r.gate_detail,
        r.why_code_list,
        r.risk_code_list,
        r.rendered_why_bullets.join(" | "),
        r.rendered_risk_bullets.join(" | "),
        r.why_bullet_count,
        r.risk_bullet_count,
        r.why_bullets_joined,
        r.risk_bullets_joined,
        r.job_family,
        r.job_location_mode,
        r.job_location_city,
        r.profile_location_mode,
        r.profile_location_constrained,
      ]
        .map(csvEscape)
        .join(",")
    ),
  ]

  fs.writeFileSync(csvOut, lines.join("\n"), "utf8")

  console.log(`Ran ${cases.length} real case(s).`)
  for (const row of csvRows) {
    console.log(
      `${row.id} | score=${row.score} | final=${row.decision_final} | gate=${row.gate_type || "none"}`
    )
  }
  console.log(`JSON written to: ${jsonOut}`)
  console.log(`CSV written to: ${csvOut}`)
}

main()
