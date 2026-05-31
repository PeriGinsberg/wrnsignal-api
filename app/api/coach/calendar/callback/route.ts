// app/api/coach/calendar/callback/route.ts
//
// GET /api/coach/calendar/callback — Phase 1d Commit 1.
//
// Hit by the BROWSER via Microsoft's redirect (not by SIGNAL code). Carries no
// Authorization header and no Supabase session cookie — the Supabase session
// lives in localStorage (lib/supabase-browser.ts), so the server cannot
// re-authenticate here. Identity is therefore derived from the HTTP-only state
// cookie set by the authenticated /connect route.
//
// State cookie format: `<random_token>.<profile_id>` (base64url token + UUID;
// neither contains '.', so a rightmost split is unambiguous). We verify the
// token half against Microsoft's echoed `state` query param (CSRF), then trust
// profile_id from the cookie as the authenticated coach. We intentionally do
// NOT re-run verifyCoach — /connect already verified is_coach=true before
// issuing the cookie, and the cookie is the authority for the 10-minute window.
// See the Phase 1d Commit 1 runlog entry (FRD §6.4.2 step 3+4 deviation).
//
// FRD: docs/Features/coach-calendar-integration-v0-1-frd.md §6.4.2, §6.5, §6.9, §6.10

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  exchangeCodeForTokens,
  getCallerIdentity,
  MicrosoftGraphError,
} from "@/lib/coach/microsoftGraph"
import { getAppUrl } from "@/lib/urls"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STATE_COOKIE = "signal_calendar_oauth_state"
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Redirect back to Coach Home with a calendar_error code. Clears the state
// cookie so a retry starts clean.
function coachErrorRedirect(req: NextRequest, code: string): NextResponse {
  const res = NextResponse.redirect(
    `${getAppUrl(req)}/dashboard/coach?calendar_error=${code}`,
    302,
  )
  res.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  })
  return res
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams

  // 1. State verification (CSRF) + identity extraction from the cookie.
  const cookieVal = req.cookies.get(STATE_COOKIE)?.value || ""
  const stateFromQuery = params.get("state") || ""

  // Rightmost split: <random_token>.<profile_id>. base64url and UUIDs contain
  // no '.', so the last '.' cleanly separates token from profile_id.
  const lastDot = cookieVal.lastIndexOf(".")
  const tokenFromCookie = lastDot >= 0 ? cookieVal.slice(0, lastDot) : ""
  const profileIdFromCookie = lastDot >= 0 ? cookieVal.slice(lastDot + 1) : ""

  if (
    !tokenFromCookie ||
    !stateFromQuery ||
    tokenFromCookie !== stateFromQuery ||
    !UUID_RE.test(profileIdFromCookie)
  ) {
    console.log(
      `[coach-calendar/callback] STATE_MISMATCH expected=${tokenFromCookie.slice(0, 8)} got=${stateFromQuery.slice(0, 8)}`,
    )
    return coachErrorRedirect(req, "state_mismatch")
  }
  // Authenticated identity for the rest of the callback (cookie is authority).
  const profileId = profileIdFromCookie

  // 2. Microsoft-side error (e.g. the coach denied consent).
  if (params.has("error")) {
    const msError = params.get("error") || "unknown"
    console.log(`[coach-calendar/callback] CONSENT_DENIED error=${msError}`)
    return coachErrorRedirect(req, "consent_denied")
  }

  // 3. Token exchange. redirectUri MUST be byte-identical to /connect's.
  const redirectUri = `${getAppUrl(req)}/api/coach/calendar/callback`
  const code = params.get("code") || ""
  if (!code) {
    console.log(
      `[coach-calendar/callback] TOKEN_EXCHANGE_FAILED coachProfileId=${profileId} code=missing_code httpStatus=null`,
    )
    return coachErrorRedirect(req, "token_exchange_failed")
  }

  let tokenResult
  try {
    tokenResult = await exchangeCodeForTokens({ code, redirectUri })
  } catch (err) {
    if (err instanceof MicrosoftGraphError) {
      console.log(
        `[coach-calendar/callback] TOKEN_EXCHANGE_FAILED coachProfileId=${profileId} code=${err.code} httpStatus=${err.httpStatus}`,
      )
    } else {
      console.log(
        `[coach-calendar/callback] TOKEN_EXCHANGE_FAILED coachProfileId=${profileId} code=unknown_error httpStatus=null`,
      )
    }
    return coachErrorRedirect(req, "token_exchange_failed")
  }

  // 4. Identity from the freshly-issued access token.
  let identity
  try {
    identity = await getCallerIdentity({ accessToken: tokenResult.accessToken })
  } catch (err) {
    if (err instanceof MicrosoftGraphError) {
      console.log(
        `[coach-calendar/callback] IDENTITY_FETCH_FAILED coachProfileId=${profileId} code=${err.code} httpStatus=${err.httpStatus}`,
      )
    } else {
      console.log(
        `[coach-calendar/callback] IDENTITY_FETCH_FAILED coachProfileId=${profileId} code=unknown_error httpStatus=null`,
      )
    }
    return coachErrorRedirect(req, "identity_fetch_failed")
  }

  // 5. Upsert the connection (one row per coach; onConflict replaces tokens).
  const expiresAtIso = new Date(
    Date.now() + tokenResult.expiresIn * 1000,
  ).toISOString()
  const supabaseAdmin = getSupabaseAdmin()
  const { error: upsertError } = await supabaseAdmin
    .from("coach_calendar_connections")
    .upsert(
      {
        coach_profile_id: profileId,
        provider: "microsoft",
        access_token: tokenResult.accessToken,
        refresh_token: tokenResult.refreshToken,
        access_token_expires_at: expiresAtIso,
        scopes: tokenResult.scope,
        microsoft_user_id: identity.microsoftUserId,
        microsoft_user_email: identity.microsoftUserEmail,
        microsoft_user_display_name: identity.microsoftUserDisplayName,
        connected_at: new Date().toISOString(),
        last_refreshed_at: null,
        // updated_at handled by the trg_coach_calendar_connections_set_updated_at trigger
      },
      { onConflict: "coach_profile_id" },
    )

  if (upsertError) {
    console.log(
      `[coach-calendar/callback] UPSERT_FAILED coachProfileId=${profileId} dbError=${upsertError.message}`,
    )
    return coachErrorRedirect(req, "storage_failed")
  }

  // 6. Success — clear the state cookie and return to Coach Home.
  console.log(
    `[coach-calendar/callback] TOKEN_EXCHANGE_SUCCESS coachProfileId=${profileId} microsoftUserEmail=${identity.microsoftUserEmail ?? ""} expiresIn=${tokenResult.expiresIn}`,
  )
  const successRes = NextResponse.redirect(
    `${getAppUrl(req)}/dashboard/coach?calendar_connected=1`,
    302,
  )
  successRes.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  })
  return successRes
}
