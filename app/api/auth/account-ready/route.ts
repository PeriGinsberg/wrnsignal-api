// app/api/auth/account-ready/route.ts
//
// Polled by the checkout success page to check if the Stripe webhook
// has created the client_profiles row yet.

import { type NextRequest } from "next/server"
import Stripe from "stripe"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

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

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("session_id")
    if (!sessionId) {
      return withCorsJson(req, { ready: false, error: "Missing session_id" }, 400)
    }

    // Look up the checkout session to get the customer email
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const email = (
      session.customer_details?.email || session.customer_email || ""
    ).trim().toLowerCase()

    if (!email) {
      return withCorsJson(req, { ready: false, error: "No email on session" }, 400)
    }

    // Check if profile row exists
    const supabase = getSupabaseAdmin()
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle()

    return withCorsJson(req, { ready: !!profile, email })
  } catch (err: any) {
    console.error("[account-ready] Error:", err.message)
    return withCorsJson(req, { ready: false, error: "Server error" }, 500)
  }
}
