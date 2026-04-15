// app/api/webhooks/stripe/route.ts
//
// Stripe webhook handler for checkout.session.completed.
// Creates a client_profiles row and sends a magic link to the new user.

import { type NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY")
  return new Stripe(key)
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error("[stripe-webhook] Missing STRIPE_WEBHOOK_SECRET")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }

  // Read raw body for signature verification
  const rawBody = await req.text()
  const signature = req.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 })
  }

  // Verify webhook signature
  let event: Stripe.Event
  try {
    const stripe = getStripe()
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err: any) {
    console.error("[stripe-webhook] Signature verification failed:", err.message)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  // Return 200 immediately to prevent Stripe retry storms
  // Process asynchronously after acknowledgment
  const response = NextResponse.json({ received: true }, { status: 200 })

  try {
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
    } else if (event.type === "charge.refunded") {
      await handleChargeRefunded(event.data.object as Stripe.Charge)
    }
  } catch (err: any) {
    console.error("[stripe-webhook] Processing error:", err.message)
  }

  return response
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const email = (
    session.customer_details?.email || session.customer_email || ""
  ).trim().toLowerCase()
  const stripeCustomerId = typeof session.customer === "string"
    ? session.customer
    : (session.customer as any)?.id || null

  if (!email) {
    console.error("[stripe-webhook] No email on checkout session:", session.id)
    return
  }

  // Resolve the payment intent + latest charge so we can refund later.
  let paymentIntentId: string | null = null
  let chargeId: string | null = null
  const paymentIntentRef = session.payment_intent
  if (paymentIntentRef) {
    paymentIntentId = typeof paymentIntentRef === "string"
      ? paymentIntentRef
      : paymentIntentRef.id
    try {
      const stripe = getStripe()
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge"],
      })
      const latest = pi.latest_charge
      chargeId = typeof latest === "string" ? latest : latest?.id ?? null
    } catch (err: any) {
      console.error("[stripe-webhook] PaymentIntent retrieve failed:", err.message)
    }
  }

  const supabase = getSupabaseAdmin()

  const { data: existing } = await supabase
    .from("client_profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle()

  const nowIso = new Date().toISOString()
  const paymentFields: Record<string, any> = {
    active: true,
    stripe_customer_id: stripeCustomerId,
    purchase_date: nowIso,
    refunded_at: null,
    updated_at: nowIso,
  }
  if (paymentIntentId) paymentFields.stripe_payment_intent_id = paymentIntentId
  if (chargeId) paymentFields.stripe_charge_id = chargeId

  if (existing) {
    await supabase
      .from("client_profiles")
      .update(paymentFields)
      .eq("id", existing.id)

    console.log("[stripe-webhook] Updated existing profile for:", email)
  } else {
    const { error: insertErr } = await supabase
      .from("client_profiles")
      .insert({
        email,
        profile_complete: false,
        profile_text: "",
        created_at: nowIso,
        ...paymentFields,
      })

    if (insertErr) {
      console.error("[stripe-webhook] Insert failed:", insertErr.message)
      return
    }

    console.log("[stripe-webhook] Created new profile for:", email)
  }

  // Mobile purchases need the OTP-style email (shows the 6-digit {{ .Token }})
  // so the user can type it into the mobile app's code-entry screen. Web
  // purchases keep the magic-link redirect to the dashboard.
  const isMobile = session.metadata?.source === "mobile"
  const otpOptions = isMobile
    ? undefined
    : { emailRedirectTo: "https://wrnsignal-api.vercel.app/dashboard" }

  const { error: otpErr } = await supabase.auth.signInWithOtp({
    email,
    options: otpOptions,
  })

  if (otpErr) {
    console.error("[stripe-webhook] OTP send failed:", otpErr.message)
  } else {
    console.log(
      `[stripe-webhook] ${isMobile ? "OTP code" : "Magic link"} sent to:`,
      email
    )
  }
}

// Safety net: if a refund is issued manually from the Stripe dashboard
// (or by our own /api/stripe/refund endpoint), revoke access in Supabase.
async function handleChargeRefunded(charge: Stripe.Charge) {
  if (!charge.refunded) return

  const customerId = typeof charge.customer === "string"
    ? charge.customer
    : charge.customer?.id ?? null
  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id ?? null

  if (!customerId && !paymentIntentId) {
    console.error("[stripe-webhook] Refund with no customer or payment_intent:", charge.id)
    return
  }

  const supabase = getSupabaseAdmin()
  const query = supabase.from("client_profiles").select("id, email")
  const { data: match, error: lookupErr } = customerId
    ? await query.eq("stripe_customer_id", customerId).maybeSingle()
    : await query.eq("stripe_payment_intent_id", paymentIntentId!).maybeSingle()

  if (lookupErr) {
    console.error("[stripe-webhook] Refund lookup failed:", lookupErr.message)
    return
  }
  if (!match) {
    console.warn("[stripe-webhook] Refund for unknown profile:", charge.id)
    return
  }

  const { error: updateErr } = await supabase
    .from("client_profiles")
    .update({
      active: false,
      refunded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", match.id)

  if (updateErr) {
    console.error("[stripe-webhook] Refund update failed:", updateErr.message)
    return
  }

  console.log("[stripe-webhook] Access revoked after refund for:", match.email)
}
