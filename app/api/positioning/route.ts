// app/api/positioning/route.ts
import crypto from "crypto"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"
import { getAuthedProfileText } from "../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { computeKeywordCoverage } from "../_lib/keywordCoverage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const MISSING = "__MISSING__"
const POSITIONING_PROMPT_VERSION = "positioning_v1_2026_02_07"
const MODEL_ID = "current"

// Supabase
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
 * Normalize values for deterministic fingerprinting
 */
function normalize(value: any): any {
  if (typeof value === "string") {
    const cleaned = value.trim()
    if (cleaned === "") return MISSING
    return cleaned.toLowerCase().replace(/\s+/g, " ")
  }

  if (Array.isArray(value)) return value.map(normalize).sort()

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc: any, key) => {
        const v = value[key]
        if (v !== null && v !== undefined) acc[key] = normalize(v)
        return acc
      }, {})
  }

  return value
}

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

function extractResumeBullets(resumeText: string) {
  // v1: lines that look like bullets
  return resumeText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-•*]\s+/.test(l) || /^\d+\.\s+/.test(l))
    .join("\n")
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
    .filter((b: BulletEdit) => b.before && b.after)
}

/**
 * CORS preflight
 */
export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

/**
 * Positioning with caching by fingerprint.
 */
export async function POST(req: Request) {
  try {
    const { profileId, profileText } = await getAuthedProfileText(req)

    const body = await req.json()
    const jobText = String(body?.job || "").trim()

    if (!jobText) {
      return withCorsJson(req, { error: "Missing job" }, 400)
    }

    // Deterministic keyword coverage
    const resumeBulletsRaw = extractResumeBullets(profileText)
    const keywordCoverage = computeKeywordCoverage(jobText, resumeBulletsRaw, {
      max_keywords: 30,
      missing_top_n: 8,
    })

    // Missing keywords (single source of truth, no duplicates)
    const missingHighPriorityKeywords = (keywordCoverage?.missing_top ?? [])
      .map((x: any) => String(x?.phrase || "").trim())
      .filter(Boolean)
      .filter((k) => k.length >= 3)
      .filter(
        (k) =>
          !["execution", "support", "communication", "stakeholder", "initiative", "process"].includes(
            k.toLowerCase()
          )
      )
      .slice(0, 8)

    const missingHighPriorityKeywordsText = missingHighPriorityKeywords.length
      ? missingHighPriorityKeywords.map((k) => `- ${k}`).join("\n")
      : "- None"

    // Fingerprint pins
    const fingerprintPayload = {
      job: { text: jobText || MISSING },
      profile: { id: profileId || MISSING, text: profileText || MISSING },
      system: {
        positioning_prompt_version: POSITIONING_PROMPT_VERSION,
        model_id: MODEL_ID,
      },
      keyword_logic: {
        max_keywords: 30,
        missing_top_n: 8,
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

BULLET EDIT RULE (NON-NEGOTIABLE):
Only rewrite bullets to clearly highlight missing high-priority job keywords that your resume already supports.
Do not add new facts. Do not invent tools, metrics, or outcomes.

KEYWORD STRICTNESS RULE:
- Bullet edits must introduce or emphasize a SPECIFIC noun or tool (e.g., research, reports, analysis, dashboards, Excel, client deliverables).
- Do NOT rewrite bullets to add vague business language such as:
  “effective,” “support,” “requirements,” “customers,” “stakeholders,” or similar.
- If only vague wording can be added, return no edit.

REDUNDANCY RULE (CONDITIONAL):
- Do NOT rewrite a bullet if the change only restates what the bullet already clearly communicates.
- An exception is allowed ONLY when the rewrite introduces an exact, job-relevant keyword or phrase that appears in the job description.
- If the added wording does not improve keyword visibility or introduce a concrete noun, return no edit.
- When in doubt, return no edit.

WHY THIS MATTERS RULE:
- Write exactly ONE short sentence.
- Explain what becomes clearer to a recruiter.
- Use plain language.
- Do NOT mention keywords, alignment, matching, ATS, or the job description.

WORDING CONSTRAINT:
Do not introduce abstract tool phrases like “data analytics tools,” “analytical tools,” or “research tools.”
If a specific tool is not named in the resume, describe the activity plainly (e.g., “analyzing data in Excel”).




OUTPUT RULES FOR BULLET EDITS:
- Return 0 bullet edits if none are needed.
- If edits are needed, return 1–6 high-impact edits.
- Do not pad the list to reach a minimum.



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
// The "why" field must follow the WHY THIS MATTERS RULE above.

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

HIGH-PRIORITY JOB KEYWORDS (SYSTEM-DETERMINED):
These are important keywords/phrases from the job description that are currently missing or underrepresented in your resume bullets:
${missingHighPriorityKeywordsText}

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
5) Resume Bullet Edits:
   - Each edit MUST include at least ONE exact phrase from the HIGH-PRIORITY JOB KEYWORDS list above (copy it verbatim).
   - Only do this if the resume facts already support it. Do not add new facts.
   - Do not use generic substitutes like “execution,” “support,” “cross-team,” or “stakeholder” unless they appear verbatim in the job keywords list.
   - Return 0–6 edits. Do not pad.
   - If you cannot truthfully include any of the listed keywords in a bullet, return an empty array.

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

          role_angle: { label: "Unclear", why: raw || "Non-JSON response.", evidence: [] },

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

    const baseIntro = asString(
      parsed?.student_intro,
      "Here is the clearest way to position your resume for this job, with only factual, high-impact changes."
    )

    const bulletPolicy =
      "We only recommend bullet changes when they clearly highlight the most important keywords for this job that your resume already supports."

    const student_intro = baseIntro.endsWith(".") ? `${baseIntro} ${bulletPolicy}` : `${baseIntro}. ${bulletPolicy}`

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

    const keyword_analysis = {
      coverage_pct: Math.round(keywordCoverage.coverage * 100),
      missing_high_priority: missingHighPriorityKeywords,
    }

    const finalResult = {
      student_intro,
      role_angle,
      arrange_resume,
      summary_statement,
      resume_bullet_edits,
      keyword_analysis,
    }

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
