import OpenAI from "openai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // Read API key at request-time (prevents import-time crashes)
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json(
        {
          error: "Missing OPENAI_API_KEY",
          fix: "Create C:\\Users\\perig\\wrnsignal-api\\.env.local with: OPENAI_API_KEY=sk-... then restart npm run dev",
        },
        { status: 500 }
      );
    }

    // Create client only after we know apiKey exists
    const client = new OpenAI({ apiKey });

    // Parse request body
    const body = await req.json().catch(() => ({} as any));
    const profile = String(body?.profile ?? "").trim();
    const job = String(body?.job ?? "").trim();

    if (!profile || !job) {
      return Response.json(
        { error: "Missing required fields: profile, job" },
        { status: 400 }
      );
    }

    // Prompt (forces JSON-only output)
    const prompt = `
You are WRNSignal JobFit. You are a decision system, not a coach.

Rules:
- Score 0–100
- 75+ = Apply
- 60–74 = Review carefully
- <60 = Pass
- Never invent experience or intent
- Be conservative with missing data
Return ONLY valid JSON (no code fences, no markdown, no commentary).

Output JSON keys (exact):
module, decision, icon, score, why, risk_flags, next_step

Decision/icon mapping:
Apply => ✅
Review carefully => ⚠️
Pass => ⛔

module must be "jobfit".
score must be an integer 0–100.
why must be an array of 3–8 short bullet strings.
risk_flags must be an array (can be empty).
next_step must be a short string telling the user what to do next.

PROFILE:
${profile}

JOB DESCRIPTION:
${job}
`.trim();

    // Call OpenAI Responses API
    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: prompt,
    });

    const text = resp.output_text ?? "";
    if (!text) {
      return Response.json(
        { error: "Empty model response (output_text was blank)." },
        { status: 502 }
      );
    }

    // Clean common Markdown code fences just in case the model ignores instructions
    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    // Parse JSON, or return raw output if parsing fails
    try {
      const parsed = JSON.parse(cleaned);
      return Response.json(parsed, { status: 200 });
    } catch {
      return Response.json({ raw_output: text }, { status: 200 });
    }
  } catch (err: any) {
    console.error("JOBFIT ERROR:", err);
    return Response.json(
      { error: "JobFit failed", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
