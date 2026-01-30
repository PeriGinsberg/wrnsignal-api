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

  if (/^\s*sincerely,\s*$/im.test(l)) return l

  return l ? `${l}\n\n${signature}` : signature
}

function normalizeLetterFormatting(letter: string) {
  let t = String(letter || "").trim()

  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  t = t.replace(/[ \t]+\n/g, "\n")
  t = t.replace(/\n{3,}/g, "\n\n")

  // Repair weird line breaks inside paragraphs, keep paragraph breaks.
  const blocks = t
    .split(/\n\s*\n/g)
    .map((b) =>
      b
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
        .trim()
    )
    .filter(Boolean)

  t = blocks.join("\n\n")
  t = t.replace(/\n{3,}/g, "\n\n").trim()
  return t
}

/**
 * Extract company name and title from job text.
 * No guesses. Only uses high confidence patterns.
 */
function extractJobHints(job: string) {
  const text = String(job || "")

  // Title: try common posting patterns
  const titlePatterns = [
    /^\s*(?:job\s*title|position|role)\s*[:]\s*(.+)\s*$/im,
    /^\s*(.+)\s*\|\s*(?:full time|part time|internship|contract)\s*$/im,
    /^\s*(.+)\s*\(\s*(?:remote|hybrid|on site|onsite)\s*\)\s*$/im,
  ]

  const companyPatterns = [
    /^\s*(?:company|organization)\s*[:]\s*(.+)\s*$/im,
    /^\s*about\s+(.+)\s*$/im,
  ]

  const pickFirst = (patterns: RegExp[]) => {
    for (const re of patterns) {
      const m = text.match(re)
      if (m && m[1]) return String(m[1]).trim()
    }
    return ""
  }

  const title = pickFirst(titlePatterns)
  const company = pickFirst(companyPatterns)

  return { title, company }
}

/**
 * Remove any dash characters from model output.
 * Your prompt bans them, but this is a safety net.
 */
function stripDashes(s: string) {
  return String(s || "").replace(/[\u2010\u2011\u2012\u2013\u2014\u2015-]/g, "")
}

function safeJsonParse(raw: string) {
  const cleaned = String(raw || "")
    .replace(/```(?:json)?/g, "")
    .replace(/```/g, "")
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {}

  const first = cleaned.indexOf("{")
  const last = cleaned.lastIndexOf("}")
  if (first === -1 || last === -1 || last <= first) return null

  const candidate = cleaned.slice(first, last + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

/**
 * Create multiple voice options the model can choose from,
 * so it does not become one size fits all.
 * The model picks ONE and writes naturally in that lane.
 */
function buildVoiceMenu() {
  return [
    {
      id: "direct",
      label: "Direct and confident",
      notes:
        "Short sentences, strong verbs, no fluff. Sounds like a sharp student who means business.",
    },
    {
      id: "warm",
      label: "Warm and personable",
      notes:
        "Still confident, but a little more human and friendly. Reads like someone people would want to work with.",
    },
    {
      id: "curious",
      label: "Curious and specific",
      notes:
        "Leans into genuine interest and thoughtful motivation. Not gushy. Not corny.",
    },
    {
      id: "crisp",
      label: "Crisp and professional",
      notes:
        "Most traditional, but still not corporate. Clean and recruiter friendly.",
    },
  ]
}

/**
 * Add a small bank of openers and closers to fight repetition.
 * Model selects one opener pattern and one closer pattern.
 * No forced phrase templates, just options.
 */
function buildVarietyBank() {
  return {
    openers: [
      "Start with what pulled you in about the role or company, in one clean sentence.",
      "Start with a quick personal point of view about the work, then connect it to the role.",
      "Start with a concrete detail from the posting that matches the candidate profile, without copying the posting.",
      "Start with a short story beat from the candidate background that naturally points to this role.",
    ],
    closers: [
      "Close with confident interest and a next step. Ask for a conversation without sounding needy.",
      "Close with a clear statement of what you want to contribute, then invite next steps.",
      "Close with a short line that makes the reader want to meet the candidate. Keep it simple and strong.",
      "Close with a calm, confident call to action to discuss fit, not availability.",
    ],
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin")

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  try {
    // Auth + stored profile (server side)
    const { profileText } = await getAuthedProfileText(req)
    const profile = String(profileText || "").trim()

    const contact = extractContact(profile)
    const signature = buildSignature(contact)

    const body = await req.json()
    const job = String(body?.job || "").trim()

    if (!job) {
      return new Response(JSON.stringify({ error: "Missing job" }), {
        status: 400,
        headers: corsHeaders(origin),
      })
    }

    // Optional hints (high confidence only)
    const hints = extractJobHints(job)
    const voiceMenu = buildVoiceMenu()
    const variety = buildVarietyBank()

    const system = `
You are WRNSignal.

Write a recruiter ready cover letter that sounds like a real early career candidate.
It must feel human, specific, and readable.

Hard rules:
1) Never use dashes or hyphens of any kind. No hyphen, en dash, em dash, or dash punctuation.
2) Use only facts contained in PROFILE. Do not invent tools, outcomes, metrics, or employers.
3) Do not copy paste the JOB. Do not summarize the JOB back to the reader.
4) Avoid generic filler and AI phrases. Do not use: excited, passionate, thrilled, dream job, perfect fit, leverage, synergy, fast paced, dynamic, results driven.
5) Always clean paragraphs. Blank line between paragraphs. No line breaks inside a paragraph.
6) No bullet points.

Date rule:
The letter must begin with the system date below on its own line, exactly as written.

SYSTEM DATE:
${today}

Format rules:
Line 1: SYSTEM DATE
Line 2: Hiring Team
Line 3: Company name if clearly present, otherwise omit the line
Line 4: Re: Application for Position Title if clearly present, otherwise "Re: Application"
Line 5: Dear Hiring Team,

Structure rules:
After the greeting, write exactly 3 paragraphs.
Each paragraph is 2 to 4 sentences.
One blank line between paragraphs.

Paragraph goals:
Paragraph 1: Motivation with a point of view. Why this role and why this company, without sounding generic.
Paragraph 2: Proof. Pull 2 to 3 experiences from PROFILE that match what the JOB needs. Use specific details from PROFILE.
Paragraph 3: Strong closer. Do not talk about being reliable, dependable, local, punctual, available, or willing to learn.
Close with confident interest and a clear next step.

Voice selection:
Pick ONE voice lane and write naturally in it.
Do not label the voice in the output.
Voice lanes:
${voiceMenu
  .map((v) => `- ${v.id}: ${v.label}. ${v.notes}`)
  .join("\n")}

Variation controls:
To avoid one size fits all writing, pick:
- One opener approach from the list below
- One closer approach from the list below
Do not quote these instructions. Just apply them.

Opener approaches:
${variety.openers.map((x) => `- ${x}`).join("\n")}

Closer approaches:
${variety.closers.map((x) => `- ${x}`).join("\n")}

Job hints:
- If the company name or title are clearly present, use them.
- If not clearly present, omit them. Do not guess.

Detected hints (use only if correct):
Company: ${hints.company || "Not confidently detected"}
Title: ${hints.title || "Not confidently detected"}

Signature rules:
End the letter with exactly this signature block.
Do not alter formatting.
Sincerely,
${contact.fullName || "[Full Name]"}
${[contact.phone, contact.email].filter(Boolean).join(" | ") || "[Phone Number] | [Email Address]"}

Output rules:
Return JSON only, no markdown, no extra text.
Schema:
{
  "signal": "required | unclear | not_required",
  "note": "",
  "letter": "FULL LETTER TEXT"
}

Signal rules:
- If JOB explicitly requires a cover letter, signal = "required".
- If JOB explicitly says no cover letter needed, signal = "not_required".
- Otherwise signal = "unclear".
- If unclear, note must be "Not specified in posting."
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
      // If your environment supports it, this increases JSON consistency.
      // If it errors, remove this block.
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "cover_letter_output",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              signal: { type: "string", enum: ["required", "unclear", "not_required"] },
              note: { type: "string" },
              letter: { type: "string" },
            },
            required: ["signal", "note", "letter"],
          },
        },
      },
    })

    const raw =
      // @ts-ignore
      response.output_text ||
      (response as any)?.output?.[0]?.content?.[0]?.text ||
      ""

    let parsed: any = safeJsonParse(raw)

    if (!parsed || typeof parsed !== "object") {
      parsed = {
        signal: "unclear",
        note: "Model did not return JSON.",
        letter: raw,
      }
    }

    if (!parsed.signal) parsed.signal = "unclear"
    if (!parsed.note) parsed.note = parsed.signal === "unclear" ? "Not specified in posting." : ""
    if (!parsed.letter) parsed.letter = ""

    // Safety nets
    parsed.letter = stripDashes(parsed.letter)
    parsed.letter = normalizeLetterFormatting(parsed.letter)
    parsed.letter = ensureSignature(parsed.letter, signature)

    // Force note standardization when unclear
    if (parsed.signal === "unclear") parsed.note = "Not specified in posting."

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
