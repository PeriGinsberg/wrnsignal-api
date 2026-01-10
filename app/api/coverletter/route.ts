import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function detectCoverLetterSignal(jobText: string): {
  signal: "required" | "not_required" | "unclear";
  evidence: string[];
} {
  const t = jobText.toLowerCase();

  const evidence: string[] = [];

  const requiredPatterns = [
    /cover letter required/,
    /cover letter is required/,
    /include (a )?cover letter/,
    /submit (a )?cover letter/,
    /attach (a )?cover letter/,
    /must include (a )?cover letter/,
    /please provide (a )?cover letter/,
    /application .* cover letter/,
  ];

  const notRequiredPatterns = [
    /cover letter (is )?optional/,
    /cover letter not required/,
    /no cover letter required/,
    /do not include a cover letter/,
  ];

  for (const p of notRequiredPatterns) {
    if (p.test(t)) evidence.push("Posting indicates cover letter is optional/not required.");
  }
  for (const p of requiredPatterns) {
    if (p.test(t)) evidence.push("Posting explicitly requests a cover letter.");
  }

  if (evidence.some((e) => e.includes("explicitly requests"))) {
    return { signal: "required", evidence };
  }
  if (evidence.some((e) => e.includes("optional/not required"))) {
    return { signal: "not_required", evidence };
  }

  // If the JD mentions cover letter anywhere but not clearly required, call it unclear
  if (t.includes("cover letter")) {
    return { signal: "unclear", evidence: ["Posting mentions cover letters, but requirement is not explicit."] };
  }

  return { signal: "unclear", evidence: ["No explicit cover letter requirement detected in the posting."] };
}

function safeJsonParse(raw: string) {
  // Extract first JSON object in the string, if the model wraps it.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const slice = raw.slice(start, end + 1);
    return JSON.parse(slice);
  }
  return JSON.parse(raw);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const profile = String(body?.profile ?? "").trim();
    const job = String(body?.job ?? "").trim();

    if (!profile || !job) {
      return Response.json(
        { error: "Missing inputs", detail: "Both profile and job are required." },
        { status: 400 }
      );
    }

    const { signal, evidence } = detectCoverLetterSignal(job);

    const recommendationNote =
      signal === "required"
        ? "This role appears to require a cover letter. Generating one is reasonable."
        : signal === "not_required"
        ? "Cover letters are rarely worth the time unless required. This role does not appear to require one."
        : "Cover letters are rarely worth the time unless required. It is not clear this role requires one.";

    const systemPrompt = `
You are WRNSignal. You generate cover letters as a compliance + signal document.
You do NOT write fluffy, enthusiastic, narrative cover letters.
You do NOT invent experience. Everything must be defensible in an interview.
You align language to the job description and the user's existing resume facts only.

STYLE:
- Crisp, professional, direct.
- Max 3 short paragraphs.
- No filler. No generic excitement. No "passion" language unless explicitly supported by the profile.
- No clichés.

OUTPUT:
Return ONLY valid JSON with this exact shape:
{
  "signal": "required" | "not_required" | "unclear",
  "note": string,
  "letter": string
}

LETTER RULES:
- Paragraph 1: role + fit frame (1–3 sentences)
- Paragraph 2: 2–3 proof points pulled from the profile/resume, phrased in job-description language
- Paragraph 3: close with availability + contact; no begging; no over-enthusiasm
- Keep it short enough to be read fast.
`.trim();

    const userPrompt = `
Cover letter requirement signal: ${signal}
Evidence: ${evidence.join(" | ")}

Recommendation note (always include in "note"): ${recommendationNote}

USER PROFILE (facts only):
${profile}

JOB DESCRIPTION:
${job}

Write the cover letter now.
`.trim();

    const resp = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    // Pull text output
    const raw =
      (resp.output_text && String(resp.output_text)) ||
      "";

    let parsed: any;
    try {
      parsed = safeJsonParse(raw);
    } catch {
      // Hard fallback: return a usable response instead of failing silently
      return Response.json({
        signal,
        note: recommendationNote,
        letter: raw || "Cover letter generation returned an unreadable response. Try again.",
        raw_output: raw,
      });
    }

    // Normalize output to keep UI stable
    const result = {
      signal: (parsed?.signal as any) || signal,
      note: String(parsed?.note ?? recommendationNote),
      letter: String(parsed?.letter ?? "").trim(),
    };

    return Response.json(result);
  } catch (err: any) {
    return Response.json(
      {
        error: "CoverLetter failed",
        detail: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
