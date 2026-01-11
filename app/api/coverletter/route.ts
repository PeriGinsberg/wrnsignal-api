import OpenAI from "openai"

export const runtime = "nodejs"

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

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

// Preflight
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin")
  return new Response(null, { status: 204, headers: corsHeaders(origin) })
}

/* -------------------- helpers -------------------- */

function safeStr(v: any) {
  return typeof v === "string" ? v : ""
}

function pickLineValue(profile: string, label: string) {
  // Works for: "First Name\tAiden" or "First Name  Aiden"
  const lines = profile.split(/\r?\n/)
  const lowerLabel = label.trim().toLowerCase()
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    const lower = t.toLowerCase()
    if (lower.startsWith(lowerLabel)) {
      // strip label then split by tabs or 2+ spaces
      const rest = t.slice(label.length).trim()
      const parts = rest.split(/\t+/).filter(Boolean)
      if (parts.length >= 1) return parts.join(" ").trim()
      const parts2 = rest.split(/\s{2,}/).filter(Boolean)
      if (parts2.length >= 1) return parts2.join(" ").trim()
      return rest.trim()
    }
  }
  return ""
}


function detectCompanyFromJob(job: string) {
  // Heuristic: look for a strong brand mention in first ~20 lines
  const lines = job.split(/\r?\n/).slice(0, 25).map((l) => l.trim()).filter(Boolean)
  const joined = lines.join(" ")
  // Example: "San Diego Padres" appears often
  const m = joined.match(/([A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){1,5})/)
  return m ? m[1].trim() : ""
}

function detectRoleFromJob(job: string) {
  // Heuristic: look for "Your role as X" or "Position: X" etc.
  const patterns = [
    /Your role as\s*:\s*([A-Za-z0-9/&()-]+(?:\s+[A-Za-z0-9/&()-]+){0,8})/i,
    /Your role as\s+([A-Za-z0-9/&()-]+(?:\s+[A-Za-z0-9/&()-]+){0,8})/i,
    /Position\s*:\s*([A-Za-z0-9/&()-]+(?:\s+[A-Za-z0-9/&()-]+){0,8})/i,
    /Title\s*:\s*([A-Za-z0-9/&()-]+(?:\s+[A-Za-z0-9/&()-]+){0,8})/i,
  ]
  for (const p of patterns) {
    const m = job.match(p)
    if (m?.[1]) return m[1].trim()
  }
  return ""
}

function detectCoverLetterSignal(job: string) {
  const t = job.toLowerCase()
  // You can refine later
  if (t.includes("cover letter required") || t.includes("cover letter is required")) return "required"
  if (t.includes("cover letter") && (t.includes("required") || t.includes("must include"))) return "required"
  if (t.includes("cover letter")) return "unclear"
  return "not_required"
}

function looksLikeHtml(text: string) {
  const t = (text || "").trim().toLowerCase()
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<head") || t.includes("<body")
}

async function readBody(req: Request) {
  try {
    return await req.json()
  } catch {
    return null
  }
}

/* -------------------- route -------------------- */

export async function POST(req: Request) {
  const origin = req.headers.get("origin")
const today = new Date().toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
})

  try {
    const body = await readBody(req)
    const profile = safeStr(body?.profile)
    const job = safeStr(body?.job)

    if (!profile || !job) {
      return new Response(JSON.stringify({ error: "Missing profile or job" }), {
        status: 400,
        headers: corsHeaders(origin),
      })
    }

    // Extract from THIS profile format
    const firstName = pickLineValue(profile, "First Name")
    const lastName = pickLineValue(profile, "Last Name")
    const candidateName = [firstName, lastName].filter(Boolean).join(" ").trim()

    const targeting = pickLineValue(profile, "3. What types of roles are you targeting right now?")
    const dontWant = pickLineValue(profile, "5. Are there any roles or industries you D O N O T want?")
    const location = pickLineValue(profile, "6. Location preferences")
    const timeline = pickLineValue(profile, "7. Timeline for starting work")
    const strengths = pickLineValue(profile, "8. What do you believe are your strongest skills right now?")
    const concern = pickLineValue(profile, "9. What about your job search gives you most concern?")
    const other = pickLineValue(profile, "13. Anything else we should know about your situation?")

    const resumePaste = pickLineValue(profile, "Resume Paste")
    const writingSample = pickLineValue(profile, "Cover Letter or Other Writing Samples")

    // Extract from job (heuristics)
    const companyHint = detectCompanyFromJob(job)
    const roleHint = detectRoleFromJob(job)
    const signal = detectCoverLetterSignal(job)

   const system = `
You are WRNSignal.

NON NEGOTIABLE RULES:
- Never use dashes or hyphens.
- Do not invent experience.
- Do not repeat the job description.
- Write with narrative flow and intent.
- Explain WHY the candidate wants this role.

DATE RULE:
- The cover letter MUST begin with the system date shown below.
- Use it exactly as written.
- Do not reformat or omit it.

SYSTEM DATE:
${today}

FORMAT (MANDATORY):
Line 1: SYSTEM DATE
Line 2: Hiring Team
Line 3: Company name if available
Line 4: Re: Application for Position Title
Line 5: Dear Hiring Team,

CONTENT:
- Paragraph 1: Story and motivation
- Paragraph 2: Evidence of fit
- Paragraph 3: Commitment and intent

OUTPUT:
Return valid JSON only:
{
  "signal": "required | unclear | not_required",
  "note": "",
  "letter": "FULL LETTER TEXT"
}
`


    const user = [
      "PROFILE (verbatim):",
      profile,
      "",
      "JOB (verbatim):",
      job,
      "",
      "CANDIDATE INTENT SIGNALS (extracted from profile; must be used when relevant):",
      intentSignals,
      "",
      "HINTS (best-effort; do not force if uncertain):",
      `Company hint: ${companyHint || "[Company Name]"}`,
      `Position hint: ${roleHint || "[Position Title]"}`,
      `Cover letter signal hint: ${signal}`,
      "",
      "HARD REQUIREMENTS:",
      "- Do not open with education/graduation.",
      "- Use exactly TWO proof examples from the resume/profile. No more than two.",
      "- Include a clear 'why this role/company' grounded in the targeting statement.",
      "- If relocation/timeline is present, include a logistics paragraph.",
      "- Keep it tight and skimmable. 220–380 words.",
      "",
      "Return JSON only in the required shape.",
    ].join("\n")

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })

    // SDK variations: prefer output_text
    // @ts-ignore
    const raw =
      // @ts-ignore
      response.output_text ||
      // fallback
      (response as any).output?.[0]?.content?.[0]?.text ||
      ""

    if (!raw || looksLikeHtml(raw)) {
      return new Response(
        JSON.stringify({
          error: "CoverLetter failed",
          detail: "Model returned empty or non-JSON content.",
        }),
        { status: 500, headers: corsHeaders(origin) }
      )
    }

    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Fallback: treat raw as letter
      parsed = {
        signal,
        note: "Cover letters are not recommended unless explicitly required, but this is provided if the user wants to submit one.",
        letter: raw,
      }
    }

    // Ensure required fields exist
    if (!parsed.note) {
      parsed.note =
        "Cover letters are not recommended unless explicitly required, but this is provided if the user wants to submit one."
    }
    if (!parsed.signal) parsed.signal = signal
    if (!parsed.letter) parsed.letter = ""

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: corsHeaders(origin),
    })
  } catch (err: any) {
    const detail = err?.message || String(err)
    return new Response(JSON.stringify({ error: "CoverLetter failed", detail }), {
      status: 500,
      headers: corsHeaders(origin),
    })
  }
}
