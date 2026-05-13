// scripts/migrate-candidate-targeting/preview-prompt.ts
//
// Render the inference prompt with a handful of sample inputs so we can
// review the exact text Claude Haiku will receive. NO LLM calls.
//
// Run:
//   npx tsx scripts/migrate-candidate-targeting/preview-prompt.ts

import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  type InferenceInput,
} from "./inference-prompt"

const SAMPLES: Array<{ label: string; input: InferenceInput }> = [
  {
    label: "Clear: explicit consulting target + JobFit-detected family",
    input: {
      targetRoles: "Strategy Consulting Associate at MBB firms",
      currentStatus: "Recent graduate",
      jobFamily: "Consulting",
      resumeSnippet: "",
    },
  },
  {
    label: "Ambiguous: vague free-text, no JobFamily",
    input: {
      targetRoles: "business roles",
      currentStatus: "Working professional",
      jobFamily: null,
      resumeSnippet: "5 years of cross-functional experience in operations and analytics across two companies.",
    },
  },
  {
    label: "PreMed (DD-04 dual-write trigger)",
    input: {
      targetRoles: "Medical school preparation, hospital volunteering, clinical exposure",
      currentStatus: "Current student",
      jobFamily: "PreMed",
      resumeSnippet: "",
    },
  },
  {
    label: "Disagreement: target_roles=marketing, JobFamily=Consulting",
    input: {
      targetRoles: "Brand Marketing, Product Marketing roles",
      currentStatus: "Recent graduate",
      jobFamily: "Consulting",
      resumeSnippet: "",
    },
  },
  {
    label: "Likely-Other: research + entrepreneurship",
    input: {
      targetRoles: "Independent research, startup founder roles, academic-industry crossover",
      currentStatus: "Career pivot",
      jobFamily: null,
      resumeSnippet: "",
    },
  },
  {
    label: "Engineering non-software (taxonomy caveat — should land in Other)",
    input: {
      targetRoles: "Mechanical engineer, automotive systems",
      currentStatus: "Working professional",
      jobFamily: "Engineering",
      resumeSnippet: "BS Mechanical Engineering, 4 years at automotive supplier on powertrain systems.",
    },
  },
]

console.log("============================================================")
console.log("SYSTEM PROMPT (sent on every inference call)")
console.log("============================================================")
console.log(SYSTEM_PROMPT)
console.log()

for (const sample of SAMPLES) {
  console.log("============================================================")
  console.log(`USER PROMPT — sample: ${sample.label}`)
  console.log("============================================================")
  console.log(buildUserPrompt(sample.input))
  console.log()
}

console.log("============================================================")
console.log(`Rendered ${SAMPLES.length} sample user prompts.`)
console.log("System prompt is shared across all inferences.")
console.log("No LLM calls were made.")
console.log("============================================================")
