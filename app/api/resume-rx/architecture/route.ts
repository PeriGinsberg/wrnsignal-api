// app/api/resume-rx/architecture/route.ts
// POST /api/resume-rx/architecture
// Generates section architecture (order, anchor, positioning statement).

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
    const confirmed = Boolean(body.confirmed)
    const adjustments = body.adjustments ? String(body.adjustments).trim() : null

    if (!session_id) return withCorsJson(req, { error: "session_id is required" }, 400)

    const supabase = getSupabaseAdmin()

    // Verify session ownership
    const { data: session, error: sessionErr } = await supabase
      .from("resume_rx_sessions")
      .select("id, profile_id, mode, year_in_school, target_field, resume_text, diagnosis, education_intake")
      .eq("id", session_id)
      .maybeSingle()

    if (sessionErr) throw new Error(`Session lookup failed: ${sessionErr.message}`)
    if (!session) return withCorsJson(req, { error: "Session not found" }, 404)
    if (session.profile_id !== profileId) return withCorsJson(req, { error: "Forbidden" }, 403)

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const userPrompt = `Generate the optimal section architecture for this resume.

Candidate: ${session.year_in_school}, mode: ${session.mode}, targeting ${session.target_field}
Confirmed education proposal: ${confirmed}
${adjustments ? `User adjustments: ${adjustments}` : ""}

Diagnosis summary:
- Overall verdict: ${session.diagnosis?.overall_verdict ?? "unknown"}
- Score: ${session.diagnosis?.overall_score ?? "unknown"}
- Skim test passes: ${session.diagnosis?.skim_test?.passes ?? "unknown"}
- Missing opportunities: ${JSON.stringify(session.diagnosis?.missing_opportunities ?? [])}

Current resume sections (inferred from resume text, first 800 chars):
${String(session.resume_text || "").slice(0, 800)}

Return ONLY valid JSON — no markdown, no explanation:
{
  "section_order": [<ordered array of section names as they should appear on the resume>],
  "anchor_section": <string — the single most important section for this candidate>,
  "positioning_statement": <string or null — optional 1-line header statement if appropriate>,
  "remove_sections": [<section names to remove with brief reason>],
  "add_sections": [<section names to add with brief reason>],
  "coaching_note": <2-3 sentences in Peri's voice explaining the architecture rationale>
}`

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: PERI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    })

    const rawText = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("")

    const cleaned = stripJsonFences(rawText)
    let architecture: any
    try {
      architecture = JSON.parse(cleaned)
    } catch {
      throw new Error(`Failed to parse Claude architecture response: ${cleaned.slice(0, 200)}`)
    }

    const { error: updateErr } = await supabase
      .from("resume_rx_sessions")
      .update({ architecture, status: "qa", updated_at: new Date().toISOString() })
      .eq("id", session_id)

    if (updateErr) throw new Error(`Session update failed: ${updateErr.message}`)

    return withCorsJson(req, { ok: true, architecture })
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[resume-rx/architecture] error:", msg)
    if (msg.includes("Unauthorized")) return withCorsJson(req, { error: msg }, 401)
    if (msg.includes("Profile not found")) return withCorsJson(req, { error: msg }, 404)
    return withCorsJson(req, { error: "Internal error" }, 500)
  }
}
