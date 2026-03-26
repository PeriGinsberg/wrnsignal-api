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

## DECISION-AWARE INSTRUCTIONS

If the decision is "Pass":
- WHY bullets should NOT make the case for applying. The student is not applying.
- Instead, generate "Strengths to Remember" bullets — skills and experiences from this evaluation that the student should carry forward to better-fit roles.
- Keep them brief. The goal is to reinforce what's transferable, not to argue against the Pass.
- The tone should be: "Here's what this evaluation confirmed about your strengths" — not "here's why you should apply."

If the decision is "Apply" or "Priority Apply":
- Generate full WHY bullets as normal.

If the decision is "Review":
- Generate WHY bullets but flag clearly which ones are strong vs adjacent.

## CRITICAL INSTRUCTIONS

### On specificity
- Always address the student directly using "you" and "your" — never use their name or third person.
- Name the employer, metric, or outcome. Never say "your background includes X" — say what you specifically did.
- If the profile_fact mentions a metric, that number MUST appear in the bullet.
- No comma-separated lists inside a sentence — pick the single strongest detail.

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
- Never put quoted language in the action instruction. Tell them what to say, not the exact words to use. Instead of: 'Write: "I built audience-first strategies"' — say: 'Lead with your audience research work and frame it as strategic, not just executional.'

### On risk reframes
- Don't just name the gap — reframe it.
- Show the student what adjacent experience they have that partially bridges it.
- Give them exact language to use. Never leave them feeling helpless.
- TOOL RISKS: gap = one sentence. reframe = one sentence naming adjacent evidence + one action. No quoted language.
- ALL OTHER RISKS: gap = one sentence. reframe = two sentences max. No quoted language — tell them what to convey, not the exact words to use.

### On voice and tone
- Write like a sharp advisor talking directly to the student, not like a bot generating output.
- Vary your sentence structure across bullets — don't start every lead the same way.
- The connection sentence should feel like an insight, not a label. Show why it matters, don't just state that it does.
- The action should feel like advice from someone who knows hiring, not a checklist item.


---

## OUTPUT FORMAT
Respond ONLY with valid JSON. No preamble, no markdown fences, no commentary.

{
  "why_bullets": [
    {
      "keyword": "3-5 WORD ALL-CAPS LABEL (e.g. 'MISSING EXCEL EXPERIENCE')",
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
// Hard guard: if no risk_codes, skip Claude for risks entirely
  const hasRisks = Array.isArray(out.risk_codes) && out.risk_codes.length > 0
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
  const riskBullets = hasRisks ? (parsed.risk_bullets ?? []) : []

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