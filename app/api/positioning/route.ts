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

function isNonEmptyString(x: any): x is string {
  return typeof x === "string" && x.trim().length > 0
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

NON-NEGOTIABLE PRINCIPLE:
Only suggest changes that clearly improve hiring signal for THIS job.
If the best answer is "no changes needed", say so.

PRIMARY QUESTION:
"Should I apply, and if yes, how do I compete?"
Your edits must make that answer more obvious in a 7-second scan and/or ATS scan.

HIGH-IMPACT FILTER (HARD GATE):
A bullet edit is allowed ONLY if it satisfies BOTH:
A) Keyword Match: It explicitly adds or foregrounds a job-relevant keyword/phrase that appears in the job description,
   AND the resume text already supports it factually.
B) Signal Lift: It materially increases clarity of what was done (scope, deliverable, stakeholder, measurable output, ownership),
   not just readability.

If A or B is not met, DO NOT propose the edit.

BANNED / AUTO-REJECT PHRASES (unless quoted verbatim from resume evidence):
- "contributing to"
- "helped drive"
- "supported growth"
- "ensure smooth execution"
- "drive partnership opportunities"
- "fan engagement"
- "successful activation"
These are usually vague. Use concrete nouns + actions instead.

DO NOT DO:
- Grammar cleanup, synonym swaps, or re-ordering that does not pass the High-Impact Filter.
- Adding generic fluff outcomes not stated in resume text.
- Adding collaboration, leadership, cross-functional language unless resume text explicitly supports it.

ANTI-FABRICATION RULES (ABSOLUTE):
- You may only rewrite a bullet by rephrasing what is already explicitly stated in that bullet or its immediate nearby context.
- You may mirror job keywords ONLY if the resume already supports them.
- If a tool, domain, industry, method, or responsibility is not present in the resume text, you must NOT add it.
- Never change the function or industry of a role.
- If a bullet is too vague to safely align, skip it.

EVIDENCE REQUIREMENT (STRICT):
For every suggested change, provide:
- evidence: an exact quote copied verbatim from the resume text that proves the added/foregrounded keyword is factual.
If you cannot quote evidence, do not include the change.

SUMMARY STATEMENT LOGIC (STRICT + SELECTIVE):
1) Detect whether a summary/profile statement exists near the top of the resume.
   A "summary" is 1–4 lines that describe target role, domain, and strengths (not education or a section header).
2) If summary exists:
   - If it already matches the job's role type + 2–4 core keywords, status = "keep" and do not rewrite.
   - If it is misaligned, status = "revise" and propose ONE revised summary that is factual and keyword-aligned.
3) If summary does NOT exist:
   - Only recommend creating one if overall_signal is "mixed" or "weak" AND the top of the resume would not clearly signal fit in 7 seconds.
   - If overall_signal is "strong", status = "keep" and explicitly say summary is not needed.

OUTPUT RULES:
- Output 0–6 bullet edits total. Fewer is better. Quality over quantity.
- Returning zero bullet edits is a valid and often correct outcome.

Return VALID JSON ONLY with this exact shape:
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
Step 1) Extract the 5–10 most important job keywords/phrases that indicate fit (do NOT output this list; use it internally).
Step 2) Decide overall_signal: strong / mixed / weak based on whether the resume already signals those keywords clearly.
Step 3) Summary logic:
  - If summary exists and aligned: keep (no rewrite).
  - If summary exists and misaligned: revise (one factual rewrite).
  - If no summary exists: only create if signal is mixed/weak and the top of the resume will not pass a 7-second scan.
Step 4) Bullet edits:
  - Apply the High-Impact Filter (must pass A and B) for each proposed edit.
  - If an edit is just polish, skip it.
  - Avoid vague outcome claims. Prefer concrete nouns and actions already present in resume text.

Hard rules:
- "before" must be copied verbatim from the resume text.
- "after" must be a safe rephrase that foregrounds job keywords ONLY when supported by resume evidence.
- Do NOT add: growth, cross-functional, execution quality, engagement, activation success unless explicitly supported by resume evidence.
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
            "Intent: strengthen resume signal for this job using only high-impact, fully factual changes (or none if already aligned).",
          summary: {
            status: "keep",
            before: null,
            after: null,
            rationale:
              "Model did not return JSON. Retry after refreshing and ensuring the job description is fully pasted.",
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

    const intro = isNonEmptyString(parsed.intro)
      ? parsed.intro
      : "Intent: strengthen resume signal for this job using only high-impact, fully factual changes (or none if already aligned)."

    // Normalize summary object
    const summary =
      parsed?.summary && typeof parsed.summary === "object"
        ? {
            status: normalizeSummaryStatus(parsed.summary.status),
            before: isNonEmptyString(parsed.summary.before) ? parsed.summary.before : null,
            after: isNonEmptyString(parsed.summary.after) ? parsed.summary.after : null,
            rationale: isNonEmptyString(parsed.summary.rationale) ? parsed.summary.rationale : "",
            evidence: Array.isArray(parsed.summary.evidence)
              ? parsed.summary.evidence
                  .filter((x: any) => isNonEmptyString(x))
                  .map((s: string) => s.trim())
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
        job_title: isNonEmptyString(b?.job_title) ? b.job_title.trim() : "Unknown role",
        before: isNonEmptyString(b?.before) ? b.before : "",
        after: isNonEmptyString(b?.after) ? b.after : "",
        rationale: isNonEmptyString(b?.rationale) ? b.rationale : "",
        evidence: isNonEmptyString(b?.evidence) ? b.evidence : "",
      }))
      .filter((b: any) => b.before && b.after && b.evidence)

    // Normalize decision object
    const decision =
      parsed?.decision && typeof parsed.decision === "object"
        ? {
            overall_signal: normalizeSignal(parsed.decision.overall_signal),
            why: isNonEmptyString(parsed.decision.why) ? parsed.decision.why : "",
            no_edits_needed: Boolean(parsed.decision.no_edits_needed),
          }
        : {
            overall_signal: "mixed" as const,
            why: "",
            no_edits_needed: bullets.length === 0 && summary.status !== "revise" && summary.status !== "create",
          }

    const inferredNoEditsNeeded =
      bullets.length === 0 && summary.status !== "revise" && summary.status !== "create"

    const decisionFinal = {
      ...decision,
      no_edits_needed: decision.no_edits_needed || inferredNoEditsNeeded,
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
