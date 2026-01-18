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

function normalizeModelDecision(d: any): "Apply" | "Review carefully" | "Pass" {
  const s = String(d || "").trim().toLowerCase()
  if (s === "apply") return "Apply"
  if (s === "review carefully" || s === "review") return "Review carefully"
  if (s === "pass") return "Pass"
  // fallback: if model returns something weird, default to Review carefully
  return "Review carefully"
}

function iconForDecision(decision: string) {
  const d = (decision || "").toLowerCase()
  if (d === "apply") return "✅"
  if (d === "review carefully") return "⚠️"
  return "⛔"
}

function enforceScoreBand(
  decision: "Apply" | "Review carefully" | "Pass",
  score: number
) {
  // Keep decision as source of truth; only nudge score into the band so UI stays consistent.
  if (decision === "Apply") return Math.max(score, 75)
  if (decision === "Review carefully") return Math.min(Math.max(score, 60), 74)
  return Math.min(score, 59)
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

ROLE:
- Decide Apply, Review carefully, or Pass for ONE job.
- Passing is framed as time protection, not rejection.
- Do not motivate, reassure, or soften decisions.

STRICT WORKFLOW:
- JobFit always comes first.
- No resume, cover letter, or networking guidance before a decision.

EVALUATION CONTEXT:
- Early career candidates.
- Do NOT require identical prior role.
- Prioritize signal-building potential and realistic conversion odds.

SIGNAL HIERARCHY (STRICT ORDER):
1) Explicit user interests and exclusions
2) Target roles, industries, environments
3) Confirmed past experience
4) Skill adjacency and comparable responsibility
5) Job description requirements

HARD RULES:
- If the profile explicitly excludes this role, industry, or environment:
  - decision MUST be Pass
  - score MUST be below 60
  - include a risk_flag containing the exact phrase: "explicit exclusion"
- Apply requires strong alignment AND credible signal.
- Review carefully is for stretch roles with realistic upside.

SCORING:
- 0–100 scale
- Apply band: 75–100
- Review carefully band: 60–74
- Pass band: 0–59
- Score must match the decision band.

OUTPUT REQUIREMENTS:
- Reasons must be specific and grounded in profile + job.
- Do NOT use generic traits (hard worker, fast learner, leadership).
- Risk flags MUST call out missing info, competition level, or misalignment.

OUTPUT:
Return valid JSON ONLY:
{
  "decision": "Apply" | "Review carefully" | "Pass",
  "icon": "✅" | "⚠️" | "⛔",
  "score": number,
  "bullets": string[],
  "risk_flags": string[],
  "next_step": string
}
    `.trim()

    const user = `
CLIENT PROFILE:
${profile}

JOB DESCRIPTION:
${job}

Make a JobFit decision.
If information is missing or unclear, reflect that in risk_flags and score.
Return JSON only.
    `.trim()

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })

    // @ts-ignore
    const raw = (resp as any).output_text || ""
    const parsed = safeJsonParse(raw)

    if (!parsed) {
      return new Response(
        JSON.stringify({
          decision: "Review carefully",
          icon: "⚠️",
          score: 60,
          bullets: [
            "Model did not return structured output.",
            "Decision requires manual review.",
          ],
          risk_flags: ["Non-JSON model response"],
          next_step: "Retry with the same job description.",
        }),
        { status: 200, headers: corsHeaders(origin) }
      )
    }

    const decision = normalizeModelDecision(parsed.decision)
    let score = clampScore(parsed.score)

    // If model flagged explicit exclusion, force Pass band
    const riskFlags = Array.isArray(parsed.risk_flags) ? parsed.risk_flags : []
    const hasExplicitExclusion = riskFlags.some((r: any) =>
      String(r || "").toLowerCase().includes("explicit exclusion")
    )

    let finalDecision: "Apply" | "Review carefully" | "Pass" = decision
    if (hasExplicitExclusion) finalDecision = "Pass"

    score = enforceScoreBand(finalDecision, score)

    const out = {
      decision: finalDecision,
      icon: iconForDecision(finalDecision),
      score,
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 8) : [],
      risk_flags: riskFlags.slice(0, 6),
      next_step:
        typeof parsed.next_step === "string"
          ? parsed.next_step
          : "Move on to the next opportunity.",
    }

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: corsHeaders(origin),
    })
  } catch (err: any) {
    const detail = err?.message || String(err)
    const lower = String(detail).toLowerCase()

    const status =
      lower.includes("unauthorized")
        ? 401
        : lower.includes("profile not found")
        ? 404
        : lower.includes("access disabled")
        ? 403
        : 500

    return new Response(JSON.stringify({ error: "JobFit failed", detail }), {
      status,
      headers: corsHeaders(origin),
    })
  }
}
