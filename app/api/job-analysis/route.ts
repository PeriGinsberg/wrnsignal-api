import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const maxDuration = 60

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── Company enrichment prompt ──
// Quick extraction + classification using model knowledge.
// No web search needed — the model knows Fortune 500s, major brands, etc.
const ENRICHMENT_PROMPT = `Extract the company name from this job description and classify it.
Return ONLY valid JSON, no explanation:
{
  "company_name": "string or null if not identifiable",
  "tier": "Fortune 500 | Major Brand | Mid-Market | Growth Stage | Early Stage | Unknown",
  "industry": "string",
  "notes": "one sentence about this company relevant to a job seeker, or null"
}

Job description:
`

// ── Main analysis prompt ──
function buildSystemPrompt(companyContext: string | null) {
  const companyBlock = companyContext
    ? `\n\nCOMPANY CONTEXT (use this to calibrate competitiveness and hidden requirements):\n${companyContext}\n`
    : ""

  return `You are a senior hiring manager and career strategist with 15 years of recruiting experience across top-tier companies. You analyze job descriptions with precision and tell candidates the truth about what a role actually requires — including what is implied but not stated.

You will receive a job description and return a structured JSON analysis.${companyBlock}

Rules:
- Be specific to THIS job description. Generic outputs are failure.
- Never use soft skill language ("communication", "teamwork", "passionate", "detail-oriented"). Only hard, tangible things.
- Hidden requirements are the most valuable output. Think like the hiring manager who wrote this posting — what do they actually want that they did not write down? What will get a resume filtered out even though the JD does not mention it? Be concrete and specific to this role and company.
- Risk flags should be blunt and honest, like a mentor who has seen 10,000 applications. Not discouraging — just real.
- Competitiveness must reflect the actual applicant pool this company and role will attract. A Fortune 500 entry-level marketing role is Very High. A 15-person startup needing a niche skill is Low.
- The summary must sound like a person briefing a friend. No AI phrases. No "exciting opportunity." No "dynamic environment." No "fast-paced." Write like you are telling someone the truth over coffee.
- Every hidden requirement and risk flag must be specific enough that a reader can act on it. "Strong candidates preferred" is useless. "Candidates without a prior internship at a comparable firm will likely be screened out at the resume stage" is useful.
- Return only valid JSON. No markdown, no explanation, no preamble.

Return exactly this structure:
{
  "role_level": "Entry | Early Career | Mid-Level | Experienced",
  "function": "specific functional area, e.g. Marketing (Brand), Sales (B2B), Finance (FP&A), Software Engineering (Frontend)",
  "seniority_signals": ["near-verbatim extractions from the JD that indicate seniority expectations"],
  "core_skills": ["hard skills only — tools, platforms, technical capabilities, no soft skills"],
  "hidden_requirements": ["2-5 inferred expectations NOT stated in the JD, specific to this role and company"],
  "competitiveness": "Low | Medium | High | Very High",
  "risk_flags": ["1-4 blunt warnings a mentor would give"],
  "target_candidate_profile": ["what a strong candidate actually looks like, be specific"],
  "summary": "2-3 sentences, hiring manager briefing style, no filler"
}`
}

const REQUIRED_FIELDS = [
  "role_level",
  "function",
  "seniority_signals",
  "core_skills",
  "hidden_requirements",
  "competitiveness",
  "risk_flags",
  "target_candidate_profile",
  "summary",
] as const

async function enrichCompany(
  jd: string,
  apiKey: string
): Promise<{ context: string; company_name: string | null } | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [
          { role: "user", content: ENRICHMENT_PROMPT + jd.slice(0, 3000) },
        ],
      }),
    })

    if (!res.ok) {
      console.error("[job-analysis] enrichment call failed:", res.status)
      return null
    }

    const json = await res.json()
    const text = (json.content ?? [])?.[0]?.text ?? ""
    const cleaned = text.replace(/```json|```/g, "").trim()
    const data = JSON.parse(cleaned)

    if (!data.company_name) return null

    const lines = [
      `Name: ${data.company_name}`,
      `Tier: ${data.tier || "Unknown"}`,
      `Industry: ${data.industry || "Unknown"}`,
    ]
    if (data.notes) lines.push(`Context: ${data.notes}`)

    return { context: lines.join("\n"), company_name: data.company_name }
  } catch (err) {
    console.error("[job-analysis] enrichment parse error:", err)
    return null
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const job_description = String(body.job_description ?? "").trim()
    const session_id = body.session_id
      ? String(body.session_id).slice(0, 200)
      : null
    const utm_source = body.utm_source
      ? String(body.utm_source).slice(0, 100)
      : null
    const utm_medium = body.utm_medium
      ? String(body.utm_medium).slice(0, 100)
      : null
    const utm_campaign = body.utm_campaign
      ? String(body.utm_campaign).slice(0, 100)
      : null

    if (!job_description || job_description.length < 100) {
      return withCorsJson(
        req,
        {
          error:
            "Job description is required and must be at least 100 characters.",
        },
        400
      )
    }

    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) {
      return withCorsJson(req, { error: "server_misconfigured" }, 500)
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // ── Cache check ──
    const jdHash = crypto
      .createHash("sha256")
      .update(job_description)
      .digest("hex")

    const { data: cached } = await supabase
      .from("job_analysis_cache")
      .select("result")
      .eq("jd_hash", jdHash)
      .gte(
        "created_at",
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      )
      .single()

    if (cached) {
      // Track even cache hits
      await supabase.from("jobfit_page_views").insert({
        page_name: "job_analysis_run",
        session_id,
        utm_source,
        utm_medium,
        utm_campaign,
        referrer: req.headers.get("referer") || null,
      })

      return withCorsJson(req, cached.result, 200)
    }

    // ── LLM calls ──
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return withCorsJson(req, { error: "server_misconfigured" }, 500)
    }

    // Step 1: Company enrichment (fast, Haiku)
    const enrichment = await enrichCompany(job_description, apiKey)
    const companyContext = enrichment?.context ?? null
    const company_name = enrichment?.company_name ?? null

    console.log("[job-analysis] company enrichment:", company_name, companyContext)

    // Step 2: Main analysis (Sonnet, with company context)
    const systemPrompt = buildSystemPrompt(companyContext)

    const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Analyze this job description:\n\n${job_description}`,
          },
        ],
      }),
    })

    if (!apiResponse.ok) {
      const errText = await apiResponse.text()
      console.error(
        "[job-analysis] Anthropic API error:",
        apiResponse.status,
        errText
      )
      return withCorsJson(
        req,
        { error: "Analysis failed. Please try again." },
        500
      )
    }

    const json = await apiResponse.json()
    const rawText = (json.content ?? [])?.[0]?.text ?? ""

    let analysis: Record<string, unknown>
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim()
      analysis = JSON.parse(cleaned)
    } catch (parseError) {
      console.error(
        "[job-analysis] JSON parse error:",
        parseError,
        "Raw:",
        rawText
      )
      return withCorsJson(
        req,
        { error: "Analysis failed. Please try again." },
        500
      )
    }

    // Validate required fields
    for (const field of REQUIRED_FIELDS) {
      if (!analysis[field]) {
        console.error("[job-analysis] Missing field:", field)
        return withCorsJson(
          req,
          { error: "Analysis incomplete. Please try again." },
          500
        )
      }
    }

    // Attach company name for frontend use
    if (company_name) {
      analysis.company_name = company_name
    }

    // ── Cache result ──
    await supabase.from("job_analysis_cache").insert({
      jd_hash: jdHash,
      result: analysis,
    })

    // ── Track event ──
    await supabase.from("jobfit_page_views").insert({
      page_name: "job_analysis_run",
      session_id,
      utm_source,
      utm_medium,
      utm_campaign,
      referrer: req.headers.get("referer") || null,
    })

    return withCorsJson(req, analysis, 200)
  } catch (err: any) {
    console.error("[job-analysis] Unexpected error:", err)
    return withCorsJson(
      req,
      { error: err?.message || "Analysis failed." },
      500
    )
  }
}
