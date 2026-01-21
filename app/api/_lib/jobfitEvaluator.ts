import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Decision = "Apply" | "Review" | "Pass";

function extractJsonObject(raw: string) {
  if (!raw) return null;

  const cleaned = raw.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

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

function normalizeDecision(d: any): Decision {
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

function stripLocationRisks(riskFlags: string[]) {
  return riskFlags.filter((r) => {
    const s = r.toLowerCase();
    return !(
      s.includes("location mismatch") ||
      s.includes("not local") ||
      s.includes("commuting") ||
      s.includes("commute") ||
      s.includes("local presence required") ||
      s.includes("onsite presence required") ||
      s.includes("hybrid location requirement") ||
      s.includes("must be local") ||
      s.includes("within commuting distance")
    );
  });
}

function containsThreePlusYearsFlag(riskFlags: string[]) {
  return riskFlags.some((r) => {
    const s = r.toLowerCase();
    return (
      s.includes("3+ years") ||
      s.includes("3 years") ||
      s.includes("three years") ||
      s.includes("minimum 3 years")
    );
  });
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

Your job is to evaluate whether ONE job is worth applying to for an early-career candidate (students and new grads), using probability of interview as the primary objective.

You must think like a decision system, not a coach.

DO NOT:
- Motivate, reassure, or soften outcomes
- Provide resume, cover letter, or networking advice
- Use generic traits (hard worker, fast learner, leadership)
- Add headings outside JSON (no WHY, RISKS, NEXT STEPS text blocks)

DECISIONS:
Return only one decision:
- Apply
- Review
- Pass

CORE PHILOSOPHY:
- Passing is time protection, not rejection
- Apply means directionally aligned with credible signal for interview conversion
- Review means possible, but meaningful risks or unknowns
- Pass means effort is unlikely to convert into an interview or builds wrong signal

EVALUATION CONTEXT:
- This is for students and new graduates
- Internships and entry-level roles do NOT require identical prior experience
- Transferable skills and adjacent experience matter
- Duties override titles
- Function alignment can outweigh industry alignment

SIGNAL HIERARCHY (STRICT ORDER):
1) Explicit user interests and exclusions
2) Target role and function alignment
3) Demonstrated experience and responsibilities
4) Skill adjacency and transferability
5) Requirements realism for early career

HARD LOGIC RULES:

EXPLICIT EXCLUSIONS:
If the profile explicitly excluded this role type, industry, location, work mode, or compensation structure:
- Decision MUST be Pass
- Score MUST be below 60
- risk_flags MUST include the exact phrase: "explicit exclusion"
- Also note if the job itself would otherwise be a strong fit so the user can reconsider
Only use "explicit exclusion" if the profile clearly and directly excludes something. Do not treat mild preferences as exclusions.

SENIORITY REQUIREMENTS:
- "3+ years required" is common HR boilerplate for early-career roles:
  - It must NEVER force a Pass
  - It must NOT force Review by itself
  - It should always be listed as a risk flag (not a primary reason bullet)
  - When present, note that internships, project work, and comparable responsibilities may substitute for years of experience
- "5+ years required":
  - Pass unless the resume clearly demonstrates equivalent senior-level scope
- Duties override titles
- "MBA required":
  - must force a decision (usually Pass for undergraduates)
- "MBA preferred":
  - risk flag only

AUTHORIZATION / CLEARANCE:
- Missing work authorization or clearance -> Review unless another Pass reason exists

LICENSING / CERTIFICATIONS:
- Required and already held -> normal evaluation
- Easily attainable quickly -> Review
- Not attainable in time -> Pass

INTERNSHIP RULE:
- If an internship restricts juniors/seniors and the candidate is a sophomore -> Pass with a clear flag

LOCATION / WORK MODE:

LOCATION CONSTRAINT DETECTION (STRICT):
- Do NOT infer a location restriction from "plans" (example: "planning to move to Orlando" is NOT a restriction).
- Only treat location as constrained if the profile explicitly says:
  "only", "must", "cannot relocate", "no relocation", "remote only", or lists a fixed city requirement.
- If location flexibility is unclear, assume the candidate CAN relocate and do NOT raise commuting or local presence as a risk.
- You MUST output a boolean field: "location_flexible"
  - true if the candidate can relocate / is flexible / not restricted
  - false only if the profile explicitly restricts location

- Remote when candidate prefers in-person -> risk flag only (unless explicitly excluded)

COMPETITION:
- High competition must be flagged when relevant
- Competition alone must NEVER force Review or Pass
- Do not describe competition as a consequence of a seniority gap (do not restate missing qualifications as "competition")
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
- Mixed-function roles or vague responsibilities -> Review and flag clearly

RISK FLAGS:
- Risk flags provide context but do not decide outcomes by themselves
- If 5 or more meaningful risk flags exist, the decision should be Review (unless explicit exclusion forced Pass)

SCORING:
- 0–100 scale
- Apply: 75–100
- Review: 60–74
- Pass: 0–59
- Score must match the decision band
- Score should reflect alignment, signal credibility, requirements realism, and interview conversion likelihood

OUTPUT REQUIREMENTS:
Return valid JSON ONLY with this structure:

{
  "decision": "Apply" | "Review" | "Pass",
  "score": number,
  "bullets": string[],
  "risk_flags": string[],
  "next_step": string,
  "location_flexible": boolean
}

BULLETS:
- Specific and grounded in profile and job description
- Written as potential interview talking points
- Mix of fit and caution where appropriate

NEXT STEP:
- Apply -> clear action
- Review -> instruct the user to review the risk flags carefully before proceeding (micro-checks allowed)
- Pass -> include this exact sentence:
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
      location_flexible: true,
    };
  }

  let decision = normalizeDecision(parsed.decision);
  let score = clampScore(parsed.score);

  const bullets = ensureArrayOfStrings(parsed.bullets, 8);
  let riskFlags = ensureArrayOfStrings(parsed.risk_flags, 10);

  // Default to true unless the model explicitly says false
  const locationFlexible =
    typeof parsed.location_flexible === "boolean" ? parsed.location_flexible : true;

  // If location is flexible, strip commute/local/location risks
  if (locationFlexible) {
    riskFlags = stripLocationRisks(riskFlags);
  }

  // Explicit exclusion enforcement (based on required phrase in risk_flags)
  const hasExplicitExclusion = riskFlags.some((r) =>
    r.toLowerCase().includes("explicit exclusion")
  );
  if (hasExplicitExclusion) {
    decision = "Pass";
  }

  // 3+ years rule safety net: never allow Pass solely due to 3+ years (unless explicit exclusion)
  if (decision === "Pass" && !hasExplicitExclusion && containsThreePlusYearsFlag(riskFlags)) {
    decision = "Review";
  }

  // 5+ risk flags -> Review (unless explicit exclusion forced Pass)
  if (decision !== "Pass" && riskFlags.length >= 5) {
    decision = "Review";
  }

  score = enforceScoreBand(decision, score);

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
    location_flexible: locationFlexible,
  };
}
