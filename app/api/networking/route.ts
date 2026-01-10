import OpenAI from "openai";

export const runtime = "nodejs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function corsHeaders(origin: string | null) {
  const allowOrigin = origin || "*";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

    const system = `
You are WRNSignal (Networking module).

RULES:
- Users can generate networking anytime, but reinforce that networking is post-apply.
- Generate EXACTLY three networking actions.
- Each action must include:
  - "target": who to contact (role/function)
  - "rationale": why that person is the right target
  - "message": a cut-and-paste message (warm + direct, not cringe, not a job ask)
- Message MUST:
  - state they applied to the role
  - ask for 10 minutes to learn about team/company and advice to stand out
  - be appropriately aggressive (no fluff)
- Reinforce: ~20% applying, ~80% networking after applying.

OUTPUT:
Return valid JSON ONLY:
{
  "note": string,
  "actions": [
    { "target": string, "rationale": string, "message": string },
    { "target": string, "rationale": string, "message": string },
    { "target": string, "rationale": string, "message": string }
  ]
}
    `.trim();

    const user = `
CLIENT PROFILE:
${profile}

JOB DESCRIPTION:
${job}

Generate exactly 3 networking actions. Choose smart targets (recruiter if appropriate, hiring team adjacent, someone in function/team).
Return JSON only.
    `.trim();

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    // @ts-ignore
    const raw = (resp as any).output_text || "";
    const parsed = safeJsonParse(raw);

    if (!parsed) {
      return new Response(
        JSON.stringify({
          note:
            "Networking is where you win. Treat applying as ~20% effort and networking as ~80% effort after you apply.",
          actions: [
            {
              target: "Model did not return JSON",
              rationale: "Retry.",
              message: raw || "Non-JSON response.",
            },
            { target: "", rationale: "", message: "" },
            { target: "", rationale: "", message: "" },
          ],
        }),
        { status: 200, headers: corsHeaders(origin) }
      );
    }

    const out = {
      note:
        typeof parsed.note === "string"
          ? parsed.note
          : "Networking is where you win. Treat applying as ~20% effort and networking as ~80% effort after you apply.",
      actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 3) : [],
    };

    // Ensure exactly 3 actions in output
    while (out.actions.length < 3) {
      out.actions.push({ target: "", rationale: "", message: "" });
    }
    out.actions = out.actions.slice(0, 3);

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (err: any) {
    const detail = err?.message || String(err);
    return new Response(JSON.stringify({ error: "Networking failed", detail }), {
      status: 500,
      headers: corsHeaders(origin),
    });
  }
}
