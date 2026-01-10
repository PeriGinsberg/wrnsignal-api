import OpenAI from "openai";

export const runtime = "nodejs"; // important for OpenAI in Next routes

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function corsHeaders(origin: string | null) {
  // Allow Framer + local dev; you can tighten later
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
    const { profile, job } = await req.json();

    if (!profile || !job) {
      return new Response(
        JSON.stringify({ error: "Missing profile or job" }),
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const system = `You are WRNSignal. Generate a concise, factual cover letter aligned to the job language using only information from the profile. No invented experience.`;
    const user = `PROFILE:\n${profile}\n\nJOB:\n${job}\n\nReturn JSON: {"signal":"required|unclear|not_required","note":"", "letter":"..."}\nKeep letter tight.`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
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
      parsed = { signal: "unclear", note: "Model did not return JSON.", letter: raw };
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (err: any) {
    const detail = err?.message || String(err);
    return new Response(JSON.stringify({ error: "CoverLetter failed", detail }), {
      status: 500,
      headers: corsHeaders(origin),
    });
  }
}
