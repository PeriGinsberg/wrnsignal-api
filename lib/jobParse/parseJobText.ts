// lib/jobParse/parseJobText.ts
//
// Reads a job posting out of pasted text with one Claude Haiku call: company,
// title, location, description and job type.
//
// Moved here from app/api/parse-job-text/route.ts so that route (JobFit, the
// coach add-job panel) and the supporter auto-fill route
// (app/api/supporter/clients/[clientId]/extract-job) run the same code. The
// limits are the one difference: the defaults are the route's, and the
// supporter route raises them so a long posting comes back whole. It returns
// the status and body the route sends; it never scores anything.

import he from "he"
import type { ParseReply } from "./parseJobUrl"

const reply = (body: Record<string, unknown>, status = 200): ParseReply => ({ status, body })

export type ParseTextLimits = {
  /** Characters of the paste sent to the model. */
  maxInputChars: number
  /** Characters of description returned. */
  maxDescriptionChars: number
  /** The model's output ceiling; the description is most of the output. */
  maxTokens: number
}

/** What /api/parse-job-text uses. */
export const DEFAULT_TEXT_LIMITS: ParseTextLimits = { maxInputChars: 30000, maxDescriptionChars: 8000, maxTokens: 4000 }

// ── Text cleaning ──
function cleanText(raw: string): string {
  const stripped = raw.replace(/<[^>]+>/g, " ")
  const decoded = he.decode(stripped)
  return decoded
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}

export async function parseJobText(
  body: { text?: unknown },
  limits: ParseTextLimits = DEFAULT_TEXT_LIMITS,
): Promise<ParseReply> {

  // 1. Validate text
  const text = String(body?.text ?? "").trim()
  if (text.length < 50) {
    return reply({ error: "Please paste more content — at least 50 characters." },
      400
    )
  }

  // 2. Call Anthropic API
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return reply({ error: "Server configuration error" }, 500)
  }

  const truncatedText = truncate(text, limits.maxInputChars)

  const prompt = `Extract job posting data from the following raw text. The text may contain navigation menus, sidebars, ads, and other non-job content from a full page copy. Ignore all of that and focus only on the actual job posting.

Return ONLY valid JSON with these fields:
{
  "jobTitle": "string — the exact job title",
  "companyName": "string — the hiring company name",
  "jobDescription": "string — the complete job posting body (responsibilities, requirements, qualifications) cleaned up. Include the full description, not a summary.",
  "location": "string — job location or 'Remote' if applicable, or null if unknown",
  "jobType": "one of: Full Time, Part Time, Internship, Contract — or null if unknown"
}

If a field cannot be determined, use null (except jobTitle, companyName, and jobDescription which should be empty strings if unknown). Return only the JSON object, no markdown fences.

Raw page text:
${truncatedText}`

  let parsed: {
    jobTitle: string
    companyName: string
    jobDescription: string
    location: string | null
    jobType: string | null
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: limits.maxTokens,
        temperature: 0,
        system: "You are a job posting parser. Extract structured data from raw job posting text. Return ONLY valid JSON.",
        messages: [{ role: "user", content: prompt }],
      }),
    })

    if (!res.ok) {
      console.error("[parse-job-text] Anthropic API error:", res.status)
      return reply({ error: "Failed to parse job posting" }, 502)
    }

    const json = await res.json()
    const raw = (json.content ?? [])?.[0]?.text ?? ""

    // 3. Strip markdown fences and parse JSON
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()
    let data: any
    try {
      data = JSON.parse(cleaned)
    } catch {
      // Haiku sometimes returns truncated JSON — try to salvage with a lenient parse
      const titleMatch = cleaned.match(/"jobTitle"\s*:\s*"([^"]*)"/)
      const companyMatch = cleaned.match(/"companyName"\s*:\s*"([^"]*)"/)
      if (titleMatch || companyMatch) {
        data = {
          jobTitle: titleMatch?.[1] || "",
          companyName: companyMatch?.[1] || "",
          jobDescription: "",
          location: null,
          jobType: null,
        }
      } else {
        throw new Error("Could not parse extraction result")
      }
    }

    // 4. Clean all fields
    parsed = {
      jobTitle: cleanText(String(data.jobTitle || "")),
      companyName: cleanText(String(data.companyName || "")),
      jobDescription: truncate(cleanText(String(data.jobDescription || "")), limits.maxDescriptionChars),
      location: data.location ? cleanText(String(data.location)) || null : null,
      jobType: data.jobType ? cleanText(String(data.jobType)) || null : null,
    }
  } catch (err) {
    console.error("[parse-job-text] parse error:", err)
    return reply({ error: "Failed to parse job posting" }, 502)
  }

  // 5. Return structured result
  return reply({
    jobTitle: parsed.jobTitle,
    companyName: parsed.companyName,
    jobDescription: parsed.jobDescription,
    location: parsed.location,
    jobType: parsed.jobType,
    source: "text_paste",
    method: "claude",
    originalUrl: null,
  })
}
