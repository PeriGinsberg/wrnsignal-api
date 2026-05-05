// app/api/positioning/route.ts
//
// ARCHITECTURAL PATTERN — read this before adding new LLM-judged fields.
//
// Several fields here (resume_bullet_edits, summary_statement) follow a
// three-layer pattern. Future contributors should mirror it:
//
//   1. Deterministic source-of-truth check
//      Run a regex / string search against the resume text BEFORE asking
//      the LLM anything. Capture a fact about presence, evidence, or
//      structure. Examples: detectExistingSummary() finds whether a
//      Summary section exists; normalizeBulletEdits() rejects any edit
//      whose BEFORE isn't a verbatim resume substring.
//
//   2. LLM judgment narrowed to what only the LLM can do
//      Pass the deterministic finding INTO the LLM prompt as a fact
//      ("summary_present: YES"). Constrain the LLM to judgments that
//      genuinely require LLM-level reasoning (alignment, tone, fit) —
//      never to facts a regex could verify.
//
//   3. Token-anchored renderer contract
//      LLM returns short tokens (e.g. "[aligned]", "[misaligned]",
//      "[missing]") in the why field. The server-side renderer maps
//      (deterministic_finding, llm_token) → user-facing message via a
//      lookup table. Free-text LLM output never reaches the user
//      directly. Any unknown LLM token defaults to the safest cell of
//      the table.
//
// History: this pattern was introduced after two production bugs where
// the LLM hallucinated answers to questions with deterministic answers
// (Ross Goldstein 2026-05-04: BEFORE bullets pulled from JD instead of
// resume; 2026-05-05: "no summary present" claim about a resume that
// had a clear SUMMARY header). In both cases a regex would have caught
// it for free.
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

// Minimum body length for a "Summary" section to count as actually present.
// A header with no body (e.g. "SUMMARY\n\nEXPERIENCE") or a tiny placeholder
// ("Summary: TBD") shouldn't qualify — the widget would falsely tell the
// user their summary is fine when it's effectively empty. 20 chars is just
// above one short sentence ("Recruiting leader.") and below any substantive
// summary we've observed in real client resumes.
const MIN_SUMMARY_BODY_LENGTH = 20

// Detect whether the resume has a Summary section near the top. Returns
// presence + the canonical header line + the body paragraph(s) immediately
// following. Used by the positioning route to gate the LLM's alignment
// judgment with a deterministic presence answer.
//
// Header regex matches the canonical section names (summary, professional
// summary, profile, about, about me, career summary, executive summary)
// optionally followed by a colon, on their own line. The `m` flag treats
// both \n and \r\n line endings correctly, so resumes pasted from Word
// (which tend to use \r\n) work the same as ones from plain text.
function detectExistingSummary(resumeText: string): {
  present: boolean
  headerLine: string | null
  body: string | null
} {
  const headerRe =
    /^(summary|professional\s+summary|profile|about\s+me|about|career\s+summary|executive\s+summary)\s*:?\s*$/im
  const m = resumeText.match(headerRe)
  if (!m || m.index == null) return { present: false, headerLine: null, body: null }

  // Body = paragraphs immediately after the header, up to the next
  // ALL-CAPS-section-header (e.g. "EXPERIENCE", "EDUCATION") or the end of
  // the resume. Normalize \r\n → \n so the line-walk is uniform.
  const after = resumeText.slice(m.index + m[0].length).replace(/\r\n/g, "\n")
  const lines = after.split("\n")
  const bodyLines: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Heuristic: an ALL-CAPS line of 3-40 chars (letters, spaces, &, optional
    // colon) is likely the next section header. Stop body collection there.
    if (/^[A-Z][A-Z\s&]{2,40}:?$/.test(trimmed) && trimmed === trimmed.toUpperCase()) {
      break
    }
    bodyLines.push(trimmed)
  }
  const body = bodyLines.join(" ").trim()
  if (body.length < MIN_SUMMARY_BODY_LENGTH) {
    return { present: false, headerLine: m[0], body: null }
  }
  return { present: true, headerLine: m[0], body }
}

// Canonicalize a string for "is this present in the resume?" comparison.
// Strips leading bullet markers (•, -, *, ·, –, —), trailing punctuation
// (.,;:), collapses internal whitespace, lowercases. The LLM frequently
// trims a leading bullet character or trailing period when copying a
// resume bullet, so naive substring match would drop legitimate edits.
// This canonicalization is symmetric — applied to both the resume haystack
// and each candidate BEFORE before comparison.
function canonicalizeForMatch(s: string): string {
  return String(s || "")
    .replace(/^[\s•·–—\-\*]+/, "")
    .replace(/[\s.,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function normalizeBulletEdits(
  arr: any,
  resumeText: string,
  ctx: { profileId: string; fingerprintCode: string }
): BulletEdit[] {
  if (!Array.isArray(arr)) return []
  // Pre-canonicalize the entire resume once for repeated substring checks.
  const haystack = canonicalizeForMatch(resumeText)
  const allEdits = arr
    .map((b: any) => ({
      job_title: asString(b?.job_title, "Unknown role"),
      before: asString(b?.before, ""),
      after: asString(b?.after, ""),
      why: asString(b?.why, ""),
      evidence: asString(b?.evidence, ""),
    }))
    .filter((b: BulletEdit) => b.before && b.after)

  const accepted: BulletEdit[] = []
  for (const edit of allEdits) {
    const canon = canonicalizeForMatch(edit.before)
    if (canon && haystack.includes(canon)) {
      accepted.push(edit)
      continue
    }
    // Drop and log. The BEFORE field on this edit is not present in the
    // resume — most often this means the LLM pulled the BEFORE from the
    // job description (Ross Goldstein bug, 2026-05-04). Logging the run
    // identifier + rejected before + short resume excerpt gives ongoing
    // visibility into how often the LLM still misbehaves after the
    // prompt tightening.
    console.log(
      "[positioning] dropped bullet edit — BEFORE not in resume:",
      JSON.stringify({
        profileId: ctx.profileId,
        fingerprintCode: ctx.fingerprintCode,
        droppedBefore: edit.before.slice(0, 200),
        resumeExcerpt: resumeText.slice(0, 240).replace(/\s+/g, " "),
      })
    )
  }
  return accepted
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
- A deterministic detector has already decided whether a Summary section is
  present in the resume. Its result will be stated explicitly in the user
  message under "SUMMARY DETECTION (deterministic)". DO NOT re-judge presence.
  If the detector says summary_present: YES, treat that as fact even if you
  think the section is weak or hard to find.
- Your job is to judge ONLY whether the existing summary (if present) is
  aligned to the candidate's target role(s) and the job description.
- The why field MUST start with one of these exact tokens, including brackets:
    [missing]    — used only when summary_present: NO. Set need_summary: YES.
                   recommended_summary: a one-sentence factual draft.
    [misaligned] — used only when summary_present: YES but the existing
                   summary doesn't anchor on the target role's keywords or
                   responsibilities. Set need_summary: YES.
                   recommended_summary: a one-sentence factual rewrite.
    [aligned]    — used only when summary_present: YES and the summary
                   reasonably anchors on the target role. Set need_summary: NO.
                   recommended_summary: null.
- After the bracketed token, write one short sentence explaining the choice.
  This sentence should NOT use the words "missing", "lacks", "no summary"
  unless the token is [missing]. The bracketed token is the source of truth
  for renderer logic; the sentence after is for human readers.
- recommended_summary must be factual (use only resume facts), one sentence,
  null only when the token is [aligned].

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

    const summaryDetection = detectExistingSummary(profileText)
    const summaryDetectionBlock = summaryDetection.present
      ? `SUMMARY DETECTION (deterministic):
  summary_present: YES
  (the resume contains a Summary section near the top — see RESUME above)`
      : `SUMMARY DETECTION (deterministic):
  summary_present: NO
  (the resume does not contain a Summary section, or the section is empty)`

    const user = `
RESUME (verbatim):
${profileText}

JOB DESCRIPTION (verbatim):
${jobText}

HIGH-PRIORITY JOB KEYWORDS (SYSTEM-DETERMINED):
These are important keywords/phrases from the job description that are currently missing or underrepresented in your resume bullets:
${missingHighPriorityKeywordsText}

${summaryDetectionBlock}

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

2) Explain why in 1–2 sentences and include supporting resume evidence quotes in the evidence array. Each evidence item MUST be a verbatim quote from the resume that proves this role angle. Do NOT include metadata like "Job type: Full Time" or "Target Roles: ..." — only actual resume text.
3) Provide How to Arrange Your Resume:
   - Include the sentence: "You have about 7 seconds to make an impact with a hiring manager. Lead with your most relevant experience."
   - Make clear this is reordering existing facts, not rewriting them.
   - Output Lead With (1), Support With (1–2), Then Include (0–2), De-emphasize (0–1) if applicable.
4) Summary Statement: follow SUMMARY STATEMENT LOGIC in the system prompt.
   Use the deterministic summary_present value from above; do not re-judge
   presence. The why field MUST start with one of [missing], [misaligned],
   or [aligned] — exact tokens, including brackets. need_summary,
   recommended_summary, and evidence must be consistent with the chosen token.
5) Resume Bullet Edits:
   - BEFORE field rule: BEFORE must be a verbatim copy of an existing bullet from the RESUME text above. Do NOT paraphrase or copy from the JOB DESCRIPTION. If no resume bullet is a strong candidate for a missing keyword, omit that edit entirely.
   - Each edit MUST include at least ONE exact phrase from the HIGH-PRIORITY JOB KEYWORDS list above (copy it verbatim) in the AFTER field.
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

    // Token-anchored renderer: parse the LLM's why field for a leading
    // [missing] / [misaligned] / [aligned] token and combine with the
    // deterministic summaryDetection.present to drive the user-facing
    // message. Free-text LLM output never reaches the user — every
    // outcome maps through the table below.
    const llmWhy = asString(summaryRaw?.why, "")
    const llmTokenMatch = llmWhy.match(/^\s*\[(missing|misaligned|aligned)\]/i)
    let llmToken: "missing" | "misaligned" | "aligned" | null = llmTokenMatch
      ? (llmTokenMatch[1].toLowerCase() as "missing" | "misaligned" | "aligned")
      : null

    // Defensive defaulting: when present=NO, anything that isn't [missing]
    // gets coerced to [missing] (the only sensible cell). When present=YES
    // and the LLM returned nothing usable, default to [misaligned] (rewrite
    // suggested) — safer than [aligned] which would suppress the widget on
    // a likely-imperfect summary.
    if (!summaryDetection.present) {
      llmToken = "missing"
    } else if (llmToken === null || llmToken === "missing") {
      // LLM said "missing" but regex found a summary section — disagreement.
      // Log for ongoing visibility, then coerce to [misaligned] so the user
      // sees a "could be stronger" prompt rather than "lacks a summary".
      if (llmToken === "missing") {
        console.log(
          "[positioning] summary detection mismatch — LLM says missing, regex found one:",
          JSON.stringify({
            profileId: profileId || "",
            fingerprintCode: fingerprint_code,
            headerLine: summaryDetection.headerLine,
            bodyLength: (summaryDetection.body || "").length,
            llmWhy: llmWhy.slice(0, 200),
          })
        )
      }
      llmToken = "misaligned"
    }

    // Renderer table: (present, token) → user-facing message + need_summary +
    // whether to keep the LLM's recommended_summary draft.
    const RENDERER_TABLE: Record<
      string,
      { message: string; need: "YES" | "NO"; keepRecommended: boolean }
    > = {
      "true|aligned": {
        message: "Your existing summary is strong — keep as-is.",
        need: "NO",
        keepRecommended: false,
      },
      "true|misaligned": {
        message:
          "Your summary is present but doesn't anchor on the target role. Rewrite suggested.",
        need: "YES",
        keepRecommended: true,
      },
      "false|missing": {
        message:
          "Add a summary at the top of the resume — recruiters scan this in 7 seconds.",
        need: "YES",
        keepRecommended: true,
      },
    }
    const tableKey = `${summaryDetection.present}|${llmToken}`
    const tableRow =
      RENDERER_TABLE[tableKey] || RENDERER_TABLE["false|missing"] // defensive

    const summary_statement = {
      need_summary: tableRow.need,
      why: tableRow.message,
      recommended_summary:
        tableRow.keepRecommended && isNonEmptyString(summaryRaw?.recommended_summary)
          ? summaryRaw.recommended_summary
          : null,
      evidence: asStringArray(summaryRaw?.evidence),
    }

    const resume_bullet_edits = normalizeBulletEdits(parsed?.resume_bullet_edits, profileText, {
      profileId: profileId || "",
      fingerprintCode: fingerprint_code,
    })

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

    // Track successful run — use profileId as session_id for dedup
    // TODO(analytics-phase-2): replace with analytics_events insert per docs/signal-analytics-spec.md
    // Previous behavior: INSERT into jobfit_page_views with the payload below
    console.log('[analytics:deferred]', {
      call_site: 'app/api/positioning/route.ts:500',
      would_have_written: {
        session_id: String(profileId || crypto.randomUUID()),
        page_name: "positioning_run",
        page_path: "/api/positioning",
        referrer: null,
      },
    })

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
