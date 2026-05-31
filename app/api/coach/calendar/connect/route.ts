// app/api/coach/calendar/connect/route.ts
//
// GET /api/coach/calendar/connect — Phase 1d Commit 1.
//
// Authenticated coach entry point for the Microsoft OAuth flow. Verifies the
// caller is a beta-gated coach (Bearer auth), mints a CSRF state token, stores
// it (bound to the coach's profile_id) in an HTTP-only cookie, and 302-redirects
// the browser to Microsoft's authorize endpoint.
//
// Identity propagation: the state cookie value is `<random_token>.<profile_id>`.
// Only <random_token> is sent to Microsoft as the `state` param (we don't echo
// profile_id through Microsoft's URL). On callback, the cookie is the authority
// for who this coach is — the browser redirect from Microsoft carries no Bearer
// header and no Supabase session cookie (the session lives in localStorage), so
// the callback cannot re-authenticate. See the Phase 1d Commit 1 runlog entry
// for the rationale (FRD §6.4.2 step 3+4 deviation).
//
// FRD: docs/Features/coach-calendar-integration-v0-1-frd.md §6.4.1, §6.5, §6.9, §6.10

import { NextRequest, NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { randomBytes } from "node:crypto"
import { buildAuthorizeUrl } from "@/lib/coach/microsoftGraph"
import { getAppUrl } from "@/lib/urls"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STATE_COOKIE = "signal_calendar_oauth_state"
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Auth helpers (inlined per coach-route convention; coachAuth extraction
//    deferred per FRD §2 non-goals). Copied from app/api/coach/clients/route.ts.
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

async function verifyCoach(profileId: string, supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase
    .from("client_profiles")
    .select("is_coach")
    .eq("id", profileId)
    .single()
  return data?.is_coach === true
}

// Parse CALENDAR_BETA_PROFILE_IDS into a UUID allowlist. Empty/unset = empty
// allowlist = fail-closed (no profile passes the gate).
function parseBetaAllowlist(): string[] {
  return (process.env.CALENDAR_BETA_PROFILE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => UUID_RE.test(s))
}

export async function GET(req: NextRequest) {
  // 1. Auth (Bearer) — resolve the calling coach's profile_id.
  let userId: string
  let email: string | null
  try {
    const authed = await getAuthedUser(req)
    userId = authed.userId
    email = authed.email
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }

  let profileId: string
  try {
    profileId = await getProfileId(userId, email)
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const isCoach = await verifyCoach(profileId, supabase)
  if (!isCoach) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 })
  }

  // 2. Beta gate (fail-closed).
  const allowlist = parseBetaAllowlist()
  if (!allowlist.includes(profileId)) {
    return NextResponse.json(
      {
        error: "calendar_beta_gated",
        message:
          "Calendar integration is in limited beta and not enabled for this account.",
      },
      { status: 403 },
    )
  }

  // 3-8. State token, cookie, redirect to Microsoft.
  try {
    const randomToken = randomBytes(32).toString("base64url")
    const redirectUri = `${getAppUrl(req)}/api/coach/calendar/callback`
    const authorizeUrl = buildAuthorizeUrl({ state: randomToken, redirectUri })

    console.log(
      `[coach-calendar/connect] AUTH_REDIRECT coachProfileId=${profileId} state=${randomToken.slice(0, 8)}`,
    )

    const res = NextResponse.redirect(authorizeUrl, 302)
    // Cookie value binds the CSRF token to the authenticated coach. Only the
    // token is echoed to Microsoft as `state`; profile_id never leaves our cookie.
    res.cookies.set(STATE_COOKIE, `${randomToken}.${profileId}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // MUST be lax to survive Microsoft's cross-site redirect back.
      maxAge: 600, // 10 minutes
      path: "/",
    })
    return res
  } catch (err) {
    console.error(
      `[coach-calendar/connect] INTERNAL_ERROR coachProfileId=${profileId}`,
      err,
    )
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}
