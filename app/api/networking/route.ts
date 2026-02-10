// app/api/networking/route.ts
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { getAuthedProfileText } from "../_lib/authProfile"
import OpenAI from "openai"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const MISSING = "__MISSING__"
const NETWORKING_PROMPT_VERSION = "networking_v1_2026_02_10"
const MODEL_ID = "current"

// Supabase (service role)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

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
  if (typeof resp?.output_text === "string" && resp.output_text.trim()) return resp.output_text

  const output = resp?.output
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "output_text" && typeof c?.text === "string" && c.text.trim()) {
            return c.text
          }
        }
      }
    }
  }
  return ""
}

/**
 * Normalize values for deterministic fingerprinting
 */
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

  const fingerprint_hash = crypto.createHash("sha256").update(canonical).digest("hex")
  const fingerprint_code =
    "NW-" + parseInt(fingerprint_hash.slice(0, 10), 16).toString(36).toUpperCase()

  return { fingerprint_hash, fingerprint_code }
}

/**
 * Basic shape guard + fill defaults. Keeps UI stable.
 */
function normalizePlan(parsed: any) {
  const fallback = {
    framing: "Here’s how you stop being just another application.",
    note:
      "Applying gets you logged. Networking gets you remembered. Treat applying as ~20% and networking after you apply as ~80%.",
    sequence: [
      { day: "Day 0", step: "Send Action 1 and Action 2." },
      { day: "Day 2", step: "Follow up Action 1 (one follow-up only)." },
      { day: "Day 5–6", step: "Send Action 3." },
      { day: "Day 7", step: "Follow up Action 2 if needed (then stop)." },
    ],
    actions: [],
  }

  const out: any = { ...fallback }

  if (parsed && typeof parsed === "object") {
    if (typeof parsed.framing === "string" && parsed.framing.trim()) out.framing = parsed.framing.trim()
    if (typeof parsed.note === "string" && parsed.note.trim()) out.note = parsed.note.trim()

    if (Array.isArray(parsed.sequence) && parsed.sequence.length) {
      const seq = parsed.sequence
        .filter((x: any) => x && typeof x === "object")
        .map((x: any) => ({ day: String(x.day || "").trim(), step: String(x.step || "").trim() }))
        .filter((x: any) => x.day && x.step)
        .slice(0, 8)
      if (seq.length) out.sequence = seq
    }

    if (Array.isArray(parsed.actions)) {
      out.actions = parsed.actions.slice(0, 3).map((a: any) => ({
        ladder_rung: String(a?.ladder_rung || "").trim(),
        target_roles: Array.isArray(a?.target_roles) ? a.target_roles.map((r: any) => String(r || "").trim()).filter(Boolean) : [],
        person_to_pick: String(a?.person_to_pick || "").trim(),
        rationale: String(a?.rationale || "").trim(),
        channel: {
          primary: String(a?.channel?.primary || "").trim(),
          why: String(a?.channel?.why || "").trim(),
          email_schema_guidance: {
            likely_formats: Array.isArray(a?.channel?.email_schema_guidance?.likely_formats)
              ? a.channel.email_schema_guidance.likely_formats.map((f: any) => String(f || "").trim()).filter(Boolean)
              : [],
            how_to_verify: String(a?.channel?.email_schema_guidance?.how_to_verify || "").trim(),
            caution: String(a?.channel?.email_schema_guidance?.caution || "").trim(),
          },
        },
        search_terms: Array.isArray(a?.search_terms) ? a.search_terms.map((s: any) => String(s || "").trim()).filter(Boolean) : [],
        message: {
          initial: String(a?.message?.initial || "").trim(),
          follow_up: String(a?.message?.follow_up || "").trim(),
        },
        conversation: {
          questions: Array.isArray(a?.conversation?.questions)
            ? a.conversation.questions.map((q: any) => String(q || "").trim()).filter(Boolean).slice(0, 4)
            : [],
        },
      }))
    }
  }

  // Ensure exactly 3 actions with minimal structure
  while (out.actions.length < 3) {
    out.actions.push({
      ladder_rung: "",
      target_roles: [],
      person_to_pick: "",
      rationale: "",
      channel: {
        primary: "",
        why: "",
        email_schema_guidance: { likely_formats: [], how_to_verify: "", caution: "" },
      },
      search_terms: [],
      message: { initial: "", follow_up: "" },
      conversation: { questions: [] },
    })
  }
  out.actions = out.actions.slice(0, 3)

  return out
}

/**
 * If the model returns non-JSON, run a cheap "repair" call that converts to strict JSON.
 * This dramatically reduces flaky outputs without relying on response_format support.
 */
async function repairToJson(raw: string) {
  const repairSystem = `
You are a JSON repair tool. Convert the user's content into valid JSON matching this exact schema.
Return JSON only. No markdown. No commentary.

SCHEMA:
{
  "framing": string,
  "note": string,
  "sequence": [{ "day": string, "step": string }],
  "actions": [
    {
      "ladder_rung": string,
      "target_roles": string[],
      "person_to_pick": string,
      "rationale": string,
      "channel": {
        "primary": "LinkedIn" | "Email" | string,
        "why": string,
        "email_schema_guidance": {
          "likely_formats": string[],
          "how_to_verify": string,
          "caution": string
        }
      },
      "search_terms": string[],
      "message": { "initial": string, "follow_up": string },
      "conversation": { "questions": string[] }
    },
    { ... }, { ... }
  ]
}

RULES:
- actions must be exactly 3 items (pad with empty items if missing).
- sequence should be 2-8 items (use reasonable defaults if missing).
- Keep text concise. Preserve intent. Do not invent personal email addresses.
  `.trim()

  const repairUser = `
Convert the following into JSON matching the schema. If content is incomplete, infer missing structure conservatively.

RAW:
${raw}
  `.trim()

  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
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
    const { profileId, profileText } = await getAuthedProfileText(req)
    const profile = profileText

    const body = await req.json()
    const job = String(body?.job || "").trim()

    if (!job) return withCorsJson(req, { error: "Missing job" }, 400)

    // ---------- Fingerprint pins ----------
    const fingerprintPayload = {
      job: { text: job || MISSING },
      profile: { id: profileId || MISSING, text: profileText || MISSING },
      system: {
        networking_prompt_version: NETWORKING_PROMPT_VERSION,
        model_id: MODEL_ID,
      },
    }

    const { fingerprint_hash, fingerprint_code } = buildNetworkingFingerprint(fingerprintPayload)

    // 1) Lookup existing run
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
You are WRNSignal (Networking module). You generate a networking PLAN for ONE job.

CORE PHILOSOPHY (LOCKED):
- Networking is post-apply. Reinforce: applying is ~20%, networking after you apply is ~80%.
- "Appropriately aggressive" means:
  - Explicitly say: I applied.
  - Ask for 10 minutes.
  - Ask to learn about the team/company and what helps candidates stand out.
  - No job ask. No referral ask. No resume ask.
  - No fake curiosity. No flattery. No "hope you're well". No exclamation points.

YOU MUST OUTPUT A PLAN, NOT TIPS:
Return valid JSON only with:
{
  "framing": string,
  "note": string,
  "sequence": [{ "day": string, "step": string }],
  "actions": [
    {
      "ladder_rung": "Closest to the work" | "Influence adjacent" | "Process owner",
      "target_roles": string[],
      "person_to_pick": string,
      "rationale": string,
      "channel": {
        "primary": "LinkedIn" | "Email",
        "why": string,
        "email_schema_guidance": {
          "likely_formats": string[],
          "how_to_verify": string,
          "caution": string
        }
      },
      "search_terms": string[],
      "message": { "initial": string, "follow_up": string },
      "conversation": { "questions": string[] }
    },
    { ... }, { ... }
  ]
}

LADDER (EXACTLY 3 ACTIONS, IN THIS ORDER):
1) Closest to the work
2) Influence adjacent
3) Process owner

PLAN REQUIREMENTS:
- framing should use:
  - APPROVE/REVIEW tone: "Here’s how you stop being just another application."
  - PASS tone: "Here’s how to learn what actually matters before you invest more effort."
(If you cannot infer JobFit, default to APPROVE/REVIEW tone.)

- sequence must be a real plan (timing + steps). Default:
  Day 0: send actions 1 and 2
  Day 2: follow up action 1 (one follow-up only)
  Day 5–6: send action 3
  Day 7: follow up action 2 if needed, then stop

CHANNEL LOGIC:
- LinkedIn is best for discovery (finding names).
- Email is often better for response once the person is identified.
- You MAY provide likely email formats and how to verify the company pattern.
- You MUST NOT guess a specific person's email address.

STUDENT VOICE:
- Must sound like a student (direct, plainspoken).
- No corporate jargon, no "pick your brain", no compliments.
- The initial message must:
  - say they applied
  - ask for 10 minutes
  - ask to learn about team/company and what helps candidates stand out
- follow_up must:
  - be shorter than initial
  - happen 48–72 hours later
  - be one follow-up only

EXEC/SENIOR OUTREACH:
- Allowed when appropriate (small company, founder-led, close to the work).
- If used, keep messages extra short and still student-credible.

RETURN JSON ONLY.
    `.trim()

    const user = `
CLIENT PROFILE:
${profile}

JOB DESCRIPTION:
${job}

TASK:
Generate the networking plan JSON now. Exactly 3 actions in the ladder order.
    `.trim()

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })

    const raw = extractOutputText(resp)
    let parsed = safeJsonParse(raw)

    // Repair if non-JSON
    if (!parsed) {
      parsed = await repairToJson(raw)
    }

    const plan = normalizePlan(parsed)

    // 2) Cache the result
    const { error: insertErr } = await supabaseAdmin.from("networking_runs").insert({
      client_profile_id: profileId,
      job_url: null,
      fingerprint_hash,
      fingerprint_code,
      result_json: plan,
    })

    if (insertErr) {
      console.warn("networking_runs insert failed:", insertErr.message)
    }

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
    const status =
      lower.includes("unauthorized")
        ? 401
        : lower.includes("profile not found")
          ? 404
          : lower.includes("access disabled")
            ? 403
            : 500

    return withCorsJson(req, { error: "Networking failed", detail }, status)
  }
}
