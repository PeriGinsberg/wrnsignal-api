// lib/prospects/bookingSpam.ts
//
// The booking form's spam checks, apart from the route so they can be tested
// (a Next.js route file may export only its handlers).

/** A form submitted faster than this after it rendered is a script. */
export const MIN_FILL_MS = 2500

/**
 * Sliding-window limit. True when `key` is still under `max` hits in the last
 * `windowMs`; records the hit. In-memory, so best-effort across instances.
 */
export function underLimit(store: Map<string, number[]>, key: string, max: number, windowMs: number, now = Date.now()): boolean {
  if (!key) return true
  const recent = (store.get(key) ?? []).filter((t) => t > now - windowMs)
  if (recent.length >= max) { store.set(key, recent); return false }
  recent.push(now)
  store.set(key, recent)
  if (store.size > 5000) store.clear() // bound memory; worst case a window resets
  return true
}

/** The honeypot: a hidden field real people never fill. */
export function isHoneypotHit(body: Record<string, unknown>): boolean {
  return String(body.website ?? "").trim() !== ""
}

/** Too fast, or no timing sent at all. */
export function isTooFast(body: Record<string, unknown>): boolean {
  const elapsed = Number(body.elapsed_ms)
  return !Number.isFinite(elapsed) || elapsed < MIN_FILL_MS
}
