// app/api/coach/invite/route.ts
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

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data.id as string

  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) return byEmail.id as string
  }

  throw new Error("Profile not found")
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Verify caller is a coach
    const { data: coachProfile } = await supabase
      .from("client_profiles")
      .select("id, name, is_coach, coach_org")
      .eq("id", profileId)
      .single()

    if (!coachProfile?.is_coach) {
      return withCorsJson(req, { ok: false, error: "Coach access required" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    // Accept both "email" and "client_email" from the request
    const clientEmail = String(body.email || body.client_email || "").trim().toLowerCase()
    const accessLevel = String(body.access_level || "full").trim()
    const personalNote = String(body.note || body.personal_note || "").trim()

    if (!clientEmail) return withCorsJson(req, { ok: false, error: "Email is required" }, 400)

    if (!["view", "annotate", "full"].includes(accessLevel)) {
      return withCorsJson(req, { ok: false, error: "access_level must be view, annotate, or full" }, 400)
    }

    // Check if client already has a SIGNAL account
    const { data: existingClient } = await supabase
      .from("client_profiles")
      .select("id")
      .eq("email", clientEmail)
      .maybeSingle()

    const clientProfileId = existingClient?.id ?? null

    // Check for existing invite from this coach to this email
    const { data: existingInvite } = await supabase
      .from("coach_clients")
      .select("id, status")
      .eq("coach_profile_id", profileId)
      .eq("invited_email", clientEmail)
      .maybeSingle()

    const inviteToken = crypto.randomUUID()

    if (existingInvite) {
      const { error: updateErr } = await supabase
        .from("coach_clients")
        .update({
          status: "pending",
          access_level: accessLevel,
          invite_token: inviteToken,
          invited_at: new Date().toISOString(),
          client_profile_id: clientProfileId,
        })
        .eq("id", existingInvite.id)

      if (updateErr) throw new Error(`Failed to update invite: ${updateErr.message}`)
    } else {
      const { error: insertErr } = await supabase
        .from("coach_clients")
        .insert({
          coach_profile_id: profileId,
          client_profile_id: clientProfileId,
          invited_email: clientEmail,
          access_level: accessLevel,
          status: "pending",
          invite_token: inviteToken,
        })

      if (insertErr) throw new Error(`Failed to create invite: ${insertErr.message}`)
    }

    // Send magic link to the client
    const redirectUrl = `https://wrnsignal-api.vercel.app/dashboard/accept-invite?token=${inviteToken}`

    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: clientEmail,
      options: {
        emailRedirectTo: redirectUrl,
      },
    })

    if (otpErr) {
      console.error("[coach/invite] OTP send failed:", otpErr.message)
      return withCorsJson(req, {
        ok: false,
        error: `Failed to send invite: ${otpErr.message}`,
      }, 500)
    }

    console.log("[coach/invite] Invite sent:", {
      coach: coachProfile.name,
      client: clientEmail,
      scenario: clientProfileId ? "existing_user" : "new_user",
      redirectUrl,
    })

    return withCorsJson(req, {
      ok: true,
      status: "invited",
      scenario: clientProfileId ? "existing_user" : "new_user",
    }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/invite] Error:", msg)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
