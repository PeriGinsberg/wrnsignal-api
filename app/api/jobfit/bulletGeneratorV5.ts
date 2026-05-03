/**
 * bulletGeneratorV5.ts
 * Drop into: app/api/jobfit/bulletGeneratorV5.ts
 *
 * AI-powered bullet renderer. Replaces the deterministic V4 templates with
 * Claude-generated, specific, actionable, personalized bullets.
 *
 * Returns the same shape as V4 ({ why, risk, renderer_debug })
 * PLUS why_structured, risk_structured, cover_letter_strategy, and
 * networking_strategy. The two strategy fields are null on Pass decisions
 * (where application strategy is incoherent — the user shouldn't apply).
 */

import type { EvalOutput } from "./signals"

// ─── Output types ─────────────────────────────────────────────────────────────

export interface WhyBullet {
  keyword: string
  lead: string
  connection: string
  action: string
}

export interface RiskBullet {
  keyword: string
  gap: string
  reframe: string
  severity: "low" | "medium" | "high"
}

export interface CoverLetterStrategy {
  open_with: string
  lead_signal: string
  address_gap: string | null
  tone: string
}

export interface NetworkingStrategy {
  /** Who to reach at this company — seniority and function specific to this role. One sentence, max 25 words. */
  target_contacts: string
  /** What to lead with in the first message, anchored on the same lead_signal as cover_letter_strategy. One sentence, max 25 words. */
  outreach_angle: string
}

export interface V5Output {
  /** Formatted strings — backward-compatible with every V4 consumer */
  why: string[]
  risk: string[]
  /** Structured objects for the frontend and cover letter route */
  why_structured: WhyBullet[]
  risk_structured: RiskBullet[]
  /** Null on Pass decisions, or when the model returned a malformed/missing object for a non-Pass decision. */
  cover_letter_strategy: CoverLetterStrategy | null
  /** Null on Pass decisions, or when the model returned a malformed/missing object for a non-Pass decision. */
  networking_strategy: NetworkingStrategy | null
  renderer_debug: {
    renderer_stamp: string
    model: string
    decision: string
    why_count: number
    risk_count: number
    prompt_tokens?: number
    completion_tokens?: number
    latency_ms?: number
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const RENDERER_V5_STAMP =
  "RENDERER_V5_STAMP__2026_03__AI_BULLET_RENDERER__CLAUDE"

// Use Haiku for speed + cost. Swap to "claude-sonnet-4-5" for higher quality.
const MODEL = "claude-haiku-4-5-20251001"

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(out: EvalOutput): string {
  const profileText =
    String((out as any).profile_text || (out as any).profileText || "").trim() ||
    "(profile text not provided)"

  const jobText =
    String((out as any).job_text || (out as any).jobText || "").trim() ||
    "(job description not provided)"

  return `You are a career coach generating JobFit analysis bullets for SIGNAL, a career decision engine for college students.

## STUDENT PROFILE
${profileText}

## JOB DESCRIPTION
${jobText}

## WHY MATCH CODES (evidence of fit)
${JSON.stringify(out.why_codes ?? [], null, 2)}

## RISK CODES (gaps or concerns)
${JSON.stringify(out.risk_codes ?? [], null, 2)}

## DECISION
${out.decision} (score: ${out.score})

---

## CRITICAL INSTRUCTIONS

### On specificity
- Always address the student directly using "you" and "your" — never use their name or third person.
- Name the employer, metric, or outcome. Never say "your background includes X" — say what you specifically did.
- If the profile_fact mentions a metric, that number MUST appear in the bullet.
- No comma-separated lists inside a sentence — pick the single strongest detail.
- CRITICAL: Never confuse the two employers in this prompt. The student worked at their past employer(s) named in the STUDENT PROFILE. The company they are applying to is named in the JOB DESCRIPTION. These are always different companies — never attribute the student's work experience to the target employer, and never say the student worked at the company in the job description.

### On transferable skills
- Make the translation explicit. Show them their experience in the hiring manager's language.
- Never leave the student to make the connection themselves.

### On length (STRICT)
- WHY bullets: one sentence per field, 20 words max per field.
- RISK bullets: gap = one sentence. reframe = one to two sentences max. Tool risks = one sentence reframe only.
- Cut every word that doesn't add specific information.

### On action instructions
- Broaden beyond cover letters — can be resume framing, application strategy, interview prep, or networking.
- One specific instruction. Not "highlight this" — tell them exactly what to do, where, and how.
- Never put quoted language in the action instruction. Tell them what to convey, not the exact words to use.

### On risk reframes
- CRITICAL: Only generate risk bullets for risk_codes that are explicitly provided. If risk_codes is an empty array, return an empty risk_bullets array. Never invent risks that aren't in the risk_codes input. 
- Don't just name the gap — reframe it.
- CRITICAL: The reframe must cite only evidence that actually appears in the profile text. 
  Never say "you likely did X" or "you probably Y" — only reference what is explicitly stated.
  If there is no adjacent evidence in the profile, say so plainly and give one action instruction only.
- Show the student what adjacent experience they have that partially bridges it.
- TOOL RISKS: gap = one sentence. reframe = one sentence naming adjacent evidence + one action. No quoted language.
- ALL OTHER RISKS: gap = one sentence. reframe = two sentences max. No quoted language.

### On voice and tone
- Write like a sharp advisor talking directly to the student, not like a bot generating output.
- Vary your sentence structure across bullets — don't start every lead the same way.
- The connection sentence should feel like an insight, not a label.
- The action should feel like advice from someone who knows hiring, not a checklist item.

### On cover letter and networking strategy
- CRITICAL: If the input DECISION is "Pass", you MUST return null for BOTH cover_letter_strategy and networking_strategy. The user should NOT apply, so application strategy is incoherent. Both fields must be the literal JSON null, not empty objects, not placeholder strings.
- networking_strategy.target_contacts must reference seniority, function, or team specific to THIS role. Pull from the JOB DESCRIPTION body and from job_signals (function_tags, isSeniorRole, jobFamily, salesSubFamily). Forbid generic phrasing — no "alumni network," "LinkedIn connections," "people at the company," "industry professionals." Must name a role type and team context (e.g., "engineering managers and recent hires on the platform team," "senior product designers in the consumer org," "directors of investor relations at mid-market PE firms").
- networking_strategy.outreach_angle MUST anchor on the SAME lead_signal as cover_letter_strategy.lead_signal — the top why_code's match_key. Same anchor, different format. The candidate's strongest qualification is the through-line across all three assets (cover letter, networking, resume positioning). Do not pick a different qualification for the outreach angle.
- networking_strategy fields: one sentence each, 25 words max per field.
- IMPORTANT: Adding networking_strategy must NOT cause why_bullets, risk_bullets, or cover_letter_strategy to be shortened. Each section must remain at the length specified above. Do not reduce field counts or word counts in earlier sections to make room.

---

## OUTPUT FORMAT
Respond ONLY with valid JSON. No preamble, no markdown fences, no commentary.

CRITICAL: Only generate risk_bullets for risk_codes that are explicitly provided above. If risk_codes is an empty array, you MUST return "risk_bullets": []. Never invent risks.

CRITICAL: If the DECISION is "Pass", you MUST return null for BOTH cover_letter_strategy and networking_strategy (literal JSON null, not empty objects). The user shouldn't apply.

{
  "why_bullets": [
    {
      "keyword": "3-5 WORD ALL-CAPS LABEL",
      "lead": "One sentence naming the specific employer, role, outcome, or metric from their profile.",
      "connection": "One sentence connecting that specific experience to the job requirement, using the job's own language.",
      "action": "One concrete instruction — exactly what to do, where, and how."
    }
  ],
  "risk_bullets": [
    {
      "keyword": "3-5 WORD ALL-CAPS LABEL",
      "gap": "One sentence naming the specific gap clearly and without sugar-coating.",
      "reframe": "One to two sentences: the adjacent evidence that bridges it. No quoted language.",
      "severity": "low | medium | high"
    }
  ],
  "cover_letter_strategy": {
    "open_with": "Specific experience or metric to open the cover letter with",
    "lead_signal": "The match_key from the top why_code",
    "address_gap": "Specific gap to address and how — or null if no risks",
    "tone": "One short phrase"
  },
  "networking_strategy": {
    "target_contacts": "Specific role type, seniority, and team context (e.g. 'senior product designers in the consumer org'). One sentence, max 25 words.",
    "outreach_angle": "What to lead with in the first message, anchored on the same lead_signal as cover_letter_strategy. One sentence, max 25 words."
  }
}
`
}

// ─── Formatters (structured → string for backward compat) ────────────────────

function formatWhyBullet(b: WhyBullet): string {
  return b.lead + " " + b.connection + " -> " + b.action
}

function formatRiskBullet(b: RiskBullet): string {
  return b.gap + " " + b.reframe
}

// ─── Validators for nullable strategy fields ─────────────────────────────────
// Both strategy fields are nullable (Pass-skip) and may also be missing or
// malformed in the model response. These helpers return true only if every
// required sub-field is a non-empty string. address_gap on
// cover_letter_strategy is allowed to be null per its type contract.

function isValidCoverLetterStrategy(s: any): s is CoverLetterStrategy {
  if (s == null || typeof s !== "object") return false
  if (typeof s.open_with !== "string" || s.open_with.length === 0) return false
  if (typeof s.lead_signal !== "string" || s.lead_signal.length === 0) return false
  if (typeof s.tone !== "string" || s.tone.length === 0) return false
  // address_gap may be null; only reject if explicitly the wrong type
  if (s.address_gap != null && typeof s.address_gap !== "string") return false
  return true
}

function isValidNetworkingStrategy(s: any): s is NetworkingStrategy {
  if (s == null || typeof s !== "object") return false
  if (typeof s.target_contacts !== "string" || s.target_contacts.length === 0) return false
  if (typeof s.outreach_angle !== "string" || s.outreach_angle.length === 0) return false
  return true
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function generateBulletsV5(out: EvalOutput): Promise<V5Output> {
  const t0 = Date.now()

  // Hard guard: if no risk_codes, skip Claude for risks entirely
  const hasRisks = Array.isArray(out.risk_codes) && out.risk_codes.length > 0

  // For PASS decisions, cap WHY bullets at 2 — enough to show transferable strengths
  // without making an apply case for a role the student shouldn't pursue
  const isPass = String(out.decision).toLowerCase() === "pass"

  const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      // Bumped from 2048 to 4096 because candidate profiles with many
      // evidence units (e.g. pre-med candidates with 25+ clinical bullets)
      // produce output JSON that gets truncated mid-response at 2048,
      // causing JSON.parse to fail and silently falling back to the V4
      // template renderer — which produces generic placeholder bullets.
      max_tokens: 4096,
      messages: [{ role: "user", content: buildPrompt(out) }],
    }),
  })

  if (!apiResponse.ok) {
    throw new Error(
      "Anthropic API error: " + apiResponse.status + " " + (await apiResponse.text())
    )
  }

  const json = await apiResponse.json()
  const usage = json.usage ?? {}

  const rawJson = (json.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => String(b.text ?? ""))
    .join("")

  // Strip markdown fences and extract JSON object
  // Note: backtick chars built via fromCharCode to avoid Turbopack parse error
  const _t = String.fromCharCode(96)
  const _fence = _t + _t + _t
  const fenceStripped = rawJson.split(_fence + "json").join("").split(_fence).join("").trim()
  const firstBrace = fenceStripped.indexOf("{")
  const lastBrace = fenceStripped.lastIndexOf("}")
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error(
      "V5 no JSON object found. Raw snippet: " + rawJson.slice(0, 200)
    )
  }
  const clean = fenceStripped.slice(firstBrace, lastBrace + 1)

  let parsed: {
    why_bullets: WhyBullet[]
    risk_bullets: RiskBullet[]
    cover_letter_strategy: CoverLetterStrategy | null
    networking_strategy: NetworkingStrategy | null
  }

  try {
    parsed = JSON.parse(clean)
  } catch {
    throw new Error(
      "V5 JSON parse failed. Raw snippet: " + rawJson.slice(0, 400)
    )
  }

  const allWhyBullets = parsed.why_bullets ?? []
  const whyBullets = isPass ? allWhyBullets.slice(0, 2) : allWhyBullets
  const riskBullets = hasRisks ? (parsed.risk_bullets ?? []) : []

  // Strategy field guards. Belt-and-suspenders against model ignoring the
  // Pass-skip rule: force null for both on Pass regardless of model output.
  // For non-Pass decisions, validate shape; missing or malformed → null + warn
  // rather than throwing. The result page handles null gracefully.
  let coverLetterStrategy: CoverLetterStrategy | null = null
  let networkingStrategy: NetworkingStrategy | null = null

  if (!isPass) {
    if (isValidCoverLetterStrategy(parsed.cover_letter_strategy)) {
      coverLetterStrategy = parsed.cover_letter_strategy
    } else {
      console.warn(
        "[V5] cover_letter_strategy missing or malformed for non-Pass decision; setting to null. Decision: " +
          out.decision
      )
    }
    if (isValidNetworkingStrategy(parsed.networking_strategy)) {
      networkingStrategy = parsed.networking_strategy
    } else {
      console.warn(
        "[V5] networking_strategy missing or malformed for non-Pass decision; setting to null. Decision: " +
          out.decision
      )
    }
  }
  // else: isPass — leave both as null (the initialized value).

  return {
    why: whyBullets.map(formatWhyBullet),
    risk: riskBullets.map(formatRiskBullet),
    why_structured: whyBullets,
    risk_structured: riskBullets,
    cover_letter_strategy: coverLetterStrategy,
    networking_strategy: networkingStrategy,
    renderer_debug: {
      renderer_stamp: RENDERER_V5_STAMP,
      model: MODEL,
      decision: out.decision,
      why_count: whyBullets.length,
      risk_count: riskBullets.length,
      prompt_tokens: usage.input_tokens,
      completion_tokens: usage.output_tokens,
      latency_ms: Date.now() - t0,
    },
  }
}