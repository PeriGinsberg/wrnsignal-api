import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const profile = body?.profile;
    const job = body?.job;

    if (!profile || !job) {
      return Response.json(
        { error: "Missing profile or job input" },
        { status: 400, headers: corsHeaders }
      );
    }

    const systemPrompt = `
You are WRNSignal JobFit.

Return ONLY valid JSON.
No markdown. No commentary.

Schema:
{
  "decision": "Apply" | "Review carefully" | "Pass",
  "icon": "✅" | "⚠️" | "⛔",
  "score": number,
  "why": string[],
  "risk_flags": string[],
  "next_step": string
}
`;

    const userPrompt = `
CLIENT PROFILE:
${profile}

JOB DESCRIPTION:
${job}

Evaluate JobFit.
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0,
    });

    let text = response.output_text || "";

    // Defensive cleanup in case the model wraps JSON
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return Response.json(
        { error: "Invalid model JSON", raw_output: text },
        { status: 500, headers: corsHeaders }
      );
    }

    return Response.json(parsed, {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err: any) {
    return Response.json(
      {
        error: "JobFit failed",
        detail: err?.message || "Unknown error",
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
