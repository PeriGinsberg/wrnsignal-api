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

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function normalizeSummaryStatus(v: any): "keep" | "revise" | "create" {
  return v === "keep" || v === "revise" || v === "create" ? v : "keep"
}

function normalizeSignal(v: any): "strong" | "mixed" | "weak" {
  return v === "strong" || v === "mixed" || v === "weak" ? v : "mixed"
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin")
  return new Response(null, { status: 204, headers: corsHeaders(origin) })
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin")

  try {
    // Auth + stored profile (server-side)
    const { profileText } = await getAuthedProfileText(req)
    const profile = profileText

    // Client sends only: { job }
    const body = await req.json()
    const job = String(body?.job || "").trim()

    if (!job) {
      return new Response(JSON.stringify({ error: "Missing job" }), {
        status: 400,
        headers: corsHeaders(origin),
      })
    }

    const system = `
You are SIGNAL by Workforce Ready Now (Positioning module).

MISSION:
Only recommend HIGH-IMPACT resume changes that strengthen the hiring signal for THIS job.
If an edit does not clearly improve keyword alignment OR signal strength, do not suggest it.

WHAT "HIGH-IMPACT" MEANS (must meet at least one):
1) Keyword Alignment: Mirrors a job description keyword or phrase AND the resume already supports it factually.
2) Stronger Signal: Increases clarity of scope, ownership, outcome, or stakeholder without adding new facts.
3) 7-Second Scan: Front-loads the right nouns and verbs so a recruiter instantly understands relevance.

DO NOT DO:
- Grammar cleanup, style tweaks, synonyms for their own sake.
- Edits just to make edits.
- Any change that cannot be defended in an interview.

ANTI-FABRICATION RULES (ABSOLUTE):
- You may only rewrite a bullet by rephrasing what is already explicitly stated in that bullet or its immediate nearby context.
- You may mirror job keywords ONLY if the original resume text already supports them.
- If a tool, domain, industry, methodology, or responsibility is not present in the resume text, you must NOT add it.
- Never change the function or industry of a role.
- If a bullet is too vague to safely align, skip it.

EVIDENCE REQUIREMENT:
For every suggested edit:
- Provide an evidence quote copied verbatim from the resume text that proves the edit is factual.
- If you cannot quote evidence, do not include the edit.

SUMMARY STATEMENT LOGIC:
1) Detect whether a summary/profile statement exists near the top of the resume.
2) If it exists:
   - Decide whether it aligns with the job’s core target keywords and role type.
   - If misaligned, suggest a factual revision with evidence quotes.
   - If aligned, keep it and do not suggest changes.
3) If it does NOT exist:
   - Decide if a summary is needed.
   - Only recommend creating one if the overall signal is mixed or weak and the reader would not immediately understand fit.
   - If signal is strong, explicitly say summary is not needed.

OUTPUT RULES:
- Output 0–8 bullet edits. Fewer is better. Quality over quantity.
- It is acceptable to return zero bullet edits if the resume is already strongly aligned.

Return valid JSON ONLY with this shape:
{
  "intro": string,
  "summary": {
    "status": "keep"|"revise"|"create",
    "before": string|null,
    "after": string|null,
    "rationale": string,
    "evidence": string[]
  },
  "bullets": [
    {
      "job_title": string,
      "before": string,
      "after": string,
      "rationale": string,
      "evidence": string
    }
  ],
  "decision": {
    "overall_signal": "strong"|"mixed"|"weak",
    "why": string,
    "no_edits_needed": boolean
  }
}
    `.trim()

    const user = `
CLIENT PROFILE (includes resume text):
${profile}

JOB DESCRIPTION:
${job}

TASK:
1) Evaluate overall fit signal for this job (strong, mixed, weak).
2) Apply summary statement logic:
   - If summary exists, keep or revise based on alignment.
   - If no summary exists, only create one if signal is mixed or weak.
3) Suggest ONLY high-impact bullet edits.
   - Zero edits is acceptable if nothing meaningful improves alignment or signal.

Hard rules:
- "before" must be copied verbatim from the resume text.
- "after" must be a safe rephrase that mirrors job language ONLY when supported by the original bullet.
- "job_title" must be the role heading the bullet belongs to; if unknown use "Unknown role".
- "evidence" must be a direct quote from resume text proving the edit is factual.
Return JSON only. No markdown. No commentary.
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

    // Fallback if non-JSON
    if (!parsed) {
      return new Response(
        JSON.stringify({
          intro:
            "Intent: strengthen resume signal for this job using only high-impact, fully factual edits (or none if already aligned).",
          summary: {
            status: "keep",
            before: null,
            after: null,
            rationale: "Model did not return JSON. Retry after refreshing and ensuring the job description is fully pasted.",
            evidence: [],
          },
          bullets: [],
          decision: {
            overall_signal: "mixed",
            why: raw || "Non-JSON response.",
            no_edits_needed: false,
          },
        }),
        { status: 200, headers: corsHeaders(origin) }
      )
    }

    const intro =
      typeof parsed.intro === "string"
        ? parsed.intro
        : "Intent: strengthen resume signal for this job using only high-impact, fully factual edits (or none if already aligned)."

    // Normalize summary object
    const summary =
      parsed?.summary && typeof parsed.summary === "object"
        ? {
            status: normalizeSummaryStatus(parsed.summary.status),
            before: typeof parsed.summary.before === "string" ? parsed.summary.before : null,
            after: typeof parsed.summary.after === "string" ? parsed.summary.after : null,
            rationale: typeof parsed.summary.rationale === "string" ? parsed.summary.rationale : "",
            evidence: Array.isArray(parsed.summary.evidence)
              ? parsed.summary.evidence.filter((x: any) => typeof x === "string" && x.trim())
              : [],
          }
        : {
            status: "keep" as const,
            before: null,
            after: null,
            rationale: "",
            evidence: [],
          }

    // Normalize bullets array
    const bulletsRaw = Array.isArray(parsed.bullets) ? parsed.bullets : []
    const bullets = bulletsRaw
      .map((b: any) => ({
        job_title: typeof b?.job_title === "string" && b.job_title.trim() ? b.job_title : "Unknown role",
        before: typeof b?.before === "string" ? b.before : "",
        after: typeof b?.after === "string" ? b.after : "",
        rationale: typeof b?.rationale === "string" ? b.rationale : "",
        evidence: typeof b?.evidence === "string" ? b.evidence : "",
      }))
      // require evidence and verbatim before/after exist
      .filter((b: any) => b.before && b.after && b.evidence)

    // Normalize decision object
    const decision =
      parsed?.decision && typeof parsed.decision === "object"
        ? {
            overall_signal: normalizeSignal(parsed.decision.overall_signal),
            why: typeof parsed.decision.why === "string" ? parsed.decision.why : "",
            no_edits_needed: Boolean(parsed.decision.no_edits_needed),
          }
        : {
            overall_signal: "mixed" as const,
            why: "",
            no_edits_needed: bullets.length === 0 && summary.status !== "revise" && summary.status !== "create",
          }

    // If the model forgot to set no_edits_needed but we have none, set it
    const decisionFinal = {
      ...decision,
      no_edits_needed:
        decision.no_edits_needed ||
        (bullets.length === 0 && summary.status !== "revise" && summary.status !== "create"),
    }

    return new Response(JSON.stringify({ intro, summary, bullets, decision: decisionFinal }), {
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

    return new Response(JSON.stringify({ error: "Positioning failed", detail }), {
      status,
      headers: corsHeaders(origin),
    })
  }
}
