import OpenAI from "openai"
import { getAuthedProfileText } from "../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

function asStringArray(v: any): string[] {
  return Array.isArray(v) ? v.filter(isNonEmptyString).map((s: string) => s.trim()) : []
}

type ArrangePick = {
  role: string
  why: string
  evidence: string[]
  action: string
}

function normalizeArrangePickArray(arr: any): ArrangePick[] {
  if (!Array.isArray(arr)) return []
  return arr
    .map((x: any) => ({
      role: asString(x?.role, "Unknown"),
      why: asString(x?.why, ""),
      evidence: asStringArray(x?.evidence),
      action: asString(x?.action, ""),
    }))
    .filter((x: ArrangePick) => x.role && (x.why || x.action))
}

type BulletEdit = {
  job_title: string
  before: string
  after: string
  why: string
  evidence: string
}

function normalizeBulletEdits(arr: any): BulletEdit[] {
  if (!Array.isArray(arr)) return []
  return arr
    .map((b: any) => ({
      job_title: asString(b?.job_title, "Unknown role"),
      before: asString(b?.before, ""),
      after: asString(b?.after, ""),
      why: asString(b?.why, ""),
      evidence: asString(b?.evidence, ""),
    }))
    .filter((b: BulletEdit) => b.before && b.after && b.evidence)
}

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: Request) {
  try {
    const { profileText } = await getAuthedProfileText(req)
    const profile = profileText

    const body = await req.json()
    const job = String(body?.job || "").trim()

    if (!job) {
      return withCorsJson(req, { error: "Missing job" }, 400)
    }

    const system = `
You are WRNSignal by Workforce Ready Now (Positioning module).

IMPORTANT PRODUCT RULE:
Job Fit is the ONLY module allowed to recommend Apply / Apply with caution / Do not apply.
You MUST NOT output any apply recommendation.

STUDENT UX GOAL:
Make this so clear that a college student can take action immediately.
Short sentences. No buzzwords. No cringe. Not nit picky.

ANTI-FABRICATION (ABSOLUTE):
- Use ONLY facts present in the resume text.
- Mirror job keywords ONLY if the resume already supports them factually.
- Never invent tools, metrics, stakeholders, industries, responsibilities, or outcomes.
- Never change the function or industry of a role.
- If something is too vague to safely align, skip it.

EVIDENCE REQUIREMENT (STRICT):
For every recommendation (role angle, ordering, summary, bullet edits),
include evidence as exact quotes copied verbatim from the resume text.
If you cannot quote evidence, do not include the recommendation.

HIGH-IMPACT FILTER (HARD GATE) FOR BULLET EDITS:
Only propose a bullet edit if:
A) Keyword Match: it adds or foregrounds a job-relevant keyword/phrase that appears in the job description,
   AND the resume already supports it factually.
B) Signal Lift: it materially increases clarity (scope, deliverable, stakeholder, measurable output, ownership).
If A or B is not met, DO NOT propose the edit.

SUMMARY STATEMENT LOGIC:
- Detect if a summary exists near the top of the resume.
- Return need_summary as YES/NO.
- YES when: summary is missing AND overall signal is mixed/weak OR the top of the resume will not pass a 7-second scan.
- YES also when: summary exists but is misaligned with the job (recommend revising).
- NO when: summary exists and is aligned, OR overall signal is strong and the top passes a 7-second scan.
- If NO because summary exists and is aligned, then return sentence saying existing summary is strong.
If YES, include one recommended summary (factual). If NO, do not write a new summary.

OUTPUT RULES:
- Return 3–6 bullet edits total when edits are needed. Minimum 3 if any are recommended.
- If truly no edits are needed, return an empty bullet_edits array.
- Do NOT include: Do This Next, Show Proof, Quick Checklist, Competitiveness Check, Next Steps.
- Do NOT output any buttons or UI instructions like "Copy".

Return VALID JSON ONLY with this exact shape:
{
  "student_intro": string,

  "role_angle": {
    "label": string,
    "why": string,
    "evidence": string[]
  },

  "arrange_resume": {
    "intro": string,
    "lead_with": [{ "role": string, "why": string, "evidence": string[], "action": string }],
    "support_with": [{ "role": string, "why": string, "evidence": string[], "action": string }],
    "then_include": [{ "role": string, "why": string, "evidence": string[], "action": string }],
    "de_emphasize": [{ "role": string, "why": string, "evidence": string[], "action": string }]
  },

  "summary_statement": {
    "need_summary": "YES" | "NO",
    "why": string,
    "recommended_summary": string | null,
    "evidence": string[]
  },

  "resume_bullet_edits": [
    {
      "job_title": string,
      "before": string,
      "after": string,
      "why": string,
      "evidence": string
    }
  ]
}
    `.trim()

    const user = `
RESUME (verbatim):
${profile}

JOB DESCRIPTION (verbatim):
${job}

TASK (do in order):
1) Identify the best Role Angle label (2–5 words) for how this resume should be read for this job.
2) Explain why in 1–2 sentences and include supporting resume evidence quotes.
3) Provide How to Arrange Your Resume:
   - Include the sentence: "You have about 7 seconds to make an impact with a hiring manager. Lead with your most relevant experience."
   - Make clear this is reordering existing facts, not rewriting them.
   - Output Lead With (1), Support With (1–2), Then Include (0–2), De-emphasize (0–1) if applicable.
4) Summary Statement: return need_summary YES/NO and explain why. If YES, give one recommended summary and cite evidence.
5) Resume Bullet Edits: 3–6 edits when needed. Minimum 3 if you recommend any. Each edit must pass the High-Impact Filter and include a single verbatim evidence quote.

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
      return withCorsJson(
        req,
        {
          student_intro:
            "I could not generate your positioning plan because the model did not return valid JSON. Paste the full job description again and retry.",

          role_angle: {
            label: "Unclear",
            why: raw || "Non-JSON response.",
            evidence: [],
          },

          arrange_resume: {
            intro:
              "You have about 7 seconds to make an impact with a hiring manager. Lead with your most relevant experience. This is about reordering your resume facts, not rewriting them.",
            lead_with: [],
            support_with: [],
            then_include: [],
            de_emphasize: [],
          },

          summary_statement: {
            need_summary: "YES",
            why: "No summary recommendation due to invalid model output.",
            recommended_summary: null,
            evidence: [],
          },

          resume_bullet_edits: [],
        },
        200
      )
    }

    // Normalize
    const student_intro = asString(
      parsed?.student_intro,
      "Here is the clearest way to position your resume for this job, with only factual, high-impact changes."
    )

    const roleRaw = parsed?.role_angle && typeof parsed.role_angle === "object" ? parsed.role_angle : {}
    const role_angle = {
      label: asString(roleRaw?.label, "Unclear"),
      why: asString(roleRaw?.why, ""),
      evidence: asStringArray(roleRaw?.evidence),
    }

    const arrangeRaw =
      parsed?.arrange_resume && typeof parsed.arrange_resume === "object" ? parsed.arrange_resume : {}

    const arrange_resume = {
      intro: asString(
        arrangeRaw?.intro,
        "You have about 7 seconds to make an impact with a hiring manager. Lead with your most relevant experience. This is about reordering your resume facts, not rewriting them."
      ),
      lead_with: normalizeArrangePickArray(arrangeRaw?.lead_with),
      support_with: normalizeArrangePickArray(arrangeRaw?.support_with),
      then_include: normalizeArrangePickArray(arrangeRaw?.then_include),
      de_emphasize: normalizeArrangePickArray(arrangeRaw?.de_emphasize),
    }

    const summaryRaw =
      parsed?.summary_statement && typeof parsed.summary_statement === "object" ? parsed.summary_statement : {}

    const need_summary =
      summaryRaw?.need_summary === "YES" || summaryRaw?.need_summary === "NO" ? summaryRaw.need_summary : "NO"

    const summary_statement = {
      need_summary,
      why: asString(summaryRaw?.why, ""),
      recommended_summary: isNonEmptyString(summaryRaw?.recommended_summary) ? summaryRaw.recommended_summary : null,
      evidence: asStringArray(summaryRaw?.evidence),
    }

    const resume_bullet_edits = normalizeBulletEdits(parsed?.resume_bullet_edits)

    return withCorsJson(
      req,
      {
        student_intro,
        role_angle,
        arrange_resume,
        summary_statement,
        resume_bullet_edits,
      },
      200
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

    return withCorsJson(req, { error: "Positioning failed", detail }, status)
  }
}



