// app/api/coverletter/route.ts
import crypto from "crypto"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"
import { getAuthedProfileText } from "../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { getHistoryBoundary, applyHistoryBoundary } from "../_lib/clientHistoryBoundary"
import { getCandidateTargeting } from "@/lib/candidateTargeting"
import { extractGraduationDate } from "@/lib/resume/extractGraduationDate"
import { computeStatus, type CandidateStatus } from "@/lib/profile/computeStatus"
import { centsForUsage } from "@/lib/ai/costPolicy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const MISSING = "__MISSING__"
// Bumped 2026-05-29 — wrong-status fix. The version bump alone busts
// every existing v4b cache entry so the next call exercises the new
// CANDIDATE STATUS branching path.
const COVERLETTER_PROMPT_VERSION = "coverletter_v5_status_verdict_2026_05_29"
const MODEL_ID = "current"

// Supabase (service role)
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

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

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

function buildCoverletterFingerprint(payload: any) {
  const canonical = JSON.stringify(normalize(payload))
  const fingerprint_hash = crypto.createHash("sha256").update(canonical).digest("hex")
  const fingerprint_code =
    "CL-" + parseInt(fingerprint_hash.slice(0, 10), 16).toString(36).toUpperCase()

  return { fingerprint_hash, fingerprint_code }
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function enforceSignalStyle(text: string) {
  return String(text || "")
    .replace(/—/g, ", ")
    .replace(/–/g, ", ")
    .replace(/[ \t]{2,}/g, " ")   // collapse spaces but NOT newlines
    .replace(/\n{3,}/g, "\n\n")   // normalize paragraph spacing
    .trim()
}

function isNonEmptyString(x: any): x is string {
  return typeof x === "string" && x.trim().length > 0
}

function extractOutputText(resp: any): string {
  if (typeof resp?.output_text === "string" && resp.output_text.trim()) return resp.output_text

  const output = resp?.output
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "output_text" && typeof c?.text === "string" && c.text.trim()) {
            return c.text
          }
        }
      }
    }
  }
  return ""
}

function cleanNameValue(s: string) {
  return String(s || "")
    .replace(/\t+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(first name|last name|name)\s*[:\-]?\s*/i, "")
    .trim()
}

function pickLabeledValue(text: string, label: string) {
  const re = new RegExp(String.raw`^\s*${label}\s*[:\-]?\s*(.+)\s*$`, "im")
  const m = text.match(re)
  return m?.[1] ? cleanNameValue(m[1]) : ""
}

function extractContactFromProfileText(profileText: string) {
  const t = String(profileText || "").replace(/\r/g, "\n")

  const emailMatch = t.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
  const email = emailMatch?.[1]?.trim() || ""

  const phoneMatch = t.match(
    /(\+?\d{1,2}\s*)?(\(\s*\d{3}\s*\)|\d{3})[\s.\-]*\d{3}[\s.\-]*\d{4}/
  )
  const phone = phoneMatch?.[0]?.trim() || ""

  const first = pickLabeledValue(t, "First\\s*Name")
  const last = pickLabeledValue(t, "Last\\s*Name")
  if (first && last) return { full_name: `${first} ${last}`.trim(), email, phone }
  if (first && !last) return { full_name: first, email, phone }

  const nameLabel = t.match(/^\s*name\s*:\s*(.+)\s*$/im)
  if (nameLabel?.[1]) {
    const candidate = cleanNameValue(nameLabel[1])
    if (candidate.split(/\s+/).length >= 2 && candidate.length <= 50) {
      return { full_name: candidate, email, phone }
    }
  }

  const lines = t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)

  const looksLikeName = (s: string) => {
    if (s.length < 5 || s.length > 50) return false
    if (/@/.test(s)) return false
    if (/\d/.test(s)) return false

    const parts = s.split(/\s+/)
    if (parts.length < 2 || parts.length > 4) return false

    const bad = ["education", "experience", "skills", "summary", "profile"]
    if (bad.some((b) => s.toLowerCase().includes(b))) return false

    const titleCaseWords = parts.filter((p) =>
      /^[A-Z][a-z]+(?:['-][A-Z][a-z]+)?$/.test(p)
    ).length

    return titleCaseWords >= 2
  }

  const full_name = lines.find(looksLikeName) || ""
  return { full_name, email, phone }
}

function asCleanString(x: any) {
  return typeof x === "string" ? x.trim() : ""
}

function asStringArray(x: any): string[] {
  return Array.isArray(x)
    ? x.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
    : []
}

function extractWritingSample(profileRow: any) {
  if (!profileRow || typeof profileRow !== "object") return ""

  const preferredKeys = [
    "writing_sample",
    "writing_sample_text",
    "sample_writing",
    "sample_piece_of_writing",
    "cover_letter_writing_sample",
    "coverletter_writing_sample",
    "cover_letter_voice_sample",
    "coverletter_voice_sample",
    "voice_sample",
    "tone_sample",
    "writing_voice_sample",
  ]

  for (const key of preferredKeys) {
    const value = profileRow?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }

  for (const [key, value] of Object.entries(profileRow)) {
    if (typeof value !== "string") continue
    const k = key.toLowerCase()
    if (
      (k.includes("writing") || k.includes("voice") || k.includes("tone")) &&
      value.trim().length >= 80
    ) {
      return value.trim()
    }
  }

  return ""
}

function summarizeJobFit(jobfit: any) {
  if (!jobfit || typeof jobfit !== "object") return null

  const decision = asCleanString(jobfit?.decision || jobfit?.verdict)
  const scoreRaw = jobfit?.score
  const score = typeof scoreRaw === "number" && Number.isFinite(scoreRaw) ? scoreRaw : null
  const why = asStringArray(
    jobfit?.bullets ||
      jobfit?.why ||
      jobfit?.reasons ||
      jobfit?.key_reasons ||
      jobfit?.why_this_works
  ).slice(0, 5)
  const risks = asStringArray(
    jobfit?.risk_flags ||
      jobfit?.risks ||
      jobfit?.concerns ||
      jobfit?.warnings ||
      jobfit?.gaps
  ).slice(0, 5)

  if (!decision && score === null && !why.length && !risks.length) return null
  return { decision, score, why, risks }
}

function summarizePositioning(positioning: any) {
  if (!positioning || typeof positioning !== "object") return null

  const roleAngleObj =
    positioning?.role_angle && typeof positioning.role_angle === "object"
      ? positioning.role_angle
      : {}

  const role_angle = {
    label: asCleanString(roleAngleObj?.label),
    why: asCleanString(roleAngleObj?.why),
    evidence: Array.isArray(roleAngleObj?.evidence)
      ? roleAngleObj.evidence.filter(
          (x: any) => typeof x === "string" && x.trim()
        )
      : [],
  }

  const summaryStatementObj =
    positioning?.summary_statement && typeof positioning.summary_statement === "object"
      ? positioning.summary_statement
      : {}

  const summary_statement = {
    why: asCleanString(summaryStatementObj?.why),
    recommended_summary: asCleanString(summaryStatementObj?.recommended_summary),
  }

  const edits = Array.isArray(positioning?.resume_bullet_edits)
    ? positioning.resume_bullet_edits
        .slice(0, 5)
        .map((e: any) =>
          e && typeof e === "object"
            ? {
                before: asCleanString(e.before),
                after: asCleanString(e.after),
                rationale: asCleanString(e.rationale),
              }
            : null
        )
        .filter((x: any) => x.before || x.after || x.rationale)
    : []

  const keyword_analysis =
    positioning?.keyword_analysis && typeof positioning.keyword_analysis === "object"
      ? {
          coverage_pct:
            typeof positioning.keyword_analysis.coverage_pct === "number"
              ? positioning.keyword_analysis.coverage_pct
              : null,
          missing_high_priority: asStringArray(
            positioning.keyword_analysis.missing_high_priority
          ).slice(0, 8),
        }
      : null

  if (
    !role_angle.label &&
    !role_angle.why &&
    !role_angle.evidence.length &&
    !summary_statement.why &&
    !summary_statement.recommended_summary &&
    !edits.length &&
    !keyword_analysis
  ) {
    return null
  }

  return { role_angle, summary_statement, resume_bullet_edits: edits, keyword_analysis }
}

// ── Wrong-status fix (2026-05-29): the CANDIDATE STATUS verdict block ───────
// injected into the user prompt. Keep this TIGHT — verdict + the
// load-bearing banned/required framings. Full rule enumeration lives in
// the system prompt's CANDIDATE STATUS BRANCHING section. The user-prompt
// block is the per-call hard fact; the system prompt is the generic
// branch logic.
function buildCandidateStatusBlock(status: CandidateStatus): string {
  if (status === "graduated") {
    return `CANDIDATE STATUS: graduated (authoritative — code-computed from grad date; do not reason about dates yourself).
FORBIDDEN throughout the letter: "student" (self-description), "senior at", "junior at", "studying X at" (present-tense), "graduating in", "graduating from", "expecting to graduate"; plus any present-tense or future use of "graduate" as a verb ("graduating", "about to graduate", "will graduate" — past-tense "graduated" is required).
REQUIRED: past-tense framing — "recent graduate from [school]", "graduated", "completed my [degree]", "earned my [degree]".
See system prompt CANDIDATE STATUS BRANCHING for full rules.`
  }
  if (status === "student") {
    return `CANDIDATE STATUS: student (authoritative — code-computed from grad date; do not reason about dates yourself).
Present-tense student framing is appropriate. Position the candidate as a current student of [degree] at [university] in the opener.
See system prompt CANDIDATE STATUS BRANCHING for full rules.`
  }
  return `CANDIDATE STATUS: unknown (no structured signal extracted; the grad date could not be parsed and no career_stage was on file).
Infer the lifecycle position from resume dates and degree language. Default to past-tense framing if the most recent graduation date is in the past relative to today.
See system prompt CANDIDATE STATUS BRANCHING for full rules.`
}

// ── NEW: extract cover_letter_strategy from V5 jobfit result ─────────────────
function extractCoverLetterStrategy(jobfitResult: any): string {
  const s = jobfitResult?.cover_letter_strategy
  if (!s || typeof s !== "object") return ""

  const parts: string[] = [
    "## COVER LETTER STRATEGY (from SIGNAL JobFit V5 — follow these instructions precisely)",
  ]

  if (s.open_with) {
    parts.push(`OPEN WITH (topic): ${s.open_with}`)
    parts.push(
      `  → This is the TOPIC for your opening paragraph, not the literal first sentence.`
    )
    parts.push(
      `  → First: position who the candidate is per CANDIDATE STATUS above (CANDIDATE STATUS is the only source of truth on lifecycle position) and name the role/company. THEN weave in this topic as the connection point.`
    )
    parts.push(
      `  → Do NOT start the letter with a raw experience statement. Start with context, then connect.`
    )
  }

  if (s.address_gap) {
    parts.push(`ADDRESS GAP: ${s.address_gap}`)
    parts.push(
      `  → Address this directly in the letter. Do not omit, minimize, or hide it.`
    )
  }

  if (s.tone) {
    parts.push(`TONE: ${s.tone}`)
  }

  return parts.join("\n")
}
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    // Read body first so we can pass persona_id to getAuthedProfileText.
    // Wave 2 personas refactor (2026-05-06): cover letter now reads the
    // resume via the persona resolution chain. Previously it used only
    // the 200-char intake header as "RESUME" in the prompt — same column-
    // split bug as positioning. See app/api/positioning/route.ts top-of-
    // file comment for the full architectural context.
    const body = await req.json().catch(() => ({}))
    const jobText = String(body?.job || "").trim()
    if (!jobText) return withCorsJson(req, { error: "Missing job" }, 400)

    const personaIdFromBody =
      typeof body?.persona_id === "string" && body.persona_id.trim().length > 0
        ? body.persona_id.trim()
        : null

    const {
      profileId,
      profileText,
      resumeText,
      activePersonaId,
    } = await getAuthedProfileText(req, { personaId: personaIdFromBody })

    // Wrong-status fix (2026-05-29): compute student-vs-graduated verdict
    // from gradDate (extractor → Haiku) + candidate_targeting.career_stage
    // fallback. Layer 1 (gradDate) wins over Layer 2 (career_stage), so a
    // stale "mid_career" career_stage on a current student/recent grad is
    // overridden by the real date in the resume. The verdict is injected
    // into the user prompt as an authoritative hard fact; the system
    // prompt's CANDIDATE STATUS BRANCHING does the framing.
    const [extractionResult, targetingResult] = await Promise.all([
      extractGraduationDate({ resumeText }),
      getCandidateTargeting(supabaseAdmin, profileId),
    ])

    const candidateStatus: CandidateStatus = computeStatus({
      gradDate: extractionResult.result,
      careerStage: targetingResult.row?.career_stage ?? null,
    })

    console.log(
      `[coverletter] grad date extraction cost cents=${centsForUsage(extractionResult.usage)} input_tokens=${extractionResult.usage.input_tokens} output_tokens=${extractionResult.usage.output_tokens} latency_ms=${extractionResult.latencyMs} extracted_raw=${JSON.stringify(extractionResult.result?.raw ?? null)} computed_status=${candidateStatus} career_stage=${targetingResult.row?.career_stage ?? "null"}`
    )

    // Accept jobfit_result from the frontend (sent alongside job)
    const jobfitResult = body?.jobfit_result ?? null

    const jobfitContext = summarizeJobFit(body?.jobfit ?? jobfitResult)
    const positioningContext = summarizePositioning(body?.positioning)

    // Extract the V5 cover letter strategy block (empty string if not present)
    const coverLetterStrategyBlock = extractCoverLetterStrategy(jobfitResult)

    // Defaults match the writingSample pattern: empty string survives the
    // catch path so downstream contact resolution doesn't have to guard
    // against undefined.
    let writingSample = ""
    let profileName = ""
    let profileEmail = ""
    try {
      const { data: profileRow, error: profileLookupErr } = await supabaseAdmin
        .from("client_profiles")
        .select("*")
        .eq("id", profileId)
        .maybeSingle()

      if (profileLookupErr) {
        console.warn("client_profiles lookup failed in coverletter:", profileLookupErr.message)
      } else {
        writingSample = extractWritingSample(profileRow)
        profileName = typeof profileRow?.name === "string" ? profileRow.name.trim() : ""
        profileEmail = typeof profileRow?.email === "string" ? profileRow.email.trim() : ""
      }
    } catch (profileErr: any) {
      console.warn(
        "client_profiles select threw in coverletter:",
        profileErr?.message || String(profileErr)
      )
    }

    // Contact resolution. DB column wins over regex for name; DB column
    // is the only server source for email (regex fallback removed per
    // docs/Features/cover-letter-header-investigation.md — auth email
    // serves as a client-side safety net in Framer/mobile, not here).
    // Phone preserved as regex-only — full phone fix tracked separately.
    const regexContact = extractContactFromProfileText(profileText)
    const contact = {
      full_name: profileName || regexContact.full_name,
      email: profileEmail || "",
      phone: regexContact.phone,
    }

    const fingerprintPayload = {
      job: { text: jobText || MISSING },
      profile: {
        id: profileId || MISSING,
        text: profileText || MISSING,
        // Wave 2: include resumeText and activePersonaId so persona switches
        // and resume edits bust the cache (previously cache was persona-blind).
        resume: resumeText || MISSING,
        persona_id: activePersonaId || MISSING,
        writing_sample: writingSample || MISSING,
      },
      upstream: {
        jobfit: jobfitContext || MISSING,
        positioning: positioningContext || MISSING,
        // Include strategy in fingerprint so a re-run with V5 data isn't cached from a V4 run
        cover_letter_strategy: jobfitResult?.cover_letter_strategy || MISSING,
      },
      // Wrong-status fix: computed verdict + the fallback signal. Edits to
      // the resume that change the extracted grad date bust the cache; a
      // change to candidate_targeting.career_stage busts the cache. The
      // version bump alone (COVERLETTER_PROMPT_VERSION) busts every
      // existing v4b entry.
      candidate_status: candidateStatus,
      candidate_targeting: {
        career_stage: targetingResult.row?.career_stage ?? MISSING,
      },
      system: {
        coverletter_prompt_version: COVERLETTER_PROMPT_VERSION,
        model_id: MODEL_ID,
      },
    }

    const { fingerprint_hash, fingerprint_code } =
      buildCoverletterFingerprint(fingerprintPayload)

    const boundaryAt = await getHistoryBoundary(supabaseAdmin, profileId)
    const clQ = supabaseAdmin
      .from("coverletter_runs")
      .select("result_json, created_at")
      .eq("client_profile_id", profileId)
      .eq("fingerprint_hash", fingerprint_hash)
    const { data: existingRun, error: findErr } = await applyHistoryBoundary(clQ, boundaryAt)
      .maybeSingle()

    if (findErr) console.warn("coverletter_runs lookup failed:", findErr.message)

    if (existingRun?.result_json) {
      const cached = existingRun.result_json as any
      return withCorsJson(
        req,
        {
          ...(cached && typeof cached === "object" ? cached : {}),
          contact,
          fingerprint_code,
          fingerprint_hash,
          reused: true,
        },
        200
      )
    }

    const system = `
You are WRNSignal by Workforce Ready Now (Cover Letter module).

Write a recruiter-ready cover letter that reads like it was written by a strong college student or early-career candidate.

STYLE RULES (DEFAULT):
- Direct, confident, human, and recruiter-ready.
- No corporate buzzwords.
- No em dashes.
- Short paragraphs. Easy to scan.
- 220-320 words max.
- Build ONE clear job-specific story. Do not wander.

CANDIDATE STATUS BRANCHING (HARD — applies to the WHOLE letter, not just the opener):

A CANDIDATE STATUS value is provided in the user prompt with one of three values: "student", "graduated", or "unknown". This value is computed by code from the candidate's graduation date and is AUTHORITATIVE — do not reason about dates yourself; CANDIDATE STATUS is the only source of truth on lifecycle position. The candidate's lifecycle position must match this value in every paragraph of the letter, not just the opener.

If CANDIDATE STATUS = "student":
- The candidate is currently enrolled. Present-tense student framing is appropriate.
- Position them as a current student of [degree] at [university] in the opener and maintain that frame across the letter.
- Acceptable framings: "current [year-level] at [university] studying [major]", "as a [major] student at [university]", "studying [X] at [university]".

If CANDIDATE STATUS = "graduated":
- The candidate has ALREADY completed their degree. Past-tense framing is REQUIRED across the entire letter.
- FORBIDDEN ANYWHERE IN THE LETTER (not just the opener):
  * "student" as a self-description of the candidate
  * "senior at [school]", "junior at [school]", "sophomore at [school]", "freshman at [school]"
  * "currently studying", "currently a [year] at [school]"
  * "studying [X] at [school]" in present tense
  * "graduating in", "graduating from", "graduating this [month/year]", "expecting to graduate", "will graduate"
  * any future-tense or present-progressive use of "graduate" as a verb referring to the candidate (e.g. "graduating", "about to graduate", "set to graduate", "soon to graduate", "will graduate"). Past-tense use ("graduated", "having graduated", "after graduating") is required and remains acceptable.
  * any present-continuous verb construction implying ongoing study (e.g. "while completing my degree", "as I finish my [X]")
- REQUIRED framings — use one in the opener and maintain past-tense register throughout the letter:
  * "As a recent [degree] graduate from [university]"
  * "As a recent graduate from [university] with [degree/honors]"
  * "After completing my [degree] at [university]"
  * "Having recently graduated from [university] with [degree]"
  * "I recently earned my [degree] from [university]"
  * Past-tense verbs only when referring to the candidate's education: "graduated", "completed", "earned", "received my [degree]"

If CANDIDATE STATUS = "unknown":
- No structured signal was extractable for this candidate. Read the resume carefully and infer their lifecycle position from dates and degree language.
- If the most recent graduation date appears to be in the past relative to today, default to the "graduated" framing rules above. If a current or future grad date appears with no degree-completion language, default to "student".

OPENING RULE (HARD):
- The first paragraph establishes WHO the person is in relation to THIS role (per CANDIDATE STATUS BRANCHING above), then connects to WHY this specific company/role matters to them.
- For career changers: briefly establish the pivot context before connecting to the role.
- For experienced professionals applying in their field: lead directly with the connection to the role/company/mission — no self-introduction needed.
- The role, company, or function MUST appear within the first two sentences. Do not bury what job this is for.
- The opener should feel like a human explaining why this specific opportunity caught their attention, not a form letter.
- Forbidden opening patterns (never use these):
  - "I am excited to apply"
  - "I'm excited"
  - "I am writing to express"
  - "I want to express my interest"
  - "Please accept"
  - "I am interested in"
  - "I would like to apply"
  - "I am applying for"
- Do not start with generic enthusiasm. Start with positioning + connection.

VOICE RULE:
- If a writing sample is provided, match the candidate's general voice characteristics at a high level: directness, sentence length, warmth, restraint, and cadence.
- Do NOT copy unusual phrases verbatim.
- Do NOT imitate so closely that it feels fake.
- Preserve professionalism.
- Use the writing sample for style only, not facts.

CONTENT RULES (STRICT):
- Use ONLY facts that are present in the resume text.
- Do NOT import facts from the writing sample, Job Fit, or Positioning unless those facts are also supported by the resume text.
- Do NOT invent tools, metrics, awards, employers, projects, or outcomes.
- If the resume does not support a claim, do not include it.
- Do NOT restate the resume line by line.
- Connect the student's evidence to the job's needs.

SIGNAL RULE:
- If Job Fit context is provided, use it to understand the strongest fit story and the main risks. Do not repeat Job Fit labels mechanically.
- If Positioning context is provided, use it to align the letter to the same role angle, summary logic, and bullet emphasis.
- The cover letter should feel consistent with the SIGNAL Positioning output, not like a separate random narrative.
- Use Positioning and Job Fit to choose the angle, not to invent facts.

STRUCTURE:
1) Opener (2-3 sentences): Position who you are in the context of this role, then state why this specific company/role resonates. The reader should know within the first paragraph: who is writing, what role this is for, and why it's a fit.
2) Fit proof: 2-3 short paragraphs, each centered on one concrete capability tied to resume evidence.
3) Close: interest, forward motion, availability, thank you.

OUTPUT:
Return VALID JSON ONLY:
{ "letter": string }
`.trim()

    const user = `
CANDIDATE INTAKE (verbatim — target roles, locations, timeline, etc.):
${profileText}

${buildCandidateStatusBlock(candidateStatus)}

RESUME (verbatim):
${resumeText}

JOB DESCRIPTION (verbatim):
${jobText}

${coverLetterStrategyBlock ? coverLetterStrategyBlock + "\n" : ""}
JOB FIT CONTEXT (use for angle only, not new facts):
${jobfitContext ? JSON.stringify(jobfitContext, null, 2) : "None provided."}

POSITIONING CONTEXT (use for angle only, not new facts):
${positioningContext ? JSON.stringify(positioningContext, null, 2) : "None provided."}

OPTIONAL WRITING SAMPLE (style only, not facts):
${writingSample || "None provided."}

TASK:
Write the cover letter following the system rules.
Return JSON only. No markdown. No commentary.
`.trim()

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })

    const raw = extractOutputText(resp)
    const parsed = safeJsonParse(raw)

    const letter =
      parsed && typeof parsed === "object" && isNonEmptyString((parsed as any).letter)
        ? String((parsed as any).letter).trim()
        : String(raw || "").trim()

    const sanitizedLetter = enforceSignalStyle(letter)

    const finalResult = {
      letter: sanitizedLetter,
      contact,
      context_used: {
        jobfit: Boolean(jobfitContext),
        positioning: Boolean(positioningContext),
        writing_sample: Boolean(writingSample),
        cover_letter_strategy: Boolean(coverLetterStrategyBlock),
      },
    }

    const { error: upsertErr } = await supabaseAdmin
      .from("coverletter_runs")
      .upsert(
        {
          client_profile_id: profileId,
          job_url: null,
          fingerprint_hash,
          fingerprint_code,
          result_json: finalResult,
        },
        { onConflict: "client_profile_id,fingerprint_hash" }
      )

    if (upsertErr) console.warn("coverletter_runs upsert failed:", upsertErr.message)

    // Track successful run
    // TODO(analytics-phase-2): replace with analytics_events insert per docs/signal-analytics-spec.md
    // Previous behavior: INSERT into jobfit_page_views with the payload below
    console.log('[analytics:deferred]', {
      call_site: 'app/api/coverletter/route.ts:566',
      would_have_written: {
        session_id: String(profileId || crypto.randomUUID()),
        page_name: "coverletter_run",
        page_path: "/api/coverletter",
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

    return withCorsJson(req, { error: "Coverletter failed", detail }, status)
  }
}