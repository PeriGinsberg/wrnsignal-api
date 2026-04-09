// app/api/jobfit/debug-review/route.ts
//
// "Second opinion" LLM sanity-check layer for the JobFit scoring engine.
// Given a scoring result (from a previous run) plus the original profile
// and job text, calls Claude and asks it to act as a senior hiring manager
// reviewer: does this scoring output make sense? Are there obvious bugs?
// Missing evidence? Contradictory signals? Wrong decision given the match?
//
// Purpose: catch scoring bugs that don't produce a crash — they produce
// a "technically valid but clearly wrong" result. The deterministic scoring
// engine can't catch its own rule bugs. A second LLM pass can.
//
// Not called inline by the main scoring pipeline (would double LLM cost
// and latency). Meant to be hit manually by the developer when a result
// looks suspicious, or from the regression test harness as a bulk audit.
//
// Usage:
//   POST /api/jobfit/debug-review
//   body: { result_json: <full jobfit result>, profile_text: string, job_text: string }
//
//   OR
//
//   body: { jobfit_run_id: string }
//   (loads the stored result and the profile from jobfit_runs + client_profiles)

import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const maxDuration = 60

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── Prompt builder ───────────────────────────────────────────────────────
function buildReviewPrompt(
  profileText: string,
  jobText: string,
  result: any
): string {
  const decision = result?.decision ?? "unknown"
  const score = result?.score ?? "unknown"
  const whyCodes = result?.why_codes ?? []
  const riskCodes = result?.risk_codes ?? []
  const gate = result?.gate_triggered?.type
  const jobSignals = result?.job_signals ?? {}

  const whySummary = whyCodes
    .map(
      (w: any, i: number) =>
        `  ${i + 1}. [${w.code}] key=${w.match_key} strength=${w.match_strength} weight=${w.weight}\n` +
        `     job_fact: ${String(w.job_fact ?? "").slice(0, 150)}\n` +
        `     profile_fact: ${String(w.profile_fact ?? "").slice(0, 150)}`
    )
    .join("\n")

  const riskSummary = riskCodes
    .map(
      (r: any, i: number) =>
        `  ${i + 1}. [${r.code}] severity=${r.severity} weight=${r.weight}\n` +
        `     risk: ${String(r.risk ?? "").slice(0, 200)}`
    )
    .join("\n")

  return `You are a senior hiring manager reviewing a scoring engine's assessment of a candidate. Your job is to spot bugs, not to evaluate the candidate. The scoring engine is deterministic and rule-based; its output is below. Look for signs that the rules produced a wrong answer.

## SCORING ENGINE OUTPUT

Decision: ${decision}
Score: ${score}
Gate triggered: ${gate ?? "none"}
Job family: ${jobSignals.jobFamily ?? "unknown"}
Finance subfamily: ${jobSignals.financeSubFamily ?? "n/a"}
Years required: ${jobSignals.yearsRequired ?? "not specified"}
Is senior role: ${jobSignals.isSeniorRole ?? false}

## WHY CODES (evidence of match)
${whySummary || "  (none)"}

## RISK CODES (gaps flagged)
${riskSummary || "  (none)"}

## CANDIDATE PROFILE (verbatim)
${profileText.slice(0, 8000)}

## JOB DESCRIPTION (verbatim)
${jobText.slice(0, 6000)}

## YOUR TASK

Review the scoring output for OBVIOUS PROBLEMS a human recruiter would catch immediately:

1. **Missed evidence**: Is there a clear qualification or experience in the profile that the scoring engine didn't credit? Name the specific resume line and the requirement it should have matched.

2. **Wrong family classification**: Is the job family correct for the role being described, or is it pulling from company boilerplate?

3. **False-positive risks**: Are any of the risk codes nonsensical given the profile? E.g., flagging "missing Excel" when the profile explicitly lists Excel, or flagging "no clinical experience" when the candidate is an EMT.

4. **Contradictory signals**: Does the same profile evidence fire BOTH a WHY code and a RISK code? (e.g., "Managed 400 B2B prospects" as a strength AND as a gap)

5. **Wrong decision**: Given the matches and gaps, does the decision match what a senior recruiter would say? Specifically:
   - Should this be Priority Apply / Apply but got Review or Pass?
   - Should this be Pass but got Apply?
   - Is the score way too high or way too low for the actual fit?

6. **Gate over-fire**: If a gate triggered, was it justified? E.g., did the credential gate fire on "ideally Series 7" language when the job is a support associate that sponsors licensing?

7. **Extraction garbage**: Look at job_signals.jobTitle, job_signals.companyName, job_signals.location — are they correct, or is there garbage like "(Unknown Role)" or section-header text?

## OUTPUT FORMAT

Return ONLY valid JSON matching this schema. No markdown, no preamble.

{
  "verdict": "LOOKS_CORRECT" | "SUSPECT" | "CLEARLY_WRONG",
  "summary": "One sentence — what's your overall take?",
  "issues": [
    {
      "severity": "high" | "medium" | "low",
      "category": "missed_evidence" | "wrong_family" | "false_positive_risk" | "contradictory" | "wrong_decision" | "gate_overfire" | "extraction_garbage" | "other",
      "description": "What's wrong — be specific, cite resume/JD text",
      "expected": "What a correct assessment would say instead"
    }
  ],
  "recruiter_assessment": "If you, as a senior recruiter, received this candidate for this role, what would you actually say? 2-3 sentences. Not scoring, not coaching — just the recruiter's gut."
}
`
}

// ── Main handler ─────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json()

    let profileText: string = String(body.profile_text ?? "").trim()
    let jobText: string = String(body.job_text ?? "").trim()
    let resultJson: any = body.result_json ?? null

    // Alternate path: load from stored jobfit_runs row
    if (body.jobfit_run_id) {
      const supabaseUrl = process.env.SUPABASE_URL
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!supabaseUrl || !supabaseKey) {
        return withCorsJson(req, { error: "Supabase env missing" }, 500)
      }
      const supabase = createClient(supabaseUrl, supabaseKey)
      const { data: run, error: runErr } = await supabase
        .from("jobfit_runs")
        .select("result_json, client_profile_id")
        .eq("id", String(body.jobfit_run_id))
        .maybeSingle()
      if (runErr || !run) {
        return withCorsJson(req, { error: `jobfit_run lookup failed: ${runErr?.message ?? "not found"}` }, 404)
      }
      resultJson = run.result_json
      // Pull profile text from the linked client_profiles row
      const { data: profile } = await supabase
        .from("client_profiles")
        .select("profile_text, resume_text")
        .eq("id", run.client_profile_id)
        .maybeSingle()
      if (profile) {
        profileText =
          String(profile.profile_text ?? "").trim() ||
          String(profile.resume_text ?? "").trim()
      }
      // Extract job text from the result's job_signals if available.
      // If the run didn't store the original JD text, the reviewer has
      // less context — but it can still catch some bugs from the
      // requirement units.
      jobText = String(
        resultJson?.job_signals?.rawJobText ??
          resultJson?.raw_job_text ??
          ""
      ).trim()
    }

    if (!resultJson) {
      return withCorsJson(req, { error: "missing result_json or jobfit_run_id" }, 400)
    }
    if (!profileText) {
      return withCorsJson(req, { error: "missing profile_text" }, 400)
    }
    if (!jobText) {
      return withCorsJson(
        req,
        {
          error:
            "missing job_text (original JD not available from stored run — pass it explicitly in the request body)",
        },
        400
      )
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return withCorsJson(req, { error: "ANTHROPIC_API_KEY missing" }, 500)
    }

    const prompt = buildReviewPrompt(profileText, jobText, resultJson)
    const t0 = Date.now()

    const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        messages: [{ role: "user", content: prompt }],
      }),
    })

    if (!apiResponse.ok) {
      const errText = await apiResponse.text()
      return withCorsJson(
        req,
        { error: `Anthropic API error ${apiResponse.status}: ${errText.slice(0, 500)}` },
        500
      )
    }

    const json = await apiResponse.json()
    const rawText = (json.content ?? [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => String(b?.text ?? ""))
      .join("")

    // Strip any markdown fences the model may have added
    const _t = String.fromCharCode(96)
    const _fence = _t + _t + _t
    const stripped = rawText.split(_fence + "json").join("").split(_fence).join("").trim()
    const firstBrace = stripped.indexOf("{")
    const lastBrace = stripped.lastIndexOf("}")

    let parsed: any = null
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        parsed = JSON.parse(stripped.slice(firstBrace, lastBrace + 1))
      } catch (err: any) {
        return withCorsJson(
          req,
          {
            error: "review JSON parse failed",
            raw_snippet: rawText.slice(0, 400),
            parse_error: err?.message,
          },
          500
        )
      }
    } else {
      return withCorsJson(
        req,
        { error: "no JSON object in review response", raw_snippet: rawText.slice(0, 400) },
        500
      )
    }

    return withCorsJson(
      req,
      {
        ok: true,
        review: parsed,
        latency_ms: Date.now() - t0,
        tokens: json.usage ?? null,
      },
      200
    )
  } catch (err: any) {
    return withCorsJson(
      req,
      { error: err?.message ?? String(err) },
      500
    )
  }
}
