// app/api/resume-rx/approve/route.ts
// POST /api/resume-rx/approve
// Marks a Q&A item as approved, appends bullets, advances status if all high-priority items done.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

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
    const approved_bullets: string[] = Array.isArray(body.approved_bullets) ? body.approved_bullets : []
    const skipped = Boolean(body.skipped)

    if (!session_id) return withCorsJson(req, { error: "session_id is required" }, 400)
    if (!item_id) return withCorsJson(req, { error: "item_id is required" }, 400)

    const supabase = getSupabaseAdmin()

    // Verify session ownership
    const { data: session, error: sessionErr } = await supabase
      .from("resume_rx_sessions")
      .select("id, profile_id, status, diagnosis, qa_items, approved_bullets")
      .eq("id", session_id)
      .maybeSingle()

    if (sessionErr) throw new Error(`Session lookup failed: ${sessionErr.message}`)
    if (!session) return withCorsJson(req, { error: "Session not found" }, 404)
    if (session.profile_id !== profileId) return withCorsJson(req, { error: "Forbidden" }, 403)

    // Update qa_items: mark this item as approved or skipped
    const existingQaItems: any[] = Array.isArray(session.qa_items) ? session.qa_items : []
    const updatedQaItems = existingQaItems.map((i: any) =>
      i.item_id === item_id
        ? { ...i, approved: !skipped, skipped, approved_bullets, approved_at: new Date().toISOString() }
        : i
    )
    // If item wasn't in qa_items yet (answered externally), add a stub
    if (!updatedQaItems.find((i: any) => i.item_id === item_id)) {
      updatedQaItems.push({
        item_id,
        approved: !skipped,
        skipped,
        approved_bullets,
        approved_at: new Date().toISOString(),
      })
    }

    // Append approved bullets to session.approved_bullets
    const existingApproved: any[] = Array.isArray(session.approved_bullets) ? session.approved_bullets : []
    const newApproved = skipped
      ? existingApproved
      : [
          ...existingApproved,
          ...approved_bullets.map((text) => ({ item_id, text, approved_at: new Date().toISOString() })),
        ]

    // Check if all high-priority items are done
    const qaAgenda: any[] = session.diagnosis?.qa_agenda ?? []
    const highPriorityIds = new Set(
      qaAgenda.filter((i: any) => i.priority === "high").map((i: any) => i.id)
    )
    const resolvedIds = new Set(
      updatedQaItems.filter((i: any) => i.approved || i.skipped).map((i: any) => i.item_id)
    )
    const allHighPriorityDone =
      highPriorityIds.size === 0 || [...highPriorityIds].every((id) => resolvedIds.has(id))

    const newStatus = allHighPriorityDone && session.status === "qa" ? "validation" : session.status

    const { error: updateErr } = await supabase
      .from("resume_rx_sessions")
      .update({
        qa_items: updatedQaItems,
        approved_bullets: newApproved,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session_id)

    if (updateErr) throw new Error(`Session update failed: ${updateErr.message}`)

    return withCorsJson(req, { ok: true, status: newStatus })
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[resume-rx/approve] error:", msg)
    if (msg.includes("Unauthorized")) return withCorsJson(req, { error: msg }, 401)
    if (msg.includes("Profile not found")) return withCorsJson(req, { error: msg }, 404)
    return withCorsJson(req, { error: "Internal error" }, 500)
  }
}
