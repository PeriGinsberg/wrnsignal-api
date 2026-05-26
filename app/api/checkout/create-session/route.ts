// app/api/checkout/create-session/route.ts
//
// Creates a Stripe checkout session for one-time payment.
// Returns the checkout URL for client-side redirect.

import { type NextRequest } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getAppUrl } from "@/lib/urls"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY")
  return new Stripe(key)
}

// Service-role Supabase client. Used only for the fire-and-forget
// unlock_email_captures INSERT + chained UPDATE below. Mirrors the
// jobfit-run-trial-open per-request instantiation pattern; throws
// synchronously if env is unset so the capture block's try/catch can
// swallow it without surfacing 500 to the user.
function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Sanitize any optional string from the request body. Stripe metadata values
// are capped at 500 chars; trim + slice before passing through so we never
// exceed that limit and never carry leading/trailing whitespace from a
// pasted URL param.
function sanitize(v: unknown): string {
  return String(v ?? "").slice(0, 500).trim()
}

// Extract the end-user's IP from the request headers. Vercel populates
// x-forwarded-for (comma-separated, client first); x-real-ip and
// cf-connecting-ip are defensive fallbacks. Empty string if none are set.
// No format validation — Meta/TikTok CAPI will reject malformed IPs
// downstream and there is no server-side attack vector here.
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

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const email = String(body?.email || "").trim().toLowerCase()
    const source = String(body?.source || "").trim().toLowerCase()

    if (!email) {
      return withCorsJson(req, { error: "Email is required." }, 400)
    }

    const priceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_ID
    if (!priceId) {
      return withCorsJson(req, { error: "Stripe price not configured." }, 500)
    }

    const origin = req.headers.get("origin") || "https://wrnsignal.workforcereadynow.com"
    const stripe = getStripe()

    // Mobile purchases route to a bridge page that deep-links back into the
    // app via the signalmobile:// scheme. The webhook also reads
    // metadata.source to pick the OTP-style email template for mobile users.
    const isMobile = source === "mobile"
    const appUrl = getAppUrl(req)
    const successUrl = isMobile
      ? `${appUrl}/checkout/mobile-success?session_id={CHECKOUT_SESSION_ID}`
      : `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`

    // Attribution + match-quality signals forwarded by the Framer site's
    // getAttributionSnapshot() helper (framer/landingpage.txt,
    // framer/jobanalysis.txt). Every field is optional. Empty strings are
    // dropped so the 50-key Stripe metadata budget stays uncluttered and
    // the Stripe dashboard remains readable for support/refund lookups.
    const sharedMetadata: Record<string, string> = {}
    const put = (k: string, v: string) => {
      if (v) sharedMetadata[k] = v
    }

    put("utm_source",   sanitize(body?.utm_source))
    put("utm_medium",   sanitize(body?.utm_medium))
    put("utm_campaign", sanitize(body?.utm_campaign))
    put("utm_content",  sanitize(body?.utm_content))
    put("utm_term",     sanitize(body?.utm_term))
    put("landing_page", sanitize(body?.landing_page))
    put("referrer",     sanitize(body?.referrer))
    put("fbclid",       sanitize(body?.fbclid))
    put("ttclid",       sanitize(body?.ttclid))
    put("gclid",        sanitize(body?.gclid))
    put("fbp",          sanitize(body?.fbp))
    put("fbc",          sanitize(body?.fbc))
    put("ttp",          sanitize(body?.ttp))

    // Request context captured at this call time. The Stripe webhook's
    // own request originates from Stripe's server, not the customer's
    // browser, so IP/UA must be stashed in PaymentIntent metadata here
    // for Meta / TikTok Conversion API match quality downstream.
    put("client_ip",         getClientIp(req))
    put("client_user_agent", sanitize(req.headers.get("user-agent")))

    if (isMobile) put("source", "mobile")

    const hasMetadata = Object.keys(sharedMetadata).length > 0

    // ──────────────────────────────────────────────────────────────────
    // Unlock email capture — fire-and-forget INSERT.
    //
    // Runs in parallel with the Stripe API call below. Never blocks the
    // response. If the user abandons Stripe checkout, the row remains
    // (that's a feature — enables abandoned-checkout email recovery).
    // The promise is captured so the UPDATE below can chain on the
    // inserted row's id (race-free: UPDATE waits for INSERT to resolve).
    //
    // Errors are logged, never surfaced to the user. Synchronous throws
    // from getSupabase() (env unset) are caught by the outer try/catch
    // here so the route still completes the Stripe call.
    // ──────────────────────────────────────────────────────────────────
    // Async IIFE returns a real Promise<string | null> (Supabase's chain
    // returns PromiseLike, which doesn't have .catch — wrapping in an
    // async function gives us a true Promise we can chain UPDATE on below.
    // All errors (sync throws from getSupabase, async Supabase errors)
    // are caught inside; the returned promise never rejects.
    const captureInsertPromise: Promise<string | null> = (async () => {
      try {
        const supabase = getSupabase()
        const sessionIdFromBody =
          typeof body?.session_id === "string" && body.session_id.trim()
            ? body.session_id.trim().slice(0, 200)
            : null
        const { data, error } = await supabase
          .from("unlock_email_captures")
          .insert({
            email,
            source: source || null,
            session_id: sessionIdFromBody,
            utm_source: sanitize(body?.utm_source) || null,
            utm_medium: sanitize(body?.utm_medium) || null,
            utm_campaign: sanitize(body?.utm_campaign) || null,
            landing_page: sanitize(body?.landing_page) || null,
            referrer: sanitize(body?.referrer) || null,
            fbclid: sanitize(body?.fbclid) || null,
            ttclid: sanitize(body?.ttclid) || null,
            gclid: sanitize(body?.gclid) || null,
            fbp: sanitize(body?.fbp) || null,
            fbc: sanitize(body?.fbc) || null,
            ttp: sanitize(body?.ttp) || null,
          })
          .select("id")
          .single()
        if (error) {
          console.error("[unlock_capture] insert_failed", {
            message: error.message,
            code: (error as any).code,
          })
          return null
        }
        return (data?.id as string | undefined) ?? null
      } catch (err: any) {
        console.error(
          "[unlock_capture] setup_failed",
          err?.message || String(err)
        )
        return null
      }
    })()

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: origin,
      // Mirror metadata to both slots: the CheckoutSession (available for
      // ~24h after completion) and the PaymentIntent (permanent — what the
      // Stripe webhook reads). Defensive dual-write; Stripe does not charge
      // per metadata key.
      metadata: hasMetadata ? sharedMetadata : undefined,
      payment_intent_data: hasMetadata
        ? { metadata: sharedMetadata }
        : undefined,
    })

    // ──────────────────────────────────────────────────────────────────
    // Unlock email capture — fire-and-forget UPDATE.
    //
    // Chains on the INSERT promise so this never fires before the row
    // exists. If INSERT failed (returned null) this is a no-op. UPDATE
    // failures are logged but never surfaced. The webhook backfill
    // (separate commit) will fill purchase_id keyed on stripe_session_id.
    // ──────────────────────────────────────────────────────────────────
    captureInsertPromise
      .then(async (insertedId) => {
        if (!insertedId) return
        try {
          const supabase = getSupabase()
          const { error } = await supabase
            .from("unlock_email_captures")
            .update({ stripe_session_id: session.id })
            .eq("id", insertedId)
          if (error) {
            console.error("[unlock_capture] update_failed", {
              message: error.message,
              code: (error as any).code,
            })
          }
        } catch (err: any) {
          console.error(
            "[unlock_capture] update_setup_failed",
            err?.message || String(err)
          )
        }
      })
      .catch((err) => {
        // Defensive: the inner try/catch should cover everything, but if
        // the .then callback ever rejects synchronously, log and swallow.
        console.error(
          "[unlock_capture] update_chain_failed",
          err?.message || String(err)
        )
      })

    return withCorsJson(req, { url: session.url })
  } catch (err: any) {
    console.error("[checkout] Error:", err.message)
    return withCorsJson(req, { error: err.message || "Checkout failed." }, 500)
  }
}
