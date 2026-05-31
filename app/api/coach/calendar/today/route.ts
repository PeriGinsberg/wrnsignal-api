// app/api/coach/calendar/today/route.ts
//
// GET /api/coach/calendar/today — Phase 1d Commit 2.
//
// Returns today's calendar events for the calling coach. JSON API endpoint
// (Bearer auth, called by the frontend — not a browser navigation). NO beta-gate
// here: once a coach has a connection row they can always read/disconnect it,
// even if later removed from CALENDAR_BETA_PROFILE_IDS (the gate only controls
// who sees the Connect button).
//
// Token lifecycle: proactively refresh when the access token is within 60s of
// expiry; if Microsoft still 401s the fetch, do ONE refresh+retry, then give up
// with reconnect_required. Strictly one retry — never loop.
//
// FRD: docs/Features/coach-calendar-integration-v0-1-frd.md §6.4.3, §6.5, §6.6, §6.9, §6.10

import { NextRequest, NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  fetchTodaysEvents,
  refreshAccessToken,
  MicrosoftGraphError,
  type CalendarEvent,
} from "@/lib/coach/microsoftGraph"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

// ── Timezone day-window helpers ──────────────────────────────────────────────
// Compute [local-midnight-today, local-midnight-tomorrow) in `tz`, expressed as
// UTC ISO8601, with no external deps. Bad/unknown tz falls back to UTC.

function normalizeTz(tz: string): string {
  try {
    // Throws RangeError for an invalid IANA zone.
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return tz
  } catch {
    return "UTC"
  }
}

// Offset in ms such that: localWallClock = utcInstant + offset, evaluated at
// `date`. (Positive for zones ahead of UTC, negative for behind.)
function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value
  let hour = Number(map.hour)
  if (hour === 24) hour = 0 // some runtimes emit "24" for midnight
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  )
  return asUtc - date.getTime()
}

// UTC ISO for local midnight (+ addDays) of dateStr ("YYYY-MM-DD") in tz.
// Offset is sampled at the guessed instant; the only imprecision is a ±1h skew
// if a DST transition falls between the guess and the true local midnight — an
// accepted edge for a today's-calendar window (calendarView tolerates it).
function zonedMidnightUtcIso(dateStr: string, tz: string, addDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const guessUtc = Date.UTC(y, m - 1, d + addDays, 0, 0, 0)
  const offset = tzOffsetMs(new Date(guessUtc), tz)
  return new Date(guessUtc - offset).toISOString()
}

// ── Small response helpers ───────────────────────────────────────────────────
function jsonErr(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status })
}

function rateLimitedResponse(profileId: string, err: MicrosoftGraphError): NextResponse {
  const n = err.retryAfterSeconds ?? 60
  console.log(
    `[coach-calendar/today] FETCH_FAILED coachProfileId=${profileId} code=rate_limited httpStatus=${err.httpStatus}`,
  )
  const res = NextResponse.json(
    { error: "rate_limited", retry_after_seconds: n },
    { status: 429 },
  )
  res.headers.set("Retry-After", String(n))
  return res
}

// Persist refreshed tokens. A persist failure is logged but non-fatal: the
// caller still has a working in-memory access token for this request (the next
// request would just re-refresh, or surface reconnect_required if the rotated
// refresh token wasn't saved).
async function persistRefresh(
  supabase: SupabaseClient,
  profileId: string,
  refreshed: { accessToken: string; refreshToken: string; expiresIn: number },
): Promise<void> {
  const { error } = await supabase
    .from("coach_calendar_connections")
    .update({
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      access_token_expires_at: new Date(
        Date.now() + refreshed.expiresIn * 1000,
      ).toISOString(),
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("coach_profile_id", profileId)
  if (error) {
    console.warn(
      `[coach-calendar/today] REFRESH_PERSIST_FAILED coachProfileId=${profileId} dbError=${error.message}`,
    )
  }
}

// Fetch events; on a Graph 401, refresh ONCE and retry ONCE. Returns the events
// or a NextResponse to return immediately. Never loops.
async function fetchEventsWithRetry(
  supabase: SupabaseClient,
  profileId: string,
  refreshToken: string,
  accessToken: string,
  tz: string,
  todayStart: string,
  todayEnd: string,
): Promise<CalendarEvent[] | NextResponse> {
  try {
    return await fetchTodaysEvents({ accessToken, tz, todayStart, todayEnd })
  } catch (err) {
    if (!(err instanceof MicrosoftGraphError)) {
      console.error(`[coach-calendar/today] FETCH_FAILED coachProfileId=${profileId}`, err)
      return jsonErr("internal_error", 500)
    }
    if (err.code === "rate_limited") return rateLimitedResponse(profileId, err)
    if (err.code !== "unauthorized") {
      // server_error (already retried in the module) or any other Graph error.
      console.log(
        `[coach-calendar/today] FETCH_FAILED coachProfileId=${profileId} code=${err.code} httpStatus=${err.httpStatus}`,
      )
      return jsonErr("upstream_error", 502)
    }

    // 401 from Graph despite the proactive check — one refresh + retry.
    console.log(`[coach-calendar/today] FETCH_RETRY coachProfileId=${profileId}`)
    let retryToken = accessToken
    try {
      const refreshed = await refreshAccessToken({ refreshToken })
      retryToken = refreshed.accessToken
      await persistRefresh(supabase, profileId, refreshed)
    } catch (refreshErr) {
      if (refreshErr instanceof MicrosoftGraphError && refreshErr.code === "invalid_grant") {
        console.log(`[coach-calendar/today] REFRESH_FAILED coachProfileId=${profileId} reason=invalid_grant`)
        console.log(`[coach-calendar/today] RECONNECT_REQUIRED coachProfileId=${profileId}`)
        return jsonErr("reconnect_required", 401)
      }
      if (refreshErr instanceof MicrosoftGraphError) {
        console.log(`[coach-calendar/today] REFRESH_FAILED coachProfileId=${profileId} reason=${refreshErr.code}`)
        return jsonErr("upstream_error", 502)
      }
      console.error(`[coach-calendar/today] REFRESH_FAILED coachProfileId=${profileId}`, refreshErr)
      return jsonErr("internal_error", 500)
    }

    try {
      return await fetchTodaysEvents({ accessToken: retryToken, tz, todayStart, todayEnd })
    } catch (retryErr) {
      if (retryErr instanceof MicrosoftGraphError && retryErr.code === "rate_limited") {
        return rateLimitedResponse(profileId, retryErr)
      }
      if (retryErr instanceof MicrosoftGraphError && retryErr.code === "unauthorized") {
        // Refresh token is valid but Microsoft keeps rejecting — needs fresh consent.
        console.log(`[coach-calendar/today] RECONNECT_REQUIRED coachProfileId=${profileId}`)
        return jsonErr("reconnect_required", 401)
      }
      if (retryErr instanceof MicrosoftGraphError) {
        console.log(
          `[coach-calendar/today] FETCH_FAILED coachProfileId=${profileId} code=${retryErr.code} httpStatus=${retryErr.httpStatus}`,
        )
        return jsonErr("upstream_error", 502)
      }
      console.error(`[coach-calendar/today] FETCH_FAILED coachProfileId=${profileId}`, retryErr)
      return jsonErr("internal_error", 500)
    }
  }
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now()

  // 1. Auth.
  let userId: string
  let email: string | null
  try {
    const authed = await getAuthedUser(req)
    userId = authed.userId
    email = authed.email
  } catch {
    return jsonErr("unauthenticated", 401)
  }

  let profileId: string
  try {
    profileId = await getProfileId(userId, email)
  } catch {
    return jsonErr("unauthenticated", 401)
  }

  const supabase = getSupabaseAdmin()
  if (!(await verifyCoach(profileId, supabase))) {
    return jsonErr("not_a_coach", 403)
  }

  // 2. Connection lookup.
  const { data: conn, error: connErr } = await supabase
    .from("coach_calendar_connections")
    .select(
      "access_token, refresh_token, access_token_expires_at, microsoft_user_email, microsoft_user_display_name, connected_at",
    )
    .eq("coach_profile_id", profileId)
    .maybeSingle()

  if (connErr) {
    console.error(`[coach-calendar/today] CONNECTION_LOOKUP_FAILED coachProfileId=${profileId}`, connErr)
    return jsonErr("internal_error", 500)
  }
  if (!conn) {
    console.log(`[coach-calendar/today] NOT_CONNECTED coachProfileId=${profileId}`)
    return jsonErr("not_connected", 404)
  }

  // 3. Day window (tz-aware; UTC fallback on bad tz).
  const tz = normalizeTz(req.nextUrl.searchParams.get("tz") || "UTC")
  const todayInTz = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()) // "YYYY-MM-DD"
  const todayStart = zonedMidnightUtcIso(todayInTz, tz, 0)
  const todayEnd = zonedMidnightUtcIso(todayInTz, tz, 1)

  // 4. Proactive refresh if the access token expires within 60s.
  let accessToken = conn.access_token as string
  let refreshToken = conn.refresh_token as string
  const expiresAtMs = new Date(conn.access_token_expires_at as string).getTime()
  const nowMs = Date.now()
  if (expiresAtMs < nowMs + 60_000) {
    console.log(
      `[coach-calendar/today] REFRESH_NEEDED coachProfileId=${profileId} expiredBy=${Math.round((nowMs - expiresAtMs) / 1000)}`,
    )
    try {
      const refreshed = await refreshAccessToken({ refreshToken })
      accessToken = refreshed.accessToken
      refreshToken = refreshed.refreshToken
      await persistRefresh(supabase, profileId, refreshed)
    } catch (err) {
      if (err instanceof MicrosoftGraphError && err.code === "invalid_grant") {
        console.log(`[coach-calendar/today] REFRESH_FAILED coachProfileId=${profileId} reason=invalid_grant`)
        console.log(`[coach-calendar/today] RECONNECT_REQUIRED coachProfileId=${profileId}`)
        return jsonErr("reconnect_required", 401)
      }
      if (err instanceof MicrosoftGraphError) {
        console.log(`[coach-calendar/today] REFRESH_FAILED coachProfileId=${profileId} reason=${err.code}`)
        return jsonErr("upstream_error", 502)
      }
      console.error(`[coach-calendar/today] REFRESH_FAILED coachProfileId=${profileId}`, err)
      return jsonErr("internal_error", 500)
    }
  }

  // 5. Fetch events (one-retry on 401).
  const result = await fetchEventsWithRetry(
    supabase,
    profileId,
    refreshToken,
    accessToken,
    tz,
    todayStart,
    todayEnd,
  )
  if (result instanceof NextResponse) return result
  const events = result

  // 6. Touch last_used_at — fire-and-forget (analytics; never fail the request).
  void supabase
    .from("coach_calendar_connections")
    .update({ last_used_at: new Date().toISOString() })
    .eq("coach_profile_id", profileId)
    .then(({ error }) => {
      if (error) {
        console.warn(
          `[coach-calendar/today] LAST_USED_UPDATE_FAILED coachProfileId=${profileId} dbError=${error.message}`,
        )
      }
    })

  // 7. Respond.
  const latencyMs = Date.now() - startedAt
  console.log(
    `[coach-calendar/today] FETCH_SUCCESS coachProfileId=${profileId} eventCount=${events.length} latencyMs=${latencyMs}`,
  )
  return NextResponse.json(
    {
      connection: {
        connected_email: (conn.microsoft_user_email as string | null) ?? null,
        connected_display_name: (conn.microsoft_user_display_name as string | null) ?? null,
        connected_at: conn.connected_at as string,
      },
      events,
      fetched_at: new Date().toISOString(),
    },
    { status: 200 },
  )
}
