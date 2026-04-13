// app/api/resume-rx/answer/route.ts
// POST /api/resume-rx/answer
// Handles Q&A rewrites: bullet rewrites, project expansions, coursework lines.

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

function buildProjectPrompt(item: any, session: any, answers: Record<string, string>, source_material: string | null): string {
  return `Expand this project into a full resume entry with strong bullets.

Candidate: ${session.year_in_school}, mode: ${session.mode}, targeting ${session.target_field}
Section: ${item.section}
Project target: ${item.target}

Q&A answers provided:
${Object.entries(answers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join("\n\n")}
${source_material ? `\nAdditional source material:\n${source_material}` : ""}

Return ONLY valid JSON — no markdown, no explanation:
{
  "section_header": <string — e.g. "Projects" or "Academic Projects">,
  "project_title_line": <string — formatted title line with date range if known>,
  "bullets": [
    {
      "text": <bullet text>,
      "reasoning": <1 sentence: why this bullet is strong>,
      "keywords": [<relevant keywords embedded>]
    }
  ],
  "coaching_note": <1-2 sentences in Peri's voice>
}`
}

function buildBulletPrompt(item: any, session: any, answers: Record<string, string>, source_material: string | null): string {
  return `Rewrite this weak bullet into 2 strong variants.

Candidate: ${session.year_in_school}, mode: ${session.mode}, targeting ${session.target_field}
Section: ${item.section}
Original bullet: ${item.original || item.target}

Q&A answers provided:
${Object.entries(answers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join("\n\n")}
${source_material ? `\nAdditional source material:\n${source_material}` : ""}

Return ONLY valid JSON — no markdown, no explanation:
{
  "variants": [
    {
      "text": <rewritten bullet>,
      "reasoning": <1 sentence: what was improved and why>,
      "keywords": [<relevant keywords embedded>]
    },
    {
      "text": <alternative rewrite with different emphasis>,
      "reasoning": <1 sentence: what was improved and why>,
      "keywords": [<relevant keywords embedded>]
    }
  ],
  "coaching_note": <1-2 sentences in Peri's voice>
}`
}

function buildCourseworkPrompt(item: any, session: any, answers: Record<string, string>): string {
  return `Generate a Relevant Coursework line for this candidate's resume.

Candidate: ${session.year_in_school}, mode: ${session.mode}, targeting ${session.target_field}
Target: ${item.target}

Courses and context provided:
${Object.entries(answers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join("\n\n")}

Return ONLY valid JSON — no markdown, no explanation:
{
  "coursework_line": <formatted "Relevant Coursework: Course 1, Course 2, ..." string>,
  "keywords": [<keywords these courses legitimately embed>],
  "coaching_note": <1 sentence in Peri's voice>
}`
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
    const item_id = String(body.item_id || "").trim()
    const type = String(body.type || "").trim()
    const original = body.original ? String(body.original).trim() : null
    const section = body.section ? String(body.section).trim() : null
    const answers: Record<string, string> = body.answers && typeof body.answers === "object" ? body.answers : {}
    const source_material = body.source_material ? String(body.source_material).trim() : null

    if (!session_id) return withCorsJson(req, { error: "session_id is required" }, 400)
    if (!item_id) return withCorsJson(req, { error: "item_id is required" }, 400)
    if (!type) return withCorsJson(req, { error: "type is required" }, 400)
    if (!["project", "bullet", "coursework"].includes(type)) {
      return withCorsJson(req, { error: "type must be project, bullet, or coursework" }, 400)
    }

    const supabase = getSupabaseAdmin()

    // Verify session ownership
    const { data: session, error: sessionErr } = await supabase
      .from("resume_rx_sessions")
      .select("id, profile_id, mode, year_in_school, target_field, diagnosis, qa_items")
      .eq("id", session_id)
      .maybeSingle()

    if (sessionErr) throw new Error(`Session lookup failed: ${sessionErr.message}`)
    if (!session) return withCorsJson(req, { error: "Session not found" }, 404)
    if (session.profile_id !== profileId) return withCorsJson(req, { error: "Forbidden" }, 403)

    // Find the qa_agenda item from diagnosis
    const qaAgenda: any[] = session.diagnosis?.qa_agenda ?? []
    const item = qaAgenda.find((i: any) => i.id === item_id) ?? {
      id: item_id,
      type,
      target: original || item_id,
      section: section || "Unknown",
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    let userPrompt: string
    if (type === "project") {
      userPrompt = buildProjectPrompt(item, session, answers, source_material)
    } else if (type === "bullet") {
      userPrompt = buildBulletPrompt({ ...item, original }, session, answers, source_material)
    } else {
      userPrompt = buildCourseworkPrompt(item, session, answers)
    }

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
    let rewrite: any
    try {
      rewrite = JSON.parse(cleaned)
    } catch {
      throw new Error(`Failed to parse Claude answer response: ${cleaned.slice(0, 200)}`)
    }

    // Update qa_items in session
    const existingQaItems: any[] = Array.isArray(session.qa_items) ? session.qa_items : []
    const updatedQaItems = [
      ...existingQaItems.filter((i: any) => i.item_id !== item_id),
      { item_id, type, original, section, answers, source_material, rewrite, answered_at: new Date().toISOString() },
    ]

    const { error: updateErr } = await supabase
      .from("resume_rx_sessions")
      .update({ qa_items: updatedQaItems, updated_at: new Date().toISOString() })
      .eq("id", session_id)

    if (updateErr) throw new Error(`Session update failed: ${updateErr.message}`)

    return withCorsJson(req, { ok: true, item_id, type, rewrite })
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[resume-rx/answer] error:", msg)
    if (msg.includes("Unauthorized")) return withCorsJson(req, { error: msg }, 401)
    if (msg.includes("Profile not found")) return withCorsJson(req, { error: msg }, 404)
    return withCorsJson(req, { error: "Internal error" }, 500)
  }
}
