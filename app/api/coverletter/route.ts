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
const COVERLETTER_PROMPT_VERSION = "coverletter_v1_2026_02_14"
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
    // remove common labels if they somehow got included
    .replace(/^(first name|last name|name)\s*[:\-]?\s*/i, "")
    .trim()
}

function pickLabeledValue(text: string, label: string) {
  // matches: "First Name: Will" OR "First Name   Will"
  const re = new RegExp(
    String.raw`^\s*${label}\s*[:\-]?\s*(.+)\s*$`,
    "im"
  )
  const m = text.match(re)
  return m?.[1] ? cleanNameValue(m[1]) : ""
}

function extractContactFromProfileText(profileText: string) {
  const t = String(profileText || "").replace(/\r/g, "\n")

  // Email
  const emailMatch = t.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
  const email = emailMatch?.[1]?.trim() || ""

  // Phone
  const phoneMatch = t.match(
    /(\+?\d{1,2}\s*)?(\(\s*\d{3}\s*\)|\d{3})[\s.\-]*\d{3}[\s.\-]*\d{4}/
  )
  const phone = phoneMatch?.[0]?.trim() || ""

  // Name (best effort)

  // 1) If profile uses First Name / Last Name labels, build full name
  const first = pickLabeledValue(t, "First\\s*Name")
  const last = pickLabeledValue(t, "Last\\s*Name")
  if (first && last) return { full_name: `${first} ${last}`.trim(), email, phone }
  if (first && !last) return { full_name: first, email, phone }

  // 2) Prefer "Name: First Last"
  const nameLabel = t.match(/^\s*name\s*:\s*(.+)\s*$/im)
  if (nameLabel?.[1]) {
    const candidate = cleanNameValue(nameLabel[1])
    if (candidate.split(/\s+/).length >= 2 && candidate.length <= 50) {
      return { full_name: candidate, email, phone }
    }
  }

  // 3) Otherwise take the first line that looks like a name (existing logic)
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

export async function POST(req: Request) {
  try {
    // Auth + stored profile (server-side)
    const { profileId, profileText } = await getAuthedProfileText(req)
    const contact = extractContactFromProfileText(profileText)

    const body = await req.json()
    const jobText = String(body?.job || "").trim()
    if (!jobText) return withCorsJson(req, { error: "Missing job" }, 400)

    // Fingerprint pins
    const fingerprintPayload = {
      job: { text: jobText || MISSING },
      profile: { id: profileId || MISSING, text: profileText || MISSING },
      system: {
        coverletter_prompt_version: COVERLETTER_PROMPT_VERSION,
        model_id: MODEL_ID,
      },
    }

    const { fingerprint_hash, fingerprint_code } =
      buildCoverletterFingerprint(fingerprintPayload)

    // 1) Cache lookup
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
          // ensure these are always returned even if cache is older
          contact,
          fingerprint_code,
          fingerprint_hash,
          reused: true,
        },
        200
      )
    }

    // 2) Generate
    const system = `
You are WRNSignal by Workforce Ready Now (Cover Letter module).

Write a recruiter-ready cover letter that reads like it was written by a strong college student or early-career candidate.

STYLE RULES (STUDENT-READY):
- Direct, confident, not cringe.
- No corporate buzzwords.
- No em dashes.
- Short paragraphs. Easy to scan.
- 220–320 words max.

CONTENT RULES (STRICT):
- Use ONLY facts that are present in the resume text.
- Do NOT invent tools, metrics, awards, employers, projects, or outcomes.
- If the resume does not support a claim, do not include it.
- Do NOT restate the resume. Connect the student’s evidence to the job’s needs.

STRUCTURE:
1) Opener: role + why them (1 short paragraph)
2) Fit proof: 2–3 short paragraphs, each with one concrete capability tied to resume evidence
3) Close: interest + availability + thank you (1 short paragraph)

OUTPUT:
Return VALID JSON ONLY:
{ "letter": string }
`.trim()

    const user = `
RESUME (verbatim):
${profileText}

JOB DESCRIPTION (verbatim):
${jobText}

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

    const finalResult = { letter, contact }

    // 3) Store (best effort)
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