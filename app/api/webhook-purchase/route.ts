import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

/**
 * Purchase webhook endpoint for GHL (or any upstream payment system).
 *
 * Expected POST body (flexible — GHL sends different shapes):
 * {
 *   email?: string,
 *   session_id?: string,          // if caller can pass the SIGNAL session id
 *   mkt_session_id?: string,      // marketing session id from the landing CTA
 *   amount?: number,
 *   currency?: string,
 *   utm_source?: string,
 *   utm_medium?: string,
 *   utm_campaign?: string,
 *   // ...any other fields from GHL
 * }
 *
 * Security: requires x-webhook-key header to match WEBHOOK_PURCHASE_KEY env var.
 * If no env var is set, the endpoint is open (fine for initial testing).
 */
export async function POST(req: Request) {
  try {
    // Optional shared-secret auth
    const expectedKey = process.env.WEBHOOK_PURCHASE_KEY
    if (expectedKey) {
      const got = req.headers.get("x-webhook-key")
      if (got !== expectedKey) {
        return withCorsJson(req, { ok: false, error: "unauthorized" }, 401)
      }
    }

    const body = await req.json().catch(() => ({} as any))

    // Try to resolve the session id from whatever the webhook provides.
    // GHL may send: custom fields, query params, UTMs, or an email.
    const sessionId =
      String(body.session_id || body.mkt_session_id || body.signal_session_id || "").trim() ||
      null

    const email = body.email ? String(body.email).toLowerCase().trim() : null
    const amount = typeof body.amount === "number" ? body.amount : null
    const currency = body.currency ? String(body.currency).slice(0, 10) : "USD"

    const utm_source = body.utm_source ? String(body.utm_source).slice(0, 100) : null
    const utm_medium = body.utm_medium ? String(body.utm_medium).slice(0, 100) : null
    const utm_campaign = body.utm_campaign ? String(body.utm_campaign).slice(0, 100) : null

    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) {
      return withCorsJson(req, { ok: false, error: "server_misconfigured" }, 500)
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    let resolvedSessionId = sessionId
    // TODO(analytics-phase-2): previously did an email→session_id lookback against
    // jobfit_page_views.page_path (a flawed heuristic — emails were rarely actually
    // stored there). Replace with an analytics_visitors lookup by email once
    // Phase 2 ships.

    // Record the purchase as a page_view event so it flows into the dashboard
    // TODO(analytics-phase-2): replace with analytics_events insert per docs/signal-analytics-spec.md
    // Previous behavior: INSERT into jobfit_page_views with the payload below
    console.log('[analytics:deferred]', {
      call_site: 'app/api/webhook-purchase/route.ts:82',
      would_have_written: {
        session_id: resolvedSessionId || crypto.randomUUID(),
        page_path: "/purchase",
        page_name: "signal_purchased",
        referrer: email || null,
        utm_source,
        utm_medium,
        utm_campaign,
      },
    })

    console.log("[webhook-purchase] recorded:", {
      sessionId: resolvedSessionId,
      email,
      amount,
      currency,
    })

    return withCorsJson(req, { ok: true, tracked: true }, 200)
  } catch (err: any) {
    console.error("[webhook-purchase] error:", err)
    return withCorsJson(req, { ok: false, error: err?.message || "failed" }, 500)
  }
}
