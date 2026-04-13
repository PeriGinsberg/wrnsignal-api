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
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string

  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles")
      .select("id, user_id")
      .eq("email", email)
      .maybeSingle()
    if (emailErr) throw new Error(`Profile email lookup failed: ${emailErr.message}`)
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        const { error: attachErr } = await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
        if (attachErr) throw new Error(`Profile attach failed: ${attachErr.message}`)
      }
      return byEmail.id as string
    }
  }

  throw new Error("Profile not found")
}

async function verifyCoach(profileId: string, supabase: any): Promise<boolean> {
  const { data } = await supabase
    .from("client_profiles")
    .select("is_coach")
    .eq("id", profileId)
    .single()
  return data?.is_coach === true
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const isCoach = await verifyCoach(profileId, supabase)
    if (!isCoach) {
      return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const clientEmail = String(body.client_email || "").trim().toLowerCase()
    const accessLevel = String(body.access_level || "view").trim()
    if (!clientEmail) return withCorsJson(req, { ok: false, error: "client_email is required" }, 400)

    const validLevels = ["view", "annotate", "full"]
    if (!validLevels.includes(accessLevel)) {
      return withCorsJson(req, { ok: false, error: "access_level must be view, annotate, or full" }, 400)
    }

    // Check if client already has an account
    const { data: existingProfile } = await supabase
      .from("client_profiles")
      .select("id, email")
      .eq("email", clientEmail)
      .maybeSingle()

    const clientProfileId = existingProfile?.id ?? null

    // Get coach profile for invite token context
    const { data: coachProfile } = await supabase
      .from("client_profiles")
      .select("id, full_name, org_name")
      .eq("id", profileId)
      .single()

    // Create invite token
    const inviteToken = crypto.randomUUID()

    // Check for existing pending invite from this coach to this email
    const { data: existingInvite } = await supabase
      .from("coach_clients")
      .select("id, status")
      .eq("coach_profile_id", profileId)
      .eq("client_email", clientEmail)
      .maybeSingle()

    let inviteRow: any
    if (existingInvite) {
      // Update existing invite
      const { data, error } = await supabase
        .from("coach_clients")
        .update({
          status: "pending",
          access_level: accessLevel,
          invite_token: inviteToken,
          invite_sent_at: new Date().toISOString(),
          client_profile_id: clientProfileId,
        })
        .eq("id", existingInvite.id)
        .select("*")
        .single()
      if (error) throw new Error(`Failed to update invite: ${error.message}`)
      inviteRow = data
    } else {
      // Create new invite
      const { data, error } = await supabase
        .from("coach_clients")
        .insert({
          coach_profile_id: profileId,
          client_email: clientEmail,
          client_profile_id: clientProfileId,
          access_level: accessLevel,
          status: "pending",
          invite_token: inviteToken,
          invite_sent_at: new Date().toISOString(),
        })
        .select("*")
        .single()
      if (error) throw new Error(`Failed to create invite: ${error.message}`)
      inviteRow = data
    }

    // Send OTP magic link to client
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: clientEmail,
      options: {
        data: {
          invite_token: inviteToken,
          coach_name: coachProfile?.full_name || null,
          coach_org: coachProfile?.org_name || null,
        },
      },
    })

    if (otpError) {
      return withCorsJson(req, {
        ok: false,
        error: `Failed to send invite email: ${otpError.message}`,
      }, 500)
    }

    const scenario = clientProfileId ? "existing_user" : "new_user"

    return withCorsJson(req, {
      ok: true,
      status: "invited",
      scenario,
      invite_id: inviteRow.id,
    }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
