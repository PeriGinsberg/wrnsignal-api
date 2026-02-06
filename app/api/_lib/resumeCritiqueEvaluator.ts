type ResumeCritiqueArgs = {
  profileText: string
  email: string
  focusRole?: string
  extraContext?: string
}

/**
 * Stub evaluator.
 * Replace the body with your actual LLM call (OpenAI, etc.)
 * or your existing internal evaluation approach.
 *
 * This returns a consistent structure for the UI.
 */
export async function runResumeCritique(args: ResumeCritiqueArgs) {
  const { profileText, focusRole, extraContext } = args

  // TODO: Replace with real critique logic
  // For now: a safe placeholder that proves the wiring works.
  return {
    headline: focusRole
      ? `Resume critique for: ${focusRole}`
      : "Resume critique",

    ats: {
      rating: "ok",
      notes: [
        "This is a placeholder response.",
        "Wire in your evaluator to generate real ATS notes.",
      ],
    },

    recruiter_scan: {
      rating: "ok",
      notes: ["Placeholder response.", "Add scan-readability checks in evaluator."],
    },

    signal_vs_noise: {
      rating: "ok",
      notes: ["Placeholder response.", "Add signal-vs-noise checks in evaluator."],
    },

    top_fixes: [
      "Replace this placeholder with your real top fixes list.",
      "Only suggest fixes that clearly improve signal, otherwise leave it.",
    ],

    keep_as_is: [
      "Replace this placeholder with items that are already good enough.",
    ],

    bullet_rewrites: [
      {
        before: "Example bullet: Worked on a project for class.",
        after:
          "Example bullet rewrite: Built a class project deliverable using [tool], producing [output].",
        why: "Adds scope and evidence without inventing facts. Prompts for tool/output if missing.",
      },
    ],

    summary_statement: {
      recommended: false,
      why: "Placeholder. Your evaluator should decide if a summary is needed for clarity.",
      suggested: "",
    },

    section_order: {
      recommended_order: [
        "Education (if current student or <6 months graduate)",
        "Experience",
        "Academic Projects (if role-relevant evidence is missing)",
        "Skills",
      ],
      note: "Placeholder. Your evaluator should determine ordering using the profile fields you store.",
    },

    academic_projects: {
      recommended: true,
      prompts: [
        "Do you have any academic projects related to your target roles (ex: analysis, research, marketing plan, case study)?",
        "Did you use tools (Excel, SQL, Tableau, Python, Canva, Figma) or any measurable outputs you can add?",
      ],
      how_to_add: [
        "Add a 2–4 bullet Academic Projects section with action + scope + tool + output where possible.",
        "Do not add fluff. One strong project beats five vague ones.",
      ],
    },

    questions: [
      "Which tools did you use for your strongest bullets that are not currently named?",
      "Where can you add a metric (volume, frequency, size, time saved) without guessing?",
    ],

    // Helpful for debugging during build
    debug_input_preview: {
      profileTextPreview: profileText.slice(0, 800),
      extraContextPreview: (extraContext || "").slice(0, 300),
    },
  }
}
