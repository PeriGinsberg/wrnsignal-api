import OpenAI from "openai"

export const runtime = "nodejs" // required for OpenAI in Next.js route handlers

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/* -------------------- CORS -------------------- */
function corsHeaders(origin: string | null) {
  // Allow Framer + local dev; tighten later if you want.
  const allowOrigin = origin || "*"
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  }
}

// Preflight
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin")
  return new Response(null, { status: 204, headers: corsHeaders(origin) })
}

/* -------------------- HELPERS -------------------- */
type Signal = "required" | "unclear" | "not_required"

function safeTrim(s: any) {
  return typeof s === "string" ? s.trim() : ""
}

/**
 * Lightweight deterministic signal detector.
 * We still ask the model to align language + write the letter,
 * but we don't rely on the model for "required" vs "not required".
 */
function detectCoverLetterSignal(jobText: string): Signal {
  const t = (jobText || "").toLowerCase()

  // Strong "required" cues
  const requiredPhrases = [
    "cover letter required",
    "cover letter is required",
    "must include a cover letter",
    "include a cover letter",
    "submit a cover letter",
    "upload a cover letter",
    "attach a cover letter",
    "please provide a cover letter",
  ]

  // Strong "not required/optional" cues
  const notRequiredPhrases = [
    "cover letter optional",
    "cover letter is optional",
    "no cover letter required",
    "cover letter not required",
    "cover letter not necessary",
    "do not submit a cover letter",
  ]

  if (notRequiredPhrases.some((p) => t.includes(p))) return "not_required"
  if (requiredPhrases.some((p) => t.includes(p))) return "required"

  // Common “application materials” phrasing can be ambiguous
  // (eg, "resume and cover letter" listed but not clearly required)
  const ambiguousPhrases = [
    "resume and cover letter",
    "cv and cover letter",
    "application materials",
    "application package",
  ]

  if (ambiguousPhrases.some((p) => t.includes(p))) return "unclear"

  return "unclear"
}

/**
 * Attempts to parse JSON strictly. If model returns extra text,
 * tries to extract first JSON object block.
 */
function parseModelJson(raw: string) {
  const t = safeTrim(raw)
  if (!t) return null

  try {
    return JSON.parse(t)
  } catch {
    // Try to extract first {...} block
    const firstBrace = t.indexOf("{")
    const lastBrace = t.lastIndexOf("}")
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = t.slice(firstBrace, lastBrace + 1)
      try {
        return JSON.parse(candidate)
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * Ensures the response matches the API contract and is always usable.
 */
function normalizeResponse(
  detectedSignal: Signal,
  parsed: any,
  fallbackLetter: string
) {
  const signal: Signal =
    parsed?.signal === "required" ||
    parsed?.signal === "unclear" ||
    parsed?.signal === "not_required"
      ? parsed.signal
      : detectedSignal

  const note =
    typeof parsed?.note === "string" && parsed.note.trim().length > 0
      ? parsed.note.trim()
      : "Not recommended unless a cover letter is explicitly required. If required, use this as a clean, factual attachment aligned to the job language."

  const letter =
    typeof parsed?.letter === "string" && parsed.letter.trim().length > 0
      ? parsed.letter.trim()
      : safeTrim(fallbackLetter)

  return { signal, note, letter }
}

/* -------------------- ROUTE -------------------- */
export async function POST(req: Request) {
  const origin = req.headers.get("origin")

  try {
    const body = await req.json()
    const profile = safeTrim(body?.profile)
    const job = safeTrim(body?.job)

    if (!profile || !job) {
      return new Response(
        JSON.stringify({ error: "Missing profile or job" }),
        { status: 400, headers: corsHeaders(origin) }
      )
    }

    const detectedSignal = detectCoverLetterSignal(job)

    /**
     * COVER LETTER RULES (FORMALIZED):
     * - Output is a concise, factual cover letter.
     * - Must align to job language (keywords, responsibilities, functions).
     * - Must only use information in the profile. No invented experience.
     * - No fluffy enthusiasm, no generic "passionate/excited" filler.
     * - Tone: direct, competent, recruiter-readable.
     * - Structure must match the preferred template:
     *   [Date]
     *   Hiring Team
     *   [Company Name]
     *   Re: Application for [Position Title]
     *   Dear Hiring Team,
     *   (3–4 short paragraphs)
     *   Sincerely,
     *   [Candidate Name]
     *
     * Also:
     * - We ALWAYS allow generation, but we include a note that it's not recommended unless required.
     * - Return JSON only.
     */
    const system = [
      "You are WRNSignal.",
      "You generate a concise, factual cover letter aligned to the job language using ONLY information from the profile.",
      "You do not invent, assume, or embellish experience, skills, outcomes, metrics, or intent.",
      "You do not use generic enthusiasm, filler, motivational language, or salesy claims.",
      "You keep sentences short, concrete, and recruiter-readable.",
      "You mirror wording from the job description where it is factually supported by the profile.",
      "You MUST follow this letter format exactly:",
      "[Date]",
      "Hiring Team",
      "[Company Name]",
      "Re: Application for [Position Title]",
      "Dear Hiring Team,",
      "(3–4 short paragraphs, tight and factual, aligned to the job language)",
      "Sincerely,",
      "[Candidate Name]",
      "",
      "You must return JSON ONLY. No markdown. No commentary.",
      'JSON shape: {"signal":"required|unclear|not_required","note":"...", "letter":"..."}',
      "",
      "Signal guidance:",
      "- Use 'required' only if the job explicitly states a cover letter is required.",
      "- Use 'not_required' only if the job explicitly states a cover letter is optional/not required.",
      "- Otherwise use 'unclear'.",
      "",
      "Note guidance:",
      "Always include: it is not recommended to spend time on a cover letter unless explicitly required, but the user can generate one anyway.",
    ].join("\n")

    const user = [
      "PROFILE:",
      profile,
      "",
      "JOB:",
      job,
      "",
      `Detected signal (use as a hint, not gospel): ${detectedSignal}`,
      "",
      "Write a cover letter that is factual and tightly aligned to the job language.",
      "If company name, title, date, or candidate name are missing, keep the placeholders [Company Name], [Position Title], [Date], [Candidate Name].",
      "Do NOT add any details not present in the profile.",
      "Return JSON only in the required shape.",
    ].join("\n")

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })

    // OpenAI SDK output text handling (covers common variants)
    const raw =
      // @ts-ignore
      response.output_text ||
      // fallback variants
      (response as any)?.output?.[0]?.content?.[0]?.text ||
      ""

    const parsed = parseModelJson(raw)
    const normalized = normalizeResponse(detectedSignal, parsed, raw)

    // Force our detected signal if you want hard deterministic behavior:
    // normalized.signal = detectedSignal

    return new Response(JSON.stringify(normalized), {
      status: 200,
      headers: corsHeaders(origin),
    })
  } catch (err: any) {
    const detail = err?.message || String(err)
    return new Response(
      JSON.stringify({ error: "CoverLetter failed", detail }),
      { status: 500, headers: corsHeaders(origin) }
    )
  }
}
