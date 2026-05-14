// app/api/conversions/event/route.ts
//
// Server-side mirror of upper-funnel browser pixel events (Lead,
// ViewContent, AddToCart, InitiateCheckout). The browser fires fbq()
// with an eventID; this endpoint receives the same eventID and fans out
// to every CAPI provider so Meta / TikTok / Google Ads / GA4 dedup the
// pair using their built-in (event_name, event_id) window.
//
// The Stripe webhook continues to own Purchase / Refund events — those
// have payment_intent.id as the dedup key and run through fireConversions.
// This endpoint is for the pre-purchase funnel only.
//
// Design notes:
//   - No auth (public client endpoint). Soft IP rate limit only.
//   - Idempotent on event_id: a retried client request just produces a
//     duplicate row in conversion_log with status=success — Meta itself
//     drops the duplicate via its own dedup. Cheap and safe.
//   - Always 200s after fan-out completes. Errors are logged but never
//     surfaced to the client — the browser pixel already fired and the
//     user shouldn't see a network error in console.

import { NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { fireFunnelEvent } from "../../_lib/conversions"
import type {
  FunnelCustomData,
  FunnelEventName,
  FunnelEventSignals,
} from "../../_lib/conversions/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 15

const VALID_EVENT_NAMES: ReadonlySet<FunnelEventName> = new Set([
  "Lead",
  "ViewContent",
  "AddToCart",
  "InitiateCheckout",
])

// Soft per-IP rate limit. Funnel events are cheap (one network round-trip
// per provider) but a misbehaving client could still flood. 60/min is
// loose enough to never block a real user (max ~5 events per real funnel
// run) and tight enough to bound abuse.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_PER_WINDOW = 60
const ipHits = new Map<string, number[]>()

function checkRateLimit(ip: string): boolean {
  if (!ip) return true
  const now = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const prior = (ipHits.get(ip) ?? []).filter((t) => t > cutoff)
  if (prior.length >= RATE_LIMIT_MAX_PER_WINDOW) return false
  prior.push(now)
  ipHits.set(ip, prior)
  if (ipHits.size > 2000) {
    for (const [k, v] of ipHits) {
      const fresh = v.filter((t) => t > cutoff)
      if (fresh.length === 0) ipHits.delete(k)
      else ipHits.set(k, fresh)
    }
  }
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
    ""
  )
}

function s(v: unknown, max = 500): string {
  return String(v ?? "").slice(0, max).trim()
}

function readCustomData(raw: any): FunnelCustomData {
  if (!raw || typeof raw !== "object") return {}
  const out: FunnelCustomData = {}
  if (typeof raw.value === "number" && isFinite(raw.value)) out.value = raw.value
  if (raw.currency) out.currency = s(raw.currency, 10)
  if (raw.verdict) out.verdict = s(raw.verdict, 50)
  if (typeof raw.score === "number" && isFinite(raw.score)) out.score = raw.score
  if (raw.cta_source) out.cta_source = s(raw.cta_source, 100)
  if (raw.content_name) out.content_name = s(raw.content_name, 200)
  if (raw.content_category) out.content_category = s(raw.content_category, 100)
  return out
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req)
    if (!checkRateLimit(ip)) {
      return withCorsJson(req, { ok: false, error: "rate_limited" }, 429)
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return withCorsJson(req, { ok: false, error: "invalid_json" }, 400)
    }
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "invalid_body" }, 400)
    }

    const event_name = s(body.event_name, 50) as FunnelEventName
    if (!VALID_EVENT_NAMES.has(event_name)) {
      return withCorsJson(req, { ok: false, error: "invalid_event_name" }, 400)
    }

    const event_id = s(body.event_id, 100)
    if (!event_id) {
      return withCorsJson(req, { ok: false, error: "missing_event_id" }, 400)
    }

    // Optional fields. event_time_sec defaults to "now" if the client
    // doesn't send one — Meta requires event_time within 7 days.
    const event_time_sec =
      typeof body.event_time_sec === "number" && isFinite(body.event_time_sec)
        ? Math.floor(body.event_time_sec)
        : Math.floor(Date.now() / 1000)

    const signals: FunnelEventSignals = {
      event_name,
      event_id,
      event_time_sec,

      email: s(body.email, 200).toLowerCase(),
      session_id: s(body.session_id, 200),

      utm_source: s(body.utm_source, 100),
      utm_medium: s(body.utm_medium, 100),
      utm_campaign: s(body.utm_campaign, 200),
      utm_content: s(body.utm_content, 200),
      utm_term: s(body.utm_term, 200),
      landing_page: s(body.landing_page, 500),
      referrer: s(body.referrer, 500),
      fbclid: s(body.fbclid, 200),
      ttclid: s(body.ttclid, 200),
      gclid: s(body.gclid, 200),
      fbp: s(body.fbp, 200),
      fbc: s(body.fbc, 200),
      ttp: s(body.ttp, 200),

      client_ip: ip,
      client_user_agent: s(req.headers.get("user-agent"), 500),

      custom_data: readCustomData(body.custom_data),
    }

    // Fan out to providers + write log rows. fireFunnelEvent never throws.
    await fireFunnelEvent(signals)

    return withCorsJson(req, { ok: true })
  } catch (err: any) {
    console.error("[conversions/event] unexpected error:", err?.message || String(err))
    // Always return 200 with ok:false so the client's catch handler
    // doesn't surface to console.error in production. The browser pixel
    // already fired before the user hit this endpoint.
    return withCorsJson(req, { ok: false, error: "internal_error" }, 200)
  }
}
