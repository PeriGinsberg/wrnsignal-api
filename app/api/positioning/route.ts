import { getAuthedProfileText } from "../_lib/authProfile"
import OpenAI from "openai"

export const runtime = "nodejs"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin")
  return new Response(null, { status: 204, headers: corsHeaders(origin) })
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin")

  try {
    // Auth + stored profile (server-side)
    const { profileText } = await getAuthedProfileText(req)
    const profile = profileText

    // Client sends only: { job }
    const body = await req.json()
    const job = String(body?.job || "").trim()

    if (!job) {
      return new Response(JSON.stringify({ error: "Missing job" }), {
        status: 400,
        headers: corsHeaders(origin),
      })
    }

    const system = `
You are WRNSignal (Positioning module).

GOAL:
- Improve ATS keyword alignment AND pass the recruiter 7-second scan.
- Make minor, factual, cut-and-paste resume bullet tweaks that align language to the job description.
- No full rewrites. No invented experience. No invented tools. No invented scope. No invented industry.
- Every change must be defensible in an interview.

ANTI FABRICATION RULES (ABSOLUTE):
- You may only rewrite a bullet by REPHRASING what is already explicitly stated in that bullet or its immediate nearby context.
- You may mirror keywords from the job description ONLY if the original bullet already supports them.
- If the job description mentions a tool, domain, or industry that does not appear in the resume text, you must NOT add it.
- You must never change the industry or function of a role. Example: legal work may not become entertainment. Finance may not become marketing.
- If the resume bullet is too vague to safely align, you must SKIP it.

EVIDENCE REQUIREMENT:
For every suggested edit:
- You must provide an "evidence" field that quotes an exact phrase from the profile/resume text proving the edit is factual.
- If you cannot quote evidence, do not include the edit.

JOB TITLE REQUIREMENT:
- Each edit must include a "job_title" field corresponding to the role the bullet came from.
- If you cannot confidently identify the job title from the resume section, use "Unknown role" and keep the edit conservative.

OUTPUT SIZE:
- Output 5–10 edits if possible.
- If you cannot produce at least 3 safe edits without risking fabrication, output fewer. Quality over quantity.

OUTPUT:
Return valid JSON ONLY:
{
  "intro": string,
  "bullets": [
    {
      "job_title": string,
      "before": string,
      "after": string,
      "rationale": string,
      "evidence": string
    }
  ]
}
    `.trim()

    const user = `
CLIENT PROFILE (includes resume text):
${profile}

JOB DESCRIPTION:
${job}

Generate resume bullet edits that are strictly factual.

Rules recap:
- "before" must be copied verbatim from the resume text.
- "after" must be a safe rephrase that mirrors job language ONLY when supported by the original bullet.
- "job_title" must be the role heading the bullet belongs to.
- "evidence" must be a direct quote from the resume text proving the edit is factual.
Return JSON only.
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

    if (!parsed) {
      return new Response(
        JSON.stringify({
          intro:
            "Intent: improve ATS keyword alignment and pass the recruiter 7-second scan using minor factual edits.",
          bullets: [
            {
              job_title: "Unknown role",
              before: "Model did not return JSON.",
              after: "Retry after refreshing and ensuring the job description is fully pasted.",
              rationale: raw || "Non-JSON response.",
              evidence: "No evidence provided.",
            },
          ],
        }),
        { status: 200, headers: corsHeaders(origin) }
      )
    }

    const intro =
      typeof parsed.intro === "string"
        ? parsed.intro
        : "Intent: improve ATS keyword alignment and pass the recruiter 7-second scan using minor factual edits."

    const bullets = Array.isArray(parsed.bullets) ? parsed.bullets : []

    // Final safety normalization: ensure fields exist, and strip obviously unsafe items
    const normalized = bullets
      .map((b: any) => ({
        job_title: typeof b?.job_title === "string" ? b.job_title : "Unknown role",
        before: typeof b?.before === "string" ? b.before : "",
        after: typeof b?.after === "string" ? b.after : "",
        rationale: typeof b?.rationale === "string" ? b.rationale : "",
        evidence: typeof b?.evidence === "string" ? b.evidence : "",
      }))
      .filter((b: any) => b.before && b.after && b.evidence) // require evidence present

    return new Response(JSON.stringify({ intro, bullets: normalized }), {
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

    return new Response(JSON.stringify({ error: "Positioning failed", detail }), {
      status,
      headers: corsHeaders(origin),
    })
  }
}
