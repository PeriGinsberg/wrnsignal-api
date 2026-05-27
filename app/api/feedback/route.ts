// app/api/feedback/route.ts
//
// POST /api/feedback — coach-submitted beta feedback (Beta Feedback v0.1
// Phase 2). FRD: docs/Features/beta-feedback-frd.md §6.2, §6.3.
//
// Auth + is_coach gate model the inline pattern from
// app/api/coach/home/route.ts (getAuthedUser + profile lookup) — NOT
// getAuthedProfileText (which throws and doesn't return is_coach; see
// preflight). On valid submission: INSERT to beta_feedback, compute the
// coach's active client count, fire a notification email (non-fatal), then
// best-effort writeback of email_sent_at / email_send_error to the row.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import {
  sendFeedbackNotification,
  type FeedbackType,
  type FeedbackSeverity,
} from "@/lib/email/sendFeedbackNotification"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_TYPES: FeedbackType[] = [
  "issue_bug",
  "enhancement",
  "technical_question",
  "general_feedback",
  "other",
]
const VALID_SEVERITIES: FeedbackSeverity[] = ["blocker", "high", "medium", "low"]

const BODY_MIN = 10
const BODY_MAX = 5000
const PAGE_URL_MAX = 2000
const USER_AGENT_MAX = 500

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

// Caller's client_profiles row: id + name + email + is_coach. Falls back to
// email lookup when user_id doesn't match (mirrors coach/home + send-invite).
async function getCoachProfile(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id, name, email, is_coach")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, name, email, is_coach, user_id")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
      }
      const { user_id: _u, ...rest } = byEmail as any
      return rest
    }
  }
  return null
}

// Strip sensitive query params from a captured page_url before persistence.
// Server-side is the canonical layer (the frontend strips too as a courtesy).
// Anything matching token|auth|key|secret|password|code (case-insensitive) is
// dropped. Returns the cleaned URL, or the original string if it doesn't parse
// as a URL (we still persist it — better a raw path than nothing).
const SENSITIVE_PARAM_RE = /token|auth|key|secret|password|code/i
function stripSensitiveParams(raw: string): string {
  try {
    const u = new URL(raw)
    const toDelete: string[] = []
    u.searchParams.forEach((_v, k) => {
      if (SENSITIVE_PARAM_RE.test(k)) toDelete.push(k)
    })
    for (const k of toDelete) u.searchParams.delete(k)
    return u.toString()
  } catch {
    return raw
  }
}

type ParseOk = {
  ok: true
  data: {
    type: FeedbackType
    severity: FeedbackSeverity | null
    body: string
    reply_ok: boolean
    page_url: string | null
    user_agent: string | null
  }
}
type ParseErr = { ok: false; code: string; message: string }

function parseAndValidate(body: any): ParseOk | ParseErr {
  if (!body || typeof body !== "object") {
    return { ok: false, code: "invalid_body", message: "Request body must be a JSON object." }
  }

  const { type } = body
  if (typeof type !== "string" || !VALID_TYPES.includes(type as FeedbackType)) {
    return { ok: false, code: "invalid_type", message: "Type must be one of the five feedback types." }
  }
  const feedbackType = type as FeedbackType

  // Severity: required for issue_bug, disallowed otherwise.
  const rawSeverity = body.severity
  let severity: FeedbackSeverity | null = null
  const severityProvided = rawSeverity !== undefined && rawSeverity !== null && rawSeverity !== ""
  if (feedbackType === "issue_bug") {
    if (!severityProvided) {
      return { ok: false, code: "severity_required", message: "Severity is required for Issue/Bug submissions." }
    }
    if (typeof rawSeverity !== "string" || !VALID_SEVERITIES.includes(rawSeverity as FeedbackSeverity)) {
      return { ok: false, code: "invalid_severity", message: "Severity must be one of: blocker, high, medium, low." }
    }
    severity = rawSeverity as FeedbackSeverity
  } else if (severityProvided) {
    return { ok: false, code: "severity_not_allowed", message: "Severity should only be set for Issue/Bug submissions." }
  }

  // Body
  if (typeof body.body !== "string") {
    return { ok: false, code: "body_required", message: "Body is required." }
  }
  const trimmedBody = body.body.trim()
  if (trimmedBody.length < BODY_MIN) {
    return { ok: false, code: "body_too_short", message: `Body must be at least ${BODY_MIN} characters.` }
  }
  if (trimmedBody.length > BODY_MAX) {
    return { ok: false, code: "body_too_long", message: `Body must be at most ${BODY_MAX} characters.` }
  }

  // reply_ok — default true when missing; must be boolean if present.
  let replyOk = true
  if (body.reply_ok !== undefined) {
    if (typeof body.reply_ok !== "boolean") {
      return { ok: false, code: "invalid_reply_ok", message: "reply_ok must be a boolean." }
    }
    replyOk = body.reply_ok
  }

  // page_url — optional string, bounded.
  let pageUrl: string | null = null
  if (body.page_url !== undefined && body.page_url !== null) {
    if (typeof body.page_url !== "string") {
      return { ok: false, code: "invalid_page_url", message: "page_url must be a string." }
    }
    if (body.page_url.length > PAGE_URL_MAX) {
      return { ok: false, code: "page_url_too_long", message: `page_url must be at most ${PAGE_URL_MAX} characters.` }
    }
    pageUrl = body.page_url ? stripSensitiveParams(body.page_url) : null
  }

  // user_agent — optional string, bounded.
  let userAgent: string | null = null
  if (body.user_agent !== undefined && body.user_agent !== null) {
    if (typeof body.user_agent !== "string") {
      return { ok: false, code: "invalid_user_agent", message: "user_agent must be a string." }
    }
    if (body.user_agent.length > USER_AGENT_MAX) {
      return { ok: false, code: "user_agent_too_long", message: `user_agent must be at most ${USER_AGENT_MAX} characters.` }
    }
    userAgent = body.user_agent || null
  }

  return {
    ok: true,
    data: { type: feedbackType, severity, body: trimmedBody, reply_ok: replyOk, page_url: pageUrl, user_agent: userAgent },
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    // ── 1+2. Auth ──────────────────────────────────────────────────
    const { userId, email } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, email)
    if (!coach) {
      return withCorsJson(req, { ok: false, error: "unauthenticated" }, 401)
    }

    // ── 3. is_coach gate ───────────────────────────────────────────
    if (!coach.is_coach) {
      return withCorsJson(
        req,
        { ok: false, error: "coaches_only", message: "Feedback is currently available to coaches only." },
        403,
      )
    }

    // ── 4+5. Parse + validate body ─────────────────────────────────
    let rawBody: any
    try {
      rawBody = await req.json()
    } catch {
      return withCorsJson(req, { ok: false, error: "invalid_json", message: "Request body is not valid JSON." }, 400)
    }
    const parsed = parseAndValidate(rawBody)
    if (!parsed.ok) {
      return withCorsJson(req, { ok: false, error: parsed.code, message: parsed.message }, 400)
    }
    const { type, severity, body, reply_ok, page_url, user_agent } = parsed.data

    const supabase = getSupabaseAdmin()
    const coachProfileId = coach.id as string

    // ── 7. INSERT row ──────────────────────────────────────────────
    const { data: feedback, error: insertError } = await supabase
      .from("beta_feedback")
      .insert({
        coach_profile_id: coachProfileId,
        type,
        severity: severity ?? null,
        body,
        reply_ok,
        page_url,
        user_agent,
      })
      .select("id, created_at")
      .single()

    if (insertError || !feedback) {
      console.error("[feedback] insert failed:", insertError?.message)
      return withCorsJson(req, { ok: false, error: "insert_failed", message: "Failed to save feedback." }, 500)
    }

    // ── 9. Active client count (FRD §6.2 corrected: Active only — ──
    //       matches the Coach Home "Active Clients" tile filter). ──
    let activeClientCount = 0
    {
      const { count } = await supabase
        .from("coach_clients")
        .select("id", { count: "exact", head: true })
        .eq("coach_profile_id", coachProfileId)
        .eq("status", "active")
        .eq("lifecycle_status", "Active")
      activeClientCount = count ?? 0
    }

    // ── 10. Notification email (non-fatal — row already committed) ─
    let emailSent = false
    let emailError: string | null = null
    try {
      await sendFeedbackNotification({
        feedbackId: feedback.id,
        coachName: coach.name || coach.email || "A coach",
        coachEmail: coach.email || email || "",
        type,
        severity,
        body,
        replyOk: reply_ok,
        pageUrl: page_url,
        userAgent: user_agent,
        activeClientCount,
        createdAt: feedback.created_at,
      })
      emailSent = true
    } catch (err: any) {
      emailError = err instanceof Error ? err.message : String(err)
      console.error("[feedback] email send failed:", emailError)
    }

    // ── 11. Best-effort email-status writeback ─────────────────────
    {
      const { error: writebackErr } = await supabase
        .from("beta_feedback")
        .update({
          email_sent_at: emailSent ? new Date().toISOString() : null,
          email_send_error: emailError,
        })
        .eq("id", feedback.id)
      if (writebackErr) {
        console.error("[feedback] email-status writeback failed:", writebackErr.message)
      }
    }

    // ── 12. Success ────────────────────────────────────────────────
    return withCorsJson(
      req,
      { ok: true, feedback_id: feedback.id, created_at: feedback.created_at, email_sent: emailSent },
      201,
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    if (status === 401) {
      return withCorsJson(req, { ok: false, error: "unauthenticated" }, 401)
    }
    console.error("[feedback] unexpected error:", msg)
    return withCorsJson(req, { ok: false, error: "internal_error" }, 500)
  }
}
