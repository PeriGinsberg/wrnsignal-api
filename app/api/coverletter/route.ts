import OpenAI from "openai"
import { getAuthedProfileText } from "../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "@/app/_lib/cors"

export const runtime = "nodejs"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: Request) {
  try {
    // Auth + stored profile (server-side)
    const { profileText } = await getAuthedProfileText(req)
    const profile = profileText

    // Client sends only: { job }
    const body = await req.json()
    const job = String(body?.job || "").trim()

    if (!job) {
      return withCorsJson(req, { error: "Missing job" }, 400)
    }

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
${profile}

JOB DESCRIPTION (verbatim):
${job}

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

    // @ts-ignore
    const raw = (resp as any).output_text || ""
    const parsed = safeJsonParse(raw)

    // If the model fails to return JSON, fall back to treating raw as the letter
    const letter =
      parsed && typeof parsed === "object" && isNonEmptyString((parsed as any).letter)
        ? String((parsed as any).letter).trim()
        : String(raw || "").trim()

    return withCorsJson(req, { letter }, 200)
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

    return withCorsJson(req, { error: "Coverletter failed", detail }, status)
  }
}
