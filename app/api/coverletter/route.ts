import OpenAI from "openai";

export const runtime = "nodejs"; // important for OpenAI in Next routes

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function corsHeaders(origin: string | null) {
  // Allow Framer + local dev; tighten later if needed
  const allowOrigin = origin || "*";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

// Preflight
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");

  try {
    const body = await req.json();

    /**
     * Expected payload (minimum):
     *  - profile: string (resume/profile text)
     *  - job: string (job description text)
     *
     * Optional (recommended):
     *  - companyName: string
     *  - positionTitle: string
     *  - date: string (e.g., "January 11, 2026")
     *
     * If optional fields are missing, the model will use placeholders.
     */
    const {
      profile,
      job,
      companyName = "[Company Name]",
      positionTitle = "[Position Title]",
      date = "[Month Day, Year]",
    } = body ?? {};

    if (!profile || !job) {
      return new Response(JSON.stringify({ error: "Missing profile or job" }), {
        status: 400,
        headers: corsHeaders(origin),
      });
    }

    /**
     * COVER LETTER RULES (formalized)
     * - NO invented experience. Use only info from profile/resume and job post.
     * - Story-first. Do NOT regurgitate the resume bullet-by-bullet.
     * - Must include a header at the very top (do not repeat candidate name/contact info).
     * - Structure:
     *   1) Intro paragraph: story + motivation + why this field/role
     *   2) Alignment paragraph: connect education/skills/experience to company/opportunity (templated)
     *   3) Team-member paragraph: the kind of person/worker they get (reliability, coachability, composure, etc.)
     *   4) Thank-you paragraph: appreciation + restate interest + excitement to learn more
     * - Keep it professional, human, and confident. No apologies.
     * - Avoid em dashes.
     * - Keep concise (target ~220–350 words unless the job clearly demands more).
     */

    const system = `
You are WRNSignal. You write story-first cover letters for early-career candidates.
Follow the cover letter rules exactly.

NON-NEGOTIABLES:
- Use ONLY information from the PROFILE. Do not invent experience, credentials, or claims.
- Do not repeat the candidate’s name or contact info (assume it already exists in the document header).
- Avoid em dashes. Use commas or parentheses instead.
- Write in a professional, grounded tone. No fluff. No cringe. No corporate buzzword soup.
- Do not mention these rules.

FORMAT REQUIREMENTS:
- The letter MUST begin with this exact header format (4 lines), using the provided values:
  Date: <DATE>
  Hiring Team
  <COMPANY NAME>
  Re: Application for <POSITION TITLE>

- After the header, include exactly 4 paragraphs in this order:
  1) Intro paragraph: story, motivation, why this field/role.
  2) Alignment paragraph: connect skills, interests, education, and experience to this company/opportunity. Templated but specific.
  3) Team-member paragraph: describe what kind of person/worker they get (reliability, composure, coachability, confidentiality, etc.), grounded in PROFILE.
  4) Thank-you paragraph: thank you + restate interest + excitement to learn more.

OUTPUT REQUIREMENTS:
Return ONLY valid JSON matching:
{
  "signal": "required" | "unclear" | "not_required",
  "note": string,
  "letter": string
}

- "letter" must contain the header + 4 paragraphs, with blank lines between paragraphs.
- "signal" should be:
  - "not_required" if the job explicitly says no cover letter is needed
  - "required" if the job requests or strongly implies a cover letter
  - "unclear" otherwise
- "note" should be 1–2 short sentences about fit and what the letter emphasizes, grounded in PROFILE + JOB.
`.trim();

    const user = `
DATE: ${date}
COMPANY NAME: ${companyName}
POSITION TITLE: ${positionTitle}

PROFILE:
${profile}

JOB:
${job}
`.trim();

    // Prefer structured output when available. If the SDK/model ignores response_format,
    // the JSON parse fallback below still works.
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // @ts-ignore - response_format is supported by the Responses API in newer SDKs
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "cover_letter_output",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              signal: {
                type: "string",
                enum: ["required", "unclear", "not_required"],
              },
              note: { type: "string" },
              letter: { type: "string" },
            },
            required: ["signal", "note", "letter"],
          },
        },
      },
    });

    const raw =
      // @ts-ignore
      response.output_text ||
      // fallback if your SDK returns differently
      (response as any).output?.[0]?.content?.[0]?.text ||
      "";

    // Attempt JSON parse; if it fails, still return something readable
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {
        signal: "unclear",
        note: "Model did not return JSON. Returned raw text in letter.",
        letter: raw,
      };
    }

    // Lightweight guardrails in case the model drifts
    if (typeof parsed?.letter === "string") {
      // Ensure header presence (best-effort). Do not mutate content beyond adding missing header.
      const headerStart = `Date:`;
      if (!parsed.letter.trim().startsWith(headerStart)) {
        const header = `Date: ${date}\nHiring Team\n${companyName}\nRe: Application for ${positionTitle}\n\n`;
        parsed.letter = header + parsed.letter.trim();
      }
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (err: any) {
    const detail = err?.message || String(err);
    return new Response(
      JSON.stringify({ error: "CoverLetter failed", detail }),
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}
