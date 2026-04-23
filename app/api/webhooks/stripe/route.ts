// app/api/webhooks/stripe/route.ts
//
// Stripe webhook handler for checkout.session.completed and charge.refunded.
// Synchronous path: upserts client_profiles, sends magic link / OTP, inserts
// a purchases row. Background path (scheduled via after()): fans out to
// Meta / TikTok / Google Ads / GA4 Conversion APIs and writes
// conversion_log rows — runs post-response so webhook latency stays well
// under Stripe's 30s timeout even when a provider is slow.

import { type NextRequest, NextResponse, after } from "next/server"
import Stripe from "stripe"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { fireConversions } from "../../_lib/conversions"
import type { PurchaseSignals } from "../../_lib/conversions/types"

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

// Extract a string metadata value from a Stripe metadata bag; returns ""
// when the key is missing or the value is not a string.
function readMeta(
  meta: Stripe.Metadata | null | undefined,
  key: string
): string {
  if (!meta) return ""
  const v = meta[key]
  return typeof v === "string" ? v : ""
}

// Idempotent purchases insert keyed on stripe_payment_intent_id. Returns
// the row's id whether we inserted it or it already existed (from a prior
// webhook delivery — Stripe has at-least-once semantics). Returns null
// only on unexpected DB failure; callers treat null as "skip CAPI fan-out".
async function insertOrFindPurchase(
  supabase: SupabaseClient,
  row: Record<string, any>
): Promise<string | null> {
  const { data, error } = await supabase
    .from("purchases")
    .insert(row)
    .select("id")
    .single()

  if (!error && data) return data.id

  // 23505 = unique_violation. Row was already inserted by a prior delivery.
  if (error?.code === "23505") {
    const { data: existing } = await supabase
      .from("purchases")
      .select("id")
      .eq("stripe_payment_intent_id", row.stripe_payment_intent_id)
      .maybeSingle()
    if (existing) return existing.id
  }

  console.error("[stripe-webhook] purchases insert failed:", error?.message)
  return null
}

// Build a PurchaseSignals snapshot from a persisted purchases row. Used on
// both purchase and refund paths so the Conversion API fan-out sees
// identical data regardless of which webhook branch produced it.
function buildSignalsFromRow(r: any): PurchaseSignals {
  return {
    purchase_id:        r.id,
    email:              r.email,
    payment_intent_id:  r.stripe_payment_intent_id,
    amount_cents:       r.amount_cents,
    currency:           r.currency,
    utm_source:         r.utm_source ?? "",
    utm_medium:         r.utm_medium ?? "",
    utm_campaign:       r.utm_campaign ?? "",
    utm_content:        r.utm_content ?? "",
    utm_term:           r.utm_term ?? "",
    landing_page:       r.landing_page ?? "",
    referrer:           r.referrer ?? "",
    fbclid:             r.fbclid ?? "",
    ttclid:             r.ttclid ?? "",
    gclid:              r.gclid ?? "",
    fbp:                r.fbp ?? "",
    fbc:                r.fbc ?? "",
    ttp:                r.ttp ?? "",
    client_ip:          r.client_ip ?? "",
    client_user_agent:  r.client_user_agent ?? "",
  }
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

  // Synchronous work (profile upsert, magic link, purchases insert) runs
  // inside the try block. Conversion API fan-out is deferred via after()
  // so it runs AFTER the 200 response goes back to Stripe — webhook
  // latency stays well under Stripe's 30s timeout even when a provider
  // is slow. handle*() returns null when CAPI should not fire (missing
  // email / payment_intent, zero-amount purchase, unknown refund).
  try {
    if (event.type === "checkout.session.completed") {
      const signals = await handleCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session
      )
      if (signals) after(() => fireConversions(signals, "purchase"))
    } else if (event.type === "charge.refunded") {
      const signals = await handleChargeRefunded(
        event.data.object as Stripe.Charge
      )
      if (signals) after(() => fireConversions(signals, "refund"))
    }
  } catch (err: any) {
    console.error("[stripe-webhook] Processing error:", err.message)
  }

  return NextResponse.json({ received: true }, { status: 200 })
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<PurchaseSignals | null> {
  const email = (
    session.customer_details?.email || session.customer_email || ""
  ).trim().toLowerCase()
  const stripeCustomerId = typeof session.customer === "string"
    ? session.customer
    : (session.customer as any)?.id || null

  if (!email) {
    console.error("[stripe-webhook] No email on checkout session:", session.id)
    return null
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

  let profileId: string | null = null

  if (existing) {
    profileId = existing.id
    await supabase
      .from("client_profiles")
      .update(paymentFields)
      .eq("id", existing.id)

    console.log("[stripe-webhook] Updated existing profile for:", email)
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("client_profiles")
      .insert({
        email,
        profile_complete: false,
        profile_text: "",
        created_at: nowIso,
        ...paymentFields,
      })
      .select("id")
      .single()

    if (insertErr) {
      console.error("[stripe-webhook] Insert failed:", insertErr.message)
      return null
    }

    profileId = inserted?.id ?? null
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

  // Without a payment_intent there is no unique key for idempotent inserts.
  // Only happens on non-mode=payment flows which we do not use today.
  if (!paymentIntentId) return null

  // Assemble the purchases row from session.metadata. Every attribution
  // field was set by /api/checkout/create-session's sharedMetadata builder
  // in Phase 3; pre-Phase-3 live traffic will still write a row, just with
  // "" for every attribution field — CAPI calls still fire with email-only
  // user_data (lower match quality, functional).
  const m = session.metadata
  const amountCents = session.amount_total ?? 0
  const currency = session.currency?.toLowerCase() ?? "usd"

  const purchaseRow: Record<string, any> = {
    client_profile_id:        profileId,
    email,
    stripe_session_id:        session.id,
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id:         chargeId,
    amount_cents:             amountCents,
    currency,
    utm_source:               readMeta(m, "utm_source"),
    utm_medium:               readMeta(m, "utm_medium"),
    utm_campaign:             readMeta(m, "utm_campaign"),
    utm_content:              readMeta(m, "utm_content"),
    utm_term:                 readMeta(m, "utm_term"),
    landing_page:             readMeta(m, "landing_page"),
    referrer:                 readMeta(m, "referrer"),
    fbclid:                   readMeta(m, "fbclid"),
    ttclid:                   readMeta(m, "ttclid"),
    gclid:                    readMeta(m, "gclid"),
    fbp:                      readMeta(m, "fbp"),
    fbc:                      readMeta(m, "fbc"),
    ttp:                      readMeta(m, "ttp"),
    client_ip:                readMeta(m, "client_ip"),
    client_user_agent:        readMeta(m, "client_user_agent"),
  }

  const purchaseId = await insertOrFindPurchase(supabase, purchaseRow)
  if (!purchaseId) {
    // DB failure (logged inside insertOrFindPurchase). Profile and magic
    // link have already succeeded — user still has access. CAPI fan-out
    // is skipped for this purchase only.
    return null
  }

  // Skip CAPI fan-out for zero / missing amounts. A $0 conversion event
  // would pollute ad-platform optimization (value-based bid strategies
  // treat zero as no revenue). The purchases row is still written above
  // so refund reconciliation works later.
  if (amountCents <= 0) {
    console.warn(
      "[stripe-webhook] purchase with missing/zero amount, skipping CAPI:",
      session.id
    )
    return null
  }

  return buildSignalsFromRow({ id: purchaseId, ...purchaseRow })
}

// Safety net: if a refund is issued manually from the Stripe dashboard
// (or by our own /api/stripe/refund endpoint), revoke access in Supabase,
// mark the purchases row refunded, and fire refund Conversion API events.
async function handleChargeRefunded(
  charge: Stripe.Charge
): Promise<PurchaseSignals | null> {
  if (!charge.refunded) return null

  const customerId = typeof charge.customer === "string"
    ? charge.customer
    : charge.customer?.id ?? null
  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id ?? null

  if (!customerId && !paymentIntentId) {
    console.error("[stripe-webhook] Refund with no customer or payment_intent:", charge.id)
    return null
  }

  const supabase = getSupabaseAdmin()
  const query = supabase.from("client_profiles").select("id, email")
  const { data: match, error: lookupErr } = customerId
    ? await query.eq("stripe_customer_id", customerId).maybeSingle()
    : await query.eq("stripe_payment_intent_id", paymentIntentId!).maybeSingle()

  if (lookupErr) {
    console.error("[stripe-webhook] Refund lookup failed:", lookupErr.message)
    return null
  }
  if (!match) {
    console.warn("[stripe-webhook] Refund for unknown profile:", charge.id)
    return null
  }

  const nowIso = new Date().toISOString()

  const { error: updateErr } = await supabase
    .from("client_profiles")
    .update({
      active: false,
      refunded_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", match.id)

  if (updateErr) {
    console.error("[stripe-webhook] Refund update failed:", updateErr.message)
    return null
  }

  console.log("[stripe-webhook] Access revoked after refund for:", match.email)

  // Without a payment_intent we have no unique key into purchases. Only
  // /api/stripe/refund (Phase 4c) provides payment_intent reliably when
  // the refund is user-initiated; the charge webhook body reliably does
  // as well, so this is an edge-case guard.
  if (!paymentIntentId) return null

  // Mark the purchases row refunded. Idempotent with /api/stripe/refund's
  // same write so a user-initiated refund that also triggers this webhook
  // is safe to run twice.
  await supabase
    .from("purchases")
    .update({ refunded_at: nowIso })
    .eq("stripe_payment_intent_id", paymentIntentId)

  // Pull the full row so refund CAPI fan-out uses the same attribution
  // data the original purchase event was sent with.
  const { data: purchase } = await supabase
    .from("purchases")
    .select("*")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle()

  if (!purchase) {
    // Purchase predates the purchases table — no row to attach refund
    // attribution to and no original Purchase event was ever sent, so
    // skipping CAPI is consistent. Log identifiers so ad-platform refunds
    // can be reconciled manually if needed.
    console.warn(
      "[stripe-webhook] refund for unknown purchase, skipping CAPI:",
      {
        charge_id: charge.id,
        payment_intent_id: paymentIntentId,
        email: match.email,
      }
    )
    return null
  }

  return buildSignalsFromRow(purchase)
}
