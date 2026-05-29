/**
 * Microsoft Graph client library for the Coach Calendar Integration (v0.1).
 *
 * Pure module: OAuth 2.0 authorization-code flow helpers + Microsoft Graph
 * API calls (`/me`, `/me/calendarView`). No routes, no DB writes, no UI.
 * The caller (Phase 1d routes) owns persistence, the env beta-gate, auth,
 * and token-refresh orchestration; this module just speaks to Microsoft.
 *
 * FRD: docs/Features/coach-calendar-integration-v0-1-frd.md §6.6, §6.7, §6.10
 *
 * Security: access tokens, refresh tokens, client secrets, and authorization
 * codes are NEVER logged. Only non-sensitive metadata (expiry, scope names,
 * counts, truncated state) is logged per §6.10.
 */

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

const LOG_PREFIX = "[coach-calendar/microsoftGraph]"

const AUTHORIZE_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
const TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token"
const GRAPH_ME_ENDPOINT = "https://graph.microsoft.com/v1.0/me"
const GRAPH_CALENDAR_VIEW_ENDPOINT =
  "https://graph.microsoft.com/v1.0/me/calendarView"

/**
 * v0.1 delegated scopes. Space-separated per the OAuth spec.
 * - Calendars.Read   — read the coach's calendar events
 * - offline_access   — issue a refresh token
 * - openid profile   — basic identity
 * - User.Read        — read /me (display name, email)
 */
const OAUTH_SCOPES = "Calendars.Read offline_access openid profile User.Read"

/** Per-request timeout. */
const REQUEST_TIMEOUT_MS = 10_000

/** Backoff before the single 5xx retry. */
const RETRY_BACKOFF_MS = 1_000

// ─────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────

/**
 * Typed error surfaced by every exported function. The `code` lets the caller
 * branch without string-matching messages.
 *
 * Codes:
 * - `invalid_grant`   — refresh token dead → caller surfaces reconnect_required
 * - `invalid_client`  — app credentials misconfigured (SIGNAL bug, surface 500)
 * - `rate_limited`    — 429 from Graph; `retryAfterSeconds` set from header
 * - `unauthorized`    — 401 from Graph; caller decides whether to refresh+retry
 * - `server_error`    — 5xx from a Microsoft endpoint (after one retry)
 * - `network_error`   — fetch threw (network failure or 10s timeout)
 * - other OAuth `error` values pass through verbatim when unmapped
 */
export class MicrosoftGraphError extends Error {
  constructor(
    public code: string,
    public httpStatus: number | null,
    message: string,
    public retryAfterSeconds: number | null = null
  ) {
    super(message)
    this.name = "MicrosoftGraphError"
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Return shapes
// ─────────────────────────────────────────────────────────────────────────

/** Token-endpoint result, shared by exchange + refresh. */
export interface TokenResult {
  accessToken: string
  refreshToken: string
  /** Lifetime of the access token in seconds (Microsoft's `expires_in`). */
  expiresIn: number
  /** Space-separated granted scopes as returned by Microsoft. */
  scope: string
}

/** Identity from `/me`. */
export interface CallerIdentity {
  microsoftUserId: string
  microsoftUserEmail: string | null
  microsoftUserDisplayName: string | null
}

/** A single calendar event, shaped per FRD §6.4.3 (events array). */
export interface CalendarEvent {
  id: string
  subject: string
  /** ISO8601 in the requested timezone (from Graph `start.dateTime`). */
  start: string
  /** ISO8601 in the requested timezone (from Graph `end.dateTime`). */
  end: string
  is_all_day: boolean
  location: string | null
  /** Total attendees including the organizer. */
  attendee_count: number
  is_online_meeting: boolean
  online_meeting_url: string | null
  organizer_email: string | null
}

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

/** First 8 chars of an opaque value, for non-sensitive log correlation. */
function truncate8(value: string): string {
  return value.slice(0, 8)
}

/** "a b c" → "a,c,c" for compact scope logging. */
function scopesToCsv(scope: string | undefined | null): string {
  if (!scope) return ""
  return scope.trim().split(/\s+/).filter(Boolean).join(",")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ""
  }
}

/**
 * fetch with a 10s abort timeout. Any thrown error (network failure, abort/
 * timeout) is normalized to a `network_error` MicrosoftGraphError.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    throw new MicrosoftGraphError(
      "network_error",
      null,
      `Network error calling ${url}: ${(err as Error)?.message ?? "unknown"}`
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * fetch + single retry on 5xx with a 1s backoff. 4xx (incl. 401/403/429) and
 * 2xx/3xx are returned to the caller as-is for status-specific handling. A
 * network throw is NOT retried (propagates as network_error).
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit
): Promise<Response> {
  const res = await fetchWithTimeout(url, init)
  if (res.status >= 500) {
    await sleep(RETRY_BACKOFF_MS)
    return await fetchWithTimeout(url, init)
  }
  return res
}

/**
 * Parse a token-endpoint response. On failure, logs `<op>_FAILED` and throws
 * a typed error mapping the OAuth `error` field (invalid_grant / invalid_client)
 * or HTTP status (server_error for 5xx).
 */
async function parseTokenResponseOrThrow(
  res: Response,
  op: "TOKEN_EXCHANGE" | "REFRESH"
): Promise<TokenResult> {
  if (!res.ok) {
    let code: string
    let description = ""
    if (res.status >= 500) {
      code = "server_error"
    } else {
      const body = await safeJson(res)
      const oauthError =
        typeof body?.error === "string" ? (body.error as string) : null
      description =
        typeof body?.error_description === "string"
          ? (body.error_description as string)
          : ""
      if (oauthError === "invalid_grant") code = "invalid_grant"
      else if (oauthError === "invalid_client") code = "invalid_client"
      else code = oauthError ?? `http_${res.status}`
    }
    console.log(`${LOG_PREFIX} ${op}_FAILED code=${code} httpStatus=${res.status}`)
    throw new MicrosoftGraphError(
      code,
      res.status,
      description || `${op} failed with HTTP ${res.status}`
    )
  }

  const json = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    scope: string
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    scope: json.scope,
  }
}

/**
 * Map a non-OK Graph response to a typed error, log `<op>_FAILED`, and throw.
 * Never returns.
 */
async function throwGraphError(res: Response, op: string): Promise<never> {
  let code: string
  let retryAfterSeconds: number | null = null

  if (res.status === 401) {
    code = "unauthorized"
  } else if (res.status === 429) {
    code = "rate_limited"
    const ra = res.headers.get("Retry-After")
    if (ra) {
      const parsed = parseInt(ra, 10)
      retryAfterSeconds = Number.isNaN(parsed) ? null : parsed
    }
  } else if (res.status >= 500) {
    code = "server_error"
  } else {
    code = `http_${res.status}`
  }

  const body = await safeText(res)
  console.log(`${LOG_PREFIX} ${op}_FAILED code=${code} httpStatus=${res.status}`)
  throw new MicrosoftGraphError(
    code,
    res.status,
    `${op} failed: HTTP ${res.status} ${body.slice(0, 200)}`,
    retryAfterSeconds
  )
}

/** Transform a raw Microsoft Graph event into the FRD §6.4.3 event shape. */
function transformEvent(ev: Record<string, any>): CalendarEvent {
  const attendees: Array<Record<string, any>> = Array.isArray(ev.attendees)
    ? ev.attendees
    : []
  const organizerEmail: string | null =
    ev.organizer?.emailAddress?.address ?? null

  // attendee_count = total attendees including the organizer. Graph's
  // `attendees` array normally excludes the organizer, so add 1 for them —
  // but dedupe by email in case the organizer also appears as an attendee.
  const attendeeEmails = new Set(
    attendees
      .map((a) => (a?.emailAddress?.address ?? "").toLowerCase())
      .filter(Boolean)
  )
  let attendeeCount = attendees.length
  if (organizerEmail && !attendeeEmails.has(organizerEmail.toLowerCase())) {
    attendeeCount += 1
  }

  return {
    id: String(ev.id ?? ""),
    subject: ev.subject ?? "",
    start: ev.start?.dateTime ?? "",
    end: ev.end?.dateTime ?? "",
    is_all_day: ev.isAllDay === true,
    location: ev.location?.displayName || null,
    attendee_count: attendeeCount,
    is_online_meeting: ev.isOnlineMeeting === true,
    online_meeting_url: ev.onlineMeeting?.joinUrl ?? null,
    organizer_email: organizerEmail,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Exported API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read + validate the Microsoft OAuth app credentials from the environment.
 *
 * @returns `{ clientId, clientSecret }`
 * @throws {Error} if either MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET is
 *   unset. The calendar feature is mandatory (not an optional integration),
 *   so this throws rather than degrading — mirrors the Supabase/Stripe
 *   env-helper convention.
 */
export function getMicrosoftOAuthConfig(): {
  clientId: string
  clientSecret: string
} {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Microsoft OAuth config: MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must both be set."
    )
  }
  return { clientId, clientSecret }
}

/**
 * Compose the Microsoft v2.0 authorize URL the coach is redirected to.
 *
 * @param state - opaque CSRF/state token the caller will verify on callback
 * @param redirectUri - the registered callback URL; must match the one passed
 *   to {@link exchangeCodeForTokens}
 * @returns the fully-composed authorize URL string
 */
export function buildAuthorizeUrl({
  state,
  redirectUri,
}: {
  state: string
  redirectUri: string
}): string {
  const { clientId } = getMicrosoftOAuthConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: OAUTH_SCOPES,
    state,
    prompt: "select_account",
  })
  const url = `${AUTHORIZE_ENDPOINT}?${params.toString()}`
  console.log(`${LOG_PREFIX} AUTHORIZE_URL_BUILT state=${truncate8(state)}`)
  return url
}

/**
 * Exchange an authorization code for tokens (initial connect).
 *
 * @param code - the authorization code from the callback query string
 * @param redirectUri - must match the redirect_uri used in the authorize step
 * @returns `{ accessToken, refreshToken, expiresIn, scope }`
 * @throws {MicrosoftGraphError} on a Microsoft error response — `.code` is the
 *   OAuth error (e.g. `invalid_grant`, `invalid_client`), `server_error` for
 *   5xx, or `network_error` if the request failed/timed out.
 */
export async function exchangeCodeForTokens({
  code,
  redirectUri,
}: {
  code: string
  redirectUri: string
}): Promise<TokenResult> {
  const { clientId, clientSecret } = getMicrosoftOAuthConfig()
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: OAUTH_SCOPES,
  })

  const res = await fetchWithRetry(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  const result = await parseTokenResponseOrThrow(res, "TOKEN_EXCHANGE")
  console.log(
    `${LOG_PREFIX} TOKEN_EXCHANGE_SUCCESS expiresIn=${result.expiresIn} scopesGranted=${scopesToCsv(result.scope)}`
  )
  return result
}

/**
 * Refresh an access token using a stored refresh token.
 *
 * Microsoft rotates refresh tokens on some refreshes — the returned
 * `refreshToken` may differ from the input, and the caller MUST persist
 * whatever the response gives back.
 *
 * @param refreshToken - the stored refresh token
 * @returns `{ accessToken, refreshToken, expiresIn, scope }`
 * @throws {MicrosoftGraphError} with `.code === 'invalid_grant'` when the
 *   refresh token is dead (the signal for the caller to surface
 *   reconnect_required); `invalid_client` for app misconfig; `server_error`
 *   for 5xx; `network_error` on transport failure.
 */
export async function refreshAccessToken({
  refreshToken,
}: {
  refreshToken: string
}): Promise<TokenResult> {
  const { clientId, clientSecret } = getMicrosoftOAuthConfig()
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: OAUTH_SCOPES,
  })

  const res = await fetchWithRetry(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  const result = await parseTokenResponseOrThrow(res, "REFRESH")
  const refreshTokenRotated = result.refreshToken !== refreshToken
  console.log(
    `${LOG_PREFIX} REFRESH_SUCCESS expiresIn=${result.expiresIn} refreshTokenRotated=${refreshTokenRotated}`
  )
  return result
}

/**
 * Fetch the connected account's identity from `/me`.
 *
 * Email is read from `mail` when present, falling back to `userPrincipalName`
 * (Microsoft is inconsistent about which is populated).
 *
 * @param accessToken - a valid Graph access token
 * @returns `{ microsoftUserId, microsoftUserEmail, microsoftUserDisplayName }`
 * @throws {MicrosoftGraphError} `unauthorized` (401 — caller may refresh+retry),
 *   `rate_limited` (429), `server_error` (5xx), or `network_error`.
 */
export async function getCallerIdentity({
  accessToken,
}: {
  accessToken: string
}): Promise<CallerIdentity> {
  const res = await fetchWithRetry(GRAPH_ME_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    await throwGraphError(res, "IDENTITY_FETCH")
  }

  const json = (await res.json()) as {
    id: string
    mail?: string | null
    userPrincipalName?: string | null
    displayName?: string | null
  }
  const email = json.mail ?? json.userPrincipalName ?? null
  console.log(`${LOG_PREFIX} IDENTITY_FETCHED userPrincipalName=${email ?? ""}`)
  return {
    microsoftUserId: json.id,
    microsoftUserEmail: email,
    microsoftUserDisplayName: json.displayName ?? null,
  }
}

/**
 * Fetch today's calendar events via `/me/calendarView`.
 *
 * The caller is responsible for computing the day window in the coach's
 * timezone and passing it as UTC ISO8601 strings. The `tz` is sent via the
 * `Prefer: outlook.timezone` header so Graph returns event times in that zone.
 *
 * @param accessToken - a valid Graph access token
 * @param tz - IANA timezone (e.g. "America/New_York") for the Prefer header
 * @param todayStart - window start as UTC ISO8601 (e.g. "2026-05-29T04:00:00Z")
 * @param todayEnd - window end as UTC ISO8601
 * @returns events shaped per FRD §6.4.3 (the events array, no connection wrapper)
 * @throws {MicrosoftGraphError} `unauthorized` (401 — caller may refresh+retry),
 *   `rate_limited` (429 with `retryAfterSeconds`), `server_error` (5xx or
 *   malformed body), or `network_error`.
 */
export async function fetchTodaysEvents({
  accessToken,
  tz,
  todayStart,
  todayEnd,
}: {
  accessToken: string
  tz: string
  todayStart: string
  todayEnd: string
}): Promise<CalendarEvent[]> {
  // Build the query string manually so the OData `$` params stay literal while
  // the timestamp values are URL-encoded (FRD §6.7 / verification note).
  const queryString = [
    `startDateTime=${encodeURIComponent(todayStart)}`,
    `endDateTime=${encodeURIComponent(todayEnd)}`,
    `$orderby=${encodeURIComponent("start/dateTime")}`,
    `$top=50`,
  ].join("&")
  const url = `${GRAPH_CALENDAR_VIEW_ENDPOINT}?${queryString}`

  const startedAt = Date.now()
  const res = await fetchWithRetry(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: `outlook.timezone="${tz}"`,
    },
  })
  const latencyMs = Date.now() - startedAt

  if (!res.ok) {
    await throwGraphError(res, "EVENTS_FETCH")
  }

  let json: { value?: unknown }
  try {
    json = (await res.json()) as { value?: unknown }
  } catch {
    console.log(
      `${LOG_PREFIX} EVENTS_FETCH_FAILED code=server_error httpStatus=${res.status}`
    )
    throw new MicrosoftGraphError(
      "server_error",
      res.status,
      "Malformed response from Microsoft Graph (body was not valid JSON)"
    )
  }

  const rawEvents: Array<Record<string, any>> = Array.isArray(json.value)
    ? (json.value as Array<Record<string, any>>)
    : []
  const events = rawEvents.map(transformEvent)
  console.log(
    `${LOG_PREFIX} EVENTS_FETCHED count=${events.length} latencyMs=${latencyMs}`
  )
  return events
}
