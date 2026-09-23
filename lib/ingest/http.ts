/**
 * One HTTP helper for every ingest adapter, with retry on transient failures.
 *
 * WHAT PROMPTED IT. A 247-board Workday sweep lost 4 boards to HTTP 500s from
 * Workday's own CXS endpoint, each carrying an errorCaseId (their internal
 * incident reference). Retried by hand moments later, all four answered 200
 * with real data. So a 1.6% transient failure rate was costing whole boards for
 * a whole pair, and the adapters had no retry at all.
 *
 * THE SPLIT IS THE SAME ONE extractPosting MAKES, for the same reason:
 *
 *   retry     network errors, 408, 429, and every 5xx
 *   never     any other 4xx
 *
 * A 404 means the board key is wrong and will be wrong three times; a 403 means
 * blocked and will be blocked three times. Retrying those turns one clear
 * failure into three slower identical ones and, on a 429, into a worse rate
 * limit. Retrying a 5xx is the only case where the second attempt can
 * legitimately differ from the first.
 *
 * ATTEMPTS ARE REPORTED, NOT HIDDEN. Every call returns how many HTTP requests
 * it actually cost, so the retry path is measured rather than assumed -- the
 * same lesson as ExtractUsage.attempts. Without it a board that needed three
 * tries is indistinguishable from one that needed one, and the transient
 * failure rate stays invisible.
 */

export type HttpResult = {
  status: number
  text: string
  /** HTTP requests this call actually cost, including retries. 1 = first try worked. */
  attempts: number
}

/** Thrown when every attempt failed, or on the first non-retryable status. */
export class HttpFailed extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly status: number | null,
  ) {
    super(message)
    this.name = "HttpFailed"
  }
}

/** Transient: the second attempt can legitimately differ from the first. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

const DEFAULT_MAX_ATTEMPTS = 3
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Headers every ingest request carries, whatever the adapter asked for.
 *
 * accept-language IS NOT COSMETIC. Node's fetch (undici) sends
 * "accept-language: *" by default, and four Workday tenants -- truist (both
 * sites), huntington and odfl -- answer HTTP 500 to it, every time, with a
 * Workday errorCaseId. The same request from node:https, from curl, or from
 * undici with a concrete language, returns 200 with real data.
 *
 * It took a while to find because every wrong hypothesis looked plausible:
 * the boards failed in two consecutive sweeps and succeeded under curl, which
 * reads exactly like a transient outage; retry did not help, which reads like
 * a dead board; and the failures survived every header we were setting
 * ourselves, which reads like TLS fingerprinting. It was none of those. It was
 * a default header we never wrote, from the HTTP client, rejected by four
 * tenants out of 247.
 *
 * Set explicitly so no adapter can inherit the default by accident, and so the
 * reason is written down next to the value rather than rediscovered.
 */
const BASE_HEADERS: Record<string, string> = {
  "accept-language": "en-US",
}

export async function httpRequest(
  url: string,
  init: RequestInit,
  opts: { maxAttempts?: number; label?: string } = {},
): Promise<HttpResult> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const label = opts.label ?? url
  let attempts = 0
  let last: { status: number | null; message: string } = { status: null, message: "no attempt made" }

  while (attempts < maxAttempts) {
    attempts++
    try {
      const res = await fetch(url, {
        ...init,
        headers: { ...BASE_HEADERS, ...(init.headers as Record<string, string> | undefined) },
      })
      const text = await res.text()
      if (res.ok) return { status: res.status, text, attempts }

      last = {
        status: res.status,
        message: `HTTP ${res.status} ${res.statusText} for ${label} -- ${text.slice(0, 200)}`,
      }
      // A non-transient status will be identical next time. Fail now, loudly,
      // rather than spending two more requests to learn the same thing.
      if (!isRetryableStatus(res.status)) throw new HttpFailed(last.message, attempts, res.status)
    } catch (e: any) {
      if (e instanceof HttpFailed) throw e
      // Network-level failure: DNS, connection reset, TLS, timeout. Transient
      // by nature, so it takes the retry path.
      last = { status: null, message: `${e?.message ?? String(e)} for ${label}` }
    }
    if (attempts < maxAttempts) await sleep(400 * attempts)
  }

  throw new HttpFailed(
    `${last.message} (gave up after ${attempts} attempt(s))`,
    attempts,
    last.status,
  )
}

/** The common case: a JSON response, parsed, with the attempt count kept. */
export async function httpJson(
  url: string,
  init: RequestInit,
  opts: { maxAttempts?: number; label?: string } = {},
): Promise<{ json: any; attempts: number }> {
  const r = await httpRequest(url, init, opts)
  try {
    return { json: JSON.parse(r.text), attempts: r.attempts }
  } catch {
    // Not retried: a 200 carrying non-JSON is a contract problem, not a blip,
    // and three identical malformed bodies are no more informative than one.
    throw new HttpFailed(
      `non-JSON response for ${opts.label ?? url} -- ${r.text.slice(0, 200)}`,
      r.attempts,
      r.status,
    )
  }
}
