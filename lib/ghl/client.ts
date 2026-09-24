/**
 * The GoHighLevel v2 HTTP client.
 *
 * AUTH IS COPIED FROM WORKING CODE, NOT FROM THE DOCS.
 * app/api/seat-create/route.ts has been setting a contact custom field in
 * production for months with exactly these headers:
 *
 *   Authorization: Bearer <GHL_API_KEY>
 *   Version:       2021-07-28
 *   LocationId:    <GHL_LOCATION_ID>
 *
 * The current developer docs specify `Version: v3` on every endpoint. Both may
 * be accepted and the date form is demonstrably working against our location,
 * so THE VERSION IS CONFIGURABLE AND DEFAULTS TO THE KNOWN-GOOD VALUE. Nothing
 * here changes seat-create. tests/ghl/probe.ts establishes what each endpoint
 * actually accepts; until it has been run against the real location, the
 * default is the value we have evidence for rather than the one we read.
 *
 * RETRY POLICY, same split used everywhere else in this codebase:
 *
 *   retry     network errors, 408, 429, and every 5xx
 *   never     any other 4xx
 *
 * A 401 means the token is wrong and will be wrong three times; a 404 means the
 * contact id is wrong. Retrying those turns one clear failure into three slower
 * identical ones. 429 matters here in a way it does not for ingest: HighLevel
 * publishes 100 requests per 10 seconds and 200,000 per day per location, so a
 * throttle is a real possibility under any bulk operation and its Retry-After
 * is honoured when present.
 *
 * NOTE ON DUPLICATION: lib/ingest/http.ts implements the same retry split. That
 * file should be promoted to lib/http.ts and shared once the ingest branch
 * lands; it is not being moved now because three ingest adapters currently
 * import it and that refactor does not belong in this change.
 */

const BASE = "https://services.leadconnectorhq.com"

/** The value seat-create has been sending successfully. See the header. */
const DEFAULT_VERSION = "2021-07-28"

export type GhlConfig = {
  token: string
  locationId: string
  version: string
}

export function ghlConfig(overrides: Partial<GhlConfig> = {}): GhlConfig {
  const token = overrides.token ?? process.env.GHL_API_KEY
  const locationId = overrides.locationId ?? process.env.GHL_LOCATION_ID
  if (!token) throw new Error("GHL_API_KEY is not set")
  if (!locationId) throw new Error("GHL_LOCATION_ID is not set")
  return {
    token,
    locationId,
    version: overrides.version ?? process.env.GHL_API_VERSION ?? DEFAULT_VERSION,
  }
}

export class GhlError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly attempts: number,
    readonly body: string | null,
  ) {
    super(message)
    this.name = "GhlError"
  }
}

const retryable = (s: number) => s === 408 || s === 429 || s >= 500
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const MAX_ATTEMPTS = 3

export type GhlResponse<T> = { data: T; status: number; attempts: number }

export async function ghlRequest<T = any>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined> },
  cfg: GhlConfig,
): Promise<GhlResponse<T>> {
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v)
  }

  let attempts = 0
  let last: { status: number | null; message: string; body: string | null } = {
    status: null,
    message: "no attempt made",
    body: null,
  }

  while (attempts < MAX_ATTEMPTS) {
    attempts++
    try {
      const res = await fetch(url.toString(), {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Version: cfg.version,
          Accept: "application/json",
          LocationId: cfg.locationId,
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      })
      const text = await res.text()

      if (res.ok) {
        let data: any = null
        if (text) {
          try {
            data = JSON.parse(text)
          } catch {
            // A 2xx carrying non-JSON is a contract problem, not a blip.
            throw new GhlError(`non-JSON 2xx from ${path}: ${text.slice(0, 200)}`, res.status, attempts, text)
          }
        }
        return { data: data as T, status: res.status, attempts }
      }

      last = {
        status: res.status,
        message: `GHL ${res.status} ${res.statusText} for ${init.method ?? "GET"} ${path}: ${text.slice(0, 300)}`,
        body: text,
      }
      if (!retryable(res.status)) throw new GhlError(last.message, res.status, attempts, text)

      // Honour Retry-After when HighLevel sends one, capped so a bad value
      // cannot stall a request path a coach is waiting on.
      if (res.status === 429 && attempts < MAX_ATTEMPTS) {
        const ra = Number(res.headers.get("retry-after"))
        if (Number.isFinite(ra) && ra > 0) await sleep(Math.min(ra * 1000, 5000))
      }
    } catch (e: any) {
      if (e instanceof GhlError) throw e
      last = { status: null, message: `${e?.message ?? String(e)} for ${path}`, body: null }
    }
    if (attempts < MAX_ATTEMPTS) await sleep(400 * attempts)
  }

  throw new GhlError(`${last.message} (gave up after ${attempts} attempts)`, last.status, attempts, last.body)
}
