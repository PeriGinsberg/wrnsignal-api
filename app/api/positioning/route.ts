import crypto from "crypto"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"
import { getAuthedProfileText } from "../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const MISSING = "__MISSING__"
const POSITIONING_PROMPT_VERSION = "positioning_v1_2026_02_07"
const MODEL_ID = "current"

// Supabase (mirrors JobFit pattern)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function requireEnv(name: string, v?: string) {
  if (!v) throw new Error(`Missing server env: ${name}`)
  return v
}

const supabaseAdmin = createClient(
  requireEnv("SUPABASE_URL", SUPABASE_URL),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
  { auth: { persistSession: false, autoRefreshToken: false } }
)

/**
 * Normalize values for deterministic fingerprinting (copied from JobFit)
 */
function normalize(value: any): any {
  if (typeof value === "string") {
    const cleaned = value.trim()
    if (cleaned === "") return MISSING
    return cleaned.toLowerCase().replace(/\s+/g, " ")
  }

  if (Array.isArray(value)) {
    return value.map(normalize).sort()
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc: any, key) => {
        const v = value[key]
        if (v !== null && v !== undefined) {
          acc[key] = normalize(v)
        }
        return acc
      }, {})
  }

  return value
}

/**
 * Build Positioning fingerprint
 */
function buildPositioningFingerprint(payload: any) {
  const normalized = normalize(payload)
  const canonical = JSON.stringify(normalized)

  const fingerprint_hash = crypto.createHash("sha256").update(canonical).digest("hex")

  const fingerprint_code =
    "PO-" + parseInt(fingerprint_hash.slice(0, 10), 16).toString(36).toUpperCase()

  return { fingerprint_hash, fingerprint_code }
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
    .filter((b: BulletEdit) => b.before && b.after && b.evidence && b.evidence === b.before)
}

/**
 * CORS preflight
 */
export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

/**
 * Positioning with caching by fingerprint (mirrors JobFit behavior)
 */
export async function POST(req: Request) {
  try {
    // Auth + stored profile (server-side, user-bound)
    const { profileId, profileText } = await getAuthedProfileText(req)

    const body = await req.json()
    const jobText = String(body?.job || "").trim()

    if (!jobText) {
      return withCorsJson(req, { error: "Missing job" }, 400)
    }

    // Fingerprint inputs used for evaluation (job + profile + system pins)
    const fingerprintPayload = {
      job: { text: jobText || MISSING },
      profile: { id: profileId || MISSING, text: profileText || MISSING },
      system: {
        positioning_prompt_version: POSITIONING_PROMPT_VERSION,
        model_id: MODEL_ID,
      },
    }

    const { fingerprint_hash, fingerprint_code } = buildPositioningFingerprint(fingerprintPayload)

    // 1) Lookup existing run
    const { data: existingRun, error: findErr } = await supabaseAdmin
      .from("positioning_runs")
      .select("result_json, fingerprint_code, fingerprint_hash, created_at")
      .eq("client_profile_id", profileId)
      .eq("fingerprint_hash", fingerprint_hash)
      .maybeSingle()

    if (findErr) {
      // If lookup fails, proceed with a fresh run (do not block user).
      console.warn("positioning_runs lookup failed:", findErr.message)
    }

    if (existingRun?.result_json) {
      return withCorsJson(
        req,
        {
          ...(existingRun.result_json as any),
          fingerprint_code,
          fingerprint_hash,
          reused: true,
        },
        200
      )
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

SUMMARY STATEMENT LOGIC:
- Detect if a summary exists near the top of the resume.
- Return need_summary as YES/NO.
- YES when: summary is missing AND overall signal is mixed/weak OR the top of the resume will not pass a 7-second scan.
- YES also when: summary exists but is misaligned with the job (recommend revising).
- NO when: summary exists and is aligned, OR overall signal is strong and the top passes a 7-second scan.
- If NO because summary exists and is aligned, then return sentence saying existing summary is strong.
If YES, include one recommended summary (factual). If NO, do not write a new summary.

BULLET EDITS: WHAT COUNTS AS "NEEDED"
A bullet edit is needed only when it creates a clear, job-relevant signal lift.
If an edit would be stylistic, nit picky, or interchangeable wording, it is NOT needed.

BULLET EDIT ELIGIBILITY TEST (MUST PASS)
You may propose a bullet edit only if ALL conditions are true:
1) Anchored: the "before" text is copied verbatim from the resume (exact characters).
2) Truth-preserving: the "after" text does not add any new facts. It can only reorder, clarify, or foreground facts already stated.
3) Job-relevant: the edit increases alignment to the job description by doing at least ONE:
   A) Adds a keyword/phrase that appears in the job description AND is already supported by the resume facts, OR
   B) Moves an already-supported job-relevant keyword earlier or makes it more explicit.
4) Material lift: the edit clearly improves at least ONE of these using existing resume facts only:
   - scope (what you owned)
   - output (what you delivered)
   - method (how you did it)
   - stakeholder (who it served)
   - measure (numbers already present)

If ANY condition fails, DO NOT propose the edit.

EVIDENCE RULE FOR BULLET EDITS (STRICT)
For every bullet edit:
- evidence MUST equal the exact "before" bullet text (verbatim).
- If you cannot do that, do not include the edit.

OUTPUT RULES:
- Return 0 bullet edits if none are needed.
- If edits are needed, return 1–6 high-impact edits.
- Do not pad the list to reach a minimum.

DO NOT INCLUDE:
- Do This Next, Show Proof, Quick Checklist, Competitiveness Check, Next Steps.
- Buttons or UI instructions like "Copy".

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
${profileText}

JOB DESCRIPTION (verbatim):
${jobText}

TASK (do in order):
1) ROLE ANGLE (DETERMINISTIC):
   Select exactly ONE role angle label from the list below.
   The label must match one of these values exactly. Do not invent new labels.

   Role Angle Labels:
   - Client-Facing / Communication
   - Analytical / Quantitative
   - Creative / Storytelling
   - Technical / Builder
   - Operations / Execution
   - Leadership / Program Ownership
   - Research / Knowledge Creation
   - Business / Commercial
   - Early-Career Generalist
   - Other

   Rules:
   - Choose the closest fit based only on resume evidence and job context.
   - Use "Early-Career Generalist" when experience is broad or mixed.
   - Use "Other" only if none apply, and explain why.

2) Explain why in 1–2 sentences and include supporting resume evidence quotes.
3) Provide How to Arrange Your Resume:
   - Include the sentence: "You have about 7 seconds to make an impact with a hiring manager. Lead with your most relevant experience."
   - Make clear this is reordering existing facts, not rewriting them.
   - Output Lead With (1), Support With (1–2), Then Include (0–2), De-emphasize (0–1) if applicable.
4) Summary Statement: return need_summary YES/NO and explain why. If YES, give one recommended summary and cite evidence.
5) Resume Bullet Edits: return only edits that pass the Bullet Edit Eligibility Test. If none are needed, return an empty array.

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

    // If model fails to return valid JSON, return safe fallback (do not cache)
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

          fingerprint_code,
          fingerprint_hash,
          reused: false,
        },
        200
      )
    }

    // Normalize model output into our expected schema
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

    const finalResult = {
      student_intro,
      role_angle,
      arrange_resume,
      summary_statement,
      resume_bullet_edits,
    }

    // Store result (best effort). Cache only valid parsed + normalized output.
    const { error: insertErr } = await supabaseAdmin.from("positioning_runs").insert({
      client_profile_id: profileId,
      job_url: null,
      fingerprint_hash,
      fingerprint_code,
      result_json: finalResult,
    })

    if (insertErr) {
      console.warn("positioning_runs insert failed:", insertErr.message)
    }

    return withCorsJson(
      req,
      {
        ...finalResult,
        fingerprint_code,
        fingerprint_hash,
        reused: false,
      },
      200
    )
  } catch (err: any) {
    const detail = err?.message || String(err)
    const lower = String(detail).toLowerCase()
    const status = lower.includes("unauthorized")
      ? 401
      : lower.includes("profile not found")
        ? 404
        : lower.includes("access disabled")
          ? 403
          : 500

    return withCorsJson(req, { error: "Positioning failed", detail }, status)
  }
}
