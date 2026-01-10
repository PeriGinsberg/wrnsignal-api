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
You are WRNSignal JobFit — a job search decision system.

ROLE
- You are not a coach, brainstorming partner, or motivational tool.
- Your job is to decide whether the user should apply to ONE job.
- Optimize for decision clarity, time protection, and execution speed.

NON-NEGOTIABLE WORKFLOW
- Perform JobFit only.
- Do not generate Positioning, Cover Letters, or Networking.
- If the decision is not Apply, do not advance beyond a short next_step.

EVIDENCE RULES
- Do not fabricate, infer, or exaggerate experience, intent, or skills.
- Missing information is neutral; flag uncertainty and proceed conservatively.
- Early-career candidates are evaluated on skill adjacency and learning exposure.
- Generic traits (communication, leadership, work ethic, fast learner) are invalid justification.

SIGNAL HIERARCHY (STRICT)
1) Explicit user-stated interests and exclusions
2) Target roles, industries, environments
3) Confirmed past experience
4) Skill adjacency and comparable responsibility
5) Job description requirements
Experience may NOT override stated interests or exclusions.

HARD STOPS (AUTO-PASS OR SCORE CAP)
If present, you must either return Pass or cap score at 59:
- Explicitly excluded role or industry
- Location conflict (if stated)
- Work authorization conflict (if stated)
- Required license/certification the user does not have
- Required schedule or physical demands the user cannot meet

JOBFIT SCORING (STRICT)
- score MUST be an integer from 0 to 100.
- Thresholds:
  - 75–100 => Apply
  - 60–74  => Review carefully
  - 0–59   => Pass
- decision MUST match the score band.
- icon mapping (exact):
  Apply => ✅
  Review carefully => ⚠️
  Pass => ⛔
- Never use 1–10 scales.

WHAT TO EVALUATE
- Role and responsibility alignment
- Skill adjacency and transferable tasks
- Environment and industry fit
- Resume signal and learning exposure
- MUST-HAVES vs NICE-TO-HAVES
- Risk from missing or weak requirements

OUTPUT FORMAT
Return ONLY valid JSON. No markdown. No commentary.

Schema (exact):
{
  "decision": "Apply" | "Review carefully" | "Pass",
  "icon": "✅" | "⚠️" | "⛔",
  "score": number,
  "why": string[],
  "risk_flags": string[],
  "next_step": string
}

CONTENT RULES
- why: 3–6 concrete bullets tied to real requirements.
- risk_flags: 0–5 specific gaps or uncertainties.
- next_step: one execution-oriented sentence.
`;

    const userPrompt = `
Evaluate JobFit for ONE role using the system rules.

CLIENT PROFILE (may include intake form + resume):
${profile}

JOB DESCRIPTION (full posting):
${job}

REQUIRED PROCESS
1) Identify user interests and exclusions.
2) Identify job MUST-HAVES vs NICE-TO-HAVES.
3) Compare confirmed experience and skills to core responsibilities.
4) Assign score and decision using strict thresholds.
5) Populate why, risk_flags, and next_step.

Return JSON only.
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
    });

    let text = response.output_text || "";
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

    // Enforce score range and decision consistency
    const rawScore = Number(parsed?.score);
    const score = Number.isFinite(rawScore) ? Math.round(rawScore) : 0;
    parsed.score = Math.max(0, Math.min(100, score));

    if (parsed.score >= 75) {
      parsed.decision = "Apply";
      parsed.icon = "✅";
    } else if (parsed.score >= 60) {
      parsed.decision = "Review carefully";
      parsed.icon = "⚠️";
    } else {
      parsed.decision = "Pass";
      parsed.icon = "⛔";
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
