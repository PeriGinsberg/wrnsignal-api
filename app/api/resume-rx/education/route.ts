// app/api/resume-rx/education/route.ts
// POST /api/resume-rx/education
// Takes education intake, applies GPA rule, calls Claude to generate education section proposal.

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

function applyGpaRule(gpa: number | null | undefined, show_gpa: boolean | undefined): boolean {
  if (gpa == null) return false
  if (gpa >= 3.5) return true
  if (gpa < 3.3) return false
  // 3.3–3.49: pass through the user's choice
  return show_gpa ?? false
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
    const education = body.education
    if (!session_id) return withCorsJson(req, { error: "session_id is required" }, 400)
    if (!education || typeof education !== "object") {
      return withCorsJson(req, { error: "education object is required" }, 400)
    }

    const supabase = getSupabaseAdmin()

    // Verify session ownership
    const { data: session, error: sessionErr } = await supabase
      .from("resume_rx_sessions")
      .select("id, profile_id, mode, year_in_school, target_field")
      .eq("id", session_id)
      .maybeSingle()

    if (sessionErr) throw new Error(`Session lookup failed: ${sessionErr.message}`)
    if (!session) return withCorsJson(req, { error: "Session not found" }, 404)
    if (session.profile_id !== profileId) return withCorsJson(req, { error: "Forbidden" }, 403)

    // Auto-apply GPA rule
    const gpa = typeof education.gpa === "number" ? education.gpa : parseFloat(education.gpa) || null
    const resolved_show_gpa = applyGpaRule(gpa, education.show_gpa)

    const resolvedEducation = { ...education, gpa, show_gpa: resolved_show_gpa }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const userPrompt = `Generate a polished Education section for this resume using the RESUME TEMPLATE FORMAT from your instructions.

Candidate: ${session.year_in_school}, mode: ${session.mode}, targeting ${session.target_field}

Education data:
${JSON.stringify(resolvedEducation, null, 2)}

GPA display: ${resolved_show_gpa ? `Show GPA (${gpa})` : "Do not show GPA"}

Format the education section EXACTLY like this template:

University Name — City, ST
Degree in Major    GPA: X.XX                                                Graduation Date
Awards/Honors: Honor 1 | Honor 2 | Scholarship Name
Study Abroad Program — Location                                             Date
Relevant Coursework: Course 1, Course 2, Course 3

RULES:
- University name and location on one line
- Degree, GPA (if shown), and graduation date on one line
- Awards/Honors pipe-separated on one line (Dean's List semesters, scholarships)
- Study abroad on its own line with location and date if applicable
- ALWAYS include a "Relevant Coursework:" line for students and recent grads — this is pure keyword value for ATS. Use courses from the data provided, or recommend field-appropriate courses if none listed.
- Each line should be a complete, formatted string ready to paste into a resume
- No bullet points in the education section — just clean lines

Return ONLY valid JSON — no markdown, no explanation:
{
  "formatted_lines": [<array of strings — each line of the education section, in order>],
  "show_gpa": <boolean>,
  "gpa_note": <string or null — coaching note about the GPA decision>,
  "coaching_note": <1-2 sentences of Peri coaching about this education section>
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
    let proposal: any
    try {
      proposal = JSON.parse(cleaned)
    } catch {
      throw new Error(`Failed to parse Claude education response: ${cleaned.slice(0, 200)}`)
    }

    const education_intake = { ...resolvedEducation, proposal }

    const { error: updateErr } = await supabase
      .from("resume_rx_sessions")
      .update({ education_intake, status: "architecture", updated_at: new Date().toISOString() })
      .eq("id", session_id)

    if (updateErr) throw new Error(`Session update failed: ${updateErr.message}`)

    return withCorsJson(req, { ok: true, proposal })
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[resume-rx/education] error:", msg)
    if (msg.includes("Unauthorized")) return withCorsJson(req, { error: msg }, 401)
    if (msg.includes("Profile not found")) return withCorsJson(req, { error: msg }, 404)
    return withCorsJson(req, { error: "Internal error" }, 500)
  }
}
