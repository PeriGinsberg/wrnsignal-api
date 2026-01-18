import { getAuthedProfileText } from "../_lib/authProfile"
import OpenAI from "openai"

export const runtime = "nodejs"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function corsHeaders(origin: string | null) {
  const allowOrigin = origin || "*"
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  }
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin")
  return new Response(null, { status: 204, headers: corsHeaders(origin) })
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function clampScore(n: any) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(100, Math.round(x)))
}

/** Locked decision vocabulary */
type Decision = "Apply" | "Review carefully" | "Pass"

function normalizeDecision(d: any): Decision {
  const s = String(d || "").trim().toLowerCase()
  if (s === "apply") return "Apply"
  if (s === "review carefully" || s === "review") return "Review carefully"
  if (s === "pass") return "Pass"
  return "Review carefully"
}

function iconForDecision(decision: Decision) {
  if (decision === "Apply") return "✅"
  if (decision === "Review carefully") return "⚠️"
  return "⛔"
}

function enforceScoreBand(decision: Decision, score: number) {
  // Decision is source of truth; keep score consistent with UI bands.
  if (decision === "Apply") return Math.max(score, 75)
  if (decision === "Review carefully") return Math.min(Math.max(score, 60), 74)
  return Math.min(score, 59)
}

/**
 * Extractor schema (model output). Model does NOT decide.
 */
type RequirementType = "technical" | "credential" | "years" | "field_of_study" | "other"
type Status = "present" | "missing" | "unclear"
type Strength3 = "strong" | "moderate" | "weak"
type ExperienceStrength = "strong" | "moderate" | "limited"

type Extracted = {
  hard_requirements: Array<{
    requirement: string
    type: RequirementType
    status: Status
    evidence?: string
  }>
  soft_requirements: Array<{
    requirement: string
    status: Status
  }>
  alignment_signals: {
    role_alignment: Strength3
    industry_alignment: Strength3
    environment_alignment: Strength3
    goal_alignment: Strength3
  }
  experience_strength: ExperienceStrength
  explicit_exclusions: string[]
}

/**
 * Deterministic Job Fit rules (locked to your methodology)
 */
function decideJobFit(x: Extracted): {
  decision: Decision
  risk_flags: string[]
  bullets: string[]
  next_step: string
  score: number
} {
  const risk_flags: string[] = []
  const bullets: string[] = []

  const hard = Array.isArray(x?.hard_requirements) ? x.hard_requirements : []
  const soft = Array.isArray(x?.soft_requirements) ? x.soft_requirements : []
  const exclusions = Array.isArray(x?.explicit_exclusions) ? x.explicit_exclusions : []

  const align = x?.alignment_signals || ({} as any)
  const expStrength: ExperienceStrength = x?.experience_strength || "limited"

  const hasExplicitExclusion = exclusions.length > 0
  if (hasExplicitExclusion) {
    risk_flags.push("explicit exclusion")
    bullets.push("Profile explicitly excludes this role/industry/environment.")
    return {
      decision: "Pass",
      risk_flags,
      bullets,
      next_step: "Protect your time. Move on to the next opportunity.",
      score: 40,
    }
  }

  // Credential gate: graduate/specific certifications (hard requirement) => PASS if missing/unclear
  const credentialMissing = hard.some(
    (r) =>
      r?.type === "credential" &&
      (r?.status === "missing" || r?.status === "unclear") &&
      /mba|cpa|rn|license|certification|clearance|security/i.test(r?.requirement || "")
  )
  if (credentialMissing) {
    risk_flags.push("required credential not shown")
    bullets.push("This role lists a specific credential/graduate requirement not shown in your profile.")
    return {
      decision: "Pass",
      risk_flags,
      bullets,
      next_step: "Protect your time. Prioritize roles where requirements match what you can clearly show.",
      score: 45,
    }
  }

  // Hard technical/system skills missing or unclear => REVIEW
  const missingTech = hard.filter(
    (r) => r?.type === "technical" && (r?.status === "missing" || r?.status === "unclear")
  )
  if (missingTech.length > 0) {
    for (const r of missingTech.slice(0, 4)) {
      const req = String(r?.requirement || "").trim()
      if (!req) continue
      risk_flags.push(`Resume does not show ${req}. If you have it, it needs to be added.`)
    }
  }

  // Years requirement > profile => REVIEW (with offset note if strong experience)
  const yearsGap = hard.some((r) => r?.type === "years" && (r?.status === "missing" || r?.status === "unclear"))
  if (yearsGap) {
    risk_flags.push("Years requirement may be a stretch.")
    if (expStrength === "strong") {
      bullets.push("Depth of experience may partially offset the years requirement, but this is still a stretch role.")
    } else {
      bullets.push("Years requirement may make this harder to convert. Treat as a stretch role.")
    }
  }

  // Field of study required but not shown => REVIEW
  const fieldGap = hard.some(
    (r) => r?.type === "field_of_study" && (r?.status === "missing" || r?.status === "unclear")
  )
  if (fieldGap) {
    risk_flags.push("Field of study requirement not shown explicitly.")
  }

  // Soft requirements: tie-breaker. Mention only if many stack up AND strengths do not outweigh.
  const softGaps = soft.filter((r) => r?.status === "missing" || r?.status === "unclear").length
  const strengthsOutweigh =
    align?.goal_alignment === "strong" ||
    align?.role_alignment === "strong" ||
    expStrength === "strong"

  if (softGaps >= 3 && !strengthsOutweigh) {
    risk_flags.push("Multiple soft-skill requirements are not clearly supported by the resume/profile.")
  }

  // Determine base alignment
  const goal = align?.goal_alignment || "weak"
  const role = align?.role_alignment || "weak"
  const industry = align?.industry_alignment || "weak"
  const env = align?.environment_alignment || "weak"

  const anyHardReviewTriggers = missingTech.length > 0 || yearsGap || fieldGap

  // Decision rules (deterministic)
  let decision: Decision = "Review carefully"

  const strongUpside =
    goal === "strong" ||
    role === "strong" ||
    industry === "strong" ||
    env === "strong"

  const moderateOrBetterGoal = goal === "strong" || goal === "moderate"

  if (anyHardReviewTriggers) {
    decision = "Review carefully"
  } else {
    // No hard review triggers. Apply allowed with upside even with some gaps (your philosophy),
    // but still requires at least moderate goal alignment.
    if (moderateOrBetterGoal && strongUpside) {
      decision = "Apply"
    } else if (moderateOrBetterGoal) {
      decision = "Review carefully"
    } else {
      decision = "Pass"
      risk_flags.push("Weak alignment to stated goals.")
    }
  }

  // Score (derived, not causal). Keep simple and stable.
  let score = 60
  if (decision === "Apply") score = 80
  if (decision === "Pass") score = 50

  // Bullets: grounded, non-motivational.
  if (decision === "Apply") {
    bullets.push("Alignment is strong enough that applying is a reasonable use of time.")
    if (softGaps > 0) bullets.push("You may still need to strengthen how you signal fit on the resume.")
    if (expStrength === "limited") bullets.push("Expect this to be more competitive. Use networking immediately after applying.")
  } else if (decision === "Review carefully") {
    bullets.push("This is a stretch or has missing signals that could change the outcome.")
    if (missingTech.length > 0) bullets.push("If you have the missing technical/system skills, add them to the resume before applying.")
    if (yearsGap) bullets.push("Years requirement is a risk. Proceed only if the role builds clear signal for your goals.")
  } else {
    bullets.push("This role is not a good use of time given your stated goals and/or constraints.")
    bullets.push("Passing here protects your effort for higher-conversion opportunities.")
  }

  // Next step (concrete)
  let next_step = "Move on to the next opportunity."
  if (decision === "Apply") {
    next_step = "Apply, then immediately run Positioning and Networking to improve your competitiveness."
  } else if (decision === "Review carefully") {
    next_step = "Decide if you can close the gaps quickly. If yes, update the resume signals, then re-run Job Fit."
  } else {
    next_step = "Protect your time. Look for roles that match your goals and where required signals are clear on your resume."
  }

  score = enforceScoreBand(decision, clampScore(score))

  // Trim for UI
  return {
    decision,
    risk_flags: risk_flags.slice(0, 6),
    bullets: bullets.slice(0, 8),
    next_step,
    score,
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin")

  try {
    // Auth + stored profile
    const { profileText } = await getAuthedProfileText(req)
    const profile = profileText

    const body = await req.json()
    const job = String(body?.job || "").trim()

    if (!job) {
      return new Response(JSON.stringify({ error: "Missing job" }), {
        status: 400,
        headers: corsHeaders(origin),
      })
    }

    const system = `
You are WRNSignal, a job search decision system by Workforce Ready Now.

Your role in this step is NOT to decide whether the user should apply.
Your role is to EXTRACT and CLASSIFY information from the job description
and the user profile so that deterministic rules can be applied in code.

DO NOT:
- Recommend Apply, Review carefully, or Pass
- Assign a score
- Judge candidate quality or competitiveness
- Infer or invent experience
- Add responsibilities, tools, or outcomes not explicitly stated

You are evaluating EARLY-CAREER candidates.
Lack of experience is normal and should NOT be penalized.
Only flag issues when information is missing or unclear in a way that affects safe evaluation.

CLASSIFICATION RULES

1) HARD REQUIREMENTS
Extract requirements explicitly stated as REQUIRED in the job description.

For each required item:
- Extract the requirement text
- Assign a type:
  - technical (tools, systems, programming languages, platforms)
  - credential (license, certification, clearance)
  - years (years of experience)
  - field_of_study (specific major or discipline)
  - other (only if none of the above fit)

Assign a status:
- present → clearly shown in the profile
- missing → clearly not shown in the profile
- unclear → not mentioned or ambiguous in the profile

IMPORTANT:
- If a required technical or system skill is unclear, treat it as missing.
- Do NOT infer skills from job titles alone.
- Do NOT infer experience depth beyond what is stated.

2) SOFT REQUIREMENTS
Extract non-technical traits (communication, teamwork, adaptability, etc.).
For each, assign status: present | missing | unclear.

3) ALIGNMENT SIGNALS
Assess alignment based ONLY on what is explicitly stated.
Classify each as: strong | moderate | weak.

Dimensions:
- role_alignment (job function vs stated goals)
- industry_alignment
- environment_alignment (company type, team type, work setting)
- goal_alignment (does this role build toward stated goals)

4) EXPERIENCE STRENGTH
Assess overall experience strength WITHOUT judging merit.
Classify as: strong | moderate | limited.

5) EXPLICIT EXCLUSIONS
List only exclusions clearly stated by the user.

OUTPUT FORMAT
Return VALID JSON ONLY.
Do not include explanations outside the schema.

{
  "hard_requirements": [
    {
      "requirement": "string",
      "type": "technical | credential | years | field_of_study | other",
      "status": "present | missing | unclear",
      "evidence": "short quote from job description or profile"
    }
  ],
  "soft_requirements": [
    {
      "requirement": "string",
      "status": "present | missing | unclear"
    }
  ],
  "alignment_signals": {
    "role_alignment": "strong | moderate | weak",
    "industry_alignment": "strong | moderate | weak",
    "environment_alignment": "strong | moderate | weak",
    "goal_alignment": "strong | moderate | weak"
  },
  "experience_strength": "strong | moderate | limited",
  "explicit_exclusions": [
    "string"
  ]
}
    `.trim()

    const user = `
CLIENT PROFILE:
${profile}

JOB DESCRIPTION:
${job}

Extract and classify. Return JSON only.
    `.trim()

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      top_p: 1,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })

    // @ts-ignore
    const raw = (resp as any).output_text || ""
    const parsed = safeJsonParse(raw)

    if (!parsed) {
      // Fail-safe: stable, conservative
      const out = {
        decision: "Review carefully" as Decision,
        icon: "⚠️",
        score: 60,
        bullets: [
          "Model did not return structured output.",
          "Decision requires manual review.",
        ],
        risk_flags: ["Non-JSON model response"],
        next_step: "Retry with the same job description.",
      }
      return new Response(JSON.stringify(out), { status: 200, headers: corsHeaders(origin) })
    }

    // Basic shape coerce
    const extracted: Extracted = {
      hard_requirements: Array.isArray(parsed.hard_requirements) ? parsed.hard_requirements : [],
      soft_requirements: Array.isArray(parsed.soft_requirements) ? parsed.soft_requirements : [],
      alignment_signals: parsed.alignment_signals || {
        role_alignment: "weak",
        industry_alignment: "weak",
        environment_alignment: "weak",
        goal_alignment: "weak",
      },
      experience_strength: parsed.experience_strength || "limited",
      explicit_exclusions: Array.isArray(parsed.explicit_exclusions) ? parsed.explicit_exclusions : [],
    }

    const decisionPack = decideJobFit(extracted)

    const out = {
      decision: decisionPack.decision,
      icon: iconForDecision(decisionPack.decision),
      score: enforceScoreBand(decisionPack.decision, decisionPack.score),
      bullets: decisionPack.bullets,
      risk_flags: decisionPack.risk_flags,
      next_step: decisionPack.next_step,
      // Optional: include extractor data for debugging during Phase 1
      // extracted,
    }

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: corsHeaders(origin),
    })
  } catch (err: any) {
    const detail = err?.message || String(err)
    const lower = String(detail).toLowerCase()

    const status =
      lower.includes("unauthorized") ? 401 :
      lower.includes("profile not found") ? 404 :
      lower.includes("access disabled") ? 403 :
      500

    return new Response(JSON.stringify({ error: "JobFit failed", detail }), {
      status,
      headers: corsHeaders(origin),
    })
  }
}
