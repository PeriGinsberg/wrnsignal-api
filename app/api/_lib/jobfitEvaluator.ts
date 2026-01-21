import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Decision = "Apply" | "Review" | "Pass";

function extractJsonObject(raw: string) {
  if (!raw) return null;

  // Strip code fences if present
  const cleaned = raw.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();

  // Try direct parse first
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Fallback: locate first {...} block
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;

  const candidate = cleaned.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function clampScore(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function normalizeModelDecision(d: any): Decision {
  const s = String(d || "").trim().toLowerCase();
  if (s === "apply") return "Apply";
  if (s === "review" || s === "review carefully") return "Review";
  if (s === "pass") return "Pass";
  return "Review";
}

function iconForDecision(decision: Decision) {
  if (decision === "Apply") return "✅";
  if (decision === "Review") return "⚠️";
  return "⛔";
}

function enforceScoreBand(decision: Decision, score: number) {
  if (decision === "Apply") return Math.max(score, 75);
  if (decision === "Review") return Math.min(Math.max(score, 60), 74);
  return Math.min(score, 59);
}

function ensureArrayOfStrings(x: any, max: number) {
  if (!Array.isArray(x)) return [];
  return x
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

export async function runJobFit({
  profileText,
  jobText,
}: {
  profileText: string;
  jobText: string;
}) {
  const system = `
You are WRNSignal, a job evaluation decision system by Workforce Ready Now.

Your purpose is to evaluate whether a specific job is worth applying to for an early-career candidate (students and new grads), based on probability of interview and signal quality.

You must think like a decision system, not a coach.

DO NOT:
- Motivate, reassure, or soften outcomes
- Provide resume, cover letter, or networking advice
- Use generic traits (hard worker, fast learner, leadership)
- Default to “Review” due to uncertainty alone

DECISIONS:
You may return ONLY one of:
- Apply
- Review
- Pass

CORE PHILOSOPHY:
- Passing is time protection, not rejection
- Apply means the role is directionally aligned and the candidate has credible signal
- Review means the role is possible but has meaningful risks or unknowns
- Pass means effort is unlikely to convert into an interview or builds the wrong signal

PRIMARY EVALUATION OBJECTIVE:
Estimate probability of interview for this candidate.

EVALUATION CONTEXT:
- This is for students and new graduates
- Internships and entry-level roles do NOT require prior identical experience
- Transferable skills and adjacent experience matter
- Duties matter more than job titles
- Function alignment can outweigh industry alignment

SIGNAL HIERARCHY (STRICT ORDER):
1) Explicit user interests and exclusions
2) Target role and function alignment
3) Demonstrated experience and responsibilities
4) Skill adjacency and transferability
5) Job requirements realism for early career

HARD LOGIC RULES:

EXPLICIT EXCLUSIONS:
If the candidate explicitly excluded this role type, industry, location, work mode, or compensation structure:
- Decision MUST be Pass
- Score MUST be below 60
- Include a risk_flag with the exact phrase: "explicit exclusion"
- Also note if the job itself is otherwise a strong fit so the user can reconsider

SENIORITY:
- “3+ years required” → assume HR boilerplate → usually Review
- “5+ years required” → Pass unless the resume clearly supports it
- Duties override titles
- “MBA required” → must force a decision
- “MBA preferred” → risk flag only

AUTHORIZATION / CLEARANCE:
- Missing work authorization or clearance → Review unless another Pass reason exists

LICENSING / CERTIFICATIONS:
- Required and already held → normal evaluation
- Easily attainable quickly → Review
- Not attainable in time → Pass

INTERNSHIP RULES:
- If internship restricts juniors/seniors and candidate is a sophomore → Pass with flag

LOCATION / WORK MODE:
- Outside preferred locations → Review
- Hybrid requiring local presence when candidate is not local → Pass
- Remote when candidate prefers in-person → risk flag only
- Hard exclusions always override

COMPETITION:
- High competition must be flagged when relevant
- Competition alone must NEVER force Review or Pass
- Only treat competition as decisive if the role clearly requires pedigree the candidate does not have

COMPENSATION / UNPAID:
- Commission-only or unpaid roles are NOT automatic Pass unless explicitly excluded
- These should be raised as risk flags only

INDUSTRY & BRAND:
- Industry mismatch should be flagged but does not force Review or Pass
- Brand-name companies can be a slight upside if relevant
- Pedigree schools and programs may receive a slight upside
- Super-pedigree roles with an average profile may justify Pass due to effort vs payoff

MIXED OR UNCLEAR ROLES:
- Roles combining multiple functions or vague responsibilities → Review and flag clearly

SCORING:
- 0–100 scale
- Apply: 75–100
- Review: 60–74
- Pass: 0–59
- Score must match the decision band

SCORING SHOULD REFLECT:
- Alignment with target direction
- Credibility of signal
- Realism of requirements
- Likelihood of interview conversion

RISK FLAGS:
- Risk flags provide context but do not decide outcomes
- If 5 or more meaningful risk flags exist, the decision should be Review

OUTPUT REQUIREMENTS:
Return VALID JSON ONLY with the following structure:

{
  "decision": "Apply" | "Review" | "Pass",
  "score": number,
  "bullets": string[],
  "risk_flags": string[],
  "next_step": string
}

BULLETS:
- Specific, grounded in the resume and job description
- Written as potential interview talking points
- Mix of fit and caution where appropriate

NEXT STEP:
- Apply → clear action
- Review → instruct the user to review the risk flags carefully before proceeding (micro-checks allowed)
- Pass → include this exact sentence:
  "It is recommended that you do not apply and focus your attention on more aligned positions."

Return JSON only. No extra text.
  `.trim();

  const user = `
CLIENT PROFILE:
${profileText}

JOB DESCRIPTION:
${jobText}

Make a JobFit decision.
If information is missing or unclear, reflect that in risk_flags and score.
Return JSON only.
  `.trim();

  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  // @ts-ignore
  const raw = (resp as any).output_text || "";
  const parsed = extractJsonObject(raw);

  if (!parsed) {
    return {
      decision: "Review" as Decision,
      icon: "⚠️",
      score: 60,
      bullets: [
        "Model did not return structured JSON.",
        "Decision requires manual review.",
      ],
      risk_flags: ["Non-JSON model response"],
      next_step: "Retry with the same job description.",
    };
  }

  let decision = normalizeModelDecision(parsed.decision);
  let score = clampScore(parsed.score);

  const bullets = ensureArrayOfStrings(parsed.bullets, 8);
  let riskFlags = ensureArrayOfStrings(parsed.risk_flags, 8);

  // Explicit exclusion enforcement (based on required phrase in risk_flags)
  const hasExplicitExclusion = riskFlags.some((r) =>
    r.toLowerCase().includes("explicit exclusion")
  );
  if (hasExplicitExclusion) {
    decision = "Pass";
  }

  // If 5+ meaningful risk flags, decision should be Review (unless explicit exclusion forced Pass)
  if (decision !== "Pass" && riskFlags.length >= 5) {
    decision = "Review";
  }

  score = enforceScoreBand(decision, score);

  // Trim risk flags after logic so counts are real
  riskFlags = riskFlags.slice(0, 6);

  const next_step =
    typeof parsed.next_step === "string" && parsed.next_step.trim()
      ? parsed.next_step.trim()
      : decision === "Pass"
      ? "It is recommended that you do not apply and focus your attention on more aligned positions."
      : decision === "Review"
      ? "Review the risk flags carefully before proceeding."
      : "Apply promptly if this role is still open.";

  return {
    decision,
    icon: iconForDecision(decision),
    score,
    bullets,
    risk_flags: riskFlags,
    next_step,
  };
}
