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
import { getAuthedUser, getProfileId } from "@/lib/collab/identity"
import { ForbiddenError } from "@/lib/collab/errors"


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
  } catch (e) {
    // A login whose email is on another live login's profile is refused (403).
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 })
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
