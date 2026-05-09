// FROZEN: pending Framer page rewrite to new /api/jobfit-run-trial flow.
// Do not extend. Delete after framer/jobanalysis.txt is replaced and the
// new free-trial Framer page is live in production.

import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const maxDuration = 90

// Backtick chars built via fromCharCode to avoid Turbopack parse error
const _t = String.fromCharCode(96)
const _fence = _t + _t + _t
function stripFences(s: string) {
  return s.split(_fence + "json").join("").split(_fence).join("").trim()
}

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── Company enrichment prompt (deep research) ──
const ENRICHMENT_PROMPT = `You are a company research analyst. Given this job description, extract the company name and research everything a job applicant would need to know.

Return ONLY valid JSON:
{
  "company_name": "string or null",
  "what_they_do": "2-3 sentences about what the company actually does — real business description, not JD marketing copy",
  "company_stage": "string — startup / growth-stage / PE-backed / public / Fortune 500 / unknown, with detail (e.g. 'Growth-stage, PE-backed. Rebranded from X in 2023')",
  "clients": "string — who their actual customers/clients are, be specific",
  "marketing_context": "string — what marketing at this type of company looks like (B2B vs B2C, sales cycles, content strategy, etc.)",
  "recent_news": "string or null — any significant recent news: rebrand, expansion, layoffs, funding, acquisitions",
  "tier": "Fortune 500 | Major Brand | Mid-Market | Growth Stage | Early Stage | Unknown",
  "industry": "string",
  "application_insight": "string — 2-3 sentences about what this company context means for how a candidate should approach their application"
}

Job description:
`

// ── Main analysis system prompt ──
function buildSystemPrompt(companyContext: string | null) {
  const companyBlock = companyContext || "No company intelligence available — proceed with best inference from the JD."

  return `You are a senior hiring manager and career intelligence analyst with 15 years of recruiting experience across top-tier companies. You have deep knowledge of job markets, hiring patterns, and what companies actually filter on versus what they say publicly.

You will receive a job description AND company intelligence gathered from external research. Use both to produce an analysis that goes far beyond what a candidate could learn from reading the JD.

Your output must include things the candidate genuinely cannot get anywhere else:
- What this company's culture and client base means for this role
- What the real competitive pool looks like (not just "high competition")
- What hiring managers at THIS type of company actually filter on
- What the last 3-5 people hired for this type of role at this company tier actually looked like
- Specific intelligence about the company that changes how you approach the application

RULES:
- Be specific to this company and role. Generic outputs are failure.
- No soft skills language. No "communication" or "teamwork".
- Hidden requirements must be genuinely hidden — not restatable from the JD. Minimum 5, maximum 7.
- Risk flags must be honest and specific, not cautionary boilerplate. Minimum 3, maximum 5.
- Market reality must include real competitive dynamics, not vague warnings.
- The summary must sound like a person who has seen 1000 of these roles.
- Return only valid JSON matching the schema exactly. No markdown, no preamble.

COMPANY CONTEXT PROVIDED:
${companyBlock}

Return this exact schema:
{
  "role_level": "Entry | Early Career | Mid-Level | Experienced",
  "function": "string — specific functional area",
  "seniority_signals": ["string — near-verbatim from JD"],
  "core_skills": ["string — hard skills only, tools/platforms/technical"],
  "hidden_requirements": ["string — 5-7 items, each specific to this company and role"],
  "competitiveness": "Low | Medium | High | Very High",
  "risk_flags": ["string — 3-5 items, blunt and specific"],
  "target_candidate_profile": ["string — what a strong candidate looks like"],
  "summary": "string — 2-3 sentences, sounds human, specific to this company",
  "market_reality": {
    "stats": [
      {"value": "string — a number, percentage, or short metric", "label": "string — what this stat means, 8 words max"}
    ],
    "competitive_dynamic": "string — 2-3 sentences, the real competitive story"
  }

IMPORTANT for market_reality.stats:
- Return exactly 3 stats, each specific to THIS role and company
- First stat should always be estimated applicant count (e.g. "200-400")
- Second and third stats should be unique competitive insights specific to this applicant pool — NOT generic. Examples: "40% have prior fintech experience", "Top 15 MBA programs overrepresented", "3:1 ratio of experienced to entry-level applicants"
- Each value should be short and punchy — a number, percentage, or ratio
- Each label should be under 8 words
- Never reuse the same stats across different analyses
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
  "market_reality",
] as const

async function enrichCompany(
  jd: string,
  apiKey: string
): Promise<{
  context: string
  company_name: string | null
  company_context: Record<string, unknown> | null
} | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [
          { role: "user", content: ENRICHMENT_PROMPT + jd.slice(0, 4000) },
        ],
      }),
    })

    if (!res.ok) {
      console.error("[job-analysis] enrichment call failed:", res.status)
      return null
    }

    const json = await res.json()
    const text = (json.content ?? [])?.[0]?.text ?? ""
    const cleaned = stripFences(text)
    const data = JSON.parse(cleaned)

    if (!data.company_name) return null

    // Build context string for the main analysis prompt
    const lines = [
      `Company: ${data.company_name}`,
      `What they do: ${data.what_they_do || "Unknown"}`,
      `Stage: ${data.company_stage || data.tier || "Unknown"}`,
      `Industry: ${data.industry || "Unknown"}`,
      `Clients: ${data.clients || "Unknown"}`,
      `Marketing context: ${data.marketing_context || "Unknown"}`,
    ]
    if (data.recent_news) lines.push(`Recent news: ${data.recent_news}`)
    if (data.application_insight) lines.push(`Application insight: ${data.application_insight}`)

    return {
      context: lines.join("\n"),
      company_name: data.company_name,
      company_context: {
        what_they_do: data.what_they_do || null,
        company_stage: data.company_stage || data.tier || null,
        clients: data.clients || null,
        marketing_context: data.marketing_context || null,
        recent_news: data.recent_news || null,
        application_insight: data.application_insight || null,
      },
    }
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

    // Optional user-provided company name and job title. When supplied,
    // these override whatever the enrichment step pulls from the JD so
    // the results page shows the user's authoritative value at the top
    // (and any downstream display consumers agree). Clamped to 200 chars.
    const userCompanyName = String(body.company_name ?? "").trim().slice(0, 200)
    const userJobTitle = String(body.job_title ?? "").trim().slice(0, 200)

    if (!job_description || job_description.length < 100) {
      return withCorsJson(
        req,
        { error: "Job description is required and must be at least 100 characters." },
        400
      )
    }

    // Helper: apply user-provided overrides to an analysis result. Called
    // on both the cache-hit path and the fresh-analysis path so behavior
    // is identical regardless of cache state. Overrides are applied AFTER
    // caching so the shared cache never holds one user's label choices.
    const applyUserOverrides = (result: Record<string, unknown>) => {
      if (userCompanyName) result.company_name = userCompanyName
      if (userJobTitle) result.job_title = userJobTitle
      return result
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
      // TODO(analytics-phase-2): replace with analytics_events insert per docs/signal-analytics-spec.md
      // Previous behavior: INSERT into jobfit_page_views with the payload below
      console.log('[analytics:deferred]', {
        call_site: 'app/api/job-analysis/route.ts:241',
        would_have_written: {
          page_name: "job_analysis_run",
          session_id,
          utm_source,
          utm_medium,
          utm_campaign,
          referrer: req.headers.get("referer") || null,
        },
      })
      // Apply user overrides to cached result (shallow clone first to
      // avoid mutating any shared reference, even though cached.result
      // is freshly fetched on each request).
      const cachedResult = { ...(cached.result as Record<string, unknown>) }
      return withCorsJson(req, applyUserOverrides(cachedResult), 200)
    }

    // ── LLM calls ──
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return withCorsJson(req, { error: "server_misconfigured" }, 500)
    }

    // Step 1: Deep company enrichment (Sonnet for quality)
    const enrichment = await enrichCompany(job_description, apiKey)
    const companyContext = enrichment?.context ?? null
    const company_name = enrichment?.company_name ?? null
    const company_context = enrichment?.company_context ?? null

    console.log("[job-analysis] company enrichment:", company_name)

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
        max_tokens: 3000,
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
      console.error("[job-analysis] Anthropic API error:", apiResponse.status, errText)
      return withCorsJson(req, { error: "Analysis failed. Please try again." }, 500)
    }

    const json = await apiResponse.json()
    const rawText = (json.content ?? [])?.[0]?.text ?? ""

    let analysis: Record<string, unknown>
    try {
      const cleaned = stripFences(rawText)
      analysis = JSON.parse(cleaned)
    } catch (parseError) {
      console.error("[job-analysis] JSON parse error:", parseError, "Raw:", rawText)
      return withCorsJson(req, { error: "Analysis failed. Please try again." }, 500)
    }

    // Validate required fields
    for (const field of REQUIRED_FIELDS) {
      if (!analysis[field]) {
        console.error("[job-analysis] Missing field:", field)
        return withCorsJson(req, { error: "Analysis incomplete. Please try again." }, 500)
      }
    }

    // Attach company data for frontend
    if (company_name) analysis.company_name = company_name
    if (company_context) analysis.company_context = company_context

    // ── Cache result ──
    // Cache the ENRICHED version without user overrides applied, so two
    // different users submitting the same JD with different label choices
    // each get their own overrides on top of the shared enrichment.
    await supabase.from("job_analysis_cache").insert({
      jd_hash: jdHash,
      result: analysis,
    })

    // ── Track event ──
    // TODO(analytics-phase-2): replace with analytics_events insert per docs/signal-analytics-spec.md
    // Previous behavior: INSERT into jobfit_page_views with the payload below
    console.log('[analytics:deferred]', {
      call_site: 'app/api/job-analysis/route.ts:333',
      would_have_written: {
        page_name: "job_analysis_run",
        session_id,
        utm_source,
        utm_medium,
        utm_campaign,
        referrer: req.headers.get("referer") || null,
      },
    })

    return withCorsJson(req, applyUserOverrides(analysis), 200)
  } catch (err: any) {
    console.error("[job-analysis] Unexpected error:", err)
    return withCorsJson(req, { error: err?.message || "Analysis failed." }, 500)
  }
}
