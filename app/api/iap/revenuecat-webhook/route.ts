// app/api/iap/revenuecat-webhook/route.ts
//
// RevenueCat webhook for Apple In-App Purchase (IAP Unit 2.2). Handles
// INITIAL_PURCHASE / NON_RENEWING_PURCHASE (paid-active upsert + OTP email)
// and CANCELLATION / REFUND (revoke). Mirrors the Stripe webhook pattern
// (app/api/webhooks/stripe/route.ts): raw body, shared-secret auth, try/catch
// that always 200s on processing errors (no retry storm), 23505 idempotency
// on the unique apple_transaction_id, [revenuecat-webhook] log prefix.

import { type NextRequest, NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const PURCHASE_TYPES = new Set(["INITIAL_PURCHASE", "NON_RENEWING_PURCHASE"])
const REFUND_TYPES = new Set(["CANCELLATION", "REFUND"])

export async function POST(req: NextRequest) {
  // ── 1. Auth: shared secret in the Authorization header ──────────────
  const expectedAuth = process.env.REVENUECAT_WEBHOOK_AUTH
  if (!expectedAuth) {
    console.error("[revenuecat-webhook] Missing REVENUECAT_WEBHOOK_AUTH")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  const auth = req.headers.get("authorization")
  if (!auth || auth !== expectedAuth) {
    console.warn("[revenuecat-webhook] auth_rejected")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ── 2. Parse JSON body. RevenueCat nests the event under `event`;
  //    fall back to a flat body so curl mocks can post either shape. ──
  const rawBody = await req.text()
  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    console.error("[revenuecat-webhook] Invalid JSON body")
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const event = body?.event ?? body
  if (!event || typeof event !== "object") {
    console.error("[revenuecat-webhook] Missing event object in payload")
    return NextResponse.json({ error: "Missing event" }, { status: 400 })
  }
  const eventType = typeof event.type === "string" ? event.type : ""

  // ── 3. Process. Wrapped so any DB/Supabase error still returns 200 —
  //    RevenueCat retries on non-2xx, and a poison payload would otherwise
  //    retry-storm. Pre-validation failures (auth, JSON) already 4xx'd. ──
  try {
    if (PURCHASE_TYPES.has(eventType)) {
      await handlePurchase(event)
    } else if (REFUND_TYPES.has(eventType)) {
      await handleRefund(event)
    } else {
      console.log("[revenuecat-webhook] event_ignored:", eventType)
    }
  } catch (err: any) {
    console.error("[revenuecat-webhook] Processing error:", err?.message)
  }

  return NextResponse.json({ received: true }, { status: 200 })
}

// ── Purchase: INITIAL_PURCHASE / NON_RENEWING_PURCHASE ────────────────
async function handlePurchase(event: any) {
  const email = String(event.app_user_id ?? "").trim().toLowerCase()
  const appleTransactionId = typeof event.transaction_id === "string" ? event.transaction_id : null
  const originalTransactionId = event.original_transaction_id ?? null
  const productId = event.product_id ?? null

  if (!email) {
    console.error("[revenuecat-webhook] purchase with no app_user_id")
    return
  }
  if (!appleTransactionId) {
    console.error("[revenuecat-webhook] purchase missing transaction_id for:", email)
    return
  }

  console.log("[revenuecat-webhook] purchase_received:", {
    email, transaction_id: appleTransactionId, original_transaction_id: originalTransactionId, product_id: productId,
  })

  const purchasedAtIso = typeof event.purchased_at_ms === "number"
    ? new Date(event.purchased_at_ms).toISOString()
    : new Date().toISOString()
  const nowIso = new Date().toISOString()

  const supabase = getSupabaseAdmin()

  // Existing row by email? (email is UNIQUE on client_profiles.) Covers two
  // cases: a re-fired webhook (row already has IAP fields) and an existing
  // Stripe customer buying on mobile (row has no apple_transaction_id yet).
  const { data: existing } = await supabase
    .from("client_profiles")
    .select("id, apple_transaction_id")
    .eq("email", email)
    .maybeSingle()

  if (existing) {
    if (existing.apple_transaction_id) {
      // Already linked to an IAP — idempotent re-fire. No write, no OTP.
      console.log("[revenuecat-webhook] idempotent_skip:", appleTransactionId)
      return
    }
    // Existing Stripe customer's first IAP: add IAP fields only. Do NOT touch
    // existing Stripe payment fields, and do NOT send another OTP (they're an
    // existing customer who already has access).
    const { error: updErr } = await supabase
      .from("client_profiles")
      .update({
        active: true,
        apple_transaction_id: appleTransactionId,
        revenuecat_app_user_id: event.app_user_id ?? email,
        iap_purchased_at: purchasedAtIso,
        updated_at: nowIso,
      })
      .eq("id", existing.id)
    if (updErr) {
      console.error("[revenuecat-webhook] link-existing update failed:", updErr.message)
      return
    }
    console.log("[revenuecat-webhook] linked_iap_to_existing:", email)
    return
  }

  // New customer: insert a paid-active row. profile_text="" + profile_complete
  // =false mirror the Stripe webhook's new-row shape (intake completes later).
  const { error: insertErr } = await supabase
    .from("client_profiles")
    .insert({
      email,
      active: true,
      apple_transaction_id: appleTransactionId,
      revenuecat_app_user_id: event.app_user_id ?? email,
      iap_purchased_at: purchasedAtIso,
      purchase_date: purchasedAtIso,
      profile_complete: false,
      profile_text: "",
      created_at: nowIso,
      updated_at: nowIso,
    })

  if (insertErr) {
    // 23505 = unique_violation (apple_transaction_id or email) from a
    // concurrent re-fire. Re-select by transaction_id and no-op.
    if (insertErr.code === "23505") {
      await supabase
        .from("client_profiles")
        .select("id")
        .eq("apple_transaction_id", appleTransactionId)
        .maybeSingle()
      console.log("[revenuecat-webhook] idempotent_skip:", appleTransactionId)
      return
    }
    console.error("[revenuecat-webhook] insert failed:", insertErr.message)
    return
  }

  console.log("[revenuecat-webhook] profile_created:", email)

  // OTP email for the mobile code-entry screen. No options at all — matches
  // the Stripe webhook's isMobile branch exactly. Passing options.data biased
  // Supabase toward the bare "Confirm signup" template instead of the branded
  // "Magic Link" template, so it's omitted (see Unit 2.2 followup).
  const { error: otpErr } = await supabase.auth.signInWithOtp({
    email,
  })
  if (otpErr) {
    console.error("[revenuecat-webhook] OTP send failed:", otpErr.message)
  } else {
    console.log("[revenuecat-webhook] OTP code sent to:", email)
  }
}

// ── Refund / cancellation: CANCELLATION / REFUND ──────────────────────
async function handleRefund(event: any) {
  const appleTransactionId = typeof event.transaction_id === "string" ? event.transaction_id : null
  if (!appleTransactionId) {
    console.warn("[revenuecat-webhook] refund_no_match: missing transaction_id")
    return
  }

  const supabase = getSupabaseAdmin()
  const { data: match, error: lookupErr } = await supabase
    .from("client_profiles")
    .select("id, email")
    .eq("apple_transaction_id", appleTransactionId)
    .maybeSingle()

  if (lookupErr) {
    console.error("[revenuecat-webhook] refund lookup failed:", lookupErr.message)
    return
  }
  if (!match) {
    // Apple sometimes refunds a transaction we never recorded (webhook
    // outage during the original purchase). Graceful no-op.
    console.warn("[revenuecat-webhook] refund_no_match:", appleTransactionId)
    return
  }

  const nowIso = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from("client_profiles")
    .update({ active: false, refunded_at: nowIso, updated_at: nowIso })
    .eq("id", match.id)

  if (updateErr) {
    console.error("[revenuecat-webhook] refund update failed:", updateErr.message)
    return
  }

  console.log("[revenuecat-webhook] refund_applied:", {
    email: match.email, transaction_id: appleTransactionId,
  })
}
