// app/api/jobfit/jdExtractionPrompt.ts
//
// The methodology-bearing artifact for Stage-1 JD-side LLM extraction: the
// output schema, the canonical key vocabulary, and the Opus 4.8 prompt.
//
// Shadow mode: nothing in the scoring path consumes this. The extractor
// (extractJobSignalsLLM, built after prompt review) and the shadow runner call
// it; the agreement report compares its output against regex extractJobSignals.

import type {
  JobFamily,
  FinanceSubFamily,
  SalesSubFamily,
  LocationMode,
  RoleArchetype,
  DegreeRequirement,
} from "./signals"

// ── Canonical capability vocabulary (39 keys, empirical from the 696-case corpus)
// The LLM picks canonical_key from these (+ "tool" + "other"). Tools are an open
// vocabulary carried separately in tool_name.
export const CANONICAL_CAPABILITY_KEYS = [
  "analysis_reporting",
  "communications_writing",
  "drafting_documentation",
  "operations_execution",
  "brand_messaging",
  "prospecting_pipeline_management",
  "content_execution",
  "financial_analysis",
  "stakeholder_coordination",
  "accounting_operations",
  "consumer_research",
  "software_engineering",
  "customer_service_guest_experience",
  "crm_usage",
  "policy_regulatory_research",
  "coaching_instruction_facilitation",
  "post_sale_support",
  "strategy_problem_solving",
  "account_management",
  "client_commercial_work",
  "performance_optimization",
  "visual_communication",
  "product_positioning",
  "clinical_stakeholder_fluency",
  "clinical_patient_work",
  "territory_execution",
  "product_training_enablement",
  "hospital_or_environment",
  "event_operations_live_execution",
  "med_device_industry_knowledge",
  "chemical_engineering",
  "electrical_engineering",
  "mechanical_engineering",
  "structural_engineering",
  "civil_engineering",
  "nursing_clinical",
  "trades_construction",
  "laboratory_research",
  "bilingual_language",
] as const

export type CanonicalCapabilityKey = (typeof CANONICAL_CAPABILITY_KEYS)[number]
export type CanonicalKey = CanonicalCapabilityKey | "tool" | "other"
export type UnitKind =
  | "function"
  | "execution"
  | "tool"
  | "deliverable"
  | "stakeholder"
  | "domain"
  | "environment"

// One-line glosses shown to the LLM so it maps to the same buckets the regex
// extractor uses (agreement depends on shared semantics, not just shared keys).
export const CAPABILITY_KEY_GLOSSES: Record<CanonicalCapabilityKey, string> = {
  analysis_reporting: "analyzing data and producing reports, metrics, or measurement",
  communications_writing: "written/verbal communication and messaging",
  drafting_documentation: "drafting documents, memos, written deliverables",
  operations_execution: "day-to-day operations, process, and workflow execution",
  brand_messaging: "brand, campaign, and positioning/messaging work",
  prospecting_pipeline_management: "outreach, prospecting, and sales pipeline management",
  content_execution: "content creation, social media, and campaign execution",
  financial_analysis: "financial modeling, valuation, and investment analysis",
  stakeholder_coordination: "coordinating across people, teams, and priorities",
  accounting_operations: "accounting, reconciliation, and financial operations",
  consumer_research: "market, user, or consumer research",
  software_engineering: "software development / engineering",
  customer_service_guest_experience: "customer- or guest-facing service",
  crm_usage: "using CRM systems (Salesforce, HubSpot) to track customers/pipeline",
  policy_regulatory_research: "policy, regulatory, legal, or compliance research",
  coaching_instruction_facilitation: "coaching, instruction, training, or facilitation",
  post_sale_support: "post-sale support, onboarding, implementation, renewals",
  strategy_problem_solving: "strategy, synthesis, and structured problem-solving",
  account_management: "managing accounts or a book of business",
  client_commercial_work: "client-facing commercial / relationship work",
  performance_optimization: "performance optimization, A/B testing, scaling",
  visual_communication: "visual / graphic design (Adobe, Figma, Canva)",
  product_positioning: "product marketing and positioning",
  clinical_stakeholder_fluency: "working with physicians / clinical staff",
  clinical_patient_work: "hands-on patient-facing clinical work",
  territory_execution: "field sales / territory coverage",
  product_training_enablement: "product training, demos, in-services",
  hospital_or_environment: "operating-room / hospital / surgical environment exposure",
  event_operations_live_execution: "live event or game-day operations",
  med_device_industry_knowledge: "medical-device industry / product knowledge",
  chemical_engineering: "chemical engineering discipline",
  electrical_engineering: "electrical engineering discipline",
  mechanical_engineering: "mechanical engineering discipline",
  structural_engineering: "structural engineering discipline",
  civil_engineering: "civil engineering discipline",
  nursing_clinical: "nursing / licensed clinical work",
  trades_construction: "skilled trades / construction",
  laboratory_research: "hands-on wet-lab / bench work: cell culture, aseptic technique, assays, PCR/molecular biology, microbiology, reagent prep, lab instrumentation",
  bilingual_language: "second-language fluency as a job requirement (e.g. bilingual English/Spanish, fluent in Mandarin)",
}

// ── Output types ──────────────────────────────────────────────────────────────

export type LLMRequirementUnit = {
  canonical_key: CanonicalKey
  tool_name: string | null // set iff canonical_key === "tool"; else null
  kind: UnitKind
  requiredness: "core" | "supporting"
  strength: number // 1-10
  functionTag: string | null
  label: string
  requirement_text: string // verbatim span from the JD (auditable)
}

export type LLMJobScalars = {
  jobFamily: JobFamily
  financeSubFamily: FinanceSubFamily // union already includes null
  salesSubFamily: SalesSubFamily // union already includes null
  jobArchetype: RoleArchetype
  jobIndustry: string | null
  detectedDomain: string | null
  analytics: { isHeavy: boolean }
  location: { mode: LocationMode; constrained: boolean; city: string | null }
  yearsRequired: number | null
  gradYearHint: number | null
  isGovernment: boolean
  isSalesHeavy: boolean
  isContract: boolean
  isHourly: boolean
  isPartTime: boolean // NEW vs regex — revives GATE_PARTTIME_MISMATCH (approved)
  isSeniorRole: boolean
  isTrainingProgram: boolean
  isContentExecutionHeavy: boolean
  degrees: DegreeRequirement[]
  credentialRequired: boolean
  credentialDetail: string | null
  credentialSponsored: boolean
  requiresAdvisoryBackground: boolean
  requiresFinancialModeling: boolean
  requiresDomainIndustryExperience: boolean
  requiresSoftCredential: boolean
  softCredentialDetail: string | null
  mentionsPharmaTraining: boolean
  territoryUndisclosed: boolean
  requiredTools: string[]
  preferredTools: string[]
  function_tags: string[]
}

export type LLMJobExtraction = {
  requirement_units: LLMRequirementUnit[]
  scalars: LLMJobScalars
}

// ── Structured-output JSON schema (output_config.format json_schema) ──────────
// enum-constrains canonical_key, kind, requiredness, strength, and the
// categorical scalars at the API layer so the model cannot emit off-vocabulary
// keys. Numeric ranges aren't expressible in structured-output schemas, so
// strength is an integer enum and years/gradYear are validated client-side.
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["requirement_units", "scalars"],
  properties: {
    requirement_units: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "canonical_key",
          "tool_name",
          "kind",
          "requiredness",
          "strength",
          "functionTag",
          "label",
          "requirement_text",
        ],
        properties: {
          canonical_key: { enum: [...CANONICAL_CAPABILITY_KEYS, "tool", "other"] },
          tool_name: { anyOf: [{ type: "string" }, { type: "null" }] },
          kind: {
            enum: ["function", "execution", "tool", "deliverable", "stakeholder", "domain", "environment"],
          },
          requiredness: { enum: ["core", "supporting"] },
          strength: { enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
          functionTag: { anyOf: [{ type: "string" }, { type: "null" }] },
          label: { type: "string" },
          requirement_text: { type: "string" },
        },
      },
    },
    scalars: {
      type: "object",
      additionalProperties: false,
      required: [
        "jobFamily", "financeSubFamily", "salesSubFamily", "jobArchetype", "jobIndustry",
        "detectedDomain", "analytics", "location", "yearsRequired", "gradYearHint",
        "isGovernment", "isSalesHeavy", "isContract", "isHourly", "isPartTime",
        "isSeniorRole", "isTrainingProgram", "isContentExecutionHeavy", "degrees",
        "credentialRequired", "credentialDetail", "credentialSponsored",
        "requiresAdvisoryBackground", "requiresFinancialModeling", "requiresDomainIndustryExperience",
        "requiresSoftCredential", "softCredentialDetail", "mentionsPharmaTraining",
        "territoryUndisclosed", "requiredTools", "preferredTools", "function_tags",
      ],
      properties: {
        jobFamily: {
          enum: ["Consulting", "Marketing", "Finance", "Accounting", "Analytics", "Sales",
            "Operations", "HR", "Government", "PreMed", "Engineering", "IT_Software",
            "ProductManagement", "Healthcare", "LifeSciences", "Legal", "Trades", "Other"],
        },
        financeSubFamily: { enum: ["ib", "fpa", "credit", "project_finance", "asset_management", "other_finance", null] },
        salesSubFamily: {
          enum: ["medical_device", "pharmaceutical", "saas_tech", "industrial_b2b", "advertising_media",
            "financial_services", "real_estate", "retail_consumer", "other_sales", null],
        },
        jobArchetype: { enum: ["analytical", "strategic", "execution", "mixed", "unclear"] },
        jobIndustry: { anyOf: [{ type: "string" }, { type: "null" }] },
        detectedDomain: { anyOf: [{ type: "string" }, { type: "null" }] },
        analytics: {
          type: "object", additionalProperties: false, required: ["isHeavy"],
          properties: { isHeavy: { type: "boolean" } },
        },
        location: {
          type: "object", additionalProperties: false, required: ["mode", "constrained", "city"],
          properties: {
            mode: { enum: ["in_person", "hybrid", "remote", "unclear"] },
            constrained: { type: "boolean" },
            city: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
        },
        yearsRequired: { anyOf: [{ type: "integer" }, { type: "null" }] },
        gradYearHint: { anyOf: [{ type: "integer" }, { type: "null" }] },
        isGovernment: { type: "boolean" },
        isSalesHeavy: { type: "boolean" },
        isContract: { type: "boolean" },
        isHourly: { type: "boolean" },
        isPartTime: { type: "boolean" },
        isSeniorRole: { type: "boolean" },
        isTrainingProgram: { type: "boolean" },
        isContentExecutionHeavy: { type: "boolean" },
        degrees: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["level", "requiredness", "field", "field_kind"],
            properties: {
              level: { enum: ["associate", "bachelor", "master", "mba", "phd"] },
              requiredness: { enum: ["required", "preferred"] },
              field: { anyOf: [{ type: "string" }, { type: "null" }] },
              field_kind: { enum: ["licensure_floor", "directional", "none"] },
            },
          },
        },
        credentialRequired: { type: "boolean" },
        credentialDetail: { anyOf: [{ type: "string" }, { type: "null" }] },
        credentialSponsored: { type: "boolean" },
        requiresAdvisoryBackground: { type: "boolean" },
        requiresFinancialModeling: { type: "boolean" },
        requiresDomainIndustryExperience: { type: "boolean" },
        requiresSoftCredential: { type: "boolean" },
        softCredentialDetail: { anyOf: [{ type: "string" }, { type: "null" }] },
        mentionsPharmaTraining: { type: "boolean" },
        territoryUndisclosed: { type: "boolean" },
        requiredTools: { type: "array", items: { type: "string" } },
        preferredTools: { type: "array", items: { type: "string" } },
        function_tags: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const

// ── The prompt ────────────────────────────────────────────────────────────────

export const EXTRACTION_SYSTEM_PROMPT = `You are an expert technical recruiter and job-market analyst. You read a single job description the way a sharp recruiter does on a first pass: you separate what the role actually REQUIRES day-to-day from company boilerplate, benefits, and how-to-apply text, and you judge which requirements are true must-haves versus nice-to-haves.

Convert ONE job description into a structured fact-sheet with two parts:
1. requirement_units — the discrete capabilities, tools, and qualifications the role calls for. For each, judge whether it is core (a real screening requirement that would filter candidates out) or supporting (helpful but not disqualifying), and how strongly the posting emphasizes it.
2. scalars — a flat set of yes/no and categorical facts about the role.

Core judgments you must make like a recruiter:
- REQUIRED vs PREFERRED is a primary judgment, not a guess. Treat "must have", "required", a hard minimum, or an explicit screening gate as core (and, for tools, requiredTools). Treat "preferred", "a plus", "nice to have", or "bonus" as supporting (and preferredTools). When the posting is ambiguous, decide the way a recruiter actually screens the resume stack.
- STRENGTH (1-10) is how central and emphasized a requirement is to THIS role: a headline responsibility repeated throughout is high (8-10); a single passing mention is low (3-4). Strength reflects emphasis within THIS posting, not the absolute difficulty of the skill. A terse JD that names a requirement once may still be core; a verbose JD that repeats a nice-to-have is still supporting.
- Map each capability to the SINGLE best key from the vocabulary the user provides. The vocabulary is finite and will not cover every role. When a genuine, real requirement does not fit any provided key, use canonical_key "other" with a clear label and the verbatim text — DO NOT force a bad fit just to use a listed key. An honest "other" is more useful than a wrong bucket.
- Tools (Excel, SQL, Python, Figma, Salesforce, etc.) are requirement_units with kind "tool", canonical_key "tool", and the lowercased tool name in tool_name. Also list them under requiredTools / preferredTools per the required-vs-preferred judgment above.

Grounding rules (strict):
- Extract ONLY what the job description states. Do not infer requirements, seniority, credentials, or family that are not supported by the text.
- requirement_text MUST be a verbatim span copied from the job description (whitespace-trimmed only), so every unit is auditable.
- When building requirement_units, ignore "About Us" company blurbs, benefits, perks, EEO statements, and application instructions — those are not requirements.
- If the job description is genuinely thin or vague, extract only what it honestly supports. Do not invent requirements to fill out the list, and do not over-use "other" to pad. A short fact-sheet from a vague posting is correct, not a failure.
- Return ONLY the JSON object matching the provided schema. No preamble, no commentary, no markdown.`

function glossBlock(): string {
  return CANONICAL_CAPABILITY_KEYS.map((k) => `  - ${k}: ${CAPABILITY_KEY_GLOSSES[k]}`).join("\n")
}

export function buildExtractionUserPrompt(args: { jobText: string; userJobTitle?: string }): string {
  const title = args.userJobTitle?.trim() || "(not provided)"
  return `USER-PROVIDED JOB TITLE: ${title}

CANONICAL CAPABILITY KEYS (pick the single best fit for each capability unit; use "tool" for tools, "other" only for real requirements none of these express):
${glossBlock()}

SCALAR FIELD GUIDANCE (fill every field; use null/false when the JD does not support a value):
  - jobFamily: the role's functional family (use the user-provided title as the strongest signal). LifeSciences = wet-lab / bench / R&D science roles (associate scientist, cell-culture/microbiology/assay lab work, process development, biotech R&D) — distinct from patient-facing Healthcare/PreMed and from Engineering.
  - financeSubFamily / salesSubFamily: only when jobFamily is Finance / Sales; else null.
  - jobArchetype: analytical | strategic | execution | mixed | unclear — the day-to-day shape of the work.
  - jobIndustry / detectedDomain: the industry vertical / a specific industry-experience requirement, if the JD names one.
  - analytics.isHeavy: true if the role is genuinely analytics-heavy (SQL/Python/modeling/experimentation central).
  - location: mode (in_person/hybrid/remote/unclear), constrained (must be in a specific place), city (named city or null).
  - yearsRequired: the minimum years of experience required as an integer (the low end of a range; null if none).
  - gradYearHint: a graduation-year the posting screens for, if any.
  - isGovernment / isSalesHeavy / isContract / isHourly / isPartTime: employment-type and sector flags.
  - isSeniorRole: true only for genuinely senior/lead/manager-level roles that hire experienced people. A title merely containing "manager" is NOT automatically senior — "Account Manager", "Manager Trainee", and entry-level roles with "manager" in the title are NOT senior. Judge the actual experience level the posting hires at.
  - isTrainingProgram: a structured training/development program where qualifications are taught on the job.
  - isContentExecutionHeavy: the role is mostly content/social/event execution.
  - degrees: an array of the degree requirements the posting states. For each: level (associate/bachelor/master/mba/phd), requiredness (required vs preferred — apply the same required-vs-preferred judgment as above), field (the named field of study, or null if the posting says only "a degree"), and field_kind:
      • "licensure_floor" — the degree/field is a legal or licensure prerequisite to perform the role (e.g. a nursing degree for an RN, an ABET/accredited engineering degree for a PE track). Use this ONLY when the field is genuinely gatekeeping.
      • "directional" — a field is named or preferred but is not a hard screen (e.g. "degree in Marketing, Communications, or related field"). This is the CONSERVATIVE DEFAULT whenever a field is named without clear licensure gating.
      • "none" — a degree is required but no field is specified ("Bachelor's degree required").
    Emit one entry per distinct degree requirement; emit an empty array when the posting states no degree requirement. Do NOT also place degree requirements in requirement_units.
  - credentialRequired + credentialDetail: a hard professional license/credential is required to perform the role (e.g. FINRA Series 7, CPA, RN, bar admission, CDL); credentialDetail names it.
  - credentialSponsored: the employer sponsors obtaining the credential.
  - requiresAdvisoryBackground: requires prior experience at a top management-consulting firm or investment bank.
  - requiresFinancialModeling: requires concrete financial modeling / valuation / public-filings work.
  - requiresDomainIndustryExperience: requires prior experience in a specific industry vertical.
  - requiresSoftCredential + softCredentialDetail: lists a non-blocking credential as required/strongly preferred (e.g. CFA, CFP, PMP).
  - mentionsPharmaTraining: prefers candidates who completed pharmaceutical sales training.
  - territoryUndisclosed: references a sales territory without disclosing where it is.
  - requiredTools / preferredTools: lowercased tool names, split by required vs preferred/nice-to-have.
  - function_tags: short functional tags for the role (free-form, lowercase, e.g. finance_corp, operations_general).

JOB DESCRIPTION:
"""
${args.jobText}
"""

Return ONLY the JSON object.`
}
