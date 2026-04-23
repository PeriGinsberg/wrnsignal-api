// app/api/_lib/conversions/http.ts
//
// Shared fetch wrapper with a hard timeout via AbortController.
// Prevents webhook background work from hanging if an ad-platform
// Conversion API goes slow or unresponsive.

const DEFAULT_TIMEOUT_MS = 3000

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Best-effort body parse: returns parsed JSON when the response body is
// valid JSON, the raw string when it is not, and undefined on any failure.
// Never throws — used to populate conversion_log.response_payload.
export async function safeJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text()
    if (!text) return undefined
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  } catch {
    return undefined
  }
}
