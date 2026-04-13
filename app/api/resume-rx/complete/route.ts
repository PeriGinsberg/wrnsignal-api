// app/api/resume-rx/complete/route.ts
// POST /api/resume-rx/complete
// Assembles final resume and generates coaching summary.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { PERI_SYSTEM_PROMPT } from "@/lib/resume-rx-prompt"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string

  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles")
      .select("id, user_id")
      .eq("email", email)
      .maybeSingle()
    if (emailErr) throw new Error(`Profile email lookup failed: ${emailErr.message}`)
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        const { error: attachErr } = await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
        if (attachErr) throw new Error(`Profile attach failed: ${attachErr.message}`)
      }
      return byEmail.id as string
    }
  }

  throw new Error("Profile not found")
}

function stripJsonFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim()
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { error: "Invalid JSON body" }, 400)
    }

    const session_id = String(body.session_id || "").trim()
    if (!session_id) return withCorsJson(req, { error: "session_id is required" }, 400)

    const supabase = getSupabaseAdmin()

    // Verify session ownership
    const { data: session, error: sessionErr } = await supabase
      .from("resume_rx_sessions")
      .select("id, profile_id, status, mode, year_in_school, target_field, original_resume_text, diagnosis, education_intake, architecture, qa_items, approved_bullets")
      .eq("id", session_id)
      .maybeSingle()

    if (sessionErr) throw new Error(`Session lookup failed: ${sessionErr.message}`)
    if (!session) return withCorsJson(req, { error: "Session not found" }, 404)
    if (session.profile_id !== profileId) return withCorsJson(req, { error: "Forbidden" }, 403)

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const approvedBullets: any[] = Array.isArray(session.approved_bullets) ? session.approved_bullets : []
    const approvedBulletsText = approvedBullets.map((b: any) => `- ${b.text}`).join("\n")

    const educationProposal = session.education_intake?.proposal
    const educationLines = educationProposal?.formatted_lines
      ? educationProposal.formatted_lines.join("\n")
      : null

    const architecture = session.architecture

    // Step 1: Assemble final resume
    const assemblePrompt = `Assemble a complete, final resume from the components below.

Candidate: ${session.year_in_school}, mode: ${session.mode}, targeting ${session.target_field}

ORIGINAL RESUME:
${session.original_resume_text}

APPROVED REWRITES (replace matching original bullets with these):
${approvedBulletsText || "(none — use original bullets)"}

EDUCATION SECTION (use this exactly):
${educationLines || "(use original education from resume)"}

SECTION ARCHITECTURE (follow this order):
${architecture ? JSON.stringify(architecture.section_order ?? []) : "(use original order)"}
${architecture?.remove_sections?.length ? `Remove these sections: ${JSON.stringify(architecture.remove_sections)}` : ""}
${architecture?.positioning_statement ? `Add positioning statement: ${architecture.positioning_statement}` : ""}

Instructions:
- Replace weak bullets with approved rewrites where item_id matches
- Follow the section order from architecture
- Remove any sections flagged for removal
- Keep all other original content intact
- Format as clean plain text (no markdown, no columns)
- One page unless experience warrants more

Return the complete resume as plain text only — no JSON wrapper, no explanation.`

    const assembleMsg = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: PERI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: assemblePrompt }],
    })

    const final_resume_text = assembleMsg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("")
      .trim()

    // Step 2: Generate coaching summary
    const coachingPrompt = `Write a coaching summary for this candidate in Peri's voice.

Candidate: ${session.year_in_school}, mode: ${session.mode}, targeting ${session.target_field}
Original score: ${session.diagnosis?.overall_score ?? "unknown"}/10
Original verdict: ${session.diagnosis?.overall_verdict ?? "unknown"}

Changes made:
- Approved rewrites: ${approvedBullets.length} bullets
- Education section: ${educationLines ? "updated" : "unchanged"}
- Architecture: ${architecture ? "restructured" : "unchanged"}

Write 300-400 words in 4 sections:
1. What We Fixed (2-3 sentences on the most important changes)
2. Why It's Stronger Now (2-3 sentences on how the resume reads differently)
3. What to Watch For (1-2 sentences on remaining risks or things to keep polishing)
4. Your Next Move (1-2 sentences of direct coaching advice)

Write in Peri's warm, direct voice. No bullet points — flowing prose. No section header formatting needed, just label each section clearly.

Return ONLY valid JSON — no markdown:
{
  "coaching_summary": <full text, ~300-400 words>,
  "sections": {
    "what_we_fixed": <text>,
    "why_stronger": <text>,
    "watch_for": <text>,
    "next_move": <text>
  }
}`

    const coachingMsg = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: PERI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: coachingPrompt }],
    })

    const coachingRaw = coachingMsg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("")

    const coachingCleaned = stripJsonFences(coachingRaw)
    let coachingParsed: any
    try {
      coachingParsed = JSON.parse(coachingCleaned)
    } catch {
      // Fall back to raw text if JSON parse fails
      coachingParsed = { coaching_summary: coachingRaw.trim() }
    }

    const coaching_summary = coachingParsed.coaching_summary ?? coachingRaw.trim()

    // Basic validation result
    const validation_result = {
      final_score: Math.min(10, (session.diagnosis?.overall_score ?? 5) + Math.min(3, Math.floor(approvedBullets.length / 2))),
      bullets_rewritten: approvedBullets.length,
      architecture_applied: !!architecture,
      education_updated: !!educationLines,
    }

    const { error: updateErr } = await supabase
      .from("resume_rx_sessions")
      .update({
        final_resume_text,
        coaching_summary,
        validation_result,
        pdf_url: null,
        status: "complete",
        updated_at: new Date().toISOString(),
      })
      .eq("id", session_id)

    if (updateErr) throw new Error(`Session update failed: ${updateErr.message}`)

    return withCorsJson(req, {
      ok: true,
      final_resume_text,
      coaching_summary,
      pdf_url: null,
      validation: validation_result,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[resume-rx/complete] error:", msg)
    if (msg.includes("Unauthorized")) return withCorsJson(req, { error: msg }, 401)
    if (msg.includes("Profile not found")) return withCorsJson(req, { error: msg }, 404)
    return withCorsJson(req, { error: "Internal error" }, 500)
  }
}
