import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { getAuthedProfileText } from "../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { getHistoryBoundary, applyHistoryBoundary } from "../_lib/clientHistoryBoundary"
import { getCandidateTargeting } from "@/lib/candidateTargeting"
import { invokeClaude } from "@/lib/ai/anthropicClient"
import { centsForUsage } from "@/lib/ai/costPolicy"
import { validatePlan } from "@/lib/networking/voiceValidator"
import { extractGraduationDate } from "@/lib/resume/extractGraduationDate"
import { computeStatus, type CandidateStatus } from "@/lib/profile/computeStatus"
import type { CareerStage } from "@/lib/laneTaxonomy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MISSING = "__MISSING__"
// Bumped 2026-05-29 — wrong-status fix. CANDIDATE STATUS verdict is now
// injected into framing/strategy via a code-computed grad-date result;
// the v8 voiceValidator surface is unchanged (validator inspects only
// user-facing message fields, not framing/strategy). The version bump
// alone busts every existing v8 cache entry.
const NETWORKING_PROMPT_VERSION = "networking_v9_status_verdict_2026_05_29"
const MODEL_ID = "claude-haiku-4-5-20251001"
// Output is 3 full moves × messages/emails/openers/queries — empirical
// worst case ≈ 3500-4000 output tokens. 6000 gives comfortable headroom
// well under Haiku 4.5's 8192 cap.
const MAX_TOKENS_GENERATION = 6000
// Low temp for structured-JSON adherence; some warmth retained for message tone.
const TEMPERATURE_MAIN = 0.5
// Higher temp on validator-triggered regenerate — matches Phase 2 retry pattern.
const TEMPERATURE_MAIN_RETRY = 0.7
// Repair is a deterministic schema-rewrite — greedy decoding.
const TEMPERATURE_REPAIR = 0.0

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function getNetworkingTestKey() {
  return String(process.env.NETWORKING_TEST_KEY || "").trim()
}

function isBypassAllowed(req: Request) {
  if (process.env.NODE_ENV === "production") return false

  const expected = getNetworkingTestKey()
  if (!expected) return false

  const fromHeader =
    req.headers.get("x-networking-test-key") ||
    req.headers.get("x-jobfit-test-key") ||
    ""

  return String(fromHeader).trim() === expected
}

type ApplicationState =
  | "not_applied"
  | "applied_today"
  | "applied_recently"
  | "interview_stage"

function requireEnv(name: string, v?: string) {
  if (!v) throw new Error(`Missing server env: ${name}`)
  return v
}

const supabaseAdmin = createClient(
  requireEnv("SUPABASE_URL", SUPABASE_URL),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
  { auth: { persistSession: false, autoRefreshToken: false } }
)

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function normalize(value: any): any {
  if (typeof value === "string") {
    const cleaned = value.trim()
    if (cleaned === "") return MISSING
    return cleaned.toLowerCase().replace(/\s+/g, " ")
  }

  if (Array.isArray(value)) return value.map(normalize).sort()

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc: any, key) => {
        const v = (value as any)[key]
        if (v !== null && v !== undefined) acc[key] = normalize(v)
        return acc
      }, {})
  }

  return value
}

function buildNetworkingFingerprint(payload: any) {
  const normalized = normalize(payload)
  const canonical = JSON.stringify(normalized)
  const fingerprint_hash = crypto
    .createHash("sha256")
    .update(canonical)
    .digest("hex")

  const fingerprint_code =
    "NW-" + parseInt(fingerprint_hash.slice(0, 10), 16).toString(36).toUpperCase()

  return { fingerprint_hash, fingerprint_code }
}

function asTrimmedString(v: any) {
  return typeof v === "string" ? v.trim() : ""
}

function asStringArray(v: any, max = 8) {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, max)
}

function detectApplicationState(raw: any): ApplicationState {
  const state = String(raw || "")
    .trim()
    .toLowerCase()

  if (state === "not_applied") return "not_applied"
  if (state === "applied_today") return "applied_today"
  if (state === "applied_recently") return "applied_recently"
  if (state === "interview_stage") return "interview_stage"

  return "applied_today"
}

function deriveLegacyActionsFromMoves(moves: any[]) {
  return moves.slice(0, 3).map((m: any) => ({
    ladder_rung: String(m?.target_type || "").trim(),
    target_roles: [String(m?.target_title || "").trim()].filter(Boolean),
    person_to_pick: String(m?.target_title || "").trim(),
    rationale: String(m?.why_this_target || "").trim(),
    channel: {
      primary: String(m?.channel_plan?.primary || "").trim(),
      why: String(m?.channel_plan?.why || "").trim(),
      email_schema_guidance: {
        likely_formats: [],
        how_to_verify:
          "Use the company directory, email pattern tools, or the company website before sending.",
        caution: "Do not guess a specific person's email address.",
      },
    },
    search_terms: Array.isArray(m?.linkedin_search_queries)
      ? m.linkedin_search_queries
      : [],
    message: {
      initial: String(
        m?.linkedin_message ||
          m?.linkedin_connection_request ||
          m?.email_body ||
          ""
      ).trim(),
      follow_up: String(m?.follow_up_message || "").trim(),
    },
    conversation: {
      questions: Array.isArray(m?.conversation_openers)
        ? m.conversation_openers.slice(0, 4)
        : [],
    },
  }))
}

function normalizeMove(raw: any, index: number) {
  const moveId = asTrimmedString(raw?.move_id) || `move_${index + 1}`

  const primary = asTrimmedString(raw?.channel_plan?.primary) || "LinkedIn"
  const secondary = asTrimmedString(raw?.channel_plan?.secondary)

  return {
    move_id: moveId,
    target_type: asTrimmedString(raw?.target_type),
    target_title: asTrimmedString(raw?.target_title),
    why_this_target: asTrimmedString(raw?.why_this_target),
    goal: asTrimmedString(raw?.goal),
    timing: asTrimmedString(raw?.timing),
    channel_plan: {
      primary,
      secondary,
      why: asTrimmedString(raw?.channel_plan?.why),
    },
    linkedin_search_queries: asStringArray(raw?.linkedin_search_queries, 6),
    linkedin_connection_request: asTrimmedString(
      raw?.linkedin_connection_request
    ),
    linkedin_message: asTrimmedString(raw?.linkedin_message),
    email_subject: asTrimmedString(raw?.email_subject),
    email_body: asTrimmedString(raw?.email_body),
    follow_up_message: asTrimmedString(raw?.follow_up_message),
    conversation_openers: asStringArray(raw?.conversation_openers, 5),
  }
}

function buildDefaultSequence(applicationState: ApplicationState) {
  if (applicationState === "not_applied") {
    return [
      { day: "Day 0", step: "Identify Move 1 and send the first outreach." },
      { day: "Day 2", step: "Send Move 2 if no response from Move 1." },
      { day: "Day 4", step: "Send one follow-up to Move 1 only." },
      { day: "Day 6", step: "Apply after you have enough signal or useful context." },
    ]
  }

  if (applicationState === "interview_stage") {
    return [
      { day: "Day 0", step: "Use Move 1 to gather team insight before interviews." },
      { day: "Day 1-2", step: "Send Move 2 for role-specific perspective." },
      { day: "Day 3", step: "Use one short follow-up if needed." },
      { day: "Before interview", step: "Review the conversation openers and intel themes." },
    ]
  }

  if (applicationState === "applied_recently") {
    return [
      { day: "Day 0", step: "Send Move 1 and Move 2." },
      { day: "Day 2-3", step: "Send one follow-up to Move 1." },
      { day: "Day 5-6", step: "Send Move 3 if you still have no traction." },
      { day: "Day 7", step: "Stop after one follow-up per person." },
    ]
  }

  return [
    { day: "Day 0", step: "Send Move 1 within 24 hours of applying." },
    { day: "Day 1", step: "Send Move 2 if it targets a different lane." },
    { day: "Day 3", step: "Send one follow-up to Move 1 only." },
    { day: "Day 5-6", step: "Send Move 3 if needed, then stop." },
  ]
}

function normalizePlan(parsed: any, applicationState: ApplicationState) {
  const fallbackMoves = [
    {
      move_id: "move_1",
      target_type: "Closest to the work",
      target_title: "Analyst or associate on the hiring team",
      why_this_target:
        "They are closest to the day-to-day work and can tell you what actually matters.",
      goal: "Get your application seen by someone close to the role.",
      timing: "Within 24 hours",
      channel_plan: {
        primary: "LinkedIn",
        secondary: "Email",
        why: "LinkedIn is best for discovery. Email is useful once you identify the right person.",
      },
      linkedin_search_queries: [],
      linkedin_connection_request: "",
      linkedin_message: "",
      email_subject: "",
      email_body: "",
      follow_up_message: "",
      conversation_openers: [],
    },
    {
      move_id: "move_2",
      target_type: "Credibility bridge",
      target_title: "Alumni or team-adjacent employee",
      why_this_target:
        "They are more likely to respond and can give credible internal signal.",
      goal: "Create a path into a real conversation.",
      timing: "Day 1-2",
      channel_plan: {
        primary: "LinkedIn",
        secondary: "",
        why: "This is usually the fastest way to start a low-friction conversation.",
      },
      linkedin_search_queries: [],
      linkedin_connection_request: "",
      linkedin_message: "",
      email_subject: "",
      email_body: "",
      follow_up_message: "",
      conversation_openers: [],
    },
    {
      move_id: "move_3",
      target_type: "Process owner",
      target_title: "Recruiter or recruiting coordinator",
      why_this_target:
        "They control process visibility and can clarify how the role is actually being handled.",
      goal: "Increase the chance your application is reviewed in the right context.",
      timing: "Later in the sequence",
      channel_plan: {
        primary: "LinkedIn",
        secondary: "Email",
        why: "Use this after the more role-proximate contacts.",
      },
      linkedin_search_queries: [],
      linkedin_connection_request: "",
      linkedin_message: "",
      email_subject: "",
      email_body: "",
      follow_up_message: "",
      conversation_openers: [],
    },
  ]

  const out: any = {
    framing: "Here’s how you stop being just another application.",
    strategy:
      "Use targeted outreach to create one credible human conversation tied to this specific role.",
    application_state: applicationState,
    sequence: buildDefaultSequence(applicationState),
    moves: fallbackMoves,
    actions: deriveLegacyActionsFromMoves(fallbackMoves),
  }

  if (parsed && typeof parsed === "object") {
    if (typeof parsed.framing === "string" && parsed.framing.trim()) {
      out.framing = parsed.framing.trim()
    }

    if (typeof parsed.strategy === "string" && parsed.strategy.trim()) {
      out.strategy = parsed.strategy.trim()
    }

    const parsedState = detectApplicationState(parsed.application_state)
    out.application_state = parsedState

    if (Array.isArray(parsed.sequence) && parsed.sequence.length) {
      const seq = parsed.sequence
        .filter((x: any) => x && typeof x === "object")
        .map((x: any) => ({
          day: String(x.day || "").trim(),
          step: String(x.step || "").trim(),
        }))
        .filter((x: any) => x.day && x.step)
        .slice(0, 8)

      if (seq.length) out.sequence = seq
    }

    if (Array.isArray(parsed.moves) && parsed.moves.length) {
      const moves = parsed.moves.slice(0, 3).map(normalizeMove)
      while (moves.length < 3) {
        moves.push(normalizeMove(fallbackMoves[moves.length], moves.length))
      }
      out.moves = moves.slice(0, 3)
      out.actions = deriveLegacyActionsFromMoves(out.moves)
    }
  }

  return out
}

async function repairToJson(raw: string, applicationState: ApplicationState) {
  const repairSystem = `
You are a JSON repair tool. Convert the user's content into valid JSON matching this exact schema.
Return JSON only. No markdown. No commentary.

SCHEMA:
{
  "framing": string,
  "strategy": string,
  "application_state": "not_applied" | "applied_today" | "applied_recently" | "interview_stage",
  "sequence": [{ "day": string, "step": string }],
  "moves": [
    {
      "move_id": string,
      "target_type": string,
      "target_title": string,
      "why_this_target": string,
      "goal": string,
      "timing": string,
      "channel_plan": {
        "primary": "LinkedIn" | "Email" | "Mixed" | string,
        "secondary": "LinkedIn" | "Email" | "" | string,
        "why": string
      },
      "linkedin_search_queries": string[],
      "linkedin_connection_request": string,
      "linkedin_message": string,
      "email_subject": string,
      "email_body": string,
      "follow_up_message": string,
      "conversation_openers": string[]
    }
  ]
}

RULES:
- moves must be exactly 3 items. Pad conservatively if needed.
- sequence should be 2-8 items.
- application_state must default to "${applicationState}" if missing.
- Do not invent a specific person's email address.
- Keep the content tactical and student-credible.
  `.trim()

  const repairUser = `
Convert the following into JSON matching the schema.

RAW:
${raw}
  `.trim()

  const repairResult = await invokeClaude({
    systemPrompt: repairSystem,
    userPrompt: repairUser,
    maxTokens: MAX_TOKENS_GENERATION,
    temperature: TEMPERATURE_REPAIR,
  })

  console.log(
    `[networking] repair generation cost cents=${centsForUsage(repairResult.usage)} input_tokens=${repairResult.usage.input_tokens} output_tokens=${repairResult.usage.output_tokens} latency_ms=${repairResult.latencyMs}`
  )

  return safeJsonParse(repairResult.text)
}

// ── Wrong-status fix (2026-05-29): the CANDIDATE STATUS verdict block ───────
// injected into the user prompt. Mirrors the cover letter helper pattern
// (Commit 3) but adapted for networking's JSON output — the load-bearing
// fields where status leaks are framing, strategy, why_this_target. The
// v8 voiceValidator does not inspect these fields, so the prompt rule is
// the only enforcement. Message fields (linkedin_message, email_body,
// connection_request, follow_up_message) follow the v8 exemplar shape
// and don't naturally assert status; the FORBIDDEN scope here is
// defense-in-depth.
//
// Copy-pasted (not imported) from coverletter/route.ts because cross-route
// imports between Next.js App Router files are architecturally awkward
// and the cover letter helper has prose-oriented wording ("throughout
// the letter") that doesn't fit networking. Shared-lib refactor is
// deferred — separate hardening, not this commit.
function buildCandidateStatusBlock(status: CandidateStatus): string {
  if (status === "graduated") {
    return `CANDIDATE STATUS: graduated (authoritative — code-computed from grad date; do not reason about dates yourself).
Use this for framing and strategy.
FORBIDDEN anywhere in the output (framing, strategy, why_this_target, conversation_openers, or message fields): "student" (self-description), "senior at", "junior at", "studying X at" (present-tense), "graduating in", "graduating from", "expecting to graduate"; plus any present-tense or future use of "graduate" as a verb ("graduating", "about to graduate", "set to graduate", "soon to graduate", "will graduate" — past-tense "graduated" is required).
REQUIRED past-tense framing when referring to the candidate's education: "recent graduate from [school]", "graduated", "completed my [degree]", "earned my [degree]".`
  }
  if (status === "student") {
    return `CANDIDATE STATUS: student (authoritative — code-computed from grad date; do not reason about dates yourself).
Use this for framing and strategy. Present-tense student framing is appropriate ("current [year-level] at [university] studying [major]").`
  }
  return `CANDIDATE STATUS: unknown (no structured signal extracted; the grad date could not be parsed and no career_stage was on file).
Infer the lifecycle position from resume dates and degree language. Default to past-tense framing if the most recent grad date is in the past relative to today.`
}

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const bypass = isBypassAllowed(req)

    let profileId = ""
    let profileText = ""
    let resumeText = ""

    if (bypass) {
      profileText = String(body?.profileText || body?.profile || "").trim()
      profileId = String(body?.profileId || "DEV_TEST_PROFILE").trim()

      if (!profileText) {
        return withCorsJson(
          req,
          { error: "Missing profileText (or profile) for bypass mode" },
          400
        )
      }

      console.log("[networking] using DEV bypass")
      console.log("[networking] profileId:", profileId)
      console.log("[networking] profileText length:", profileText.length)
    } else {
      const authed = await getAuthedProfileText(req)
      profileId = authed.profileId
      profileText = authed.profileText
      resumeText = authed.resumeText || ""
    }

    const profile = profileText
    const job = String(body?.job || "").trim()
    const applicationState = detectApplicationState(body?.application_state)

    // networkingContext is not yet plumbed from any client; preserved as {}.
    const networkingContext = body?.networking_context ?? {}

    if (!job) {
      return withCorsJson(req, { error: "Missing job" }, 400)
    }

    // Returning-client clean slate: seeds must not pull last season's hidden
    // runs. Resolved once; null = show all (no-op for every non-returning user).
    const boundaryAt = await getHistoryBoundary(supabaseAdmin, profileId)

    // ── Context plumbing (networking_v5) ─────────────────────────────────
    // Replaces the always-{} jobfit/positioning context with real data
    // looked up by this profile + this JD. PROMPT INSTRUCTIONS unchanged in
    // this commit — we only feed the existing JOBFIT/POSITIONING context
    // slots and add RESUME + CANDIDATE TARGETING blocks. Match rules:
    //   - jobfit_runs / positioning_runs_v2: exact job_description text match
    //     (both store the trimmed JD; `job` is trimmed above). No recency
    //     fallback for these — a miss passes {}.
    //   - positioning_runs (v1): has no job_description column, so latest
    //     within the last 24h only (tight window to limit wrong-JD matches).
    // All scoped to this profile, newest first, limit 1.

    // JobFit context — exact JD match on jobfit_runs.
    let jobfitContext: any = {}
    {
      const jfQ = supabaseAdmin
        .from("jobfit_runs")
        .select("id, verdict, result_json, created_at")
        .eq("client_profile_id", profileId)
        .eq("job_description", job)
      const { data: jfRow } = await applyHistoryBoundary(jfQ, boundaryAt)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (jfRow?.result_json) {
        const rj: any = jfRow.result_json
        const js: any = rj?.job_signals ?? {}
        jobfitContext = {
          verdict:
            typeof rj?.decision === "string" && rj.decision.trim()
              ? rj.decision.trim()
              : asTrimmedString(jfRow.verdict),
          score: typeof rj?.score === "number" ? rj.score : null,
          risks: Array.isArray(rj?.risk_structured)
            ? rj.risk_structured
            : Array.isArray(rj?.risk)
              ? rj.risk
              : rj?.risks ?? [],
          why: Array.isArray(rj?.why_structured)
            ? rj.why_structured
            : Array.isArray(rj?.why)
              ? rj.why
              : rj?.whys ?? [],
          job_signals: {
            companyName: asTrimmedString(js?.companyName),
            jobTitle: asTrimmedString(js?.jobTitle),
            jobFamily: asTrimmedString(js?.jobFamily),
          },
        }
      } else {
        console.log(
          `[networking] no jobfit context found for profileId=${profileId} (no jobfit_runs row matching this JD)`
        )
      }
    }

    // Positioning context — v2 first (exact JD match), else v1 (24h recency).
    let positioningContext: any = {}
    {
      const v2Q = supabaseAdmin
        .from("positioning_runs_v2")
        .select("case_assigned, case_reasoning, result_json, created_at")
        .eq("profile_id", profileId)
        .eq("job_description", job)
      const { data: v2Row } = await applyHistoryBoundary(v2Q, boundaryAt)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (v2Row) {
        const rj: any = (v2Row as any).result_json ?? {}
        positioningContext = {
          source: "v2",
          case_assigned: asTrimmedString((v2Row as any).case_assigned),
          case_reasoning: asTrimmedString((v2Row as any).case_reasoning),
          case_specific: rj?.case_specific ?? null,
          workflow_preview: rj?.workflow_preview ?? null,
        }
      } else {
        const cutoffIso = new Date(
          Date.now() - 24 * 60 * 60 * 1000
        ).toISOString()
        const { data: v1Row } = await supabaseAdmin
          .from("positioning_runs")
          .select("result_json, created_at")
          .eq("client_profile_id", profileId)
          .gte("created_at", cutoffIso)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        if ((v1Row as any)?.result_json) {
          const rj: any = (v1Row as any).result_json
          positioningContext = {
            source: "v1",
            role_angle: rj?.role_angle ?? null,
            summary_statement: rj?.summary_statement ?? null,
            keyword_analysis: rj?.keyword_analysis ?? null,
          }
          console.log(
            `[networking] v1 positioning recency-fallback used, profileId=${profileId}; possible wrong-JD match if user ran multiple JDs today`
          )
        } else {
          console.log(
            `[networking] no positioning context found for profileId=${profileId}`
          )
        }
      }
    }

    // Candidate targeting — by profile_id (UNIQUE → at most one row).
    let candidateTargeting: any = {}
    let candidateCareerStage: CareerStage | null = null
    {
      const { row: ct } = await getCandidateTargeting(supabaseAdmin, profileId)
      if (ct) {
        candidateTargeting = {
          primary_lane: ct.primary_lane ?? null,
          primary_sublane: ct.primary_sublane ?? null,
          secondary_lane_1: ct.secondary_lane_1 ?? null,
          secondary_lane_2: ct.secondary_lane_2 ?? null,
          career_stage: ct.career_stage ?? null,
          primary_other_description: ct.primary_other_description ?? null,
        }
        candidateCareerStage = ct.career_stage
      } else {
        console.log(
          `[networking] no candidate_targeting found for profileId=${profileId}`
        )
      }
    }

    // Wrong-status fix (2026-05-29): compute student-vs-graduated verdict
    // from gradDate (extractor → Haiku) + candidate_targeting.career_stage
    // fallback. Layer 1 (gradDate) wins over Layer 2 (career_stage), so a
    // stale "mid_career" is overridden by the real date in the resume.
    // The verdict is injected into the user prompt; the system prompt's
    // USE CONTEXT FOR STRATEGY section tells the model it's authoritative
    // for framing / strategy.
    const extractionResult = await extractGraduationDate({ resumeText })
    const candidateStatus: CandidateStatus = computeStatus({
      gradDate: extractionResult.result,
      careerStage: candidateCareerStage,
    })

    console.log(
      `[networking] grad date extraction cost cents=${centsForUsage(extractionResult.usage)} input_tokens=${extractionResult.usage.input_tokens} output_tokens=${extractionResult.usage.output_tokens} latency_ms=${extractionResult.latencyMs} extracted_raw=${JSON.stringify(extractionResult.result?.raw ?? null)} computed_status=${candidateStatus} career_stage=${candidateCareerStage ?? "null"}`
    )

    const fingerprintPayload = {
      job: { text: job || MISSING },
      profile: {
        id: profileId || MISSING,
        text: profileText || MISSING,
        resume: resumeText || MISSING,
      },
      application_state: applicationState || MISSING,
      jobfit_context: jobfitContext || MISSING,
      positioning_context: positioningContext || MISSING,
      networking_context: networkingContext || MISSING,
      candidate_targeting: candidateTargeting || MISSING,
      // Wrong-status fix: computed verdict in the fingerprint so resume
      // edits that change the extracted grad date or a career_stage
      // change bust the cache. Version bump alone busts every v8 entry.
      candidate_status: candidateStatus,
      system: {
        networking_prompt_version: NETWORKING_PROMPT_VERSION,
        model_id: MODEL_ID,
      },
    }

    const { fingerprint_hash, fingerprint_code } =
      buildNetworkingFingerprint(fingerprintPayload)

    const nrQ = supabaseAdmin
      .from("networking_runs")
      .select("result_json, fingerprint_code, fingerprint_hash, created_at")
      .eq("client_profile_id", profileId)
      .eq("fingerprint_hash", fingerprint_hash)
    const { data: existingRun, error: findErr } = await applyHistoryBoundary(nrQ, boundaryAt)
      .maybeSingle()

    if (findErr) {
      console.warn("networking_runs lookup failed:", findErr.message)
    }

    if (existingRun?.result_json) {
      return withCorsJson(
        req,
        {
          ...(existingRun.result_json as any),
          fingerprint_code,
          fingerprint_hash,
          reused: true,
        },
        200
      )
    }

    const system = `
You are WRNSignal (Networking module). You generate a networking EXECUTION PLAN for ONE specific job.

This is tactical job-search execution: produce outreach the student would actually send, not generic networking advice.

THE WRN COACHING VOICE

The student is appropriately aggressive: transparent that they applied, direct about wanting the role, no fluff, no fake enthusiasm, no resume-dumping. The application itself is the anchor — they do not recite their background to a stranger. They ask for the call. Specifics belong in the conversation, not the cold message.

THREE EXEMPLARS — these define the voice. Match this shape and brevity.

Type 1 — "Doing this job" (peer currently in the role):
"Hi [Name], I recently applied for the [Role] role at [Company]. I'm reaching out with the hope of connecting to learn more about the role and specifically how I can stand out as a candidate. Would you have 10 minutes for a quick call this week?

Best, [Your Name]"

Type 2 — "Similar background" (someone at the company like the user):
"Hi [Name], I recently applied for the [Role] role at [Company] and noticed you [shared background hook — e.g. 'also studied at NYU' / 'started in a similar role' / 'made a similar pivot']. I'm reaching out with the hope of connecting to learn how you positioned your experience for this kind of role. Would you have 10 minutes for a quick call this week?

Best, [Your Name]"

Type 3 — "Recruiter / HR / hiring manager":
"Hi [Name], I recently applied for the [Role] role at [Company]. I'm reaching out to learn more about what the hiring team prioritizes when evaluating candidates. Would you have 10 minutes for a quick call this week?

Best, [Your Name]"

The exemplars are templates. In the output, fill the bracketed slots with the actual recipient name, role title, company name, and student name. Never emit a literal [bracketed placeholder] in any message.

THE BREVITY + SPECIFICS RULE

Every outreach message follows the 4-part shape of the exemplars:
1. Greeting + name
2. Statement of fact: applied for [role] at [company]
3. ONE ask, calibrated to the recipient (stand out / how-they-positioned / evaluation criteria)
4. Time ask: 10 minutes, this week

ONE specific allowed — this is a CEILING, not a target. A message may name AT MOST ONE concrete anchor from the resume, and ONLY when it genuinely sharpens the ask for THAT recipient. Most messages use ZERO.
- Type 1: usually zero. The application is the anchor.
- Type 2: the ONE allowed specific is the credibility bridge (shared school, prior function, similar pivot) — the reason to contact this specific person.
- Type 3: zero. Application-anchored evaluation ask.

Resume specifics DO NOT belong in the cold message. They go in:
- conversation_openers (post-call, where the user actually discusses background)
- why_this_target (strategy reasoning, not user-facing message)

APPLY THIS VOICE TO EVERY USER-FACING MESSAGE FIELD

- linkedin_connection_request: shorter than the exemplar — under 220 characters. State the reason, imply the ask.
- linkedin_message: 3-5 sentences total, matching the exemplar length. If it's longer than the exemplar, it's wrong.
- email_body: same core content as the LinkedIn message with light email framing (greeting + sign-off with name). At most one or two sentences longer than linkedin_message. NOT a background recitation — if you are listing accomplishments, you have failed.
- follow_up_message: one or two lines, written as a second touch 2-3 days after the first — not a restatement.
- email_subject: plain, believable, short.
- conversation_openers: these STAY substantive — they are the post-call questions, exactly 3 per move, where role-specific depth lives. Make them sharp and specific to the real work of the role.

BANNED PHRASES (backstop): no "pick your brain," no "I hope you're well," no "I'd love to learn more," no "I'd value your perspective," no "would appreciate," no fake compliments ("admire your background," "love your journey"), no "any advice would help."

STRUCTURAL REQUIREMENTS

- Exactly 3 moves. Each targets a DIFFERENT lane. Default ladder:
  1) closest to the work (peer currently doing the role)
  2) credibility bridge (shared school, prior function, alumni, pivot)
  3) process owner (recruiter / HR / hiring manager)

- channel_plan: LinkedIn is usually best for discovery; email is stronger once the right person is identified; use Mixed when both make sense. Do NOT invent a specific person's email address.

- linkedin_search_queries: 2-4 realistic queries per move. Combine company + likely title + school/alumni signal (when relevant) + functional keywords from the role. Search strings the student could actually paste into LinkedIn.

- application_state logic:
  - not_applied → insight before applying; do not claim the student already applied
  - applied_today → say they applied; emphasize short, credible outreach within 24 hours
  - applied_recently → say they applied recently; create visibility without sounding desperate
  - interview_stage → reframe asks toward interview preparation; do not ask for a job

USE CONTEXT FOR STRATEGY, NOT FOR STUFFING MESSAGES

The provided CLIENT PROFILE, RESUME, JOBFIT CONTEXT, POSITIONING CONTEXT, and CANDIDATE TARGETING exist to inform:
- which lane each move targets (alumni when a clear school overlap exists; credibility bridge when positioning identified one; etc.)
- conversation_openers (where role-specific and background-specific depth belongs)
- why_this_target (strategy reasoning — internal to the plan, not sent)

They do NOT exist to populate the cold message body. The cold message stays in the exemplar shape.

When CANDIDATE STATUS is provided in the user prompt, treat it as authoritative for framing, strategy, and any field that asserts the candidate's lifecycle position — do not infer student vs graduated from the resume. The forbidden/required framings are listed in the CANDIDATE STATUS block of the user prompt.

YOU MUST RETURN JSON ONLY:
{
  "framing": string,
  "strategy": string,
  "application_state": "not_applied" | "applied_today" | "applied_recently" | "interview_stage",
  "sequence": [{ "day": string, "step": string }],
  "moves": [
    {
      "move_id": string,
      "target_type": string,
      "target_title": string,
      "why_this_target": string,
      "goal": string,
      "timing": string,
      "channel_plan": {
        "primary": "LinkedIn" | "Email" | "Mixed",
        "secondary": "LinkedIn" | "Email" | "",
        "why": string
      },
      "linkedin_search_queries": string[],
      "linkedin_connection_request": string,
      "linkedin_message": string,
      "email_subject": string,
      "email_body": string,
      "follow_up_message": string,
      "conversation_openers": string[]
    }
  ]
}

OUTPUT QUALITY BAR: the student should read each message and think "I would actually send this." Brevity is correctness; resume-dumping is the failure mode.
    `.trim()

    const user = `
CLIENT PROFILE:
${profile}

${buildCandidateStatusBlock(candidateStatus)}

RESUME:
${resumeText || "(no resume on file for this user)"}

JOB DESCRIPTION:
${job}

APPLICATION STATE:
${applicationState}

JOBFIT CONTEXT:
${JSON.stringify(jobfitContext, null, 2)}

POSITIONING CONTEXT:
${JSON.stringify(positioningContext, null, 2)}

CANDIDATE TARGETING:
${JSON.stringify(candidateTargeting, null, 2)}

NETWORKING CONTEXT:
${JSON.stringify(networkingContext, null, 2)}

TASK:
Generate the networking execution plan now.
Return JSON only.
Exactly 3 moves.
Make the messages feel specifically grounded in this user and this role.
    `.trim()

    const aiResult = await invokeClaude({
      systemPrompt: system,
      userPrompt: user,
      maxTokens: MAX_TOKENS_GENERATION,
      temperature: TEMPERATURE_MAIN,
    })

    console.log(
      `[networking] generation cost cents=${centsForUsage(aiResult.usage)} input_tokens=${aiResult.usage.input_tokens} output_tokens=${aiResult.usage.output_tokens} latency_ms=${aiResult.latencyMs}`
    )

    const raw = aiResult.text
    let parsed = safeJsonParse(raw)

    if (!parsed) {
      parsed = await repairToJson(raw, applicationState)
    }

    let plan = normalizePlan(parsed, applicationState)

    // ── Shape-and-voice validation (v8) ───────────────────────────────
    // On validation failure: regenerate ONCE at higher temperature, parse +
    // normalize the retry, validate again. If the retry still fails we
    // accept it as best-effort (never block the user) and log a structured
    // violation marker per failed check so we can monitor cap drift.
    let validation = validatePlan(plan)
    if (!validation.ok) {
      console.log(
        `[networking] validation failed attempt=1 violations=${validation.violations.length}`
      )
      for (const v of validation.violations) {
        console.log(
          `[networking] validation_violation attempt=1 move=${v.move_id} field=${v.field} reason=${v.reason} detail="${v.detail}"`
        )
      }

      const retryResult = await invokeClaude({
        systemPrompt: system,
        userPrompt: user,
        maxTokens: MAX_TOKENS_GENERATION,
        temperature: TEMPERATURE_MAIN_RETRY,
      })

      console.log(
        `[networking] retry generation cost cents=${centsForUsage(retryResult.usage)} input_tokens=${retryResult.usage.input_tokens} output_tokens=${retryResult.usage.output_tokens} latency_ms=${retryResult.latencyMs}`
      )

      const retryRaw = retryResult.text
      let retryParsed = safeJsonParse(retryRaw)
      if (!retryParsed) {
        retryParsed = await repairToJson(retryRaw, applicationState)
      }
      plan = normalizePlan(retryParsed, applicationState)

      validation = validatePlan(plan)
      if (validation.ok) {
        console.log(`[networking] retry validation passed`)
      } else {
        // Best-effort accept. Per task spec: never block the user; log so
        // we can monitor cap drift in production.
        for (const v of validation.violations) {
          console.log(
            `[networking] validation_failed_after_retry move=${v.move_id} field=${v.field} reason=${v.reason} detail="${v.detail}"`
          )
        }
      }
    }

    const { error: insertErr } = await supabaseAdmin
      .from("networking_runs")
      .insert({
        client_profile_id: profileId,
        job_url: null,
        fingerprint_hash,
        fingerprint_code,
        result_json: plan,
      })

    if (insertErr) {
      console.warn("networking_runs insert failed:", insertErr.message)
    }

    // Track successful run
    // TODO(analytics-phase-2): replace with analytics_events insert per docs/signal-analytics-spec.md
    // Previous behavior: INSERT into jobfit_page_views with the payload below
    console.log('[analytics:deferred]', {
      call_site: 'app/api/networking/route.ts:922',
      would_have_written: {
        session_id: String(profileId || crypto.randomUUID()),
        page_name: "networking_run",
        page_path: "/api/networking",
        referrer: null,
      },
    })

    return withCorsJson(
      req,
      {
        ...plan,
        fingerprint_code,
        fingerprint_hash,
        reused: false,
      },
      200
    )
  } catch (err: any) {
    const detail = err?.message || String(err)

    const lower = String(detail).toLowerCase()
    const status = lower.includes("unauthorized")
      ? 401
      : lower.includes("profile not found")
        ? 404
        : lower.includes("access disabled")
          ? 403
          : 500

    return withCorsJson(req, { error: "Networking failed", detail }, status)
  }
}