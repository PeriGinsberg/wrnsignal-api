// app/api/checkout/create-session/route.ts
//
// Creates a Stripe checkout session for one-time payment.
// Returns the checkout URL for client-side redirect.

import { type NextRequest } from "next/server"
import Stripe from "stripe"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY")
  return new Stripe(key)
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
    const successUrl = isMobile
      ? `https://wrnsignal-api.vercel.app/checkout/mobile-success?session_id={CHECKOUT_SESSION_ID}`
      : `https://wrnsignal-api.vercel.app/checkout/success?session_id={CHECKOUT_SESSION_ID}`

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

    return withCorsJson(req, { url: session.url })
  } catch (err: any) {
    console.error("[checkout] Error:", err.message)
    return withCorsJson(req, { error: err.message || "Checkout failed." }, 500)
  }
}
