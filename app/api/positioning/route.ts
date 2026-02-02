import OpenAI from "openai"
import { getAuthedProfileText } from "../_lib/authProfile"

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

function isNonEmptyString(x: any): x is string {
  return typeof x === "string" && x.trim().length > 0
}

function asString(x: any, fallback = ""): string {
  return isNonEmptyString(x) ? x.trim() : fallback
}

function asBool(x: any, fallback = false): boolean {
  return typeof x === "boolean" ? x : fallback
}

function asStringArray(v: any): string[] {
  return Array.isArray(v) ? v.filter(isNonEmptyString).map((s: string) => s.trim()) : []
}

/**
 * Accepts either a string OR an array of strings and returns a single string.
 * This prevents "evidence" arrays from getting dropped by downstream filters.
 */
function asStringOrJoin(v: any, fallback = ""): string {
  if (Array.isArray(v)) {
    const parts = v.filter(isNonEmptyString).map((s: string) => s.trim())
    return parts.length ? parts.join(" | ") : fallback
  }
  return asString(v, fallback)
}

function normalizeSummaryStatus(v: any): "keep" | "revise" | "create" {
  return v === "keep" || v === "revise" || v === "create" ? v : "keep"
}

function normalizeSignal(v: any): "strong" | "mixed" | "weak" {
  return v === "strong" || v === "mixed" || v === "weak" ? v : "mixed"
}

type RolePick = {
  role: string
  why: string
  evidence: string[]
  action: string
}

function normalizeRolePickArray(arr: any): RolePick[] {
  if (!Array.isArray(arr)) return []
  return arr
    .map((x: any) => ({
      role: asString(x?.role, "Unknown"),
      why: asString(x?.why, ""),
      evidence: asStringArray(x?.evidence),
      action: asString(x?.action, ""),
    }))
    .filter((x: RolePick) => x.role && (x.why || x.action))
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin")
  return new Response(null, { status: 204, headers: corsHeaders(origin) })
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin")

  try {
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
You are WRNSignal by Workforce Ready Now (Positioning module).

IMPORTANT PRODUCT RULE:
Job Fit is the ONLY module allowed to recommend Apply / Apply with caution / Do not apply.
You MUST NOT output any apply recommendation.
Your job is: "If the student is applying, how do they compete with clearer positioning?"

STUDENT UX GOAL:
Make this so clear that a college student can take action immediately.
Short sentences. No buzzwords. No cringe.

NON-NEGOTIABLE PRINCIPLE:
Only suggest changes that clearly improve hiring signal for THIS job.
If the best answer is "no changes needed", say so.

ANTI-FABRICATION (ABSOLUTE):
- Use ONLY facts present in the resume text.
- Mirror job keywords ONLY if the resume already supports them.
- Never invent tools, metrics, stakeholders, industries, responsibilities, or outcomes.
- Never change the function or industry of a role.
- If something is too vague to safely align, skip it.

EVIDENCE REQUIREMENT (STRICT):
For every recommendation (branch, emphasis, summary, bullet edits),
include evidence as exact quotes copied verbatim from the resume text.
If you cannot quote evidence, do not include it.

HIGH-IMPACT FILTER (HARD GATE) FOR BULLET EDITS:
A bullet edit is allowed ONLY if it satisfies BOTH:
A) Keyword Match: It explicitly adds or foregrounds a job-relevant keyword/phrase that appears in the job description,
   AND the resume already supports it factually.
B) Signal Lift: It materially increases clarity of what was done (scope, deliverable, stakeholder, measurable output, ownership),
   not just readability.

If A or B is not met, DO NOT propose the edit.

BANNED VAGUE PHRASES (unless quoted verbatim from resume evidence):
- "contributing to"
- "helped drive"
- "supported growth"
- "ensure smooth execution"
- "drive partnership opportunities"
- "fan engagement"
- "successful activation"

SUMMARY STATEMENT LOGIC (STRICT + SELECTIVE):
1) Detect whether a summary exists near the top of the resume.
2) If summary exists:
   - If it matches the job's role type + 2–4 core keywords: status="keep" and do not rewrite.
   - If misaligned: status="revise" and propose ONE revised summary (factual).
3) If summary does NOT exist:
   - Recommend "create" only if overall_signal is "mixed" or "weak" AND the top of the resume will not pass a 7-second scan.
   - If overall_signal is "strong", status="keep" and explicitly say summary is not needed.

IMPORTANT TYPE RULE:
- In bullet_edits, "evidence" must be ONE single verbatim quote string from the resume (not an array).

OUTPUT RULES:
- Return 0–6 bullet edits total. Fewer is better.
- Returning zero bullet edits is valid and often correct.
- DO NOT output apply/do-not-apply recommendations.

Return VALID JSON ONLY with this exact shape:
{
  "student_intro": string,

  "branch": {
    "target_branch": string,
    "alt_branches": string[],
    "why_this_branch": string,
    "evidence": string[],
    "what_to_do_next": string[]
  },

  "emphasis_plan": {
    "lead_with": [
      { "role": string, "why": string, "evidence": string[], "action": string }
    ],
    "support_with": [
      { "role": string, "why": string, "evidence": string[], "action": string }
    ],
    "deemphasize": [
      { "role": string, "why": string, "evidence": string[], "action": string }
    ],
    "top_keywords_to_surface": string[],
    "section_order_suggestion": string[],
    "quick_checklist": string[]
  },

  "summary": {
    "status": "keep"|"revise"|"create",
    "before": string|null,
    "after": string|null,
    "why": string,
    "evidence": string[],
    "what_to_do_next": string[]
  },

  "bullet_edits": [
    {
      "job_title": string,
      "before": string,
      "after": string,
      "why": string,
      "evidence": string,
      "copy_paste_tip": string
    }
  ],

  "competitiveness": {
    "overall_signal": "strong"|"mixed"|"weak",
    "what_this_means": string,
    "no_edits_needed": boolean,
    "next_steps": string[]
  }
}
    `.trim()

    const user = `
RESUME (verbatim):
${profile}

JOB DESCRIPTION (verbatim):
${job}

TASK (do in order):
1) Pick ONE target_branch for this job (branch under the umbrella). Add 0–2 alt branches if truly plausible.
2) Build an emphasis plan for that branch: lead_with, support_with, deemphasize.
3) Decide competitiveness overall_signal: strong / mixed / weak based on whether the resume signals the job's core keywords clearly.
4) Apply summary logic (strict).
5) Bullet edits (0–6 max). Must pass High-Impact Filter A + B. "before" copied verbatim. "after" safe and factual. Provide evidence quotes.
6) Return a competitiveness section that explains what the signal means and gives a short checklist.
7) IMPORTANT: Do NOT recommend Apply/Do not apply.

Return JSON only. No markdown. No extra text.
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
          student_intro:
            "I could not generate your positioning plan because the model did not return valid JSON. Paste the full job description again and retry.",

          branch: {
            target_branch: "unclear",
            alt_branches: [],
            why_this_branch: raw || "Non-JSON response.",
            evidence: [],
            what_to_do_next: ["Paste the full job description (not a link).", "Retry Positioning."],
          },

          emphasis_plan: {
            lead_with: [],
            support_with: [],
            deemphasize: [],
            top_keywords_to_surface: [],
            section_order_suggestion: [],
            quick_checklist: [],
          },

          summary: {
            status: "keep",
            before: null,
            after: null,
            why: "No summary recommendation due to invalid model output.",
            evidence: [],
            what_to_do_next: [],
          },

          bullet_edits: [],

          competitiveness: {
            overall_signal: "mixed",
            what_this_means: raw || "Non-JSON response.",
            no_edits_needed: false,
            next_steps: ["Retry with the full job description pasted in."],
          },
        }),
        { status: 200, headers: corsHeaders(origin) }
      )
    }

    // ---- Debug: confirm whether model produced bullet edits but parsing/filtering removed them.
    // Remove these logs after confirming the fix in production.
    const rawBulletEdits = Array.isArray(parsed?.bullet_edits) ? parsed.bullet_edits : []
    console.log("Positioning raw bullet_edits:", JSON.stringify(rawBulletEdits, null, 2))

    const branchRaw = parsed?.branch && typeof parsed.branch === "object" ? parsed.branch : {}
    const branch = {
      target_branch: asString(branchRaw?.target_branch, "unclear"),
      alt_branches: asStringArray(branchRaw?.alt_branches),
      why_this_branch: asString(branchRaw?.why_this_branch, ""),
      evidence: asStringArray(branchRaw?.evidence),
      what_to_do_next: asStringArray(branchRaw?.what_to_do_next),
    }

    const emphasisRaw =
      parsed?.emphasis_plan && typeof parsed.emphasis_plan === "object" ? parsed.emphasis_plan : {}

    const emphasis_plan = {
      lead_with: normalizeRolePickArray(emphasisRaw?.lead_with),
      support_with: normalizeRolePickArray(emphasisRaw?.support_with),
      deemphasize: normalizeRolePickArray(emphasisRaw?.deemphasize),
      top_keywords_to_surface: asStringArray(emphasisRaw?.top_keywords_to_surface),
      section_order_suggestion: asStringArray(emphasisRaw?.section_order_suggestion),
      quick_checklist: asStringArray(emphasisRaw?.quick_checklist),
    }

    const summaryRaw = parsed?.summary && typeof parsed.summary === "object" ? parsed.summary : {}
    const summary = {
      status: normalizeSummaryStatus(summaryRaw?.status),
      before: isNonEmptyString(summaryRaw?.before) ? summaryRaw.before : null,
      after: isNonEmptyString(summaryRaw?.after) ? summaryRaw.after : null,
      why: asString(summaryRaw?.why, ""),
      evidence: asStringArray(summaryRaw?.evidence),
      what_to_do_next: asStringArray(summaryRaw?.what_to_do_next),
    }

    const bulletEditsRaw = rawBulletEdits
    const bullet_edits = bulletEditsRaw
      .map((b: any) => ({
        job_title: asString(b?.job_title, "Unknown role"),
        before: asString(b?.before, ""),
        after: asString(b?.after, ""),
        why: asString(b?.why, ""),
        // Accept string OR string[] so we don't drop edits when the model returns an array.
        evidence: asStringOrJoin(b?.evidence, ""),
        copy_paste_tip: asString(b?.copy_paste_tip, "Copy the After version into your resume."),
      }))
      .filter((b: any) => b.before && b.after && b.evidence)

    console.log("Positioning bullet_edits kept:", bullet_edits.length)

    const compRaw =
      parsed?.competitiveness && typeof parsed.competitiveness === "object"
        ? parsed.competitiveness
        : {}

    const inferredNoEditsNeeded =
      bullet_edits.length === 0 && summary.status !== "revise" && summary.status !== "create"

    const competitiveness = {
      overall_signal: normalizeSignal(compRaw?.overall_signal),
      what_this_means: asString(compRaw?.what_this_means, ""),
      no_edits_needed: asBool(compRaw?.no_edits_needed, inferredNoEditsNeeded) || inferredNoEditsNeeded,
      next_steps: asStringArray(compRaw?.next_steps),
    }

    const student_intro = asString(
      parsed?.student_intro,
      "Here is the clearest way to position your resume for this job, with only factual, high-impact changes."
    )

    const compNextStepsFallback =
      competitiveness.next_steps.length > 0
        ? competitiveness.next_steps
        : competitiveness.no_edits_needed
          ? ["You do not need edits for this job. Keep your resume as-is for this application."]
          : ["Follow the emphasis plan first.", "Then apply the copy paste edits.", "Re-run Positioning after updates."]

    return new Response(
      JSON.stringify({
        student_intro,
        branch,
        emphasis_plan,
        summary,
        bullet_edits,
        competitiveness: { ...competitiveness, next_steps: compNextStepsFallback },
      }),
      { status: 200, headers: corsHeaders(origin) }
    )
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
