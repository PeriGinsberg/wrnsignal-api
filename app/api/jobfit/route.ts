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

function clampScore(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function iconForDecision(decision: string) {
  const d = (decision || "").toLowerCase().trim();
  if (d === "apply") return "✅";
  if (d === "review carefully") return "⚠️";
  if (d === "pass") return "⛔";
  // fallback
  return "⚠️";
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
You are WRNSignal, a job search decision system by Workforce Ready Now.

ROLE:
- You decide whether to Apply, Review carefully, or Pass for ONE job description at a time.
- You do not motivate, reassure, or inflate outcomes.
- Passing is framed as time protection.

STRICT WORKFLOW:
- JobFit always comes first.
- You must make a decision before any resume/positioning/cover letter/networking guidance.

EVALUATION CONTEXT:
- Users are early-career. Do not require identical prior role.
- Evaluate: directional interest, skill adjacency, environment match, learning exposure, signal-building potential.
- Never use generic traits (hard worker, fast learner, leadership) as justification.

SIGNAL HIERARCHY (STRICT ORDER):
1) Explicit user interests/exclusions
2) Target roles/industries/environments
3) Confirmed past experience
4) Skill adjacency/comparable responsibility
5) Job description requirements

SCORING:
- Score 0–100.
- >=75 Apply
- 60–74 Review carefully
- <60 Pass
- Explicit exclusions must trigger Pass or cap score <60.

DECISION ICON (STRICT):
- Apply → ✅
- Review carefully → ⚠️
- Pass → ⛔
Use the icon exactly once, only next to the decision label.

OUTPUT:
Return valid JSON ONLY with this schema:
{
  "decision": "Apply"|"Review carefully"|"Pass",
  "icon": "✅"|"⚠️"|"⛔",
  "score": number,
  "bullets": string[],        // 4–8 concise reasons grounded in profile + job
  "risk_flags": string[],     // 0–6, include uncertainty/missing info risks
  "next_step": string         // single concrete instruction
}
    `.trim();

    const user = `
CLIENT PROFILE:
${profile}

JOB DESCRIPTION:
${job}

Make a JobFit decision. If profile/job content is placeholder or missing details, score should be low and risk_flags should say what is missing.
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
      // Fallback: return raw text so UI still shows something
      return new Response(
        JSON.stringify({
          decision: "Review carefully",
          icon: "⚠️",
          score: 60,
          bullets: ["Model did not return JSON.", "Review output manually."],
          risk_flags: ["Non-JSON response"],
          next_step: raw || "Retry with full profile + job description.",
        }),
        { status: 200, headers: corsHeaders(origin) }
      );
    }

    const decision = parsed.decision || "Review carefully";
    const score = clampScore(parsed.score);
    const icon = iconForDecision(decision);

    const out = {
      decision,
      icon,
      score,
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets : [],
      risk_flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags : [],
      next_step: typeof parsed.next_step === "string" ? parsed.next_step : "",
    };

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (err: any) {
    const detail = err?.message || String(err);
    return new Response(JSON.stringify({ error: "JobFit failed", detail }), {
      status: 500,
      headers: corsHeaders(origin),
    });
  }
}
