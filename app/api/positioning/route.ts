import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM = `
You are WRNSignal — Positioning.
You produce resume bullet rewrites that align the candidate's existing experience to the job description language.

Non-negotiables:
- Output must be factual. You may ONLY rewrite/reshape bullets that already exist in the provided profile/resume content.
- You may NOT invent new projects, metrics, tools, scope, titles, employers, or responsibilities.
- Every rewritten bullet must be defensible in an interview.
- Optimize for BOTH: (1) ATS keyword alignment and (2) recruiter 7-second scan clarity.
- No fluff. No generic traits ("hard-working", "fast learner", "strong communicator") as justification.
- Keep bullets punchy. Prefer action + scope + outcome. If outcome/metrics are not provided, do NOT fabricate them.
- Mirror job description phrasing when it is truthful (tools, responsibilities, nouns/verbs).
- Early-career candidates do not need identical role history — focus on adjacency, transferable responsibilities, and correct vocabulary.

Output requirements:
- Return 5 to 10 bullet modifications.
- Each modification must include:
  - before: the original bullet text as found in the input (or the closest exact original line if formatting is messy)
  - after: revised bullet aligned to the job description language (still truthful)
  - rationale: one sentence explaining why this improves ATS match + recruiter scan

Intro requirement (must appear every time, use this exact 3-line template in this order):
1) Built to pass ATS keyword screens and the recruiter 7-second test.
2) These edits align your existing bullets to the job description language while staying strictly factual.
3) They are minor cut/paste tweaks, not a full resume rewrite.

Strict JSON only. No markdown. No extra keys.
`.trim();

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intro: { type: "string" },
    bullets: {
      type: "array",
      minItems: 5,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          before: { type: "string" },
          after: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["before", "after", "rationale"],
      },
    },
  },
  required: ["intro", "bullets"],
} as const;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const profile = String(body?.profile ?? "").trim();
    const job = String(body?.job ?? "").trim();

    if (!profile || !job) {
      return NextResponse.json({ error: "Missing profile or job" }, { status: 400 });
    }

    const userPrompt = `
TASK:
Generate WRNSignal Positioning output.

INPUTS:
[CLIENT PROFILE / RESUME CONTENT]
${profile}

[JOB DESCRIPTION]
${job}

REMINDERS:
- Only modify bullets that already exist in the profile/resume content.
- Mirror job language where truthful.
- No invented metrics/tools/scope.
- 5–10 bullet modifications.
- Intro must use the exact 3-line template.
`.trim();

    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      // ✅ Correct way to request structured JSON in the Responses API
      text: {
        format: {
          type: "json_schema",
          name: "wrnsignal_positioning",
          strict: true,
          schema: SCHEMA,
        },
      },
    });

    const text = resp.output_text;

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          error: "Positioning failed",
          detail: "Model did not return valid JSON.",
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
