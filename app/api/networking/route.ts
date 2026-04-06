import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { getAuthedProfileText } from "../_lib/authProfile"
import OpenAI from "openai"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const MISSING = "__MISSING__"
const NETWORKING_PROMPT_VERSION = "networking_v4_2026_03_16"
const MODEL_ID = "gpt-4.1-mini"

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

function extractOutputText(resp: any): string {
  if (typeof resp?.output_text === "string" && resp.output_text.trim()) {
    return resp.output_text
  }

  const output = resp?.output
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content
      if (Array.isArray(content)) {
        for (const c of content) {
          if (
            c?.type === "output_text" &&
            typeof c?.text === "string" &&
            c.text.trim()
          ) {
            return c.text
          }
        }
      }
    }
  }

  return ""
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

  const resp = await client.responses.create({
    model: MODEL_ID,
    input: [
      { role: "system", content: repairSystem },
      { role: "user", content: repairUser },
    ],
  })

  const repairedText = extractOutputText(resp)
  return safeJsonParse(repairedText)
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
    }

    const profile = profileText
    const job = String(body?.job || "").trim()
    const applicationState = detectApplicationState(body?.application_state)

    const jobfitContext = body?.jobfit_context ?? {}
    const positioningContext = body?.positioning_context ?? {}
    const networkingContext = body?.networking_context ?? {}

    if (!job) {
      return withCorsJson(req, { error: "Missing job" }, 400)
    }

    const fingerprintPayload = {
      job: { text: job || MISSING },
      profile: { id: profileId || MISSING, text: profileText || MISSING },
      application_state: applicationState || MISSING,
      jobfit_context: jobfitContext || MISSING,
      positioning_context: positioningContext || MISSING,
      networking_context: networkingContext || MISSING,
      system: {
        networking_prompt_version: NETWORKING_PROMPT_VERSION,
        model_id: MODEL_ID,
      },
    }

    const { fingerprint_hash, fingerprint_code } =
      buildNetworkingFingerprint(fingerprintPayload)

    const { data: existingRun, error: findErr } = await supabaseAdmin
      .from("networking_runs")
      .select("result_json, fingerprint_code, fingerprint_hash, created_at")
      .eq("client_profile_id", profileId)
      .eq("fingerprint_hash", fingerprint_hash)
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

LOCKED PRODUCT PHILOSOPHY:
- This is tactical job search execution.
- Do not give generic networking advice.
- Produce output the student would actually send.
- Every move must feel specific to the student's background, the job, and the application moment.
- No fluff.
- No fake enthusiasm.
- No compliments.
- No "hope you're well."
- No exclamation points.
- No "pick your brain."
- Direct, credible, student-appropriate tone.

WRN NETWORKING PHILOSOPHY:

This product follows the Workforce Ready Now networking style.

The student is APPROPRIATELY AGGRESSIVE.

That means:

- They are clear about why they are reaching out.
- They are transparent that they applied or are pursuing the role.
- They are trying to get hired.
- They ask for specific help.

They are NOT passive.

They DO ask for:
- advice
- guidance
- insight
- perspective
- introductions
- what makes candidates stand out
- how the team actually evaluates candidates

They DO NOT:

- pretend interest just to start a conversation
- use false flattery
- compliment the company generically
- say things like “I admire your background”
- say things like “I’d love to learn more about your journey”

This is not networking theater.

This is job search execution.

Every outreach message should clearly signal:

1. why the student is reaching out
2. what they are trying to understand
3. what specific help or perspective they want

WRN NETWORKING PHILOSOPHY:

This product follows the Workforce Ready Now networking style.

The student is APPROPRIATELY AGGRESSIVE.

They are transparent that they applied or are pursuing the role and they
are actively trying to get hired.

They do not hide the purpose of the outreach.

They do not use false flattery, networking theater, or pretend curiosity.

They are direct about wanting insight that will help them compete for the role.

They frequently ask for:

- advice
- guidance
- insight into the team
- how candidates actually stand out
- how the role really works day-to-day
- what hiring managers evaluate
- how to position their experience
- who else they should speak with

This is job search execution, not casual networking.

WRN CONVERSATION OBJECTIVE RULE:

The objective of every outreach message is to secure a short conversation.

Every outreach must include a clear request for time to talk.

Examples of acceptable asks:

- "Would you be open to a quick 10-minute call?"
- "Would you have 10 minutes to share how the team evaluates analysts?"
- "Could I grab 10 minutes of your perspective on the role?"
- "If you have 10 minutes sometime this week, I’d value your perspective."

The request must be:

- direct
- short
- specific about time
- framed around learning something useful for the role

OBJECTIVE:
Help the student convert an application into a real human conversation.

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

MOVE REQUIREMENTS:
- Exactly 3 moves.
- Each move must target a DIFFERENT lane.
- Prefer this ladder unless the job context strongly suggests a better one:
  1) closest to the work
  2) credibility bridge
  3) process owner

CUSTOMIZATION RULES:
- Each move must reference at least one concrete detail from:
  - the candidate profile, or
  - the job description, or
  - the positioning/jobfit context
- Do not write reusable template language.
- Messages must sound different across moves.
- If the candidate has a stronger credibility bridge such as alumni, shared background, adjacent function, or location overlap, use it.

APPLICATION STATE LOGIC:
- not_applied:
  - goal is insight before applying or before investing more time
  - do not claim the student already applied
- applied_today:
  - say they applied
  - emphasize short, credible outreach within 24 hours
- applied_recently:
  - say they applied recently
  - aim to create visibility without sounding desperate
- interview_stage:
  - outreach should gather team/process insight to help interview performance
  - do not ask for a job
  - make the conversation purpose more interview-prep oriented

MESSAGE RULES:
- linkedin_connection_request:
  - short enough for a connection request
  - credible and specific
- linkedin_message:
  - longer than connection request
  - should sound like a real message someone would send after connecting or as InMail
- email_subject:
  - plain and believable
- email_body:
  - complete draft, but do not invent any email address
- follow_up_message:
  - shorter than the main message
  - one follow-up only
  - 48-72 hours later
- conversation_openers:
  - exactly 3 concise questions
  - useful if the person replies yes

CHANNEL RULES:
- LinkedIn is usually best for discovery.
- Email can be stronger once the right person is identified.
- Do not invent a specific person's email address.
- Use Mixed when both channels make sense.

MESSAGE DIFFERENTIATION RULES:
- Each move must sound materially different in tone and purpose.
- Move 1 should sound role-close and work-specific.
- Move 2 should sound affiliation-based and lower friction.
- Move 3 should sound process-aware and concise.
- Do not reuse the same opening phrase across moves.
- Do not reuse “I applied,” “I recently applied,” or “would appreciate” in more than one move.
- Do not reuse the same ask structure across moves.

ANTI-TEMPLATE RULES:
- Avoid generic networking phrases.
- Do not use:
  - "I hope you're well"
  - "pick your brain"
  - "I’d love to learn more"
  - "would appreciate 10 minutes"
  - "just wanted to reach out"
  - "any advice"
  - "next steps"
  - "thank you for your time and consideration"
- Messages must read like a credible student, not a polished template.
- Use shorter sentences.
- Prefer specificity over polish.

GROUNDING RULES:
- Every move must include at least 2 concrete anchors drawn from:
  - school
  - major
  - prior internship or work experience
  - specific skill from profile
  - specific responsibility from the job
  - specific risk or strength from jobfit_context
  - specific angle from positioning_context
- If there are not enough strong anchors, keep the message shorter rather than generic.

CHANNEL DISTINCTION RULES:
- LinkedIn connection request must be short, specific, and lower-friction.
- LinkedIn full message should feel conversational and human.
- Email should be more structured and complete.
- Do not restate the same wording across LinkedIn and email.

LINKEDIN SEARCH RULES:
- For each move, generate 2-4 realistic search queries.
- Queries should combine:
  - company
  - likely title
  - school/alumni signal when relevant
  - functional keywords from the role
- Prefer practical search strings a student could actually use on LinkedIn.
- Avoid overly broad queries.

CONVERSATION OPENER RULES:
- Each move must include exactly 3 questions.
- Questions must not be generic.
- At least one question must connect directly to the role’s real work.
- At least one question must help the student understand how candidates stand out.
- Do not ask broad life-story questions.

APPROPRIATE AGGRESSION RULE:

Outreach should make a clear ask.

Every message must contain ONE concrete ask such as:

- advice on how candidates stand out
- perspective on the team's evaluation criteria
- guidance on the role's real day-to-day work
- insight into the hiring process
- suggestions on how to position relevant experience
- whether the person would recommend someone else to speak with

Do not end messages passively.
Do not end with vague curiosity.
Always ask for something useful.

CONVERSATION ASK REQUIREMENT:

Every message must end with a request for a short conversation.

The conversation ask should be:

- 10 minutes
- short call or quick chat
- framed around learning something specific about the role

Do not leave the message open-ended.

Incorrect:
"Any insight would be helpful."

Correct:
"Would you have 10 minutes to share how analysts actually approach underwriting on the team?"

ASK TYPE RULES:
- Move 1 must ask about the real work.
- Move 2 must ask about entry path, credibility, or how to position relevant experience.
- Move 3 must ask about evaluation criteria, process, or who else to speak with.
- Do not let all 3 moves ask the same style of question.
- Each move must have a distinct informational goal.

CONNECTION REQUEST RULES:
- Connection requests must still feel purposeful.
- They do not need to ask multiple questions.
- They should state the reason for reaching out and imply the request to talk.
- Keep them under 220 characters.
- Avoid sounding robotic or resume-like.

STUDENT VOICE RULES:
- Write like a sharp college student.
- Do not use overly polished phrases such as:
  - "could best translate here"
  - "seeking insight"
  - "would value your perspective"
  - "could you share any guidance"
- Prefer plain language.

NO PASSIVE ENDINGS:

Messages must not end with vague phrases such as:

- "Any advice would help."
- "Any insight would be appreciated."
- "Would love to learn more."
- "Would value your perspective."

All messages must end with a specific time ask for a short conversation.

NO NETWORKING THEATER:

Do not write messages that pretend to be curious just to start a conversation.

Do not compliment the company or the person’s background.

Do not say:

- "I admire your career path"
- "Your background is impressive"
- "I’d love to learn about your journey"

Messages must focus on the role, the work, or the hiring process.

WRN DIRECTNESS RULE:

The student should be transparent about why they are reaching out.

They applied or are pursuing the role and want to understand how to stand out.

They should not hide the objective of getting hired.

OUTPUT QUALITY BAR:
- This should feel like a tactical execution engine, not a coach giving advice.
- The student should think: "I would actually send this."
    `.trim()

    const user = `
CLIENT PROFILE:
${profile}

JOB DESCRIPTION:
${job}

APPLICATION STATE:
${applicationState}

JOBFIT CONTEXT:
${JSON.stringify(jobfitContext, null, 2)}

POSITIONING CONTEXT:
${JSON.stringify(positioningContext, null, 2)}

NETWORKING CONTEXT:
${JSON.stringify(networkingContext, null, 2)}

TASK:
Generate the networking execution plan now.
Return JSON only.
Exactly 3 moves.
Make the messages feel specifically grounded in this user and this role.
    `.trim()

    const resp = await client.responses.create({
      model: MODEL_ID,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })

    const raw = extractOutputText(resp)
    let parsed = safeJsonParse(raw)

    if (!parsed) {
      parsed = await repairToJson(raw, applicationState)
    }

    const plan = normalizePlan(parsed, applicationState)

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
    try {
      await supabaseAdmin.from("jobfit_page_views").insert({
        session_id: String(profileId || crypto.randomUUID()),
        page_name: "networking_run",
        page_path: "/api/networking",
        referrer: null,
      })
    } catch {}

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