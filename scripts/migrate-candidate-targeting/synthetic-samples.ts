// scripts/migrate-candidate-targeting/synthetic-samples.ts
//
// Eight synthetic candidate profiles for testing the inference prompt before
// running migration on real dev data. Each case carries:
//   - input: what gets sent to the LLM
//   - expected: our hypothesis for what the LLM SHOULD return
//   - testing: the specific failure mode or edge case this surfaces
//
// When the LLM actually runs, mismatches between expected and actual flag
// either a prompt issue or an expectation issue. Both are useful signals.

import type { InferenceInput, InferenceOutput } from "./inference-prompt"

/**
 * Hypothesis for the LLM's output on a synthetic case.
 *
 * `sublaneMode` controls how strict the runner is about the sub-lane:
 *   - "specific" (default) — actual sub-lane must equal expected.sublane
 *   - "any-within-lane"    — actual sub-lane must belong to expected.lane
 *     (any of its sub-lanes is OK). The expected.sublane string is then
 *     illustrative — what we'd guess if forced — but not a mismatch trigger.
 *     Use this when input genuinely doesn't disambiguate sub-lane.
 *
 * `reasoning` is not predicted — the LLM's reasoning string is logged for
 * debugging only.
 */
export type SyntheticExpected = Omit<InferenceOutput, "reasoning"> & {
  sublaneMode?: "specific" | "any-within-lane"
  /**
   * Optional list of acceptable lanes (lane match passes if actual ∈ this
   * list). When set, expected.lane is illustrative — used as the primary
   * hypothesis but the runner accepts any value in the list. Sub-lane
   * "any-within-lane" mode then checks against the ACTUAL lane (since the
   * LLM had multiple valid lane choices). Use when input genuinely doesn't
   * disambiguate lane.
   */
  acceptableLanes?: string[]
}

export type SyntheticCase = {
  id: number
  label: string
  testing: string
  input: InferenceInput
  expected: SyntheticExpected
}

export const SYNTHETIC_SAMPLES: SyntheticCase[] = [
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 1,
    label: "Clear consulting + JobFamily match",
    testing:
      "Deterministic baseline — the cleanest possible signal. If this doesn't land high-confidence, there's a fundamental prompt issue. Sanity check on the happy path.",
    input: {
      targetRoles: "Strategy Consulting Associate at MBB firms",
      currentStatus: "Recent graduate",
      jobFamily: "Consulting",
      resumeSnippet: "",
    },
    expected: {
      lane: "consulting",
      sublane: "strategy_consulting",
      primary_other_description: null,
      confidence: "high",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: 2,
    label: "Ambiguous 'business roles' + no JobFamily + resume snippet",
    testing:
      "Tests the anti-Other-as-soft-default rule. This is the EXACT example baked into the prompt. The LLM should pick operations_strategy/business_operations with LOW confidence rather than escaping to 'other'. If it returns 'other', the anti-soft-default reinforcement isn't strong enough — consolidate the two stacked instructions per Peri's observation.",
    input: {
      targetRoles: "business roles",
      currentStatus: "Working professional",
      jobFamily: null,
      resumeSnippet:
        "5 years of cross-functional experience in operations and analytics across two companies.",
    },
    expected: {
      lane: "operations_strategy",
      sublane: "business_operations",
      primary_other_description: null,
      confidence: "low",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: 3,
    label: "PreMed (DD-04 dual-write trigger)",
    testing:
      "Confirms the LLM maps PreMed candidates to the healthcare lane. The status_premed=true side-effect is the migration script's responsibility (DD-04 locked pattern) — the LLM just returns the lane mapping. None of the four healthcare sub-lanes cleanly fits a pre-med student (clinical_patient_care is for working clinicians; life_sciences_biotech is industry; etc.), so sub-lane is genuinely uncertain — confidence should be 'medium' per the relaxed scale. If the LLM returns 'high', that's a false-confidence failure mode worth flagging.",
    input: {
      targetRoles:
        "Medical school preparation, hospital volunteering, clinical exposure",
      currentStatus: "Current student",
      jobFamily: "PreMed",
      resumeSnippet: "",
    },
    expected: {
      lane: "healthcare",
      // Illustrative pick — any healthcare sub-lane is acceptable per
      // sublaneMode below. clinical_patient_care is most likely given the
      // "hospital volunteering" signal.
      sublane: "clinical_patient_care",
      sublaneMode: "any-within-lane",
      primary_other_description: null,
      confidence: "medium",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: 4,
    label: "Disagreement: target_roles=marketing, JobFamily=Consulting",
    testing:
      "Tests source priority when JobFit's auto-detected family disagrees with user-stated target_roles. User-stated targeting (marketing) should beat JobFit's auto-classification (Consulting) — the user's explicit choice is the stronger signal. Sub-lane choice between brand_marketing and product_marketing is genuinely ambiguous → medium confidence.",
    input: {
      targetRoles: "Brand Marketing, Product Marketing roles",
      currentStatus: "Recent graduate",
      jobFamily: "Consulting",
      resumeSnippet: "",
    },
    expected: {
      lane: "marketing",
      // Sub-lane ambiguous across all five marketing sub-lanes. Test is
      // lane-match + confidence; any valid marketing sub-lane is acceptable.
      sublane: "brand_marketing",
      sublaneMode: "any-within-lane",
      primary_other_description: null,
      confidence: "medium",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: 5,
    label: "Likely-Other: research + entrepreneurship",
    testing:
      "Tests legitimate Other usage. Independent research + startup founder + academic-industry crossover doesn't cleanly map to any of the 11 lanes. The LLM should resist force-fitting into operations_strategy/business_operations or public_sector/policy_think_tanks and choose 'other' with a faithful description. Confidence medium because the LLM might be uncertain whether to force-fit; high if it commits.",
    input: {
      targetRoles:
        "Independent research, startup founder roles, academic-industry crossover",
      currentStatus: "Career pivot",
      jobFamily: null,
      resumeSnippet: "",
    },
    expected: {
      lane: "other",
      sublane: null,
      primary_other_description:
        "Independent research and startup founder roles spanning academic-industry crossover",
      confidence: "medium",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: 6,
    label: "Non-software engineering (DD-02 caveat)",
    testing:
      "Tests the engineering caveat. JobFamily=Engineering would default-map to Technology, but mechanical/civil/biomedical/etc. don't belong there. The prompt has an exact worked example for this case → confidence should be high. If the LLM picks Technology, the engineering caveat isn't strong enough.",
    input: {
      targetRoles: "Mechanical engineer, automotive systems",
      currentStatus: "Working professional",
      jobFamily: "Engineering",
      resumeSnippet:
        "BS Mechanical Engineering, 4 years at automotive supplier on powertrain systems.",
    },
    expected: {
      lane: "other",
      sublane: null,
      primary_other_description: "Mechanical engineer (non-software, automotive systems)",
      confidence: "high",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: 7,
    label: "Empty target_roles + empty current_status + JobFamily present",
    testing:
      "Tests inference from JobFamily alone when intake is minimal. Mirrors the case of a legacy user who completed intake before target_roles was required and only has a JobFit run as signal. Lane is unambiguous (Finance → finance) but sub-lane is a guess — corporate_finance is the most generic default. Per relaxed confidence definitions, sparse input + sub-lane uncertainty = medium or low. Hypothesis = low.",
    input: {
      targetRoles: "",
      currentStatus: "",
      jobFamily: "Finance",
      resumeSnippet: "",
    },
    expected: {
      lane: "finance",
      // Sub-lane essentially arbitrary among the five finance sub-lanes
      // with no input beyond JobFamily=Finance. Any valid finance sub-lane
      // is acceptable. corporate_finance is the most generic illustrative
      // guess.
      sublane: "corporate_finance",
      sublaneMode: "any-within-lane",
      primary_other_description: null,
      confidence: "low",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: 8,
    label: "Sprawling target_roles spanning multiple lanes",
    testing:
      "Tests single-primary-lane enforcement when the user hasn't decided. Three lanes mentioned: technology (PM), consulting (strategy), finance (IB). The 'BEST single lane' rule plus order-of-mention should push the LLM to technology/product_management (first mentioned). Low confidence because the user is genuinely undecided. If the LLM picks finance/investment_banking on the basis that 'IB' is the most specific role, that's also defensible — flag as expectation mismatch but not necessarily prompt failure.",
    input: {
      targetRoles:
        "interested in PM at tech, consulting if better fit, possibly investment banking",
      currentStatus: "Recent graduate",
      jobFamily: null,
      resumeSnippet: "",
    },
    expected: {
      lane: "technology",
      // Three lanes are mentioned in target_roles with hedging — any of them
      // with low confidence is acceptable per Peri's calibration call.
      acceptableLanes: ["technology", "consulting", "finance"],
      sublane: "product_management",
      sublaneMode: "any-within-lane",
      primary_other_description: null,
      confidence: "low",
    },
  },
]
