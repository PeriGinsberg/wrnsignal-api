// app/api/jobfit/semanticRelevance.ts
//
// Semantic evidence-relevance layer — STAGE 2: the gated relevance call +
// verdict cache. See docs/jobfit-semantic-relevance-layer-scope.md.
//
// For a SUSPECT match (see semanticGate.ts) this asks Haiku one question: does
// this candidate evidence genuinely satisfy this specific job requirement —
// same domain, same specialization — or is it a generic/transferable skill that
// merely sounds related? The engine acts (Stage 3) ONLY on satisfies:false +
// confidence:high; everything else keeps the credit.
//
// Determinism controls:
//   - pinned model + temperature 0
//   - JSON-via-prompt + fail-open parse (repo convention)
//   - FAIL-OPEN to KEEP: any error / malformed / timeout → satisfies:true so a
//     flaky call can never fabricate a suppression
//   - verdict cache keyed by sha256(model | requirement | evidence); frozen for
//     the test suites so scores are byte-deterministic and CI never calls live

import crypto from "crypto"
import type { StructuredJobSignals } from "./signals"
import { suspectMatches, type GateMatch } from "./semanticGate"

export const RELEVANCE_MODEL = "claude-haiku-4-5-20251001"
const MAX_TOKENS = 150

export type RelevanceVerdict = {
  satisfies: boolean
  confidence: "high" | "med" | "low"
  reason: string
}

// Fail-open default: keep the credit. Used on any error/malformed response.
function keepVerdict(reason: string): RelevanceVerdict {
  return { satisfies: true, confidence: "low", reason }
}

export const RELEVANCE_SYSTEM_PROMPT =
  "You are a strict hiring evaluator. You decide whether ONE piece of a candidate's experience genuinely satisfies ONE specific job requirement. The test is whether the evidence shows the candidate has done the SAME kind of work the requirement calls for — same domain and same level of specialization. A real but generic or transferable skill performed in a DIFFERENT domain does NOT satisfy a specialized requirement, even when both involve the same broad activity (e.g. both involve \"analysis\", \"customer service\", or \"writing\"). Topical overlap is not enough. Return ONLY valid JSON — no markdown, no commentary."

export function buildRelevanceUserPrompt(args: {
  jobContext: string
  requirement: string
  evidence: string
}): string {
  return `Job context: ${args.jobContext}
Job requirement: "${args.requirement}"
Candidate evidence: "${args.evidence}"

Does the candidate evidence genuinely satisfy this job requirement?

- "satisfies": true  — the evidence shows the candidate has actually done the
  specific kind of work the requirement describes, in a domain that genuinely
  transfers.
- "satisfies": false — the evidence is a generic, transferable, or merely
  topically-related skill from a different domain or a less specialized kind of
  work. It sounds related but is not the same work. For example, none of these
  satisfy: retail sales experience offered for a quantitative trading
  requirement; blog writing offered for a legal drafting requirement; managing a
  club budget offered for a corporate FP&A requirement.

Be conservative. Use confidence "high" only when the mismatch (or match) is clear.
If the evidence plausibly demonstrates the required capability, answer true. If
you are genuinely unsure, answer true with "low" or "med" confidence — the credit
is kept unless we are confident it does not apply.

Return ONLY this JSON:
{"satisfies": true|false, "confidence": "high"|"med"|"low", "reason": "one short sentence"}`
}

// Cache key — pinned to model so a model bump re-freezes behind a reviewed diff.
export function verdictKey(requirement: string, evidence: string, model: string = RELEVANCE_MODEL): string {
  return crypto.createHash("sha256").update(`${model}␟${requirement}␟${evidence}`).digest("hex")
}

function parseVerdict(rawText: string): RelevanceVerdict | null {
  const t = String.fromCharCode(96)
  const fence = t + t + t
  const stripped = rawText.split(fence + "json").join("").split(fence).join("").trim()
  const a = stripped.indexOf("{")
  const b = stripped.lastIndexOf("}")
  if (a === -1 || b === -1) return null
  let obj: any
  try { obj = JSON.parse(stripped.slice(a, b + 1)) } catch { return null }
  if (typeof obj?.satisfies !== "boolean") return null
  const conf = String(obj.confidence ?? "").toLowerCase()
  const confidence = conf === "high" || conf === "med" || conf === "low" ? conf : "low"
  return {
    satisfies: obj.satisfies,
    confidence: confidence as RelevanceVerdict["confidence"],
    reason: String(obj.reason ?? "").slice(0, 200),
  }
}

// Live call. FAIL-OPEN: returns a keep verdict on any error/malformed response.
export async function callRelevanceLive(args: {
  jobContext: string
  requirement: string
  evidence: string
}): Promise<RelevanceVerdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return keepVerdict("fail-open: no api key")
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: RELEVANCE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: RELEVANCE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildRelevanceUserPrompt(args) }],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return keepVerdict(`fail-open: http ${res.status} ${body.slice(0, 80)}`)
    }
    const json = await res.json()
    const rawText = (json.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => String(b.text ?? ""))
      .join("")
    const parsed = parseVerdict(rawText)
    return parsed ?? keepVerdict("fail-open: unparseable verdict")
  } catch (err: any) {
    return keepVerdict(`fail-open: ${err?.message || String(err)}`)
  }
}

export type VerdictCache = Record<string, RelevanceVerdict>

// Cache-first lookup. Returns the frozen verdict if present; otherwise calls
// live (when allowLive) and stores it; otherwise fails open to KEEP. In the
// test suites the cache is frozen and allowLive is false → no live calls.
export async function getVerdict(
  cache: VerdictCache,
  args: { jobContext: string; requirement: string; evidence: string },
  opts: { allowLive: boolean }
): Promise<RelevanceVerdict> {
  const key = verdictKey(args.requirement, args.evidence)
  const cached = cache[key]
  if (cached) return cached
  if (!opts.allowLive) return keepVerdict("fail-open: cache miss, live disabled")
  const verdict = await callRelevanceLive(args)
  cache[key] = verdict
  return verdict
}

// Job-context string shown to the LLM (not part of the cache key). Shared by
// the engine and the freeze harness so live prod verdicts match frozen ones.
export function buildJobContext(job: {
  jobTitle?: string | null
  jobFamily?: string
  financeSubFamily?: string | null
}): string {
  const parts: string[] = []
  if (job.jobTitle) parts.push(String(job.jobTitle))
  if (job.jobFamily) parts.push(String(job.jobFamily))
  if (job.financeSubFamily) parts.push(`finance:${job.financeSubFamily}`)
  return parts.join(" — ")
}

// A scoring match, reduced to what suppression resolution needs.
export type RawMatchView = {
  job_unit_key: string
  profile_unit_key: string
  match_strength: "direct" | "adjacent"
  weight: number
  job_fact: string
  profile_fact: string
}

// Observability record emitted per distinct suspect pair evaluated on a scan.
// PII-safe: carries the JD requirement snippet (employer text) but NOT the raw
// candidate evidence snippet — the LLM `reason` paraphrases enough to review.
export type VerdictLog = {
  job_unit_key: string
  profile_unit_key: string
  match_strength: "direct" | "adjacent"
  requirement_snippet: string
  satisfies: boolean
  confidence: "high" | "med" | "low"
  reason: string
  suppressed: boolean
}

// Resolve the set of verdict keys to SUPPRESS for one scan: gate to suspect
// matches, fetch each verdict (cache/live), keep only satisfies:false +
// confidence:high. Returned keys are verdictKey(requirement, evidence) so the
// scorer can match them against its rebuilt matches.
export async function resolveSuppressions(
  matches: RawMatchView[],
  job: StructuredJobSignals,
  cache: VerdictCache,
  opts: { allowLive: boolean; onVerdict?: (log: VerdictLog) => void }
): Promise<Set<string>> {
  const gm: GateMatch[] = matches.map((m) => ({
    job_unit_key: m.job_unit_key,
    profile_unit_key: m.profile_unit_key,
    match_strength: m.match_strength,
    weight: m.weight,
    job_fact: m.job_fact,
  }))
  const suspectKeySet = new Set(
    suspectMatches(gm, job).map((s) => `${s.profile_unit_key}|${s.job_unit_key}|${s.match_strength}`)
  )
  const jobContext = buildJobContext(job)
  const suppressed = new Set<string>()
  const seen = new Set<string>() // one verdict (and one onVerdict) per distinct pair/scan
  for (const m of matches) {
    if (!suspectKeySet.has(`${m.profile_unit_key}|${m.job_unit_key}|${m.match_strength}`)) continue
    if (!m.job_fact || !m.profile_fact) continue
    const key = verdictKey(m.job_fact, m.profile_fact)
    if (seen.has(key)) continue
    seen.add(key)
    const v = await getVerdict(cache, { jobContext, requirement: m.job_fact, evidence: m.profile_fact }, { allowLive: opts.allowLive })
    const suppress = v.satisfies === false && v.confidence === "high"
    if (suppress) suppressed.add(key)
    opts.onVerdict?.({
      job_unit_key: m.job_unit_key,
      profile_unit_key: m.profile_unit_key,
      match_strength: m.match_strength,
      requirement_snippet: m.job_fact,
      satisfies: v.satisfies,
      confidence: v.confidence,
      reason: v.reason,
      suppressed: suppress,
    })
  }
  return suppressed
}
