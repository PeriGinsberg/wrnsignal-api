import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Decision = "Apply" | "Review" | "Pass";
type LocationConstraint = "constrained" | "not_constrained" | "unclear";

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

// If location is not explicitly constrained, we strip commuting/local-presence/location-mismatch language.
// This enforces your rule: do not infer commute risk from "plans."
function stripLocationLanguage(items: string[]) {
  return items.filter((s0) => {
    const s = (s0 || "").toLowerCase();
    return !(
      s.includes("commute") ||
      s.includes("commuting") ||
      s.includes("reasonable commuting distance") ||
      s.includes("miles away") ||
      s.includes("mile away") ||
      s.includes("distance") ||
      s.includes("not local") ||
      s.includes("local presence") ||
      s.includes("must be local") ||
      s.includes("onsite presence required") ||
      s.includes("hybrid location requirement") ||
      s.includes("location mismatch") ||
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

function normalizeLocationConstraint(x: any): LocationConstraint {
  const s = String(x || "").trim().toLowerCase();
  if (s === "constrained") return "constrained";
  if (s === "not_constrained" || s === "not constrained") return "not_constrained";
  if (s === "unclear") return "unclear";
  return "unclear";
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
- Output headings or formatted sections outside JSON (no WHY, RISKS, NEXT STEPS)

DECISIONS:
Return only one:
- Apply
- Review
- Pass

CORE PHILOSOPHY:
- Passing is time protection, not rejection
- Apply means directionally aligned with credible signal for interview conversion
- Review means possible, but meaningful risks or unknowns
- Pass means effort is unlikely to convert into an interview or builds wrong signal

EVALUATION CONTEXT:
- Students and new grads
- Internships/entry-level roles do NOT require identical prior experience
- Transferable skills and adjacent experience matter
- Duties override titles
- Function match can outweigh industry match

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
  - It should always be listed as a risk flag
  - Put it in risk_flags, not as a primary reason bullet
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

LOCATION / WORK MODE (STRICT):
You MUST output "location_constraint" as one of:
- "constrained"
- "not_constrained"
- "unclear"

Rules for setting location_constraint:
- "constrained" ONLY if the profile explicitly restricts location or relocation
  Examples: "NYC only", "must be Orlando", "no relocation", "remote only"
- "not_constrained" if the profile indicates flexibility or openness to relocate
- "unclear" if it is not stated either way

IMPORTANT:
- If location_constraint is "unclear", treat it as NOT constrained.
- If location is not explicitly constrained, you MUST NOT mention commuting distance, miles, commuting acceptability, "reasonable commuting distance", or local presence as a risk or bullet.
- Do NOT infer location constraints from "plans" (example: "planning to move to Orlando" is NOT a constraint).

Remote preference:
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
- Score reflects alignment, signal credibility, requirements realism, and interview conversion likelihood

OUTPUT REQUIREMENTS:
Return valid JSON ONLY:

{
  "decision": "Apply" | "Review" | "Pass",
  "score": number,
  "bullets": string[],
  "risk_flags": string[],
  "next_step": string,
  "location_constraint": "constrained" | "not_constrained" | "unclear"
}

BULLETS:
- Specific and grounded in profile and job
- Written as potential interview talking points
- Mix of fit and caution

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
      location_constraint: "unclear" as LocationConstraint,
    };
  }

  let decision = normalizeDecision(parsed.decision);
  let score = clampScore(parsed.score);

  let bullets = ensureArrayOfStrings(parsed.bullets, 10);
  let riskFlags = ensureArrayOfStrings(parsed.risk_flags, 12);

  const loc = normalizeLocationConstraint(parsed.location_constraint);

  // Treat unclear as not constrained (your rule)
  const treatAsConstrained = loc === "constrained";

  // If not constrained, strip location/commute language from BOTH bullets and risk flags
  if (!treatAsConstrained) {
    bullets = stripLocationLanguage(bullets);
    riskFlags = stripLocationLanguage(riskFlags);
  }

  // Explicit exclusion enforcement (based on required phrase in risk_flags)
  const hasExplicitExclusion = riskFlags.some((r) =>
    r.toLowerCase().includes("explicit exclusion")
  );
  if (hasExplicitExclusion) {
    decision = "Pass";
  }

  // 3+ years safety net: never allow Pass solely due to 3+ years (unless explicit exclusion)
  if (decision === "Pass" && !hasExplicitExclusion && containsThreePlusYearsFlag(riskFlags)) {
    decision = "Review";
  }

  // 5+ risk flags -> Review (unless explicit exclusion forced Pass)
  if (decision !== "Pass" && riskFlags.length >= 5) {
    decision = "Review";
  }

  // Enforce score bands
  score = enforceScoreBand(decision, score);

  // Final trims for UI
  bullets = bullets.slice(0, 8);
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
    location_constraint: loc,
  };
}
