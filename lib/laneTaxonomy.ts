// lib/laneTaxonomy.ts
//
// Canonical user-facing lane taxonomy for SIGNAL's targeting vocabulary.
// Source of truth for:
//   - Intake form options (Framer renders from API echo of LANES)
//   - App-layer validation (intake API, Positioning routes)
//   - JobFamily mapping (forward + reverse — used by migration + inference)
//   - Blind-read return vocabulary (Positioning Phase 3 when it ships)
//
// FRD: docs/Features/positioning-foundation-frd.md (section 4.1)
// Design ref: docs/Features/positioning-design-reference-v2.md
//
// Total: 11 lanes + Other; 49 sub-lanes. (FRD prose said "~45"; the locked
// list from the approval + label-review conversation came out to 49. The
// Technology lane's "Data Science / Engineering" was split into two distinct
// sub-lanes on label review — different career paths, different resumes.)
//
// JobFamily mapping notes (skimmer's index — JSDoc on getJobFamilyForLane
// and getLaneFromJobFamily is canonical; if this block disagrees with the
// JSDoc, trust the JSDoc):
//   - Forward (Lane.jobFamilyMapping): each lane lists JobFamily values that
//     could fall under it. Read via getJobFamilyForLane().
//   - Reverse (getLaneFromJobFamily): single-lane lookup. Edge cases:
//       * Engineering → Technology (default; software-only — non-software
//         routes to Other via migration LLM fallback)
//       * PreMed → Healthcare (migration also sets status_premed=true; see
//         runlog DD-04)
//       * Analytics → null (cross-functional — migration LLM fallback)
//       * Trades → null (out of taxonomy scope)

import type { JobFamily } from "@/app/api/jobfit/signals"

// ============================================================================
// Types
// ============================================================================

export interface SubLane {
  id: string
  label: string
  description?: string
}

export interface Lane {
  id: string
  label: string
  description?: string
  subLanes: SubLane[]
  jobFamilyMapping: JobFamily[]
}

export const STATUS_INDICATORS = ["premed", "prelaw", "pregrad"] as const
export type StatusIndicator = (typeof STATUS_INDICATORS)[number]

export const CAREER_STAGES = [
  "student",
  "early_career",
  "mid_career",
  "executive",
] as const
export type CareerStage = (typeof CAREER_STAGES)[number]

// ============================================================================
// The 11 lanes + Other
// ============================================================================

export const LANES: Lane[] = [
  {
    id: "consulting",
    label: "Consulting",
    jobFamilyMapping: ["Consulting"],
    subLanes: [
      { id: "strategy_consulting", label: "Strategy Consulting" },
      { id: "management_consulting", label: "Management Consulting" },
      { id: "technology_consulting", label: "Technology Consulting" },
      { id: "operations_consulting", label: "Operations Consulting" },
      { id: "healthcare_consulting", label: "Healthcare Consulting" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    jobFamilyMapping: ["Finance"],
    subLanes: [
      { id: "investment_banking", label: "Investment Banking" },
      { id: "private_equity_vc", label: "Private Equity / Venture Capital" },
      { id: "asset_management", label: "Asset Management / Hedge Funds" },
      { id: "corporate_finance", label: "Corporate Finance" },
      { id: "sales_trading", label: "Sales & Trading" },
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    jobFamilyMapping: ["Accounting"],
    subLanes: [
      { id: "public_accounting_audit", label: "Public Accounting / Audit" },
      { id: "tax", label: "Tax" },
      { id: "corporate_accounting", label: "Corporate Accounting" },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    jobFamilyMapping: ["Marketing"],
    subLanes: [
      { id: "brand_marketing", label: "Brand Marketing" },
      { id: "product_marketing", label: "Product Marketing" },
      { id: "performance_marketing", label: "Performance / Growth Marketing" },
      { id: "content_communications", label: "Content & Communications" },
      { id: "marketing_analytics", label: "Marketing Analytics" },
    ],
  },
  {
    id: "sales_bd",
    label: "Sales & Business Development",
    jobFamilyMapping: ["Sales"],
    subLanes: [
      { id: "enterprise_sales", label: "Enterprise Sales" },
      { id: "business_development", label: "Business Development" },
      { id: "sales_operations", label: "Sales Operations" },
      { id: "customer_success", label: "Customer Success" },
    ],
  },
  {
    id: "technology",
    label: "Technology",
    jobFamilyMapping: ["IT_Software", "Engineering"],
    subLanes: [
      { id: "software_engineering", label: "Software Engineering" },
      { id: "product_management", label: "Product Management" },
      { id: "design", label: "Design" },
      { id: "data_science", label: "Data Science" },
      { id: "data_engineering", label: "Data Engineering" },
      { id: "it_infrastructure_devops", label: "IT / Infrastructure / DevOps" },
    ],
  },
  {
    id: "operations_strategy",
    label: "Operations & Strategy",
    jobFamilyMapping: ["Operations"],
    subLanes: [
      { id: "business_operations", label: "Business Operations / Strategy" },
      { id: "supply_chain_logistics", label: "Supply Chain & Logistics" },
      { id: "program_project_management", label: "Program / Project Management" },
      { id: "operations_analytics", label: "Operations Analytics" },
    ],
  },
  {
    id: "healthcare",
    label: "Healthcare",
    jobFamilyMapping: ["Healthcare", "PreMed"],
    subLanes: [
      { id: "clinical_patient_care", label: "Clinical / Patient Care" },
      { id: "healthcare_administration", label: "Healthcare Administration" },
      { id: "life_sciences_biotech", label: "Life Sciences / Biotech" },
      { id: "healthcare_technology", label: "Healthcare Technology" },
    ],
  },
  {
    id: "people_hr",
    label: "People & HR",
    jobFamilyMapping: ["HR"],
    subLanes: [
      { id: "recruiting_talent", label: "Recruiting / Talent Acquisition" },
      { id: "hr_generalist", label: "HR Generalist" },
      { id: "compensation_benefits", label: "Compensation & Benefits" },
      { id: "learning_development", label: "Learning & Development" },
      { id: "people_analytics", label: "People Analytics" },
    ],
  },
  {
    id: "public_sector",
    label: "Public Sector & Nonprofit",
    jobFamilyMapping: ["Government"],
    subLanes: [
      { id: "government", label: "Government" },
      { id: "policy_think_tanks", label: "Policy / Think Tanks" },
      { id: "nonprofit_social_impact", label: "Nonprofit / Social Impact" },
      { id: "education_academia", label: "Education / Academia" },
    ],
  },
  {
    id: "legal",
    label: "Legal",
    jobFamilyMapping: ["Legal"],
    subLanes: [
      { id: "corporate_law", label: "Corporate Law" },
      { id: "litigation", label: "Litigation" },
      { id: "in_house_counsel", label: "In-House Counsel" },
      { id: "compliance_regulatory", label: "Compliance / Regulatory" },
    ],
  },
  {
    id: "other",
    label: "Other",
    description:
      "Use the free-text description (primary_other_description) to describe targeting.",
    jobFamilyMapping: ["Other"],
    subLanes: [],
  },
]

// ============================================================================
// Derived: LANE_IDS — used by DB CHECK constraint emission and API validation
// ============================================================================

export const LANE_IDS: readonly string[] = LANES.map((l) => l.id)

// ============================================================================
// Validation utilities
// ============================================================================

/**
 * Returns true if `id` is a valid top-level lane id (case-sensitive).
 */
export function isValidLaneId(id: string): boolean {
  return LANES.some((l) => l.id === id)
}

/**
 * Returns true if `subLaneId` is a valid sub-lane of `laneId`. Returns false
 * if either the lane is unknown, the sub-lane doesn't belong to that lane,
 * or the lane has no sub-lanes (i.e., 'other').
 *
 * Callers handling 'other' lane should check `laneId === 'other'` and route
 * to primary_other_description instead of calling this.
 */
export function isValidSubLaneId(laneId: string, subLaneId: string): boolean {
  const lane = LANES.find((l) => l.id === laneId)
  if (!lane) return false
  return lane.subLanes.some((s) => s.id === subLaneId)
}

/**
 * Returns the array of JobFamily values that this lane's mapping includes.
 * Empty array if `laneId` is unknown.
 *
 * Forward mapping: Lane → JobFamily[]. Used by JobFit and Positioning when
 * they know the candidate's lane and want to predict relevant JobFamily
 * classifications for the JD.
 */
export function getJobFamilyForLane(laneId: string): JobFamily[] {
  const lane = LANES.find((l) => l.id === laneId)
  return lane?.jobFamilyMapping ?? []
}

/**
 * Returns the first Lane whose jobFamilyMapping contains `family`, or null
 * if no lane claims it.
 *
 * Reverse mapping: JobFamily → Lane. Used by the migration script to infer a
 * legacy user's lane from their most recent JobFit's detected family.
 *
 * Known caveats (handled by the migration script, not here — keep this
 * function a pure lookup):
 *   - JobFamily.Engineering returns the Technology lane as the default
 *     mapping. This is correct only for software-adjacent Engineering
 *     (software, ML engineering, infrastructure). The migration script's
 *     LLM fallback handles non-software disciplines (Mechanical, Civil,
 *     Biomedical, Industrial, etc.), typically routing them to Other based
 *     on JD and resume signals.
 *   - JobFamily.PreMed returns the Healthcare lane. The migration script
 *     MUST also set status_premed=true on the targeting row. This dual-write
 *     pattern keeps the taxonomy stateless (returns a lane, period) and the
 *     migration script responsible for translation side effects. See runlog
 *     DD-04 for the architectural reasoning.
 *   - JobFamily.Analytics returns null (intentionally unmapped). Migration
 *     script falls back to LLM.
 *   - JobFamily.Trades returns null (out of taxonomy scope).
 */
export function getLaneFromJobFamily(family: JobFamily): Lane | null {
  return LANES.find((l) => l.jobFamilyMapping.includes(family)) ?? null
}
