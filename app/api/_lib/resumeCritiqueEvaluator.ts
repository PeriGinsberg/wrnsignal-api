type ResumeCritiqueInput = {
  resumeText: string
  profileText?: string // optional context if you want it later
}

type ResumeCritiqueOutput = {
  headline: string
  ats_survivability: string[]
  recruiter_scan: string[]
  signal_vs_noise: string[]
  fix_now: Array<{
    before: string
    after: string
    why: string
  }>
  questions: string[]
  summary_statement: {
    recommended: boolean
    reason: string
    suggested?: string
  }
  sections_order: {
    recommended_order: string[]
    reason: string
  }
}

/**
 * V1 evaluator: deterministic structure, no invented facts.
 * (Replace logic with your GPT prompt later if desired.)
 */
export async function runResumeCritique(
  input: ResumeCritiqueInput
): Promise<ResumeCritiqueOutput> {
  const text = (input.resumeText || "").trim()

  // Minimal safety
  if (!text) {
    return {
      headline: "No resume text received",
      ats_survivability: ["Paste your resume text so the critique can run."],
      recruiter_scan: [],
      signal_vs_noise: [],
      fix_now: [],
      questions: [],
      summary_statement: {
        recommended: false,
        reason: "No resume content provided.",
      },
      sections_order: {
        recommended_order: ["Education", "Experience", "Projects", "Skills"],
        reason:
          "Default order for students and early career candidates when school is recent.",
      },
    }
  }

  // V1: simple heuristics placeholder (safe)
  const hasEducation = /education/i.test(text)
  const hasProjects = /project/i.test(text)
  const hasSummary = /(summary|profile|objective)/i.test(text)

  const questions: string[] = []
  if (!hasProjects) {
    questions.push(
      "Do you have any academic projects related to your target roles that you can add as a Projects section?"
    )
  }
  questions.push(
    "For your strongest bullets, can you add one of: scope, tool/skill, or a metric (without inventing anything)?"
  )

  const summaryRecommended = !hasSummary && text.length < 2000
  const summarySuggested = summaryRecommended
    ? "Student / recent grad targeting [ROLE]. Strong in [SKILLS]. Built experience through [PROJECTS/INTERNSHIPS]."
    : undefined

  return {
    headline: "Resume critique (v1)",
    ats_survivability: [
      "Use simple section headers: Education, Experience, Projects, Skills.",
      "Avoid tables, columns, and graphics if you are submitting to ATS-heavy systems.",
      "Keep dates and titles consistent across entries.",
    ],
    recruiter_scan: [
      "Make the first 6 bullets obviously relevant to the target role.",
      "Lead bullets with action + scope + tool/skill or metric. If it already has that, leave it.",
      "Remove filler phrases that do not add proof (hardworking, motivated, passionate).",
    ],
    signal_vs_noise: [
      "Keep content that proves skills. Delete lines that only describe responsibilities.",
      "If a bullet is vague, make it specific by adding what you did, with what, and for what outcome.",
    ],
    fix_now: [
      {
        before: "Responsible for helping with marketing tasks.",
        after: "Built a weekly content calendar and drafted 12 posts aligned to campaign goals.",
        why: "Turns a vague responsibility into action + scope. No personal judgment.",
      },
    ],
    questions,
    summary_statement: {
      recommended: summaryRecommended,
      reason: summaryRecommended
        ? "A short summary can add clarity if your target is not obvious from the first glance."
        : "If your target is already obvious from your top section and first bullets, a summary is optional.",
      suggested: summarySuggested,
    },
    sections_order: {
      recommended_order: hasEducation
        ? ["Education", "Experience", "Projects", "Skills"]
        : ["Experience", "Projects", "Skills", "Education"],
      reason:
        "Students and very recent grads should usually lead with Education. Otherwise lead with Experience.",
    },
  }
}
