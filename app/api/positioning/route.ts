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

    /**
     * UX GOAL:
     * The student should leave with:
     * 1) a clear role direction for THIS job (branch)
     * 2) a simple plan for what to emphasize (lead/support/de-emphasize)
     * 3) very few, very high-impact edits they can copy-paste
     *
     * We keep your anti-fabrication + evidence rules,
     * but we also require "what to do next" language for each recommendation.
     */

    const system = `
You are WRNSignal by Workforce Ready Now (Positioning module).

You are helping a college student tailor their resume for ONE specific job.

NON-NEGOTIABLE PRINCIPLE:
Only suggest changes that clearly improve hiring signal for THIS job.
If the best answer is "no changes needed", say so.

PRIMARY QUESTION:
"Should I apply, and if yes, how do I compete?"
Your output must make that answer obvious in a 7-second scan and/or ATS scan.

ANTI-FABRICATION (ABSOLUTE):
- You may only use facts that already exist in the resume text.
- You may mirror job keywords ONLY if the resume already supports them.
- Never invent tools, metrics, stakeholders, industries, responsibilities, or outcomes.
- Never change the function or industry of a role.
- If a bullet is too vague to safely align, skip it.

EVIDENCE REQUIREMENT (STRICT):
For every recommendation (branch, emphasis, summary, bullet edits),
include evidence as exact quotes copied verbatim from the resume text.
If you cannot quote evidence, do not include the recommendation.

HIGH-IMPACT FILTER (HARD GATE) FOR BULLET EDITS:
A bullet edit is allowed ONLY if it satisfies BOTH:
A) Keyword Match: It explicitly adds or foregrounds a job-relevant keyword/phrase that appears in the job description,
   AND the resume text already supports it factually.
B) Signal Lift: It materially increases clarity of what was done (scope, deliverable, measurable output, ownership),
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
These are vague. Use concrete nouns + actions instead.

STUDENT CLARITY RULES (UX):
- Write like you are giving direct instructions to a student.
- No corporate buzzwords.
- Make the plan actionable in 2–5 steps.
- Prefer short sentences.
- If something is unclear, say what is missing.

SUMMARY STATEMENT LOGIC (STRICT + SELECTIVE):
1) Detect whether a summary/profile statement exists near the top of the resume.
   A "summary" is 1–4 lines that describe target role, domain, and strengths (not education or a section header).
2) If summary exists:
   - If it matches the job's role type + 2–4 core keywords, status="keep" and do not rewrite.
   - If it is misaligned, status="revise" and propose ONE revised summary that is factual and keyword-aligned.
3) If summary does NOT exist:
   - Only recommend creating one if overall_signal is "mixed" or "weak" AND the top of the resume would not clearly signal fit in 7 seconds.
   - If overall_signal is "strong", status="keep" and explicitly say summary is not needed.

OUTPUT RULES:
- Return 0–6 bullet edits total. Fewer is better.
- Returning zero bullet edits is valid and often correct.
- The student must understand what to do next without guessing.

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

  "decision": {
    "overall_signal": "strong"|"mixed"|"weak",
    "apply_recommendation": "apply"|"apply_with_caution"|"do_not_apply",
    "why": string,
    "no_edits_needed": boolean,
    "next_steps": string[]
  }
}
    `.trim()

    const user = `
STUDENT RESUME (verbatim text):
${profile}

JOB DESCRIPTION (verbatim text):
${job}

TASK (do in order):
Step 1) Identify what role branch this job is (use internally).
Step 2) Pick ONE target_branch for this job and 1–2 alt_branches only if truly plausible.
  - Give short, student-clear reasoning.
  - Provide evidence quotes from the resume.
  - Provide "what_to_do_next" actions the student can follow.

Step 3) Build an emphasis plan for the target_branch:
  - lead_with: which experience(s) should be the headline for this job and why
  - support_with: what supports the story
  - deemphasize: what should stop leading (not deleted, just not highlighted)
  - Provide action text for each item (example: "Move this role above Projects" or "Use this bullet as your first bullet")

Step 4) Decide overall_signal: strong / mixed / weak based on whether the resume already signals the job's core keywords clearly.

Step 5) Summary logic (strict rules). If revise/create, include a simple "what_to_do_next".

Step 6) Bullet edits (0–6 max):
  - Must pass the High-Impact Filter A and B.
  - "before" must be copied verbatim from resume text.
  - "after" must only use facts already supported by resume evidence.
  - "evidence" must be an exact quote from resume text proving the edit is factual.
  - Add a short copy_paste_tip for the student.

Step 7) Apply recommendation:
  - "apply" if signal is strong
  - "apply_with_caution" if mixed but fixable quickly
  - "do_not_apply" if weak and missing core requirements

Hard rules:
- No generic fluff.
- No new tools, metrics, or responsibilities.
- If you cannot prove it with a quote, do not say it.

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

    // Fallback if non-JSON
    if (!parsed) {
      return new Response(
        JSON.stringify({
          student_intro:
            "I could not generate your positioning plan because the model did not return valid JSON. Paste the full job description again and retry.",

          branch: {
            target_branch: "unclear",
            alt_branches: [],
            why_this_branch:
              raw || "Non-JSON response. Try again after refreshing and ensuring the job description is fully pasted.",
            evidence: [],
            what_to_do_next: [
              "Paste the full job description (not a link).",
              "Retry positioning.",
            ],
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

          decision: {
            overall_signal: "mixed",
            apply_recommendation: "apply_with_caution",
            why: raw || "Non-JSON response.",
            no_edits_needed: false,
            next_steps: ["Retry with the full job description pasted in."],
          },
        }),
        { status: 200, headers: corsHeaders(origin) }
      )
    }

    // ---- Normalize branch ----
    const branchRaw = parsed?.branch && typeof parsed.branch === "object" ? parsed.branch : {}
    const branch = {
      target_branch: asString(branchRaw?.target_branch, "unclear"),
      alt_branches: asStringArray(branchRaw?.alt_branches),
      why_this_branch: asString(branchRaw?.why_this_branch, ""),
      evidence: asStringArray(branchRaw?.evidence),
      what_to_do_next: asStringArray(branchRaw?.what_to_do_next),
    }

    // ---- Normalize emphasis_plan ----
    const emphasisRaw =
      parsed?.emphasis_plan && typeof parsed.emphasis_plan === "object" ? parsed.emphasis_plan : {}

    const normalizeRolePickArray = (arr: any): RolePick[] => {
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

    const emphasis_plan = {
      lead_with: normalizeRolePickArray(emphasisRaw?.lead_with),
      support_with: normalizeRolePickArray(emphasisRaw?.support_with),
      deemphasize: normalizeRolePickArray(emphasisRaw?.deemphasize),
      top_keywords_to_surface: asStringArray(emphasisRaw?.top_keywords_to_surface),
      section_order_suggestion: asStringArray(emphasisRaw?.section_order_suggestion),
      quick_checklist: asStringArray(emphasisRaw?.quick_checklist),
    }

    // ---- Normalize summary ----
    const summaryRaw = parsed?.summary && typeof parsed.summary === "object" ? parsed.summary : {}
    const summary = {
      status: normalizeSummaryStatus(summaryRaw?.status),
      before: isNonEmptyString(summaryRaw?.before) ? summaryRaw.before : null,
      after: isNonEmptyString(summaryRaw?.after) ? summaryRaw.after : null,
      why: asString(summaryRaw?.why, asString(summaryRaw?.rationale, "")),
      evidence: asStringArray(summaryRaw?.evidence),
      what_to_do_next: asStringArray(summaryRaw?.what_to_do_next),
    }

    // ---- Normalize bullet_edits ----
    const bulletEditsRaw = Array.isArray(parsed?.bullet_edits) ? parsed.bullet_edits : []
    const bullet_edits = bulletEditsRaw
      .map((b: any) => ({
        job_title: asString(b?.job_title, "Unknown role"),
        before: asString(b?.before, ""),
        after: asString(b?.after, ""),
        why: asString(b?.why, asString(b?.rationale, "")),
        evidence: asString(b?.evidence, ""),
        copy_paste_tip: asString(b?.copy_paste_tip, "Copy the 'after' version into your resume."),
      }))
      // Keep strict: must have before, after, evidence
      .filter((b: any) => b.before && b.after && b.evidence)

    // ---- Normalize decision ----
    const decisionRaw = parsed?.decision && typeof parsed.decision === "object" ? parsed.decision : {}
    const overall_signal = normalizeSignal(decisionRaw?.overall_signal)

    const apply_recommendation =
      decisionRaw?.apply_recommendation === "apply" ||
      decisionRaw?.apply_recommendation === "apply_with_caution" ||
      decisionRaw?.apply_recommendation === "do_not_apply"
        ? decisionRaw.apply_recommendation
        : overall_signal === "strong"
          ? "apply"
          : overall_signal === "mixed"
            ? "apply_with_caution"
            : "do_not_apply"

    const inferredNoEditsNeeded =
      bullet_edits.length === 0 && summary.status !== "revise" && summary.status !== "create"

    const decision = {
      overall_signal,
      apply_recommendation,
      why: asString(decisionRaw?.why, ""),
      no_edits_needed: asBool(decisionRaw?.no_edits_needed, inferredNoEditsNeeded) || inferredNoEditsNeeded,
      next_steps: asStringArray(decisionRaw?.next_steps),
    }

    const student_intro = asString(
      parsed?.student_intro,
      "Here is the clearest way to position your resume for this job, with only factual, high-impact changes."
    )

    // If model forgot to provide next_steps, generate a minimal set server-side.
    const nextStepsFallback: string[] =
      decision.next_steps.length > 0
        ? decision.next_steps
        : decision.no_edits_needed
          ? [
              "Apply with this resume version.",
              "Use the branch label in your networking outreach so you sound consistent.",
            ]
          : [
              "Make the branch and emphasis changes first.",
              "Then copy-paste the bullet edits exactly.",
              "Re-run positioning after you update the resume text.",
            ]

    const decisionFinal = {
      ...decision,
      next_steps: nextStepsFallback,
    }

    return new Response(
      JSON.stringify({
        student_intro,
        branch,
        emphasis_plan,
        summary,
        bullet_edits,
        decision: decisionFinal,
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
