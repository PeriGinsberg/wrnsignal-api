// app/api/coach/calendar/disconnect/route.ts
//
// DELETE /api/coach/calendar/disconnect — Phase 1d Commit 2.
//
// Removes the calling coach's calendar connection row. JSON API endpoint
// (Bearer auth). NO beta-gate: a coach must always be able to disconnect, even
// if removed from CALENDAR_BETA_PROFILE_IDS after connecting.
//
// Note: this does NOT revoke the token in Microsoft's system — the access token
// stays valid in Microsoft's infra until natural expiry (~1h). Full revocation
// requires the coach to remove the app in their Microsoft account settings
// (documented in the coach-facing guide). Calling a Microsoft revocation
// endpoint is out of scope per FRD §2 non-goals.
//
// FRD: docs/Features/coach-calendar-integration-v0-1-frd.md §6.4.4, §6.5, §6.9, §6.10

import { NextRequest, NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── Auth helpers (inlined per coach-route convention; coachAuth extraction
//    deferred per FRD §2 non-goals). Copied from app/api/coach/clients/route.ts.
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

async function verifyCoach(profileId: string, supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase
    .from("client_profiles")
    .select("is_coach")
    .eq("id", profileId)
    .single()
  return data?.is_coach === true
}

export async function DELETE(req: NextRequest) {
  // 1. Auth.
  let userId: string
  let email: string | null
  try {
    const authed = await getAuthedUser(req)
    userId = authed.userId
    email = authed.email
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }

  let profileId: string
  try {
    profileId = await getProfileId(userId, email)
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  if (!(await verifyCoach(profileId, supabase))) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 })
  }

  // 2. DELETE ... RETURNING id (via .select()).
  const { data, error } = await supabase
    .from("coach_calendar_connections")
    .delete()
    .eq("coach_profile_id", profileId)
    .select("id")

  if (error) {
    console.error(`[coach-calendar/disconnect] DELETE_FAILED coachProfileId=${profileId}`, error)
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }

  // 3. Branch on rows affected.
  if (!data || data.length === 0) {
    console.log(`[coach-calendar/disconnect] NOT_FOUND coachProfileId=${profileId}`)
    return NextResponse.json({ error: "not_connected", disconnected: false }, { status: 404 })
  }

  console.log(`[coach-calendar/disconnect] DISCONNECTED coachProfileId=${profileId}`)
  return NextResponse.json({ disconnected: true }, { status: 200 })
}
