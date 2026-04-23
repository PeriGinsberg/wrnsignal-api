// app/api/checkout/session-summary/route.ts
//
// Minimal Stripe checkout session lookup for /checkout/success to display
// the actual paid amount (matters once Promotion Codes are used).
//
// Public GET ?session_id=<id>. Response strictly {amount_cents, currency,
// email} — no address, phone, name, or other customer_details fields.
// Session IDs are long opaque tokens the user already has from the Stripe
// redirect URL, so the security boundary here is ID opacity.
//
// Rate-limited to 10 requests/minute/IP via an in-memory Map. Best-effort
// (each warm Vercel instance has its own bucket); the session ID opacity
// is the actual abuse boundary. Opportunistic cleanup of expired buckets
// runs when the map grows past 1000 entries.

import { type NextRequest } from "next/server"
import Stripe from "stripe"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── Rate limiting ─────────────────────────────────────────────────────

const rateBuckets = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 10
const RATE_WINDOW_MS = 60_000
const PRUNE_THRESHOLD = 1000

function pruneExpiredBuckets(now: number): void {
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(ip)
  }
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  // Opportunistic cleanup. Prevents unbounded memory growth on warm
  // Vercel instances serving weeks of traffic. Runs only when the map
  // has grown past the threshold — normal path is O(1).
  if (rateBuckets.size > PRUNE_THRESHOLD) {
    pruneExpiredBuckets(now)
  }
  const bucket = rateBuckets.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (bucket.count >= RATE_LIMIT) return false
  bucket.count++
  return true
}

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  )
}

// ── Stripe ────────────────────────────────────────────────────────────

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY")
  return new Stripe(key)
}

// ── Handlers ──────────────────────────────────────────────────────────

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req)
  if (!checkRateLimit(ip)) {
    const res = withCorsJson(req, { error: "Too many requests" }, 429)
    res.headers.set("Retry-After", "60")
    return res
  }

  const sessionId = req.nextUrl.searchParams.get("session_id")
  if (!sessionId) {
    return withCorsJson(req, { error: "session_id required" }, 400)
  }

  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    // Strict payload restriction: amount_cents, currency, email only.
    // Do NOT expose address, phone, name, or any other customer_details
    // field even though Stripe populates them.
    return withCorsJson(req, {
      amount_cents: session.amount_total ?? 0,
      currency: (session.currency ?? "usd").toLowerCase(),
      email: session.customer_details?.email || session.customer_email || "",
    })
  } catch (err: any) {
    const status = err?.statusCode === 404 ? 404 : 500
    console.error("[session-summary] retrieve failed:", err?.message)
    return withCorsJson(
      req,
      { error: status === 404 ? "Session not found" : "Lookup failed." },
      status
    )
  }
}
