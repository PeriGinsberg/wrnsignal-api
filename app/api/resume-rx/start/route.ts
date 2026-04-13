// app/api/resume-rx/start/route.ts
// POST /api/resume-rx/start
// Validates resume, runs Claude diagnosis, creates session.

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

    const resume_text = String(body.resume_text || "").trim()
    const mode = String(body.mode || "").trim()
    const year_in_school = String(body.year_in_school || "").trim()
    const target_field = String(body.target_field || "").trim()
    const source_persona_id = body.source_persona_id ?? null

    if (resume_text.length < 200) {
      return withCorsJson(req, { error: "resume_text must be at least 200 characters" }, 400)
    }
    if (!mode) return withCorsJson(req, { error: "mode is required" }, 400)
    if (!year_in_school) return withCorsJson(req, { error: "year_in_school is required" }, 400)
    if (!target_field) return withCorsJson(req, { error: "target_field is required" }, 400)

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const userPrompt = `Analyze this resume. The candidate is a ${year_in_school} in mode: ${mode}, targeting ${target_field}.

Return ONLY valid JSON — no markdown, no explanation:
{
  "overall_verdict": "strong"|"needs_work"|"experience_gap",
  "overall_score": <1-10>,
  "skim_test": {
    "passes": <boolean>,
    "role_clarity": "clear"|"unclear"|"missing",
    "anchor_proof": <string>,
    "reason_to_read": "present"|"weak"|"missing",
    "notes": <1-2 sentences>
  },
  "summary": <2-3 sentence assessment in Peri's voice>,
  "high_school_items": [<exact text of any HS content>],
  "should_remove_hs": <boolean>,
  "dimensions": {
    "impact": { "score": <1-5>, "verdict": <one line>, "findings": [<max 4>] },
    "specificity": { "score": <1-5>, "verdict": <one line>, "findings": [<max 4>] },
    "language": { "score": <1-5>, "verdict": <one line>, "findings": [<max 4>] },
    "relevance": { "score": <1-5>, "verdict": <one line>, "findings": [<max 4>] },
    "completeness": { "score": <1-5>, "verdict": <one line>, "findings": [<max 4>] },
    "honesty": { "score": <1-5>, "verdict": <one line>, "findings": [<max 3>] }
  },
  "ats_issues": [<specific problems>],
  "weak_bullets": [{ "original": <text>, "reason": <why weak>, "section": <name> }],
  "missing_opportunities": [<things likely missing>],
  "qa_agenda": [{ "id": <unique id>, "type": "bullet"|"project"|"section"|"coursework"|"activity", "target": <text>, "section": <name>, "priority": "high"|"medium", "questions": [<2-4 questions>] }]
}

Resume:
${resume_text}`

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: PERI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    })

    const rawText = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("")

    const cleaned = stripJsonFences(rawText)
    let diagnosis: any
    try {
      diagnosis = JSON.parse(cleaned)
    } catch {
      throw new Error(`Failed to parse Claude diagnosis response: ${cleaned.slice(0, 200)}`)
    }

    const supabase = getSupabaseAdmin()
    const { data: session, error: insertErr } = await supabase
      .from("resume_rx_sessions")
      .insert({
        profile_id: profileId,
        status: "diagnosis",
        mode,
        year_in_school,
        target_field,
        source_persona_id,
        resume_text,
        diagnosis,
      })
      .select("id")
      .single()

    if (insertErr) throw new Error(`Session insert failed: ${insertErr.message}`)

    return withCorsJson(req, { session_id: session.id, diagnosis }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[resume-rx/start] error:", msg)
    if (msg.includes("Unauthorized")) return withCorsJson(req, { error: msg }, 401)
    if (msg.includes("Profile not found")) return withCorsJson(req, { error: msg }, 404)
    return withCorsJson(req, { error: "Internal error" }, 500)
  }
}
