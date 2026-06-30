// FILE: lib/jobfit/freeScanPerception.ts
//
// FREE-SCAN PERCEPTION BRIDGE — Path A, EXPLICITLY TEMPORARY.
//
// STATUS: thin, isolated bridge that derives a perception-archetype read for the
// new free-scan results UI from today's legacy engine output. This is a STOPGAP.
// engineContract.ts's evaluate-once / project-twice model (FitVerdict +
// PositioningVerdict → LensProjection "free") REPLACES this module once wired.
// Keep it self-contained: no imports from signals.ts / bulletGeneratorV5 (loose
// structural input types) so deleting it later is a one-file removal.
//
// Contract:
//   computeFreeScanPerception({ resumeText, jobText, decision, gateTriggered,
//     riskCodes, whyStructured }) → FreeScanPerception | null
//   FAILS OPEN: any error / missing key / non-200 / parse fail → null. The UI
//   falls back to the existing decision/score render; the scan never blocks.
//
// Composition:
//   - archetype  : DETERMINISTIC (no LLM) — gate + decision + risk codes.
//   - strengths  : DETERMINISTIC (no LLM) — from whyStructured keywords.
//   - perception / marked_lines / margin_notes / verdict_line / cta_lead : ONE
//     Haiku call (temp 0), with a server-side verbatim-substring grounding guard
//     on every marked line. Cached per-run (sha256 of model|resume|jd).

import { createHash } from "crypto"

// ── Mirror bulletGeneratorV5's Claude integration (raw fetch, no SDK) ──────────
const MODEL = "claude-haiku-4-5-20251001"
const ANTHROPIC_VERSION = "2023-06-01"
const MAX_TOKENS = 1024
const SEP = "␟" // unit separator for the cache key (mirrors semanticRelevance.verdictKey)

// ── Output types ──────────────────────────────────────────────────────────────
export type FreeScanArchetype = "STRONG_FIT" | "MISPOSITIONED" | "WRONG_FIELD"

export interface FreeScanMarkedLine {
  line: string // verbatim substring of the resume (grounding-guarded)
  mark: "underline" | "circle"
  tone: "positive" | "problem"
}

export interface FreeScanMarginNote {
  text: string // 3-4 word handwritten-style scrawl
  tone: "positive" | "problem" | "neutral"
}

export interface FreeScanPerception {
  archetype: FreeScanArchetype
  strengths: string[] // 2-3 tick strings (deterministic)
  perception: string // one-line recruiter read (LLM)
  marked_lines: FreeScanMarkedLine[] // 2-3, verbatim-grounded (LLM + guard)
  margin_notes: FreeScanMarginNote[] // up to 3, ordered top→bottom (LLM)
  verdict_line: string // one-line bottom call (LLM)
  cta_lead: string // one-line lead into upgrade (LLM)
}

// ── Loose structural inputs (kept decoupled from signals.ts on purpose) ────────
export interface ComputeFreeScanPerceptionArgs {
  resumeText: string
  jobText: string
  decision: string
  gateTriggered?: { type?: string; gateCode?: string } | null
  riskCodes?: Array<{ code?: string | null } | null> | null
  whyStructured?: Array<{ keyword?: string | null; connection?: string | null } | null> | null
}

// ── (1) ARCHETYPE — deterministic ──────────────────────────────────────────────
// Auditable positioning-risk set. NOTE: RISK_ROLE_ARCHETYPE is intentionally NOT
// here — it was retired (commit c8bddb46) and is emitted nowhere.
const POSITIONING_RISK_CODES = [
  "RISK_SUBFAMILY_MISMATCH",
  "RISK_FAMILY_MISMATCH",
  "RISK_AMBIGUOUS_ROLE",
  "RISK_SALES_SUBSEGMENT",
  "RISK_CONTENT_ROLE_CONFLICT",
] as const

function deriveArchetype(args: ComputeFreeScanPerceptionArgs): FreeScanArchetype {
  const codes = new Set(
    (args.riskCodes ?? [])
      .map((r) => (r && typeof r.code === "string" ? r.code : null))
      .filter((c): c is string => !!c)
  )
  const fieldGate =
    args.gateTriggered?.type === "force_pass" &&
    args.gateTriggered?.gateCode === "GATE_FIELD_MISMATCH"
  if (fieldGate) return "WRONG_FIELD"

  const hasPositioningRisk = POSITIONING_RISK_CODES.some((c) => codes.has(c))
  const isApply = args.decision === "Apply" || args.decision === "Priority Apply"
  if (isApply && !hasPositioningRisk) return "STRONG_FIT"
  if (hasPositioningRisk || args.decision === "Review") return "MISPOSITIONED"
  return "MISPOSITIONED" // Pass, no field gate
}

// ── (2) STRENGTHS — deterministic, cap 3 ───────────────────────────────────────
function buildStrengths(
  whyStructured: ComputeFreeScanPerceptionArgs["whyStructured"]
): string[] {
  const out: string[] = []
  for (const w of whyStructured ?? []) {
    const kw = String(w?.keyword ?? "").trim()
    if (!kw) continue
    const conn = String(w?.connection ?? "").trim()
    out.push(conn ? `${kw} — ${conn}` : kw)
    if (out.length >= 3) break
  }
  return out
}

// ── (3) Haiku call ─────────────────────────────────────────────────────────────
export const FREE_SCAN_PERCEPTION_SYSTEM_PROMPT = `You are a sharp, experienced recruiter giving a candidate the honest 7-second read on their resume against one job. You speak plainly and directly, like a real person who screens hundreds of resumes — warm but unsentimental, never corporate, never a cheerleader. You name what you actually see.

You receive: the candidate's RESUME (verbatim), the JOB DESCRIPTION, the engine's DECISION, and a precomputed ARCHETYPE for this scan (STRONG_FIT, MISPOSITIONED, or WRONG_FIELD). Write your read to match that archetype:
- STRONG_FIT: right field, right work, and the resume proves it. Confident and encouraging — "go apply, you don't need me for this one."
- MISPOSITIONED: the candidate can likely do the job, but the resume leads with the wrong story, reads as something else, or buries the relevant proof. The problem is the page, not the person.
- WRONG_FIELD: this is a different career. The candidate may be genuinely strong, but not for THIS role, and a rewrite will not fix it. Be honest and kind, and redirect — never pretend a wording change closes the gap.

HARD GROUNDING RULES (absolute):
1. Every string in "marked_lines" MUST be copied VERBATIM from the RESUME — an exact, character-for-character substring of a real resume line (whitespace aside). NEVER invent, paraphrase, summarize, or stitch together lines. If you are not certain a line appears verbatim in the resume, leave it out.
2. Mark 2-3 resume lines total. Use "underline" for strong, relevant proof (tone "positive") and "circle" for the line that reveals the problem — the off-target or misleading one (tone "problem"). For STRONG_FIT, all marks are positive underlines. For WRONG_FIELD, circle the line that shows the wrong field.
3. Write exactly 3 "margin_notes": short handwritten-style scrawls of 3-4 words each, ordered top-to-bottom as a recruiter's eye moves down the page. tone is "positive", "problem", or "neutral". They should feel like real margin scribbles (e.g. "solid degree", "wait, marketing?!", "no code anywhere").
4. "perception" is ONE sentence: how a recruiter perceives this candidate after the 7-second scan (e.g. "Reads as a salesperson, not a marketer.").
5. "verdict_line" is ONE short, punchy sentence — the bottom-line call, in the recruiter's voice.
6. "cta_lead" is ONE sentence leading into the next step, matched to the archetype (fix the positioning / find roles you actually win / polish it and apply).

Return ONLY a JSON object — no preamble, no commentary, no markdown — exactly this shape:
{"perception": string, "marked_lines": [{"line": string, "mark": "underline"|"circle", "tone": "positive"|"problem"}], "margin_notes": [{"text": string, "tone": "positive"|"problem"|"neutral"}], "verdict_line": string, "cta_lead": string}`

function buildUserPrompt(args: {
  resumeText: string
  jobText: string
  decision: string
  archetype: FreeScanArchetype
  riskCodes: string[]
}): string {
  return `ARCHETYPE: ${args.archetype}
ENGINE DECISION: ${args.decision}
RISK CODES: ${args.riskCodes.length ? args.riskCodes.join(", ") : "(none)"}

JOB DESCRIPTION:
"""
${args.jobText}
"""

CANDIDATE RESUME (verbatim — every marked_lines[].line MUST be copied exactly from this text):
"""
${args.resumeText}
"""

Return ONLY the JSON object.`
}

interface LLMPerceptionRaw {
  perception?: unknown
  marked_lines?: unknown
  margin_notes?: unknown
  verdict_line?: unknown
  cta_lead?: unknown
}

function parsePerception(rawText: string): LLMPerceptionRaw | null {
  // Fence-strip via String.fromCharCode(96) to avoid Turbopack parse error
  // (same convention as bulletGeneratorV5 / extractJobSignalsLLM).
  const t = String.fromCharCode(96)
  const fence = t + t + t
  const stripped = rawText.split(fence + "json").join("").split(fence).join("").trim()
  const a = stripped.indexOf("{")
  const b = stripped.lastIndexOf("}")
  if (a === -1 || b === -1) return null
  try {
    const obj = JSON.parse(stripped.slice(a, b + 1))
    if (!obj || typeof obj !== "object") return null
    return obj as LLMPerceptionRaw
  } catch {
    return null
  }
}

async function callPerceptionLLM(args: {
  resumeText: string
  jobText: string
  decision: string
  archetype: FreeScanArchetype
  riskCodes: string[]
}): Promise<LLMPerceptionRaw | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: FREE_SCAN_PERCEPTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(args) }],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`[freeScanPerception] http ${res.status} ${body.slice(0, 200)}`)
      return null
    }
    const json: any = await res.json()
    const rawText = (json?.content ?? [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => String(b?.text ?? ""))
      .join("")
    return parsePerception(rawText)
  } catch (err: any) {
    console.error("[freeScanPerception] call error:", err?.message || String(err))
    return null
  }
}

// ── (4) GROUNDING GUARD — verbatim-substring check ─────────────────────────────
function normalizeWs(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase()
}

function groundMarkedLines(raw: unknown, resumeText: string): FreeScanMarkedLine[] {
  if (!Array.isArray(raw)) return []
  const haystack = normalizeWs(resumeText)
  const out: FreeScanMarkedLine[] = []
  for (const item of raw) {
    if (out.length >= 3) break
    const line = String((item as any)?.line ?? "").trim()
    if (!line) continue
    const needle = normalizeWs(line)
    if (needle.length < 3) continue
    // Drop any line that is not a verbatim substring of the resume.
    if (!haystack.includes(needle)) continue
    const mark: FreeScanMarkedLine["mark"] =
      (item as any)?.mark === "circle" ? "circle" : "underline"
    const tone: FreeScanMarkedLine["tone"] =
      (item as any)?.tone === "problem" ? "problem" : "positive"
    out.push({ line, mark, tone })
  }
  return out
}

function sanitizeNotes(raw: unknown): FreeScanMarginNote[] {
  if (!Array.isArray(raw)) return []
  const out: FreeScanMarginNote[] = []
  for (const item of raw) {
    if (out.length >= 3) break
    const text = String((item as any)?.text ?? "").trim()
    if (!text) continue
    const t = (item as any)?.tone
    const tone: FreeScanMarginNote["tone"] =
      t === "problem" ? "problem" : t === "neutral" ? "neutral" : "positive"
    out.push({ text, tone })
  }
  return out
}

// ── (5) CACHE — module-scope, per warm instance (mirrors SEMANTIC_VERDICT_CACHE) ─
const PERCEPTION_CACHE: Record<string, FreeScanPerception> = {}

function cacheKey(resumeText: string, jobText: string): string {
  return createHash("sha256").update(`${MODEL}${SEP}${resumeText}${SEP}${jobText}`).digest("hex")
}

// ── Public entry ───────────────────────────────────────────────────────────────
export async function computeFreeScanPerception(
  args: ComputeFreeScanPerceptionArgs
): Promise<FreeScanPerception | null> {
  try {
    const resumeText = String(args.resumeText ?? "")
    const jobText = String(args.jobText ?? "")
    // Can't ground line citations without a resume; bail (fail open).
    if (resumeText.trim().length === 0 || jobText.trim().length === 0) return null

    const key = cacheKey(resumeText, jobText)
    const cached = PERCEPTION_CACHE[key]
    if (cached) return cached

    const archetype = deriveArchetype(args)
    const strengths = buildStrengths(args.whyStructured)
    const riskCodeList = (args.riskCodes ?? [])
      .map((r) => (r && typeof r.code === "string" ? r.code : null))
      .filter((c): c is string => !!c)

    const llm = await callPerceptionLLM({
      resumeText,
      jobText,
      decision: String(args.decision ?? ""),
      archetype,
      riskCodes: riskCodeList,
    })
    if (!llm || typeof llm.perception !== "string") return null

    const result: FreeScanPerception = {
      archetype,
      strengths,
      perception: String(llm.perception).trim(),
      marked_lines: groundMarkedLines(llm.marked_lines, resumeText),
      margin_notes: sanitizeNotes(llm.margin_notes),
      verdict_line: String(llm.verdict_line ?? "").trim(),
      cta_lead: String(llm.cta_lead ?? "").trim(),
    }

    PERCEPTION_CACHE[key] = result
    return result
  } catch (err: any) {
    console.error("[freeScanPerception] failed:", err?.message || String(err))
    return null
  }
}
