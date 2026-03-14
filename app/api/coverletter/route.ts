// app/api/coverletter/route.ts
import crypto from "crypto"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"
import { getAuthedProfileText } from "../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const MISSING = "__MISSING__"
const COVERLETTER_PROMPT_VERSION = "coverletter_v2_2026_03_14"
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
    evidence: asStringArray(roleAngleObj?.evidence).slice(0, 4),
  }

  const summaryObj =
    positioning?.summary_statement && typeof positioning.summary_statement === "object"
      ? positioning.summary_statement
      : {}

  const summary_statement = {
    need_summary: asCleanString(summaryObj?.need_summary),
    why: asCleanString(summaryObj?.why),
    recommended_summary: asCleanString(summaryObj?.recommended_summary),
    evidence: asStringArray(summaryObj?.evidence).slice(0, 3),
  }

  const edits = Array.isArray(positioning?.resume_bullet_edits)
    ? positioning.resume_bullet_edits
        .slice(0, 4)
        .map((x: any) => ({
          before: asCleanString(x?.before),
          after: asCleanString(x?.after),
          rationale: asCleanString(x?.rationale),
        }))
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

export async function POST(req: Request) {
  try {
    const { profileId, profileText } = await getAuthedProfileText(req)
    const contact = extractContactFromProfileText(profileText)

    const body = await req.json().catch(() => ({}))
    const jobText = String(body?.job || "").trim()
    if (!jobText) return withCorsJson(req, { error: "Missing job" }, 400)

    const jobfitContext = summarizeJobFit(body?.jobfit)
    const positioningContext = summarizePositioning(body?.positioning)

    let writingSample = ""
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
      }
    } catch (profileErr: any) {
      console.warn(
        "client_profiles select threw in coverletter:",
        profileErr?.message || String(profileErr)
      )
    }

    const fingerprintPayload = {
      job: { text: jobText || MISSING },
      profile: {
        id: profileId || MISSING,
        text: profileText || MISSING,
        writing_sample: writingSample || MISSING,
      },
      upstream: {
        jobfit: jobfitContext || MISSING,
        positioning: positioningContext || MISSING,
      },
      system: {
        coverletter_prompt_version: COVERLETTER_PROMPT_VERSION,
        model_id: MODEL_ID,
      },
    }

    const { fingerprint_hash, fingerprint_code } =
      buildCoverletterFingerprint(fingerprintPayload)

    const { data: existingRun, error: findErr } = await supabaseAdmin
      .from("coverletter_runs")
      .select("result_json, created_at")
      .eq("client_profile_id", profileId)
      .eq("fingerprint_hash", fingerprint_hash)
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

OPENING RULE (HARD):
- The first sentence MUST begin with a personal reason, connection, motivation, or point of fit tied to the actual role, company, function, industry, customer, or mission.
- The first sentence MUST NOT begin with generic application filler.
- Forbidden opening patterns include:
  - "I am excited"
  - "I'm excited"
  - "I am writing"
  - "I want to express my interest"
  - "Please accept"
  - "I am interested"
  - "I would like to apply"
- Do not start by announcing that the user is applying. Start with why this role makes sense for this person.

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
1) Opener: immediate personal connection to the role and why this role/company makes sense.
2) Fit proof: 2-3 short paragraphs, each centered on one concrete capability tied to resume evidence.
3) Close: interest, forward motion, availability, thank you.

OUTPUT:
Return VALID JSON ONLY:
{ "letter": string }
`.trim()

    const user = `
RESUME (verbatim):
${profileText}

JOB DESCRIPTION (verbatim):
${jobText}

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