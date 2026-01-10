import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM = `
You are WRNSignal — Positioning.

You generate factual resume bullet edits that align existing experience to the job description language.

Non-negotiables:
- You may ONLY modify bullets that already exist in the resume content.
- You may NOT invent metrics, tools, scope, employers, titles, or responsibilities.
- Every edit must be defensible in an interview.
- Optimize for ATS keyword matching AND recruiter 7-second scan clarity.
- Mirror job description language only when truthful.
- No fluff. No generic traits.

Return ONLY valid JSON in EXACTLY this shape (no other keys):
{
  "intro": "three lines",
  "bullets": [
    { "before": "...", "after": "...", "rationale": "..." }
  ]
}

Rules:
- intro must be EXACTLY 3 lines, in this order:
  1) Built to pass ATS keyword screens and the recruiter 7-second test.
  2) These edits align your existing bullets to the job description language while staying strictly factual.
  3) They are minor cut/paste tweaks, not a full resume rewrite.
- bullets must contain 5–10 items.
- Use key name "bullets" (NOT edits, NOT changes).
- Return ONLY JSON. No markdown. No commentary.
`.trim();

// ----- CORS -----
function corsHeaders(origin: string | null) {
  const allowOrigin = origin ?? "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get("origin"));

  try {
    const body = await req.json();
    const profile = String(body?.profile ?? "").trim();
    const job = String(body?.job ?? "").trim();

    if (!profile || !job) {
      return NextResponse.json({ error: "Missing profile or job" }, { status: 400, headers });
    }

    const userPrompt = `
CLIENT PROFILE / RESUME:
${profile}

JOB DESCRIPTION:
${job}

Generate Positioning output following all rules above.
`.trim();

    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
    });

    const text = resp.output_text;

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Positioning failed", detail: "Model did not return valid JSON", raw_output: text },
        { status: 500, headers }
      );
    }

    // Normalize legacy key if the model returns "edits"
    if (!parsed?.bullets && Array.isArray(parsed?.edits)) {
      parsed.bullets = parsed.edits;
      delete parsed.edits;
    }

    const introOk = typeof parsed?.intro === "string" && parsed.intro.trim().length > 0;
    const bulletsOk =
      Array.isArray(parsed?.bullets) &&
      parsed.bullets.length >= 5 &&
      parsed.bullets.length <= 10 &&
      parsed.bullets.every(
        (b: any) =>
          typeof b?.before === "string" &&
          typeof b?.after === "string" &&
          typeof b?.rationale === "string"
      );

    if (!introOk || !bulletsOk) {
      return NextResponse.json(
        {
          error: "Positioning failed",
          detail: "Output missing required intro and/or 5–10 bullets in required format.",
          parsed_preview: parsed,
          raw_output: text,
        },
        { status: 500, headers }
      );
    }

    return NextResponse.json(parsed, { status: 200, headers });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Positioning failed", detail: e?.message ?? String(e) },
      { status: 500, headers }
    );
  }
}
