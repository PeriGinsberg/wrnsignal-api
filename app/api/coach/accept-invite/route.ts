// app/api/coach/accept-invite/route.ts
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

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const inviteToken = String(body.token || "").trim()
    if (!inviteToken) return withCorsJson(req, { ok: false, error: "token is required" }, 400)

    // Find pending coach_clients row by invite token
    const { data: invite, error: inviteErr } = await supabase
      .from("coach_clients")
      .select("id, coach_profile_id, invited_email, status")
      .eq("invite_token", inviteToken)
      .maybeSingle()

    if (inviteErr) throw new Error(`Invite lookup failed: ${inviteErr.message}`)
    if (!invite) return withCorsJson(req, { ok: false, error: "Invite not found or already used" }, 404)
    if (invite.status !== "pending") {
      return withCorsJson(req, { ok: false, error: "Invite is no longer pending" }, 409)
    }

    // Verify the accepting user's email matches the invite
    if (invite.invited_email && email && invite.invited_email !== email) {
      return withCorsJson(req, { ok: false, error: "This invite was sent to a different email address" }, 403)
    }

    // Update coach_clients to active
    const { error: updateErr } = await supabase
      .from("coach_clients")
      .update({
        status: "active",
        client_profile_id: profileId,
        accepted_at: new Date().toISOString(),
        invite_token: null,
      })
      .eq("id", invite.id)

    if (updateErr) throw new Error(`Failed to accept invite: ${updateErr.message}`)

    // Fetch coach name and org for response
    const { data: coachProfile } = await supabase
      .from("client_profiles")
      .select("full_name, org_name")
      .eq("id", invite.coach_profile_id)
      .single()

    return withCorsJson(req, {
      ok: true,
      coach_name: coachProfile?.full_name || null,
      coach_org: coachProfile?.org_name || null,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
