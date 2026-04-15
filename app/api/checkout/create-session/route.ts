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

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: origin,
      metadata: isMobile ? { source: "mobile" } : undefined,
    })

    return withCorsJson(req, { url: session.url })
  } catch (err: any) {
    console.error("[checkout] Error:", err.message)
    return withCorsJson(req, { error: err.message || "Checkout failed." }, 500)
  }
}
