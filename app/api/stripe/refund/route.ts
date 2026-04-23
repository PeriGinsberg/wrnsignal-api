// app/api/stripe/refund/route.ts
//
// Authenticated refund request. Honors the 7-day money-back guarantee:
// if the caller's purchase_date is within 7 days, we issue a full Stripe
// refund and revoke their access (active=false). Outside 7 days or after
// an existing refund, we return an error.

import { type NextRequest, after } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { buildSignalsFromRow, fireConversions } from "../../_lib/conversions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const REFUND_WINDOW_DAYS = 7
const REFUND_WINDOW_MS = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000

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

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const supabase = getSupabaseAdmin()

    const PROFILE_SELECT =
      "id, active, purchase_date, refunded_at, stripe_payment_intent_id, stripe_charge_id"

    let { data: profile } = await supabase
      .from("client_profiles")
      .select(PROFILE_SELECT)
      .eq("user_id", userId)
      .maybeSingle()

    if (!profile && email) {
      const byEmail = await supabase
        .from("client_profiles")
        .select(PROFILE_SELECT)
        .eq("email", email)
        .maybeSingle()
      profile = byEmail.data
    }

    if (!profile) {
      return withCorsJson(req, { error: "Profile not found." }, 404)
    }

    if (profile.refunded_at) {
      return withCorsJson(
        req,
        { error: "This account has already been refunded." },
        409
      )
    }

    if (!profile.active) {
      return withCorsJson(
        req,
        { error: "No active purchase on file." },
        409
      )
    }

    if (!profile.purchase_date) {
      return withCorsJson(
        req,
        { error: "No purchase on file for this account." },
        409
      )
    }

    const purchasedAt = new Date(profile.purchase_date).getTime()
    if (!Number.isFinite(purchasedAt)) {
      return withCorsJson(req, { error: "Invalid purchase record." }, 500)
    }

    const ageMs = Date.now() - purchasedAt
    if (ageMs > REFUND_WINDOW_MS) {
      return withCorsJson(
        req,
        {
          error: `Refund window expired. Refunds are only available within ${REFUND_WINDOW_DAYS} days of purchase.`,
        },
        403
      )
    }

    if (!profile.stripe_payment_intent_id && !profile.stripe_charge_id) {
      return withCorsJson(
        req,
        { error: "No Stripe payment reference on file — contact support." },
        409
      )
    }

    // Issue a full Stripe refund. Prefer the payment intent; fall back to the charge id.
    const stripe = getStripe()
    const refundParams: Stripe.RefundCreateParams = profile.stripe_payment_intent_id
      ? { payment_intent: profile.stripe_payment_intent_id }
      : { charge: profile.stripe_charge_id! }

    let refund: Stripe.Refund
    try {
      refund = await stripe.refunds.create(refundParams)
    } catch (err: any) {
      console.error("[refund] Stripe refund failed:", err.message)
      return withCorsJson(req, { error: err.message || "Refund failed." }, 502)
    }

    // Revoke access immediately. The charge.refunded webhook will also fire
    // and perform the same update — both are idempotent.
    const nowIso = new Date().toISOString()
    const { error: updateErr } = await supabase
      .from("client_profiles")
      .update({
        active: false,
        refunded_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", profile.id)

    if (updateErr) {
      console.error("[refund] Access revoke failed:", updateErr.message)
      // The refund already went through; surface the error so support can
      // finish the cleanup, but do not tell the user the refund failed.
      return withCorsJson(
        req,
        {
          ok: true,
          refund_id: refund.id,
          warning: "Refund issued but access could not be updated. Contact support.",
        },
        200
      )
    }

    // Mark the matching purchases row refunded (idempotent with the
    // charge.refunded webhook's same write — whichever fires first wins,
    // second is a no-op). Then fan out refund events to Meta / TikTok /
    // Google Ads / GA4 via after() so the response returns before the
    // network calls complete.
    if (profile.stripe_payment_intent_id) {
      await supabase
        .from("purchases")
        .update({ refunded_at: nowIso })
        .eq("stripe_payment_intent_id", profile.stripe_payment_intent_id)

      const { data: purchase } = await supabase
        .from("purchases")
        .select("*")
        .eq("stripe_payment_intent_id", profile.stripe_payment_intent_id)
        .maybeSingle()

      if (purchase) {
        after(() => fireConversions(buildSignalsFromRow(purchase), "refund"))
      } else {
        // Refund for a purchase that predates the purchases table — no row
        // to attach refund attribution to and no original Purchase event
        // was ever sent for it. Skipping CAPI is consistent; log enough
        // identifiers to reconcile in ad platforms manually if needed.
        console.warn(
          "[refund] refund for unknown purchase, skipping CAPI:",
          {
            user_id: userId,
            payment_intent_id: profile.stripe_payment_intent_id,
            email,
          }
        )
      }
    }

    return withCorsJson(req, { ok: true, refund_id: refund.id })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
