import { getAuthedProfileText } from "../_lib/authProfile"
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

/**
 * Extract contact info from stored profile text.
 * Supports lines like:
 * Full Name: Jane Doe
 * Phone: 555-555-5555
 * Email: jane@domain.com
 * Email Address: jane@domain.com
 */
function extractContact(profileText: string) {
  const text = String(profileText || "")

  const pick = (re: RegExp) => {
    const m = text.match(re)
    return m ? String(m[1]).trim() : ""
  }

  const fullName =
    pick(/^\s*(?:full\s*name|name|candidate\s*name)\s*[:\-]\s*(.+)\s*$/im) || ""

  const phone =
    pick(/^\s*(?:phone|phone number|mobile)\s*[:\-]\s*(.+)\s*$/im) || ""

  const email =
    pick(/^\s*(?:email|email address)\s*[:\-]\s*(.+)\s*$/im) || ""

  return { fullName, phone, email }
}

function buildSignature(contact: { fullName: string; phone: string; email: string }) {
  const parts = [contact.phone, contact.email].filter(Boolean).join(" | ")
  const lines = ["Sincerely,", contact.fullName || "", parts || ""].filter(Boolean)
  return lines.join("\n")
}

function ensureSignature(letter: string, signature: string) {
  const l = String(letter || "").trim()
  if (!signature) return l

  // If the letter already contains a "Sincerely," line, assume signature exists.
  if (/^\s*sincerely,\s*$/im.test(l)) return l

  return l ? `${l}\n\n${signature}` : signature
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
    // ✅ Auth + stored profile (server-side)
    const { profileText } = await getAuthedProfileText(req)
    const profile = profileText

    // ✅ Extract contact info and build signature (server enforced)
    const contact = extractContact(profile)
    const signature = buildSignature(contact)

    // ✅ Client sends only { job }
    const body = await req.json()
    const job = String(body?.job || "").trim()

    if (!job) {
      return new Response(JSON.stringify({ error: "Missing job" }), {
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

CONTACT INFO (MANDATORY):
- Use the exact contact info below in the signature block.
- Do not change the phone or email formatting.
Full Name: ${contact.fullName || "NOT PROVIDED"}
Phone: ${contact.phone || "NOT PROVIDED"}
Email: ${contact.email || "NOT PROVIDED"}

SIGNATURE BLOCK (MANDATORY):
End the letter with exactly this structure:
Sincerely,
${contact.fullName || "[Full Name]"}
${[contact.phone, contact.email].filter(Boolean).join(" | ") || "[Phone Number] | [Email Address]"}

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
    `.trim()

    const user = `
PROFILE:
${profile}

JOB:
${job}
    `.trim()

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })

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

    if (!parsed || typeof parsed !== "object") {
      parsed = {
        signal: "unclear",
        note: "Invalid model output.",
        letter: raw,
      }
    }

    if (!parsed.signal) parsed.signal = "unclear"
    if (!parsed.note) parsed.note = ""
    if (!parsed.letter) parsed.letter = ""

    // ✅ Server-enforce signature presence (so it never gets “ignored”)
    parsed.letter = ensureSignature(parsed.letter, signature)

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: corsHeaders(origin),
    })
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

    return new Response(JSON.stringify({ error: "CoverLetter failed", detail }), {
      status,
      headers: corsHeaders(origin),
    })
  }
}
