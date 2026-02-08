import { getAuthedProfileText } from "../_lib/authProfile"
import OpenAI from "openai"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * The Responses API can return text in different shapes depending on SDK versions.
 * This extractor keeps your endpoint resilient without changing UI assumptions.
 */
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
 * Ensures we always return a complete plan with exactly 3 actions,
 * even if the model returns partial data.
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
    actions: [
      {
        ladder_rung: "Closest to the work",
        target_roles: ["Recent hire in the same function/team", "Someone doing the role now"],
        person_to_pick: "Recent hire (0–2 years) or current team member doing the work.",
        rationale:
          "Closest to the work gives you the real expectations and what actually helps candidates stand out.",
        channel: {
          primary: "LinkedIn",
          why: "Best for finding the right person quickly. Email can come after you confirm the company’s format.",
          email_schema_guidance: {
            likely_formats: ["first.last@company.com", "first@company.com"],
            how_to_verify:
              "Check press releases, investor relations PDFs, or the company website for any staff emails. Confirm the format before sending.",
            caution: "Do not guess a specific person’s email. Verify the company pattern first.",
          },
        },
        search_terms: [
          'site:linkedin.com/in "Company" ("Analyst" OR "Associate")',
          '"Company" "Analyst" "Team keyword" LinkedIn',
        ],
        message: {
          initial:
            "Hi [Name] — I applied for the [Role] role at [Company]. I’m reaching out directly because you’re close to the work on the team. Could I grab 10 minutes this week to learn how the team actually thinks about this role and what helps candidates stand out?",
          follow_up:
            "Quick follow-up — I applied for [Role] and wanted to see if you’d be open to 10 minutes to share what helps candidates stand out on your team.",
        },
        conversation: {
          questions: [
            "What actually matters most for this team when they’re reviewing candidates?",
            "What do strong candidates do differently that most applicants miss?",
          ],
        },
      },
      {
        ladder_rung: "Influence adjacent",
        target_roles: ["Senior IC / Team Lead in the function", "Cross-functional partner who works with the team"],
        person_to_pick: "Senior IC, team lead, or close partner who influences the hiring manager informally.",
        rationale:
          "Influence-adjacent people help your name travel internally and tell you what signals create traction.",
        channel: {
          primary: "Email",
          why: "Email often gets higher response than DMs once you have the right person and verified company format.",
          email_schema_guidance: {
            likely_formats: ["first.last@company.com", "first_last@company.com", "first@company.com"],
            how_to_verify:
              "Look for any publicly listed employee emails (press, media kit, conference bios) to infer the pattern. Verify using at least two examples before emailing.",
            caution: "Don’t send the same message on LinkedIn and email. Pick one channel.",
          },
        },
        search_terms: [
          'site:linkedin.com/in "Company" ("Senior" OR "Lead") ("Title keyword")',
          '"Company" "Team Lead" "Function" LinkedIn',
        ],
        message: {
          initial:
            "Hi [Name] — I applied for the [Role] at [Company]. I’m reaching out because your work is closely connected to the team. Could I grab 10 minutes to learn what actually helps candidates stand out for this role and what the team cares about most?",
          follow_up:
            "Following up — I applied for [Role] and wanted to see if you’d be open to 10 minutes to share what helps candidates stand out for your team.",
        },
        conversation: {
          questions: [
            "What signals make someone stand out quickly for this role?",
            "If you were advising a candidate, what would you tell them to focus on in the first 30 days of the role?",
          ],
        },
      },
      {
        ladder_rung: "Process owner",
        target_roles: ["Recruiter aligned to the function/program", "Early career / program manager if program-based"],
        person_to_pick: "The recruiter/program owner responsible for this role family, not a random HR contact.",
        rationale:
          "Process owners can clarify timing and how to avoid getting buried, especially in program or high-volume pipelines.",
        channel: {
          primary: "Email",
          why: "Recruiting teams are built around email workflows. It’s the most natural channel for process questions.",
          email_schema_guidance: {
            likely_formats: ["first.last@company.com", "first@company.com"],
            how_to_verify:
              "Company careers pages sometimes list recruiter contact formats; otherwise infer from public examples. Verify pattern before sending.",
            caution: "Do not ask for a referral. Do not ask them to ‘pull’ your app. Keep it about process and standing out.",
          },
        },
        search_terms: [
          '"Company" recruiter "Function"',
          'site:linkedin.com/in "Company" recruiter ("campus" OR "early career" OR "university")',
        ],
        message: {
          initial:
            "Hi [Name] — I applied for the [Role] at [Company]. I wanted to reach out directly to understand the timeline and what helps candidates stand out as the team reviews applications. Could I grab 10 minutes this week to make sure I’m focusing on the right things?",
          follow_up:
            "Quick follow-up — I applied for [Role] and wanted to see if you’d be open to 10 minutes to share timeline and what helps candidates stand out in this process.",
        },
        conversation: {
          questions: [
            "What does the timeline look like from here and when are interviews typically scheduled?",
            "What do candidates who move forward usually do differently in how they present their experience?",
          ],
        },
      },
    ],
  }

  const out: any = { ...fallback }

  if (parsed && typeof parsed === "object") {
    if (typeof parsed.framing === "string" && parsed.framing.trim()) out.framing = parsed.framing.trim()
    if (typeof parsed.note === "string" && parsed.note.trim()) out.note = parsed.note.trim()

    if (Array.isArray(parsed.sequence) && parsed.sequence.length) {
      out.sequence = parsed.sequence
        .filter((x: any) => x && typeof x === "object")
        .slice(0, 6)
        .map((x: any) => ({
          day: String(x.day || "").trim(),
          step: String(x.step || "").trim(),
        }))
        .filter((x: any) => x.day && x.step)
      if (!out.sequence.length) out.sequence = fallback.sequence
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

  // Ensure exactly 3 actions
  while (out.actions.length < 3) out.actions.push(fallback.actions[out.actions.length])
  out.actions = out.actions.slice(0, 3)

  // Light sanity fill for required strings
  if (!out.framing) out.framing = fallback.framing
  if (!out.note) out.note = fallback.note

  return out
}

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: Request) {
  try {
    // ✅ Auth + stored profile (server-side)
    const { profileText } = await getAuthedProfileText(req)
    const profile = profileText

    // ✅ Client sends only { job }
    const body = await req.json()
    const job = String(body?.job || "").trim()

    if (!job) {
      return withCorsJson(req, { error: "Missing job" }, 400)
    }

    const system = `
You are WRNSignal (Networking module). You produce a networking PLAN for ONE job.

CORE PHILOSOPHY (LOCKED):
- Networking is post-apply. You can generate anytime, but always reinforce: applying is ~20%, networking after applying is ~80%.
- We are "appropriately aggressive":
  - We explicitly say we applied.
  - We ask for 10 minutes.
  - We want to learn about the team/company and what helps candidates stand out.
  - We do NOT ask for a job, referral, or resume review.
  - We do NOT do fake curiosity ("your path is so interesting") or flattery.

YOU MUST OUTPUT A PLAN, NOT TIPS:
- Provide a short framing line and a short note.
- Provide a sequenced execution plan (days + steps).
- Provide EXACTLY 3 actions using the ladder:
  1) Closest to the work
  2) Influence adjacent
  3) Process owner
- Each action must include:
  - ladder_rung
  - target_roles (role titles to search for)
  - person_to_pick (what kind of person to select: recent hire, senior IC, etc.)
  - rationale (why this rung matters)
  - channel recommendation (LinkedIn vs Email)
    - LinkedIn is best for discovery, email is often best for response.
    - You may provide email SCHEMA GUIDANCE (likely formats) and HOW TO VERIFY.
    - You must NOT output guessed personal email addresses.
  - search_terms (LinkedIn / Google search strings to find the right person)
  - message.initial and message.follow_up:
    - Student voice, direct, short.
    - MUST state they applied.
    - MUST ask for 10 minutes.
    - MUST ask to learn about team/company and how to stand out.
    - No "hope you're well", no exclamation points, no buzzwords, no "pick your brain".
    - Follow-up is one follow-up only, 48–72 hours later, shorter than initial.
  - conversation.questions (2–4 questions for the 10-minute chat)

JOBFIT MODIFIERS (IMPORTANT):
- If JobFit is APPROVE: more direct, closer to decision influence, but still student voice.
- If JobFit is REVIEW: peer-first emphasis, focus on what stands out and how to frame experience.
- If JobFit is PASS: plan becomes exploratory. Still state you applied ONLY if user did. Otherwise: learn what matters before investing more; do not push recruiters.

EXECUTIVE/SENIOR OUTREACH:
- Allowed only when appropriate (small company, founder-led, close to the work).
- If suggested, keep messages extra short and still student-credible.

OUTPUT:
Return valid JSON only. No markdown. No extra commentary.
`.trim()

    const user = `
CLIENT PROFILE:
${profile}

JOB DESCRIPTION:
${job}

TASK:
Generate a networking PLAN using the rules. Produce exactly 3 actions, each with ladder_rung and all required fields.
Assume the student has applied unless the job text clearly indicates otherwise.
Return JSON only.
`.trim()

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // If your SDK supports it, this keeps the shape consistent without changing UI.
      // If not supported in your environment, you can remove response_format and rely on safeJsonParse fallback.
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "wrnsignal_networking_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              framing: { type: "string" },
              note: { type: "string" },
              sequence: {
                type: "array",
                minItems: 2,
                maxItems: 8,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    day: { type: "string" },
                    step: { type: "string" },
                  },
                  required: ["day", "step"],
                },
              },
              actions: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    ladder_rung: { type: "string" },
                    target_roles: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
                    person_to_pick: { type: "string" },
                    rationale: { type: "string" },
                    channel: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        primary: { type: "string" },
                        why: { type: "string" },
                        email_schema_guidance: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            likely_formats: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6 },
                            how_to_verify: { type: "string" },
                            caution: { type: "string" },
                          },
                          required: ["likely_formats", "how_to_verify", "caution"],
                        },
                      },
                      required: ["primary", "why", "email_schema_guidance"],
                    },
                    search_terms: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
                    message: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        initial: { type: "string" },
                        follow_up: { type: "string" },
                      },
                      required: ["initial", "follow_up"],
                    },
                    conversation: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        questions: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
                      },
                      required: ["questions"],
                    },
                  },
                  required: [
                    "ladder_rung",
                    "target_roles",
                    "person_to_pick",
                    "rationale",
                    "channel",
                    "search_terms",
                    "message",
                    "conversation",
                  ],
                },
              },
            },
            required: ["framing", "note", "sequence", "actions"],
          },
        },
      },
    })

    const raw = extractOutputText(resp)
    const parsed = safeJsonParse(raw)

    // If schema mode returns parsed JSON differently in your SDK/env, try to fall back gracefully:
    const plan = normalizePlan(parsed || safeJsonParse(raw) || null)

    return withCorsJson(req, plan, 200)
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
