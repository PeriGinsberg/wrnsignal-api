// app/api/jobfit/bulletGenerator.ts
import OpenAI from "openai"
import { BANNED_PHRASES, validateBullets } from "./bulletValidator"

type BulletOutput = {
  why_bullets: string[]
  risk_bullets: string[]
  reasoning: string
}

type GenerateBulletsOptions = {
  model?: string // e.g. "gpt-4.1-mini" or whatever you use
  temperature?: number // keep low
  maxRetries?: number // validator retries
  strictGates?: boolean // if true, WHY = 0 when any gates
  requestId?: string // for logging
}

function safeJsonParse<T>(raw: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    const v = JSON.parse(raw)
    return { ok: true, value: v }
  } catch (e: any) {
    return { ok: false, error: e?.message || "Invalid JSON" }
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function buildSystemPrompt(): string {
  return [
    "You write hiring-decision bullets for a job fit engine.",
    "You must follow the provided Evidence Packet exactly.",
    "You are NOT allowed to change the decision, score, or gates.",
    "No generic language. No contradictions. No fluff.",
    "Every bullet must reference at least one job fact and one profile fact from the packet.",
    "Use crisp, specific, professional language. Avoid em dashes.",
    "Return JSON only.",
  ].join("\n")
}

function buildUserPrompt(evidence: any, strictGates: boolean, violations?: string[]): string {
  const whyMin = evidence?.output_rules?.why_min ?? 3
  const whyMax = evidence?.output_rules?.why_max ?? 6
  const riskMin = evidence?.output_rules?.risk_min ?? 0
  const riskMax = evidence?.output_rules?.risk_max ?? 6

  const gates = Array.isArray(evidence?.gates) ? evidence.gates : []
  const hasGates = gates.length > 0

  const effectiveWhyMin = strictGates && hasGates ? 0 : whyMin
  const effectiveWhyMax = strictGates && hasGates ? 0 : whyMax

  const base = [
    "Generate JobFit memo bullets using this Evidence Packet.",
    "",
    "Non-negotiables:",
    `1) Do not change decision, score, or gates.`,
    `2) WHY bullets: ${effectiveWhyMin}-${effectiveWhyMax} bullets. Each must be unique, concrete, and directly supported by drivers.why_evidence.`,
    `3) RISK bullets: ${riskMin}-${riskMax} bullets. Each must be concrete and supported by drivers.risk_evidence. Do not repeat WHY bullets.`,
    `4) No generic phrases like: "strong communicator", "fast learner", "passionate", "hardworking", "team player" unless explicitly supported by a proof point.`,
    `5) No contradictions:`,
    `   - If there is any hard gate, decision must remain Pass.`,
    `   - If strictGates=true and any gate exists, WHY bullets must be 0 and risks should explain viability blockers.`,
    `   - If a risk is "high", it must appear as a risk bullet.`,
    `6) Output JSON only matching the schema below.`,
    "",
    "Output JSON schema:",
    "{",
    '  "why_bullets": string[],',
    '  "risk_bullets": string[],',
    '  "reasoning": string',
    "}",
  ].join("\n")

  const fixBlock = violations?.length
    ? "\n\nYour previous output violated the rules.\nFix ONLY the bullets and reasoning.\nViolations:\n- " +
      violations.join("\n- ")
    : ""

  return base + fixBlock + "\n\nEvidence Packet:\n" + JSON.stringify(evidence)
}

function deterministicFallback(evidence: any, strictGates: boolean): BulletOutput {
  const gates = Array.isArray(evidence?.gates) ? evidence.gates : []
  const hasGates = gates.length > 0

  const whyMin = evidence?.output_rules?.why_min ?? 3
  const whyMax = evidence?.output_rules?.why_max ?? 6
  const riskMin = evidence?.output_rules?.risk_min ?? 0
  const riskMax = evidence?.output_rules?.risk_max ?? 6

  const effWhyMin = strictGates && hasGates ? 0 : whyMin
  const effWhyMax = strictGates && hasGates ? 0 : whyMax

  const whyEvidence = Array.isArray(evidence?.drivers?.why_evidence) ? evidence.drivers.why_evidence : []
  const riskEvidence = Array.isArray(evidence?.drivers?.risk_evidence) ? evidence.drivers.risk_evidence : []

  const whyCount = clamp(whyEvidence.length, effWhyMin, effWhyMax)
  const riskCount = clamp(riskEvidence.length, riskMin, riskMax)

  const why_bullets =
    effWhyMax === 0
      ? []
      : whyEvidence.slice(0, Math.max(whyCount, effWhyMin)).map((w: any) => {
          const jf = w?.job_fact ? String(w.job_fact).trim() : ""
          const pf = w?.profile_fact ? String(w.profile_fact).trim() : ""
          const link = w?.link ? String(w.link).trim() : ""
          // Keep it crisp and evidence-bound
          return link || (jf && pf ? `${jf}; profile evidence: ${pf}.` : jf || pf || "Direct fit evidence.")
        })

  const risk_bullets = riskEvidence
    .slice(0, Math.max(riskCount, riskMin))
    .map((r: any) => String(r?.risk || r?.job_fact || "Execution risk.").trim())
    .filter(Boolean)

  const decision = evidence?.decision ? String(evidence.decision) : "Review"
  const score = typeof evidence?.score === "number" ? evidence.score : null

  const gateText =
    hasGates && gates.length
      ? ` Gates: ${gates.map((g: any) => g?.detail || g?.type).filter(Boolean).join("; ")}.`
      : ""

  return {
    why_bullets,
    risk_bullets,
    reasoning:
      `Decision is ${decision}${score !== null ? ` with score ${score}` : ""}.` +
      gateText +
      " Bullets derived from structured evidence.",
  }
}

export async function generateJobfitBullets(
  evidence: any,
  opts: GenerateBulletsOptions = {}
): Promise<{
  bullets: BulletOutput
  used_fallback: boolean
  attempts: number
  last_violations: string[]
}> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const model = opts.model || process.env.JOBFIT_BULLET_MODEL || "gpt-4.1-mini"
  const temperature = typeof opts.temperature === "number" ? opts.temperature : 0.2
  const maxRetries = typeof opts.maxRetries === "number" ? opts.maxRetries : 2
  const strictGates = opts.strictGates !== false // default true
  const requestId = opts.requestId || evidence?.id || "jobfit"

  // quick strict gate enforcement at generator boundary
  const gates = Array.isArray(evidence?.gates) ? evidence.gates : []
  const hasGates = gates.length > 0
  if (strictGates && hasGates) {
    // force output rules for WHY to 0-0 so LLM cannot produce WHY
    evidence = {
      ...evidence,
      output_rules: { ...(evidence.output_rules || {}), why_min: 0, why_max: 0 },
    }
  }

  let attempts = 0
  let lastViolations: string[] = []

  // First attempt plus repair attempts
  while (attempts <= maxRetries) {
    attempts++

    const userPrompt = buildUserPrompt(evidence, strictGates, attempts === 1 ? undefined : lastViolations)

    try {
      const resp = await client.chat.completions.create({
        model,
        temperature,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: userPrompt },
        ],
        // Encourage JSON-only output
        response_format: { type: "json_object" } as any,
      })

      const text = resp.choices?.[0]?.message?.content || ""
      const parsed = safeJsonParse<BulletOutput>(text)

      if (!parsed.ok) {
        lastViolations = [`Invalid JSON: ${parsed.error}`]
        continue
      }

      const out = parsed.value

      // normalize arrays
      out.why_bullets = Array.isArray(out.why_bullets) ? out.why_bullets.filter(Boolean) : []
      out.risk_bullets = Array.isArray(out.risk_bullets) ? out.risk_bullets.filter(Boolean) : []
      out.reasoning = typeof out.reasoning === "string" ? out.reasoning : ""

      // extra hard cleanup: remove em dashes and trim
      out.why_bullets = out.why_bullets.map((b) => b.replace(/[\u2013\u2014]/g, "-").trim())
      out.risk_bullets = out.risk_bullets.map((b) => b.replace(/[\u2013\u2014]/g, "-").trim())
      out.reasoning = out.reasoning.replace(/[\u2013\u2014]/g, "-").trim()

      const validation = validateBullets(out, evidence, BANNED_PHRASES)

      if (validation.ok) {
        return { bullets: out, used_fallback: false, attempts, last_violations: [] }
      }

      lastViolations = validation.violations
    } catch (e: any) {
      lastViolations = [`LLM call failed: ${e?.message || String(e)}`]
    }
  }

  // If we reach here, use fallback
  const fallback = deterministicFallback(evidence, strictGates)

  // last pass: strip any banned phrases that might appear in fallback links
  const scrub = (s: string) => {
    let t = s
    for (const p of BANNED_PHRASES) {
      const np = normalize(p)
      const re = new RegExp(`\\b${np.replace(/\s+/g, "\\s+")}\\b`, "ig")
      t = normalize(t).replace(re, "").trim()
    }
    return t
  }

  fallback.why_bullets = fallback.why_bullets.map(scrub).filter(Boolean)
  fallback.risk_bullets = fallback.risk_bullets.map(scrub).filter(Boolean)
  fallback.reasoning = scrub(fallback.reasoning)

  return { bullets: fallback, used_fallback: true, attempts, last_violations: lastViolations }
}