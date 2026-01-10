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
- Early-career candidates do not need identical prior roles.

Output rules:
- Return 5–10 bullet edits.
- Each edit must include:
  before: original bullet
  after: revised bullet aligned to job language
  rationale: one sentence explaining ATS + recruiter benefit

Intro (must appear every time, exactly 3 lines):
Built to pass ATS keyword screens and the recruiter 7-second test.
These edits align your existing bullets to the job description language while staying strictly factual.
They are minor cut/paste tweaks, not a full resume rewrite.

Return ONLY valid JSON. No markdown. No extra commentary.
`.trim();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const profile = String(body?.profile ?? "").trim();
    const job = String(body?.job ?? "").trim();

    if (!profile || !job) {
      return NextResponse.json(
        { error: "Missing profile or job" },
        { status: 400 }
      );
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

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          error: "Positioning failed",
          detail: "Model did not return valid JSON",
          raw_output: text,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed, { status: 200 });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Positioning failed", detail: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
