// app/api/auth/send-link/route.ts
//
// Server-side magic link sender with profile gate.
// Checks client_profiles BEFORE sending OTP:
//   - No active profile → 403 (no_account)
//   - profile_complete = false → magic link to /dashboard/onboarding
//   - profile_complete = true → magic link to /signal/jobfit

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const email = String(body?.email || "").trim().toLowerCase()

    if (!email) {
      return withCorsJson(req, { error: "missing_email", message: "Email is required." }, 400)
    }

    const supabase = getSupabaseAdmin()

    // Check for active profile BEFORE any auth call
    const { data: profile, error: profileErr } = await supabase
      .from("client_profiles")
      .select("id, active, profile_complete")
      .eq("email", email)
      .eq("active", true)
      .maybeSingle()

    if (profileErr) {
      console.error("[send-link] Profile lookup error:", profileErr.message)
      return withCorsJson(req, { error: "server_error", message: "Profile lookup failed." }, 500)
    }

    if (!profile) {
      return withCorsJson(
        req,
        { error: "no_account", message: "No active account found for this email." },
        403
      )
    }

    // Determine redirect based on profile completeness
    const redirectTo = profile.profile_complete
      ? "https://wrnsignal-api.vercel.app/jobfit"
      : "https://wrnsignal-api.vercel.app/dashboard/onboarding"

    // Send the magic link via OTP. signInWithOtp handles everything:
    // creates the Supabase Auth user if it doesn't exist yet, and sends
    // the email with the redirect URL embedded. No need for generateLink.
    console.log("[send-link] Sending OTP to:", email, "redirectTo:", redirectTo)
    const { error: sendErr } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })

    if (sendErr) {
      console.error("[send-link] OTP send error:", sendErr.message, sendErr)
      return withCorsJson(req, { error: "send_failed", message: sendErr.message }, 500)
    }
    console.log("[send-link] OTP sent successfully to:", email)

    return withCorsJson(req, {
      ok: true,
      sent: true,
      redirectTo,
      profileComplete: profile.profile_complete,
    })
  } catch (err: any) {
    console.error("[send-link] Error:", err?.message)
    return withCorsJson(req, { error: "server_error", message: "Internal error." }, 500)
  }
}
