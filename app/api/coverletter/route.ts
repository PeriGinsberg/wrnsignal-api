import OpenAI from "openai"

export const runtime = "nodejs"

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

function corsHeaders(origin: string | null) {
  // Allow Framer + local dev; tighten later if you want
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

export async function POST(req: Request) {
  const origin = req.headers.get("origin")

  // System date (forced into letter). No dashes, recruiter-safe.
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  try {
    const { profile, job } = await req.json()

    if (!profile || !job) {
      return new Response(JSON.stringify({ error: "Missing profile or job" }), {
        status: 400,
        headers: corsHeaders(origin),
      })
    }

    const system = `
You are WRNSignal.

ROLE:
Generate a high-caliber, recruiter-ready cover letter that reads like a strong human wrote it.
It must explain WHY the candidate wants the role and why this company makes sense, not just restate the job description.

NON NEGOTIABLE RULES:
- Never use dashes or hyphens of any kind. This includes hyphens, en dashes, em dashes, or dash based punctuation. Rewrite sentences to avoid them entirely.
- Use ONLY information contained in the PROFILE. Never invent, assume, or embellish experience, metrics, tools, or outcomes.
- Do not copy paste the job description. Do not summarize responsibilities back to the reader.
- Mirror job language selectively: use keywords and values, but keep it human. No copied blocks.
- Avoid generic enthusiasm and filler. Do not use: excited, passionate, thrilled, dream job, perfect fit.
- Keep the letter tight and readable. Short paragraphs. Strong topic sentences.
- Match an early career candidate voice: confident, grounded, direct.
- No em dashes. No hyphens. Ever.

DATE RULE (MANDATORY):
- The cover letter MUST begin with the system date shown below on its own line.
- Use it exactly as written. Do not reformat or omit it.

SYSTEM DATE:
${today}

FORMAT (MANDATORY):
Line 1: SYSTEM DATE
Line 2: Hiring Team
Line 3: Company name (if clearly present in JOB, otherwise omit)
Line 4: Re: Application for Position Title (use the exact role title if clearly present, otherwise use "Re: Application")
Line 5: Dear Hiring Team,

CONTENT REQUIREMENTS:
Paragraph 1: Story and motivation. Why this role. Why now. One clear point of view.
Paragraph 2: Evidence. Pick 2 to 3 experiences from the PROFILE that prove fit for the role. Use specific details from the PROFILE.
Paragraph 3: Intent. Reliability, availability, and seriousness. If the PROFILE states willingness to relocate or immediate start, include it.
Optional Paragraph 4: One sentence close that reinforces fit and asks for next step.

OUTPUT REQUIREMENTS:
Return valid JSON only in this format:
{
  "signal": "required | unclear | not_required",
  "note": "",
  "letter": "FULL LETTER TEXT"
}

SIGNAL RULES:
- If the JOB explicitly requires a cover letter, signal = "required".
- If the JOB explicitly says no cover letter needed, signal = "not_required".
- Otherwise signal = "unclear".
- Keep note short. If unclear, say "Not specified in posting."
`

    const user = `
PROFILE:
${profile}

JOB:
${job}
`

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })

    // The OpenAI SDK returns output_text in many cases; keep a safe fallback.
    const raw =
      // @ts-ignore
      response.output_text ||
      (response as any)?.output?.[0]?.content?.[0]?.text ||
      ""

    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = {
        signal: "unclear",
        note: "Model did not return JSON.",
        letter: raw,
      }
    }

    // Defensive cleanup: ensure required keys exist
    if (!parsed || typeof parsed !== "object") {
      parsed = { signal: "unclear", note: "Invalid model output.", letter: raw }
    }
    if (!parsed.signal) parsed.signal = "unclear"
    if (!parsed.note) parsed.note = ""
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
