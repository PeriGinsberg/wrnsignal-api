// jobfit/testSuite.ts

import assert from "assert"
import { evaluateJobFit } from "./evaluator"
import { RiskCode, WhyCode, StructuredProfileSignals } from "./signals"

type ProfileFixture = {
  id: string
  overrides: Partial<StructuredProfileSignals>
}

type JobFixture = {
  id: string
  text: string
}

type TestCase = {
  name: string
  profileId: string
  jobId: string
  expectedDecision: "Apply" | "Review" | "Pass"
  expectedRiskCodes?: RiskCode[]
  expectedWhyCodes?: WhyCode[]
  expectedScoreRange?: [number, number]
}

const PROFILES: ProfileFixture[] = [
  {
    id: "marketing_general",
    overrides: {
      targetFamilies: ["Marketing"],
      tools: ["Google Analytics", "Excel", "HubSpot"],
      gradYear: 2027,
      yearsExperienceApprox: 1,
      locationPreference: { mode: "hybrid", constrained: false },
      constraints: {
        hardNoSales: true,
        hardNoGovernment: true,
        hardNoContract: false,
        hardNoHourlyPay: false,
        hardNoFullyRemote: false,
        prefFullTime: true,
        preferNotAnalyticsHeavy: true,
      },
    },
  },
  {
    id: "analytics_focused",
    overrides: {
      targetFamilies: ["Analytics"],
      tools: ["SQL", "Python", "Tableau", "Excel"],
      gradYear: 2026,
      yearsExperienceApprox: 1,
      locationPreference: { mode: "remote", constrained: false },
      constraints: {
        hardNoSales: true,
        hardNoGovernment: false,
        hardNoContract: false,
        hardNoHourlyPay: false,
        hardNoFullyRemote: false,
        prefFullTime: true,
        preferNotAnalyticsHeavy: false,
      },
    },
  },
  {
    id: "no_sales_no_remote_constrained",
    overrides: {
      targetFamilies: ["Finance", "Accounting"],
      tools: ["Excel"],
      gradYear: 2028,
      yearsExperienceApprox: 0,
      locationPreference: { mode: "onsite", constrained: true },
      constraints: {
        hardNoSales: true,
        hardNoGovernment: true,
        hardNoContract: true,
        hardNoHourlyPay: false,
        hardNoFullyRemote: true,
        prefFullTime: true,
        preferNotAnalyticsHeavy: false,
      },
    },
  },
]

const JOBS: JobFixture[] = [
  {
    id: "marketing_email_exec",
    text: `
      Marketing Internship. Execute email campaigns, build content calendars, support lifecycle marketing.
      Preferred: HubSpot, GA4. Light reporting on weekly performance metrics. Hybrid.
    `,
  },
  {
    id: "marketing_analytics_heavy",
    text: `
      Growth Analyst. Own dashboards and KPI ownership. SQL required. A/B experiment design.
      Build models and forecasting. Remote.
    `,
  },
  {
    id: "sales_quota_role",
    text: `
      Business Development Rep. Cold calling, pipeline generation, quota, commission.
      Must be comfortable closing and working against targets.
    `,
  },
  {
    id: "gov_clearance",
    text: `
      Analyst supporting federal client. Clearance required. Public sector work. On-site.
    `,
  },
  {
    id: "mba_required_role",
    text: `
      Associate. MBA required. 3+ years of experience required.
    `,
  },
  {
    id: "grad_screen_classof",
    text: `
      Internship. Only Class of 2025 candidates will be considered.
    `,
  },
]

const TESTS: TestCase[] = [
  {
    name: "Marketing execution role should Apply for marketing profile",
    profileId: "marketing_general",
    jobId: "marketing_email_exec",
    expectedDecision: "Apply",
    expectedWhyCodes: ["WHY_FAMILY_MATCH", "WHY_MARKETING_EXECUTION"],
    expectedRiskCodes: ["RISK_REPORTING_SIGNALS"],
    expectedScoreRange: [78, 97],
  },
  {
    name: "Analytics-heavy role should Pass for marketing profile that prefers not analytics heavy (gate)",
    profileId: "marketing_general",
    jobId: "marketing_analytics_heavy",
    expectedDecision: "Pass",
  },
  {
    name: "Sales role should Pass for hard-no-sales profile (gate)",
    profileId: "marketing_general",
    jobId: "sales_quota_role",
    expectedDecision: "Pass",
  },
  {
    name: "Government role should Pass for hard-no-government profile (gate)",
    profileId: "marketing_general",
    jobId: "gov_clearance",
    expectedDecision: "Pass",
  },
  {
    name: "MBA required should Pass always (gate)",
    profileId: "analytics_focused",
    jobId: "mba_required_role",
    expectedDecision: "Pass",
  },
  {
    name: "Grad screen mismatch should Pass for far-off grad year (gate)",
    profileId: "no_sales_no_remote_constrained",
    jobId: "grad_screen_classof",
    expectedDecision: "Pass",
  },
]

function getProfile(id: string): ProfileFixture {
  const p = PROFILES.find((x) => x.id === id)
  if (!p) throw new Error(`Missing profile fixture: ${id}`)
  return p
}

function getJob(id: string): JobFixture {
  const j = JOBS.find((x) => x.id === id)
  if (!j) throw new Error(`Missing job fixture: ${id}`)
  return j
}

function subset<T>(needles: T[] | undefined, hay: T[]): boolean {
  if (!needles || needles.length === 0) return true
  return needles.every((n) => hay.includes(n))
}

export function runJobFitTestSuite(): { passed: number; failed: number } {
  let passed = 0
  let failed = 0

  for (const tc of TESTS) {
    try {
      const profile = getProfile(tc.profileId)
      const job = getJob(tc.jobId)

      // Determinism check
      const outputs = Array.from({ length: 5 }).map(() =>
        evaluateJobFit({ jobText: job.text, profileOverrides: profile.overrides })
      )

      for (let i = 1; i < outputs.length; i++) {
        assert.deepStrictEqual(outputs[i], outputs[0], "Non-deterministic output drift detected")
      }

      const out = outputs[0]

      assert.strictEqual(out.decision, tc.expectedDecision, "Decision mismatch")

      assert.ok(subset(tc.expectedRiskCodes, out.risk_codes), "Expected risk codes missing")
      assert.ok(subset(tc.expectedWhyCodes, out.why_codes), "Expected why codes missing")

      if (tc.expectedScoreRange) {
        const [lo, hi] = tc.expectedScoreRange
        assert.ok(out.score >= lo && out.score <= hi, `Score out of expected range: ${out.score}`)
      }

      // Presentation rules
      assert.strictEqual(new Set(out.bullets).size, out.bullets.length, "Duplicate WHY bullets")
      assert.strictEqual(new Set(out.risk_flags).size, out.risk_flags.length, "Duplicate RISK bullets")
      if (out.decision === "Pass") {
        assert.ok(out.risk_flags.length === 0, "Pass should not show risk flags")
        assert.ok(out.why_codes.length === 0, "Pass should not show why codes")
      }

      passed++
    } catch (e: any) {
      failed++
      // eslint-disable-next-line no-console
      console.error(`[FAIL] ${tc.name}: ${e.message}`)
    }
  }

  // eslint-disable-next-line no-console
  console.log(`JobFit Test Suite: ${passed} passed, ${failed} failed`)
  return { passed, failed }
}

// If you want to run directly via node/ts-node:
// runJobFitTestSuite()