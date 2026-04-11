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
    const origin = req.headers.get("origin") || "https://wrnsignal.workforcereadynow.com"
    const redirectTo = profile.profile_complete
      ? `${origin}/signal/jobfit`
      : `${origin}/dashboard/onboarding`

    // Send the magic link
    const { error: otpErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    })

    // generateLink creates the user + link server-side but doesn't send email.
    // Use signInWithOtp to actually send the email.
    const { error: sendErr } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })

    if (sendErr) {
      console.error("[send-link] OTP send error:", sendErr.message)
      return withCorsJson(req, { error: "send_failed", message: sendErr.message }, 500)
    }

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
