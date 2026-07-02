// app/api/coach/coach-clients/[id]/setup-account/route.ts
//
// "Set up account (no invite)" — the prospect-flow twin of coach/create-client's
// deferred-invite decoupling. Creates the SIGNAL account for a converted
// prospect and links it (sets client_profile_id) WITHOUT sending the invite
// email. The coach sends the invite later from the client detail screen via
// /api/coach/clients/[clientId]/send-invite (shipped 9c7c756b).
//
// This is send-invite's account-creation half (create-new Steps 1-4 +
// link-existing) MINUS the magic-link/email steps. Deliberately duplicated
// rather than shared with send-invite so the shipped invite path is untouched.
// (Tech debt: 3 near-identical copies now exist — create-client, send-invite
// create-new, and this. Consolidate onto a shared helper as separate work.)
//
// [id] = coach_clients.id (NOT client_profile_id) — same key as the awaiting-
// setup screen and /coach-clients/[id]/send-invite.
//
// CORRECTNESS-CRITICAL: the link UPDATE sets invited_at = null alongside
// client_profile_id. A prospect row's invited_at = its prospect-creation date
// (DEFAULT now(), reused as the created_at anchor). Leaving it non-null would
// make the client screen's Send/Re-send button falsely read "Invited {date}" /
// "Re-send" on an account that was never emailed. Mirrors create-client:283.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { logCoachClientEvent } from "../../../../_lib/coachClientEvents"

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

// Caller's client_profiles row for the is_coach gate. Mirrors send-invite.
async function getCoachProfile(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id, name, is_coach, coach_org")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, name, is_coach, coach_org, user_id")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
      }
      const { user_id: _u, ...rest } = byEmail as any
      return rest
    }
  }
  return null
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin()

  // Cleanup tracking for the outer catch — mirrors send-invite / create-client.
  let createdAuthUserId: string | null = null
  let createdProfileId: string | null = null

  try {
    // ── Gate 1+2: auth ─────────────────────────────────────────────
    const { userId, email: callerEmail } = await getAuthedUser(req)

    // ── Gate 3+3.5: caller is a coach ──────────────────────────────
    const coach = await getCoachProfile(userId, callerEmail)
    if (!coach) {
      return withCorsJson(req, { ok: false, error: "Profile not found" }, 500)
    }
    if (!coach.is_coach) {
      return withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403)
    }
    const coachProfileId = coach.id as string

    // ── Gate 4: URL param ──────────────────────────────────────────
    const { id: coachClientId } = await params
    if (!coachClientId) {
      return withCorsJson(req, { ok: false, error: "id is required" }, 400)
    }

    // ── Gate 5: body parses (optional resume_text) ─────────────────
    const rawText = await req.text()
    let body: any = {}
    if (rawText.trim()) {
      try {
        body = JSON.parse(rawText)
      } catch {
        return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
      }
      if (typeof body !== "object" || body === null) {
        return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
      }
    }
    const resumeText = typeof body.resume_text === "string"
      ? body.resume_text.trim() || null
      : null

    // ── Gate 6: row exists + owned by caller + active ("full") ─────
    const { data: ccRow } = await supabase
      .from("coach_clients")
      .select("id, lifecycle_status, client_profile_id, invited_email, name, is_returning, access_level, job_type, target_roles, target_locations, preferred_locations, timeline")
      .eq("id", coachClientId)
      .eq("coach_profile_id", coachProfileId)
      .eq("status", "active")
      .maybeSingle()
    if (!ccRow) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }
    if (ccRow.access_level !== "full") {
      return withCorsJson(req, { ok: false, error: "Forbidden: full access required" }, 403)
    }

    // ── Gate 7: lifecycle bucket ───────────────────────────────────
    if (ccRow.lifecycle_status !== "Active" && ccRow.lifecycle_status !== "Inactive") {
      return withCorsJson(req, {
        ok: false,
        error: "Cannot set up account for this lifecycle status; must be 'Active' or 'Inactive'",
      }, 422)
    }

    // ── Gate 8: invited_email present ──────────────────────────────
    if (!ccRow.invited_email || !String(ccRow.invited_email).trim()) {
      return withCorsJson(req, { ok: false, error: "Email missing on coach_clients row" }, 400)
    }

    // ── Gate 9: not already linked ─────────────────────────────────
    if (ccRow.client_profile_id) {
      return withCorsJson(req, { ok: false, error: "Account already set up (profile already linked)" }, 409)
    }

    // ── Find-or-create branch decision ─────────────────────────────
    const normalizedEmail = String(ccRow.invited_email).trim().toLowerCase()
    const name = String(ccRow.name ?? "").trim() || normalizedEmail.split("@")[0]
    const firstName = name.split(/\s+/)[0] || "there"

    const { data: existingProfile } = await supabase
      .from("client_profiles")
      .select("id, user_id")
      .eq("email", normalizedEmail)
      .maybeSingle()

    let profileId: string
    let branch: "create-new" | "link-existing"

    if (existingProfile) {
      // ── Branch: link-existing ────────────────────────────────────
      branch = "link-existing"
      profileId = existingProfile.id as string

      if (resumeText) {
        console.warn(
          `[setup-account] link-existing branch: resume_text provided but ` +
          `skipped because profile already exists. ` +
          `coach_client_id=${coachClientId} profile_id=${profileId}`,
        )
      }

      // Link + null invited_at (GAP 1) in one UPDATE.
      const { error: linkErr } = await supabase
        .from("coach_clients")
        .update({ client_profile_id: profileId, invited_at: null })
        .eq("id", coachClientId)
      if (linkErr) {
        throw new Error(`Failed to link profile to coach_clients: ${linkErr.message}`)
      }

      // Returning-client clean slate (same as send-invite:233-239).
      if (ccRow.is_returning) {
        const { error: boundaryErr } = await supabase
          .from("client_profiles")
          .update({ history_boundary_at: new Date().toISOString() })
          .eq("id", profileId)
        if (boundaryErr) console.warn("[setup-account] history_boundary stamp failed:", boundaryErr.message)
      }
    } else {
      // ── Branch: create-new ───────────────────────────────────────
      branch = "create-new"

      // Step 1: create auth user
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: { name },
      })
      if (authErr || !authData?.user) {
        console.error("[setup-account] Auth user create failed:", authErr?.message)
        return withCorsJson(req, {
          ok: false,
          error: `Failed to create auth user: ${authErr?.message || "unknown error"}`,
        }, 500)
      }
      createdAuthUserId = authData.user.id

      // Step 2: INSERT client_profiles (with prospect carry-over)
      const profileTextLines: string[] = []
      if (name) profileTextLines.push(`Name: ${name}`)
      if (resumeText) profileTextLines.push(`\nResume:\n${resumeText}`)
      const profileText = profileTextLines.join("\n").trim()

      const carryover: Record<string, string> = {}
      if (ccRow.job_type) carryover.job_type = ccRow.job_type
      if (ccRow.target_roles) carryover.target_roles = ccRow.target_roles
      if (ccRow.target_locations) carryover.target_locations = ccRow.target_locations
      if (ccRow.preferred_locations) carryover.preferred_locations = ccRow.preferred_locations
      if (ccRow.timeline) carryover.timeline = ccRow.timeline

      const { data: newProfile, error: profileErr } = await supabase
        .from("client_profiles")
        .insert({
          user_id: createdAuthUserId,
          email: normalizedEmail,
          name,
          profile_text: profileText,
          resume_text: resumeText,
          profile_complete: false,
          active: true,
          ...carryover,
        })
        .select("id")
        .single()
      if (profileErr || !newProfile) {
        console.error("[setup-account] Profile insert failed:", profileErr?.message)
        await supabase.auth.admin.deleteUser(createdAuthUserId).catch(() => {})
        createdAuthUserId = null
        return withCorsJson(req, {
          ok: false,
          error: `Failed to create profile: ${profileErr?.message || "unknown error"}`,
        }, 500)
      }
      createdProfileId = newProfile.id as string
      profileId = createdProfileId

      // Step 3: UPDATE link + null invited_at (GAP 1) in one UPDATE.
      const { error: linkErr } = await supabase
        .from("coach_clients")
        .update({ client_profile_id: profileId, invited_at: null })
        .eq("id", coachClientId)
      if (linkErr) {
        console.error("[setup-account] Link update failed:", linkErr.message)
        try { await supabase.from("client_profiles").delete().eq("id", createdProfileId) } catch {}
        await supabase.auth.admin.deleteUser(createdAuthUserId).catch(() => {})
        createdProfileId = null
        createdAuthUserId = null
        return withCorsJson(req, {
          ok: false,
          error: `Failed to link profile to coach_clients: ${linkErr.message}`,
        }, 500)
      }

      // Steady state reached — clear cleanup refs so a later non-fatal
      // throw can't cascade-delete the account/link (same guard as
      // send-invite:322-329).
      createdProfileId = null
      createdAuthUserId = null

      // Step 4: (optional) INSERT persona — NON-FATAL.
      if (resumeText) {
        const { error: personaErr } = await supabase
          .from("client_personas")
          .insert({
            profile_id: profileId,
            name: `${firstName}'s Resume`,
            resume_text: resumeText,
            is_default: true,
            display_order: 1,
          })
        if (personaErr) {
          console.warn("[setup-account] Initial persona insert failed:", personaErr.message)
        }
      }
    }

    // NO magic link, NO email — the coach sends the invite later from the
    // client detail screen. (send-invite Steps 5-6 intentionally omitted.)

    // ── Audit: non-invite copy (GAP 2) ─────────────────────────────
    // Note + event record ACCOUNT CREATION, never an invite.
    try {
      const { error: noteErr } = await supabase
        .from("coach_client_notes")
        .insert({
          coach_client_id: coachClientId,
          coach_profile_id: coachProfileId,
          client_profile_id: profileId,
          type: "other",
          body: "Account created",
          priority: null,
        })
      if (noteErr) {
        console.warn("[setup-account] System note insert failed:", noteErr.message)
      }
    } catch (noteErr: any) {
      console.warn("[setup-account] System note insert threw:", noteErr?.message)
    }

    await logCoachClientEvent({
      coachClientId,
      eventType: "account_created",
      actorProfileId: coachProfileId,
      context: { branch },
    })

    return withCorsJson(req, {
      ok: true,
      client_profile_id: profileId,
      coach_client_id: coachClientId,
      branch,
    }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[setup-account] Error:", msg)

    if (createdProfileId) {
      try { await supabase.from("client_profiles").delete().eq("id", createdProfileId) } catch {}
    }
    if (createdAuthUserId) {
      try { await supabase.auth.admin.deleteUser(createdAuthUserId) } catch {}
    }

    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
