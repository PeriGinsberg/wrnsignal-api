// scripts/verify-microsoft-graph.ts
//
// Verification script for the Microsoft Graph client library
// (lib/coach/microsoftGraph.ts, shipped in commit 13fa628a — Phase 1c Commit 1).
//
// 100% mocked fetch — NO live Microsoft endpoints are hit. Covers the happy
// path and every named error code in FRD §6.7 across the 6 exported functions.
//
// Run:
//   npx tsx scripts/verify-microsoft-graph.ts
//   (or: npm run calendar:verify)
//
// Exits 0 when all tests pass, 1 on any failure. Each test restores the
// global fetch / env it mutated in a finally block.
//
// FRD: docs/Features/coach-calendar-integration-v0-1-frd.md §8

import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchTodaysEvents,
  getCallerIdentity,
  getMicrosoftOAuthConfig,
  MicrosoftGraphError,
  refreshAccessToken,
} from "@/lib/coach/microsoftGraph"

// ─────────────────────────────────────────────────────────────────────────
// Result tracking
// ─────────────────────────────────────────────────────────────────────────

interface TestResult {
  name: string
  passed: boolean
  reason?: string
}

const results: TestResult[] = []

async function runTest(
  name: string,
  fn: () => Promise<void> | void
): Promise<void> {
  try {
    await fn()
    results.push({ name, passed: true })
    console.log(`✅ ${name}`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    results.push({ name, passed: false, reason })
    console.log(`❌ ${name}`)
    console.log(`   → ${reason}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Mock fetch
// ─────────────────────────────────────────────────────────────────────────

type MockResponse = {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

interface CapturedCall {
  url: string
  init: RequestInit | undefined
}

function buildResponse(spec: MockResponse): Response {
  const headers = new Headers(spec.headers ?? {})
  let bodyStr: string | null = null
  if (spec.body !== undefined) {
    bodyStr =
      typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body)
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }
  }
  return new Response(bodyStr, { status: spec.status, headers })
}

/**
 * Override globalThis.fetch with a mock. Pass a single MockResponse to return
 * it on every call, or an array to return successive responses (the last
 * element is reused if the module makes more calls than provided). Captures
 * every (url, init) for assertion.
 */
function installMockFetch(response: MockResponse | MockResponse[]): {
  calls: CapturedCall[]
  restore: () => void
} {
  const original = globalThis.fetch
  const queue = Array.isArray(response) ? [...response] : null
  const single = Array.isArray(response) ? null : response
  const calls: CapturedCall[] = []

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String(input)
    calls.push({ url, init })

    let spec: MockResponse
    if (queue) {
      spec = queue.length > 1 ? (queue.shift() as MockResponse) : queue[0]
    } else {
      spec = single as MockResponse
    }
    return buildResponse(spec)
  }) as unknown as typeof fetch

  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Env helpers
// ─────────────────────────────────────────────────────────────────────────

function setMockEnv(): () => void {
  const originalId = process.env.MICROSOFT_CLIENT_ID
  const originalSecret = process.env.MICROSOFT_CLIENT_SECRET
  process.env.MICROSOFT_CLIENT_ID = "test-client-id"
  process.env.MICROSOFT_CLIENT_SECRET = "test-client-secret"
  return () => {
    // Guard against `process.env.X = undefined` (which stringifies to
    // "undefined"); delete the key when it was originally unset.
    if (originalId === undefined) delete process.env.MICROSOFT_CLIENT_ID
    else process.env.MICROSOFT_CLIENT_ID = originalId
    if (originalSecret === undefined) delete process.env.MICROSOFT_CLIENT_SECRET
    else process.env.MICROSOFT_CLIENT_SECRET = originalSecret
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Assertions
// ─────────────────────────────────────────────────────────────────────────

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    )
  }
}

function assertTrue(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function assertThrows(fn: () => unknown, msg: string): Error {
  try {
    fn()
  } catch (e) {
    return e as Error
  }
  throw new Error(`${msg}: expected function to throw, but it did not`)
}

async function assertThrowsAsync(
  fn: () => Promise<unknown>,
  msg: string
): Promise<Error> {
  try {
    await fn()
  } catch (e) {
    return e as Error
  }
  throw new Error(`${msg}: expected async function to throw, but it did not`)
}

function asGraphError(err: Error, msg: string): MicrosoftGraphError {
  if (!(err instanceof MicrosoftGraphError)) {
    throw new Error(
      `${msg}: expected MicrosoftGraphError, got ${err?.constructor?.name ?? typeof err}`
    )
  }
  return err
}

// ─────────────────────────────────────────────────────────────────────────
// Test groups
// ─────────────────────────────────────────────────────────────────────────

async function group1_getMicrosoftOAuthConfig(): Promise<void> {
  console.log("\nGroup 1: getMicrosoftOAuthConfig")

  await runTest("Returns config when both env vars set", () => {
    const restoreEnv = setMockEnv()
    try {
      const cfg = getMicrosoftOAuthConfig()
      assertEqual(cfg.clientId, "test-client-id", "clientId")
      assertEqual(cfg.clientSecret, "test-client-secret", "clientSecret")
    } finally {
      restoreEnv()
    }
  })

  await runTest("Throws when either env var missing", () => {
    const restoreEnv = setMockEnv()
    try {
      delete process.env.MICROSOFT_CLIENT_SECRET
      const err = assertThrows(
        () => getMicrosoftOAuthConfig(),
        "getMicrosoftOAuthConfig with missing secret"
      )
      assertTrue(err instanceof Error, "thrown value is an Error")
      assertTrue(
        !(err instanceof MicrosoftGraphError),
        "thrown error is a plain Error, not MicrosoftGraphError"
      )
    } finally {
      restoreEnv()
    }
  })
}

async function group2_buildAuthorizeUrl(): Promise<void> {
  console.log("\nGroup 2: buildAuthorizeUrl")

  await runTest("Composes correct URL with all required params", () => {
    const restoreEnv = setMockEnv()
    try {
      const url = buildAuthorizeUrl({
        state: "test-state-12345",
        redirectUri: "https://example.com/cb",
      })
      const p = new URL(url).searchParams
      assertEqual(p.get("client_id"), "test-client-id", "client_id")
      assertEqual(p.get("response_type"), "code", "response_type")
      assertEqual(p.get("redirect_uri"), "https://example.com/cb", "redirect_uri")
      assertEqual(p.get("response_mode"), "query", "response_mode")
      assertEqual(
        p.get("scope"),
        "Calendars.Read offline_access openid profile User.Read",
        "scope"
      )
      assertEqual(p.get("state"), "test-state-12345", "state")
      assertEqual(p.get("prompt"), "select_account", "prompt")
    } finally {
      restoreEnv()
    }
  })

  await runTest("Endpoint is the v2.0 common authorize endpoint", () => {
    const restoreEnv = setMockEnv()
    try {
      const url = buildAuthorizeUrl({
        state: "s",
        redirectUri: "https://example.com/cb",
      })
      const parsed = new URL(url)
      assertEqual(
        parsed.origin + parsed.pathname,
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "authorize endpoint origin+pathname"
      )
    } finally {
      restoreEnv()
    }
  })

  await runTest("State is URL-encoded", () => {
    const restoreEnv = setMockEnv()
    try {
      const state = "state with spaces&equals=ok"
      const url = buildAuthorizeUrl({
        state,
        redirectUri: "https://example.com/cb",
      })
      assertTrue(
        !url.includes("state with spaces"),
        "raw URL does not contain the unencoded state value"
      )
      assertEqual(
        new URL(url).searchParams.get("state"),
        state,
        "state round-trips back to original after decode"
      )
    } finally {
      restoreEnv()
    }
  })
}

async function group3_exchangeCodeForTokens(): Promise<void> {
  console.log("\nGroup 3: exchangeCodeForTokens")

  await runTest("Happy path returns TokenResult shape", async () => {
    const restoreEnv = setMockEnv()
    const mock = installMockFetch({
      status: 200,
      body: {
        access_token: "AT",
        refresh_token: "RT",
        expires_in: 3599,
        scope: "Calendars.Read offline_access",
      },
    })
    try {
      const result = await exchangeCodeForTokens({
        code: "auth-code",
        redirectUri: "https://example.com/cb",
      })
      assertEqual(result.accessToken, "AT", "accessToken")
      assertEqual(result.refreshToken, "RT", "refreshToken")
      assertEqual(result.expiresIn, 3599, "expiresIn")
      assertEqual(result.scope, "Calendars.Read offline_access", "scope")
    } finally {
      mock.restore()
      restoreEnv()
    }
  })

  await runTest("POSTs form-encoded body to /token endpoint", async () => {
    const restoreEnv = setMockEnv()
    const mock = installMockFetch({
      status: 200,
      body: { access_token: "AT", refresh_token: "RT", expires_in: 3599, scope: "x" },
    })
    try {
      await exchangeCodeForTokens({
        code: "AUTHCODE123",
        redirectUri: "https://example.com/cb",
      })
      assertEqual(mock.calls.length, 1, "exactly one fetch call")
      const call = mock.calls[0]
      assertEqual(
        call.url,
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "token endpoint URL"
      )
      assertEqual(call.init?.method, "POST", "method is POST")
      const headers = call.init?.headers as Record<string, string>
      assertEqual(
        headers["Content-Type"],
        "application/x-www-form-urlencoded",
        "Content-Type header"
      )
      const body = String(call.init?.body)
      assertTrue(body.includes("client_id=test-client-id"), "body has client_id")
      assertTrue(
        body.includes("client_secret=test-client-secret"),
        "body has client_secret"
      )
      assertTrue(body.includes("code=AUTHCODE123"), "body has code")
      assertTrue(body.includes("redirect_uri="), "body has redirect_uri")
      assertTrue(
        body.includes("grant_type=authorization_code"),
        "body has grant_type=authorization_code"
      )
      assertTrue(body.includes("scope="), "body has scope")
    } finally {
      mock.restore()
      restoreEnv()
    }
  })

  await runTest(
    "Throws MicrosoftGraphError with code=invalid_grant on Microsoft 400",
    async () => {
      const restoreEnv = setMockEnv()
      const mock = installMockFetch({
        status: 400,
        body: { error: "invalid_grant", error_description: "AADSTS70008" },
      })
      try {
        const err = await assertThrowsAsync(
          () =>
            exchangeCodeForTokens({ code: "bad", redirectUri: "https://x/cb" }),
          "exchange with invalid_grant"
        )
        const ge = asGraphError(err, "invalid_grant exchange")
        assertEqual(ge.code, "invalid_grant", "err.code")
        assertEqual(ge.httpStatus, 400, "err.httpStatus")
      } finally {
        mock.restore()
        restoreEnv()
      }
    }
  )

  await runTest(
    "Throws MicrosoftGraphError with code=invalid_client on Microsoft 400",
    async () => {
      const restoreEnv = setMockEnv()
      const mock = installMockFetch({
        status: 400,
        body: { error: "invalid_client", error_description: "AADSTS7000215" },
      })
      try {
        const err = await assertThrowsAsync(
          () =>
            exchangeCodeForTokens({ code: "bad", redirectUri: "https://x/cb" }),
          "exchange with invalid_client"
        )
        const ge = asGraphError(err, "invalid_client exchange")
        assertEqual(ge.code, "invalid_client", "err.code")
        assertEqual(ge.httpStatus, 400, "err.httpStatus")
      } finally {
        mock.restore()
        restoreEnv()
      }
    }
  )
}

async function group4_refreshAccessToken(): Promise<void> {
  console.log("\nGroup 4: refreshAccessToken")

  await runTest("Happy path returns TokenResult", async () => {
    const restoreEnv = setMockEnv()
    const mock = installMockFetch({
      status: 200,
      body: {
        access_token: "AT2",
        refresh_token: "RT2",
        expires_in: 3599,
        scope: "Calendars.Read offline_access",
      },
    })
    try {
      const result = await refreshAccessToken({ refreshToken: "OLD" })
      assertEqual(result.accessToken, "AT2", "accessToken")
      assertEqual(result.refreshToken, "RT2", "refreshToken")
      assertEqual(result.expiresIn, 3599, "expiresIn")
      assertEqual(result.scope, "Calendars.Read offline_access", "scope")
    } finally {
      mock.restore()
      restoreEnv()
    }
  })

  await runTest(
    "Returns the refresh_token from response (rotation case)",
    async () => {
      const restoreEnv = setMockEnv()
      const mock = installMockFetch({
        status: 200,
        body: {
          access_token: "AT",
          refresh_token: "NEW_REFRESH",
          expires_in: 3599,
          scope: "s",
        },
      })
      try {
        const result = await refreshAccessToken({ refreshToken: "OLD_REFRESH" })
        assertEqual(
          result.refreshToken,
          "NEW_REFRESH",
          "returns the rotated refresh token from the response"
        )
      } finally {
        mock.restore()
        restoreEnv()
      }
    }
  )

  await runTest(
    "Returns the input refresh_token when Microsoft doesn't rotate",
    async () => {
      const restoreEnv = setMockEnv()
      const mock = installMockFetch({
        status: 200,
        body: {
          access_token: "AT",
          refresh_token: "SAME_REFRESH",
          expires_in: 3599,
          scope: "s",
        },
      })
      try {
        const result = await refreshAccessToken({ refreshToken: "SAME_REFRESH" })
        assertEqual(
          result.refreshToken,
          "SAME_REFRESH",
          "returns the same refresh token when not rotated"
        )
      } finally {
        mock.restore()
        restoreEnv()
      }
    }
  )

  await runTest("Throws invalid_grant when refresh token dead", async () => {
    const restoreEnv = setMockEnv()
    const mock = installMockFetch({
      status: 400,
      body: { error: "invalid_grant", error_description: "token expired" },
    })
    try {
      const err = await assertThrowsAsync(
        () => refreshAccessToken({ refreshToken: "DEAD" }),
        "refresh with dead token"
      )
      const ge = asGraphError(err, "refresh invalid_grant")
      assertEqual(ge.code, "invalid_grant", "err.code (reconnect_required signal)")
      assertEqual(ge.httpStatus, 400, "err.httpStatus")
    } finally {
      mock.restore()
      restoreEnv()
    }
  })
}

async function group5_getCallerIdentity(): Promise<void> {
  console.log("\nGroup 5: getCallerIdentity")

  await runTest(
    "Happy path with both mail and userPrincipalName populated — prefers mail",
    async () => {
      const mock = installMockFetch({
        status: 200,
        body: {
          id: "user-123",
          mail: "peri@workforcereadynow.com",
          userPrincipalName: "peri@WORKFORCEREADYNOW.COM",
          displayName: "Peri Ginsberg",
        },
      })
      try {
        const id = await getCallerIdentity({ accessToken: "AT" })
        assertEqual(id.microsoftUserId, "user-123", "microsoftUserId")
        assertEqual(
          id.microsoftUserEmail,
          "peri@workforcereadynow.com",
          "prefers `mail` over `userPrincipalName`"
        )
        assertEqual(
          id.microsoftUserDisplayName,
          "Peri Ginsberg",
          "microsoftUserDisplayName"
        )
      } finally {
        mock.restore()
      }
    }
  )

  await runTest("Falls back to userPrincipalName when mail is null", async () => {
    const mock = installMockFetch({
      status: 200,
      body: {
        id: "user-456",
        mail: null,
        userPrincipalName: "peri@example.com",
        displayName: "Peri",
      },
    })
    try {
      const id = await getCallerIdentity({ accessToken: "AT" })
      assertEqual(
        id.microsoftUserEmail,
        "peri@example.com",
        "falls back to userPrincipalName when mail is null"
      )
    } finally {
      mock.restore()
    }
  })

  await runTest("Throws unauthorized on 401", async () => {
    const mock = installMockFetch({
      status: 401,
      body: { error: { code: "InvalidAuthenticationToken" } },
    })
    try {
      const err = await assertThrowsAsync(
        () => getCallerIdentity({ accessToken: "BAD" }),
        "identity 401"
      )
      const ge = asGraphError(err, "identity unauthorized")
      assertEqual(ge.code, "unauthorized", "err.code")
      assertEqual(ge.httpStatus, 401, "err.httpStatus")
    } finally {
      mock.restore()
    }
  })
}

async function group6_fetchTodaysEvents(): Promise<void> {
  console.log("\nGroup 6: fetchTodaysEvents")

  const event1 = {
    id: "evt-1",
    subject: "Coaching Session — Catherine",
    start: { dateTime: "2026-05-29T09:00:00.0000000", timeZone: "America/New_York" },
    end: { dateTime: "2026-05-29T09:30:00.0000000", timeZone: "America/New_York" },
    isAllDay: false,
    location: { displayName: "Zoom" },
    attendees: [
      { emailAddress: { address: "catherine@example.com" } },
      { emailAddress: { address: "peri@workforcereadynow.com" } },
    ],
    organizer: { emailAddress: { address: "peri@workforcereadynow.com" } },
    isOnlineMeeting: true,
    onlineMeeting: { joinUrl: "https://zoom.us/j/123" },
  }
  const event2 = {
    id: "evt-2",
    subject: "Holiday",
    start: { dateTime: "2026-05-29T00:00:00.0000000", timeZone: "America/New_York" },
    end: { dateTime: "2026-05-30T00:00:00.0000000", timeZone: "America/New_York" },
    isAllDay: true,
    location: { displayName: "" },
    attendees: [],
    organizer: { emailAddress: { address: "peri@workforcereadynow.com" } },
    isOnlineMeeting: false,
  }

  await runTest("Happy path returns transformed events", async () => {
    const mock = installMockFetch({
      status: 200,
      body: { value: [event1, event2] },
    })
    try {
      const events = await fetchTodaysEvents({
        accessToken: "AT",
        tz: "America/New_York",
        todayStart: "2026-05-29T04:00:00Z",
        todayEnd: "2026-05-30T04:00:00Z",
      })
      assertEqual(events.length, 2, "two events returned")

      const e1 = events[0]
      assertEqual(e1.id, "evt-1", "e1.id")
      assertEqual(e1.subject, "Coaching Session — Catherine", "e1.subject")
      assertEqual(e1.start, "2026-05-29T09:00:00.0000000", "e1.start")
      assertEqual(e1.end, "2026-05-29T09:30:00.0000000", "e1.end")
      assertEqual(e1.is_all_day, false, "e1.is_all_day (snake_case)")
      assertEqual(e1.location, "Zoom", "e1.location")
      assertEqual(e1.is_online_meeting, true, "e1.is_online_meeting (snake_case)")
      assertEqual(
        e1.online_meeting_url,
        "https://zoom.us/j/123",
        "e1.online_meeting_url (snake_case)"
      )
      assertEqual(
        e1.organizer_email,
        "peri@workforcereadynow.com",
        "e1.organizer_email (snake_case)"
      )
      // organizer is already in the attendees list → no double-count → 2
      assertEqual(
        e1.attendee_count,
        2,
        "e1.attendee_count dedupes organizer already in attendees"
      )

      const e2 = events[1]
      assertEqual(e2.is_all_day, true, "e2.is_all_day")
      assertEqual(e2.location, null, "e2 empty displayName → null")
      assertEqual(e2.online_meeting_url, null, "e2 no onlineMeeting → null")
      // 0 attendees + organizer not in list → +1 → 1
      assertEqual(
        e2.attendee_count,
        1,
        "e2.attendee_count adds organizer when absent from attendees"
      )
    } finally {
      mock.restore()
    }
  })

  await runTest("URL contains OData params with $ literal preserved", async () => {
    const mock = installMockFetch({ status: 200, body: { value: [] } })
    try {
      await fetchTodaysEvents({
        accessToken: "AT",
        tz: "America/New_York",
        todayStart: "2026-05-29T04:00:00Z",
        todayEnd: "2026-05-30T04:00:00Z",
      })
      const url = mock.calls[0].url
      assertTrue(url.includes("$orderby="), "literal $orderby preserved")
      assertTrue(url.includes("$top=50"), "literal $top=50 preserved")
      assertTrue(
        !url.includes("%24orderby") && !url.includes("%24top"),
        "$ is NOT percent-encoded (would break OData)"
      )
      assertTrue(
        url.includes("startDateTime=2026-05-29T04%3A00%3A00Z"),
        "startDateTime is URL-encoded (colons → %3A)"
      )
      assertTrue(
        url.includes("endDateTime=2026-05-30T04%3A00%3A00Z"),
        "endDateTime is URL-encoded"
      )
    } finally {
      mock.restore()
    }
  })

  await runTest("Sends Prefer: outlook.timezone header", async () => {
    const mock = installMockFetch({ status: 200, body: { value: [] } })
    try {
      await fetchTodaysEvents({
        accessToken: "AT",
        tz: "America/New_York",
        todayStart: "2026-05-29T04:00:00Z",
        todayEnd: "2026-05-30T04:00:00Z",
      })
      const headers = mock.calls[0].init?.headers as Record<string, string>
      assertEqual(
        headers["Prefer"],
        'outlook.timezone="America/New_York"',
        "Prefer header with the requested tz"
      )
      assertEqual(headers["Authorization"], "Bearer AT", "Authorization header")
    } finally {
      mock.restore()
    }
  })

  await runTest("Throws rate_limited on 429 with Retry-After header", async () => {
    const mock = installMockFetch({
      status: 429,
      headers: { "Retry-After": "60" },
      body: { error: { code: "TooManyRequests" } },
    })
    try {
      const err = await assertThrowsAsync(
        () =>
          fetchTodaysEvents({
            accessToken: "AT",
            tz: "UTC",
            todayStart: "2026-05-29T00:00:00Z",
            todayEnd: "2026-05-30T00:00:00Z",
          }),
        "events 429"
      )
      const ge = asGraphError(err, "events rate_limited")
      assertEqual(ge.code, "rate_limited", "err.code")
      assertEqual(ge.httpStatus, 429, "err.httpStatus")
      assertEqual(ge.retryAfterSeconds, 60, "err.retryAfterSeconds from header")
    } finally {
      mock.restore()
    }
  })

  await runTest("Throws server_error on 503 after one retry", async () => {
    const mock = installMockFetch([
      { status: 503, body: {} },
      { status: 503, body: {} },
    ])
    try {
      const err = await assertThrowsAsync(
        () =>
          fetchTodaysEvents({
            accessToken: "AT",
            tz: "UTC",
            todayStart: "2026-05-29T00:00:00Z",
            todayEnd: "2026-05-30T00:00:00Z",
          }),
        "events 503 twice"
      )
      const ge = asGraphError(err, "events server_error")
      assertEqual(ge.code, "server_error", "err.code")
      assertEqual(ge.httpStatus, 503, "err.httpStatus")
      assertEqual(mock.calls.length, 2, "retried once on 5xx (2 total calls)")
    } finally {
      mock.restore()
    }
  })

  await runTest("Returns empty array when value missing from response", async () => {
    const mock = installMockFetch({ status: 200, body: {} })
    try {
      const events = await fetchTodaysEvents({
        accessToken: "AT",
        tz: "UTC",
        todayStart: "2026-05-29T00:00:00Z",
        todayEnd: "2026-05-30T00:00:00Z",
      })
      assertEqual(events.length, 0, "empty array when `value` key is absent")
    } finally {
      mock.restore()
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[verify-microsoft-graph] Starting verification...")

  await group1_getMicrosoftOAuthConfig()
  await group2_buildAuthorizeUrl()
  await group3_exchangeCodeForTokens()
  await group4_refreshAccessToken()
  await group5_getCallerIdentity()
  await group6_fetchTodaysEvents()

  const passed = results.filter((r) => r.passed).length
  const failed = results.length - passed

  console.log("\n" + "─".repeat(40))
  console.log(`Total: ${passed} passed, ${failed} failed`)

  if (failed > 0) {
    console.log("\nFailures:")
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ❌ ${r.name}`)
      console.log(`     ${r.reason ?? "(no reason)"}`)
    }
    console.log("\n❌ Verification FAILED.")
    process.exitCode = 1
  } else {
    console.log("✅ All verification tests passed.")
    process.exitCode = 0
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
