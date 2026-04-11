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

  if (event.type !== "checkout.session.completed") {
    return response
  }

  // Process checkout.session.completed asynchronously
  try {
    const session = event.data.object as Stripe.Checkout.Session
    const email = (
      session.customer_details?.email || session.customer_email || ""
    ).trim().toLowerCase()
    const stripeCustomerId = typeof session.customer === "string"
      ? session.customer
      : (session.customer as any)?.id || null

    if (!email) {
      console.error("[stripe-webhook] No email on checkout session:", session.id)
      return response
    }

    const supabase = getSupabaseAdmin()

    // Check if profile already exists
    const { data: existing } = await supabase
      .from("client_profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle()

    if (existing) {
      // Update existing row — set active and stripe_customer_id
      await supabase
        .from("client_profiles")
        .update({
          active: true,
          stripe_customer_id: stripeCustomerId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)

      console.log("[stripe-webhook] Updated existing profile for:", email)
    } else {
      // Insert new row
      const { error: insertErr } = await supabase
        .from("client_profiles")
        .insert({
          email,
          active: true,
          profile_complete: false,
          profile_text: "",
          stripe_customer_id: stripeCustomerId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })

      if (insertErr) {
        console.error("[stripe-webhook] Insert failed:", insertErr.message)
        return response
      }

      console.log("[stripe-webhook] Created new profile for:", email)
    }

    // Send magic link to onboarding
    const redirectTo = "https://wrnsignal-api.vercel.app/dashboard/onboarding"
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })

    if (otpErr) {
      console.error("[stripe-webhook] Magic link send failed:", otpErr.message)
    } else {
      console.log("[stripe-webhook] Magic link sent to:", email)
    }
  } catch (err: any) {
    console.error("[stripe-webhook] Processing error:", err.message)
  }

  return response
}
