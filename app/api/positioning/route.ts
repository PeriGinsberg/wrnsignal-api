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

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin")
  return new Response(null, { status: 204, headers: corsHeaders(origin) })
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
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
- No full rewrites. No new experience. No invented metrics.
- Every change must be defensible in an interview.

RULES:
- Output 5–10 edits.
- Each edit must be anchored to an existing bullet from the profile/resume text.
- Mirror exact phrases from the job description where appropriate (tools, responsibilities, keywords), but keep facts true.

OUTPUT:
Return valid JSON ONLY:
{
  "intro": string, 
  "bullets": [
    { "before": string, "after": string, "rationale": string }
  ]
}
    `.trim()

    const user = `
CLIENT PROFILE (includes resume text):
${profile}

JOB DESCRIPTION:
${job}

Generate 5–10 bullet edits:
- "before" must be copied from the profile/resume (or clearly a line from it).
- "after" must be a factual language alignment to the job (ATS + 7-second scan).
- "rationale" must explain which job language/requirements you mirrored and why it improves signal.
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
              before: "Model did not return JSON.",
              after: "Retry with a cleaner resume paste inside the profile field.",
              rationale: raw || "Non-JSON response.",
            },
          ],
        }),
        { status: 200, headers: corsHeaders(origin) }
      )
    }

    const out = {
      intro:
        typeof parsed.intro === "string"
          ? parsed.intro
          : "Intent: improve ATS keyword alignment and pass the recruiter 7-second scan using minor factual edits.",
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets : [],
    }

    return new Response(JSON.stringify(out), {
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

    return new Response(
      JSON.stringify({ error: "Positioning failed", detail }),
      {
        status,
        headers: corsHeaders(origin),
      }
    )
  }
}
