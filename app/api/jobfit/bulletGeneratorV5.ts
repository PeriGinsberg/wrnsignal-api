/**
 * bulletGeneratorV5.ts
 * Drop into: app/api/jobfit/bulletGeneratorV5.ts
 *
 * AI-powered bullet renderer. Replaces the deterministic V4 templates with
 * Claude-generated, specific, actionable, personalized bullets.
 *
 * Returns the same shape as V4 ({ why, risk, renderer_debug })
 * PLUS why_structured, risk_structured, and cover_letter_strategy.
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

export interface V5Output {
  /** Formatted strings — backward-compatible with every V4 consumer */
  why: string[]
  risk: string[]
  /** Structured objects for the frontend and cover letter route */
  why_structured: WhyBullet[]
  risk_structured: RiskBullet[]
  cover_letter_strategy: CoverLetterStrategy
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
- Use the actual evidence from the profile. Name the employer, name the metric, name the outcome.
- Never say "your background includes X" — say what they specifically did.
- If the profile_fact mentions a metric (e.g. "grew client follower base by 200%"), that number MUST appear in the bullet.
- If the profile names an employer (e.g. "Alpha PR"), use that name.

### On transferable skills (MOST IMPORTANT)
- When the student's experience doesn't obviously match the job requirement, make the translation explicit.
- Students think in job titles — your job is to show them their experience in the hiring manager's language.
- Example: "Running a 300-member chapter required budget oversight, compliance management, and cross-functional coordination — those are operations management skills, even if you've never had that title."
- Never leave the student to make this connection themselves.

### On action instructions
- Every WHY bullet must end with ONE specific instruction.
- Not "highlight this in your application" — tell them EXACTLY what to do: which sentence to lead with, which metric to name, which experience to frame first.
- Be specific enough that the student could follow the instruction without any additional guidance.

### On risk reframes
- Don't just name the gap — reframe it.
- Show the student what adjacent experience they have that partially bridges it.
- Give them exact language to use in their cover letter.
- Never leave them feeling helpless. Every gap has a reframe.

### On the cover letter strategy
- The top WHY signal (highest-weight why_code) becomes the cover letter opening.
- The top RISK becomes the gap to address directly.
- If there are no risks, set address_gap to null.
- Tone should reflect the decision: "confident" for Apply/Priority Apply, "measured" for Review, "honest and direct" for Pass.

---

## OUTPUT FORMAT
Respond ONLY with valid JSON. No preamble, no markdown fences, no commentary.

{
  "why_bullets": [
    {
      "keyword": "SHORT ALL-CAPS LABEL FOR THIS STRENGTH",
      "lead": "One sentence naming the specific employer, role, outcome, or metric from their profile.",
      "connection": "One sentence connecting that specific experience to the job requirement, using the job's own language.",
      "action": "One concrete instruction — exactly what to write, lead with, or name in the application."
    }
  ],
  "risk_bullets": [
    {
      "keyword": "SHORT ALL-CAPS LABEL FOR THIS RISK",
      "gap": "One sentence naming the specific gap clearly and without sugar-coating.",
      "reframe": "One to two sentences: the adjacent evidence that bridges it, plus exact cover letter language to use.",
      "severity": "low | medium | high"
    }
  ],
  "cover_letter_strategy": {
    "open_with": "Specific experience or metric to open the cover letter with",
    "lead_signal": "The match_key from the top why_code",
    "address_gap": "Specific gap to address and how — or null if no risks",
    "tone": "One short phrase"
  }
}`
}

// ─── Formatters (structured → string for backward compat) ────────────────────

function formatWhyBullet(b: WhyBullet): string {
  return `${b.lead} ${b.connection} → ${b.action}`
}

function formatRiskBullet(b: RiskBullet): string {
  return `${b.gap} ${b.reframe}`
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function generateBulletsV5(out: EvalOutput): Promise<V5Output> {
  const t0 = Date.now()

  const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: buildPrompt(out) }],
    }),
  })

  if (!apiResponse.ok) {
    throw new Error(`Anthropic API error: ${apiResponse.status} ${await apiResponse.text()}`)
  }

  const json = await apiResponse.json()
  const usage = json.usage ?? {}

  const rawJson = (json.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => String(b.text ?? ""))
    .join("")

  const clean = rawJson
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()

  let parsed: {
    why_bullets: WhyBullet[]
    risk_bullets: RiskBullet[]
    cover_letter_strategy: CoverLetterStrategy
  }

  try {
    parsed = JSON.parse(clean)
  } catch {
    throw new Error(
      `V5 JSON parse failed. Raw snippet: ${rawJson.slice(0, 400)}`
    )
  }

  const whyBullets = parsed.why_bullets ?? []
  const riskBullets = parsed.risk_bullets ?? []

  return {
    why: whyBullets.map(formatWhyBullet),
    risk: riskBullets.map(formatRiskBullet),
    why_structured: whyBullets,
    risk_structured: riskBullets,
    cover_letter_strategy: parsed.cover_letter_strategy,
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