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

function norm(s: string) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
}

function exactSubstring(haystack: string, needle: string) {
  const h = norm(haystack)
  const n = norm(needle)
  if (!n) return false
  return h.includes(n)
}

/**
 * Conservative hallucination guard:
 * We allow keyword alignment, but we reject edits that introduce strong new-claim verbs
 * unless that same verb already appears in the "before" bullet.
 *
 * This is intentionally strict.
 */
function introducesNewClaims(before: string, after: string) {
  const b = norm(before).toLowerCase()
  const a = norm(after).toLowerCase()

  // Strong claim words that often signal fabrication when newly introduced
  const claimWords = [
    "managed",
    "led",
    "owned",
    "launched",
    "built",
    "designed",
    "developed",
    "implemented",
    "architected",
    "negotiated",
    "closed",
    "increased",
    "decreased",
    "reduced",
    "improved",
    "generated",
    "delivered",
    "created",
    "produced",
    "drove",
    "scaled",
    "automated",
    "optimized",
    "secured",
    "won",
    "achieved",
    "grew",
    "boosted",
    "transformed",
  ]

  // If after adds a claim verb not present in before, reject
  for (const w of claimWords) {
    const inAfter = a.includes(`${w} `) || a.includes(` ${w} `)
    const inBefore = b.includes(`${w} `) || b.includes(` ${w} `)
    if (inAfter && !inBefore) return true
  }

  return false
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

YOUR JOB:
Generate 5–10 resume bullet edits that improve ATS alignment and pass the recruiter 7-second scan.

ABSOLUTE TRUTH RULES (NON NEGOTIABLE):
1) You may ONLY edit bullets that already exist in the provided resume text.
2) "before" MUST be an exact, verbatim copy of a bullet line from the resume. Do not paraphrase. Do not merge bullets. Do not shorten.
3) "after" MUST preserve the original factual meaning. You may reword for clarity and keyword alignment, but you may NOT add:
   - new responsibilities
   - new industries or domains
   - new tools
   - new metrics or outcomes
   - new scope (team size, budgets, scale, seniority)
4) You are allowed to add a keyword ONLY if it is clearly implied by the existing "before" bullet.
   If it is not implied, do NOT add it.
5) Evidence is mandatory:
   - Include "evidence" as a short direct quote copied verbatim from the resume/profile that proves the "after" is factual.
   - Evidence must be text that appears in the profile. If you cannot provide evidence, do not include that edit.

JOB TITLE TAGGING:
- Include "job_title" for each edit. It must be the role title from the resume section where the "before" bullet came from.
- If you cannot confidently identify the job title, use "Unknown".

STYLE:
- Make edits cut-and-paste ready.
- Keep edits tight.
- Mirror exact job description language when it does not change facts.

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
PROFILE (includes resume text):
${profile}

JOB DESCRIPTION:
${job}

Generate 5–10 bullet edits under the Truth Rules.
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
              job_title: "Unknown",
              before: "Model did not return JSON.",
              after: "Retry. If this repeats, shorten the job description and try again.",
              rationale: raw || "Non-JSON response.",
              evidence: "",
            },
          ],
        }),
        { status: 200, headers: corsHeaders(origin) }
      )
    }

    const intro =
      typeof parsed.intro === "string" && parsed.intro.trim()
        ? parsed.intro.trim()
        : "Intent: improve ATS keyword alignment and pass the recruiter 7-second scan using minor factual edits."

    const bulletsRaw = Array.isArray(parsed.bullets) ? parsed.bullets : []

    // Normalize + enforce truth constraints server-side
    const cleaned = bulletsRaw
      .map((b: any) => ({
        job_title:
          typeof b?.job_title === "string" && b.job_title.trim()
            ? b.job_title.trim()
            : "Unknown",
        before: typeof b?.before === "string" ? b.before : "",
        after: typeof b?.after === "string" ? b.after : "",
        rationale: typeof b?.rationale === "string" ? b.rationale : "",
        evidence: typeof b?.evidence === "string" ? b.evidence : "",
      }))
      .filter((b: any) => {
        // must have fields
        if (!norm(b.before) || !norm(b.after) || !norm(b.rationale)) return false

        // "before" must be copied from profile
        if (!exactSubstring(profile, b.before)) return false

        // evidence must be copied from profile
        if (!norm(b.evidence) || !exactSubstring(profile, b.evidence)) return false

        // must not introduce strong new claims
        if (introducesNewClaims(b.before, b.after)) return false

        return true
      })
      .slice(0, 10)

    // If we filtered too hard, return a safe response instead of hallucinating
    if (cleaned.length === 0) {
      return new Response(
        JSON.stringify({
          intro:
            "I could not produce safe edits without risking fabrication. Your resume bullets may be too vague to support keyword alignment without adding claims.",
          bullets: [],
        }),
        { status: 200, headers: corsHeaders(origin) }
      )
    }

    const out = { intro, bullets: cleaned }

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: corsHeaders(origin),
    })
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

    return new Response(JSON.stringify({ error: "Positioning failed", detail }), {
      status,
      headers: corsHeaders(origin),
    })
  }
}
