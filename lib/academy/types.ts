// lib/academy/types.ts
//
// The Casing Academy's case library format. The engine (the case player, the
// coach review, the export) reads any case in this shape; a new case is a new
// file in lib/academy/cases/ and an entry in the registry, nothing else.
//
// TWO AUDIENCES IN ONE FILE. Everything under `coach` on a case or a question
// is the answer key and the coaching guide. It is served by coach routes only
// and must never be imported by a client component: anything a "use client"
// file imports ships to every browser that loads that page. The student sees
// what the round's rows hold (scenario, question text, exhibit, times), which
// is copied out of here when the round is created.

export const CASE_TYPES = [
  "profitability",
  "growth_strategy",
  "market_entry",
  "market_sizing",
  "pricing",
  "product_launch",
  "mergers_acquisitions",
  "operations_efficiency",
  "general_strategy",
] as const
export type CaseType = (typeof CASE_TYPES)[number]

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  profitability: "Profitability",
  growth_strategy: "Growth strategy",
  market_entry: "Market entry",
  market_sizing: "Market sizing",
  pricing: "Pricing",
  product_launch: "Product launch",
  mergers_acquisitions: "Mergers and acquisitions",
  operations_efficiency: "Operations and efficiency",
  general_strategy: "General business strategy",
}

export type Difficulty = "foundation" | "intermediate" | "advanced"

/** A rubric dimension's key. See lib/academy/rubric.ts. */
export type DimensionKey =
  | "problem_understanding"
  | "structuring"
  | "prioritization"
  | "hypothesis"
  | "brainstorming"
  | "quant_accuracy"
  | "business_interpretation"
  | "conciseness"
  | "clarity"
  | "recommendation"

export type CaseQuestion = {
  /** Stable within the case: "q1" ... Used to join attempts across rounds. */
  qkey: string
  /** Short name: "Business understanding". */
  title: string
  /** Exactly what the interviewer asks. */
  text: string
  /** Numbers or new information shown with the question, plain text. */
  exhibit?: string
  answer_seconds: number
  /** Think time before recording starts. 0 or absent: none. */
  prep_seconds?: number
  /** Which rubric dimensions this question gives evidence for. */
  dimensions: DimensionKey[]
  coach: {
    purpose: string
    strong: string[]
    example: string
    calculation?: string[]
    alternatives: string[]
    common_errors: string[]
    overanalysis: string[]
    poor_prioritization: string[]
    interventions: string[]
  }
}

export type CaseDefinition = {
  id: string
  title: string
  /** As the student and the coach both see it. */
  round_title: string
  type: CaseType
  difficulty: Difficulty
  industry: string
  employer_alignment?: string
  minutes: string
  skills: DimensionKey[]
  /** What the student reads before question 1. */
  scenario: string
  /** How the round works, shown above the scenario. */
  instructions: string[]
  /** Shown to the student on the case's last screen. */
  self_assessment: { key: string; question: string }[]
  questions: CaseQuestion[]
  coach: {
    /** The answer key, worked. */
    answer_key: string[]
    /** What a strong candidate qualifies the numbers with. */
    qualifications: string[]
    model_reasoning: string
    /** "Analytical problem or communication problem": how to tell. */
    diagnosis: { analytical: string[]; communication: string[] }
    coaching_prompts: string[]
  }
}
