// app/api/coach/create-client/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { sendClientInvite } from "../../../../lib/email/sendClientInvite"

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

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  const supabase = getSupabaseAdmin()
  let createdAuthUserId: string | null = null
  let createdProfileId: string | null = null

  try {
    // ── STEP 1: Verify caller is a coach ──
    const { userId, email: callerEmail } = await getAuthedUser(req)

    const { data: coachProfile } = await supabase
      .from("client_profiles")
      .select("id, name, is_coach, coach_org")
      .eq("user_id", userId)
      .maybeSingle()

    if (!coachProfile) {
      // Fallback: try by email
      if (callerEmail) {
        const { data: byEmail } = await supabase
          .from("client_profiles")
          .select("id, name, is_coach, coach_org")
          .eq("email", callerEmail)
          .maybeSingle()
        if (!byEmail?.is_coach) {
          return withCorsJson(req, { ok: false, error: "Coach access required" }, 403)
        }
        Object.assign(coachProfile ?? {}, byEmail)
      } else {
        return withCorsJson(req, { ok: false, error: "Coach access required" }, 403)
      }
    }

    const coach = coachProfile!
    if (!coach.is_coach) {
      return withCorsJson(req, { ok: false, error: "Coach access required" }, 403)
    }

    // ── STEP 2: Read and validate request body ──
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const firstName = String(body.firstName || "").trim()
    const lastName = String(body.lastName || "").trim()
    const email = String(body.email || "").trim().toLowerCase()
    const jobType = String(body.jobType || "").trim()
    const targetRoles = String(body.targetRoles || "").trim()
    const targetLocations = String(body.targetLocations || "").trim()
    const timeframe = String(body.timeframe || "").trim()
    const resumeText = String(body.resumeText || "").trim() || null
    const hardConstraints = String(body.hardConstraints || "").trim() || null
    const strengths = String(body.strengths || "").trim() || null
    const concerns = String(body.concerns || "").trim() || null

    const missing: string[] = []
    if (!firstName) missing.push("firstName")
    if (!lastName) missing.push("lastName")
    if (!email) missing.push("email")
    if (!jobType) missing.push("jobType")
    if (!targetRoles) missing.push("targetRoles")
    if (!targetLocations) missing.push("targetLocations")
    if (!timeframe) missing.push("timeframe")

    if (missing.length) {
      return withCorsJson(req, { ok: false, error: `Missing required fields: ${missing.join(", ")}` }, 400)
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return withCorsJson(req, { ok: false, error: "Invalid email format" }, 400)
    }

    // ── STEP 3: Check if account already exists ──
    const { data: existingProfile } = await supabase
      .from("client_profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle()

    if (existingProfile) {
      return withCorsJson(req, { ok: false, error: "An account with this email already exists" }, 409)
    }

    // ── STEP 4: Create Supabase auth user ──
    const fullName = `${firstName} ${lastName}`

    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name: fullName },
    })

    if (authErr || !authData?.user) {
      console.error("[create-client] Auth user creation failed:", authErr?.message)
      return withCorsJson(req, { ok: false, error: `Failed to create auth user: ${authErr?.message || "unknown error"}` }, 500)
    }

    createdAuthUserId = authData.user.id

    // ── STEP 5: Create client_profile ──
    // Build profile_text (same pattern as PUT /api/profile)
    const lines: string[] = []
    const add = (label: string, val: string | null) => {
      const v = (val || "").trim()
      if (v) lines.push(`${label}: ${v}`)
    }
    add("Name", fullName)
    add("Job type", jobType)
    add("Target roles", targetRoles)
    add("Target locations", targetLocations)
    add("Timeline", timeframe)
    if (hardConstraints) add("Constraints", hardConstraints)
    if (strengths) add("Strengths", strengths)
    if (concerns) add("Concerns", concerns)
    if (resumeText) lines.push(`\nResume:\n${resumeText}`)
    const profileText = lines.join("\n").trim()

    const { data: newProfile, error: profileErr } = await supabase
      .from("client_profiles")
      .insert({
        user_id: createdAuthUserId,
        email,
        name: fullName,
        job_type: jobType,
        target_roles: targetRoles,
        target_locations: targetLocations,
        timeline: timeframe,
        resume_text: resumeText,
        profile_text: profileText,
        profile_complete: true,
        active: true,
        // Migration 20260507_profile_personas_pilot — first-class columns
        // for the three coaching notes captured here. Previously they were
        // only embedded inside profile_text, which made them uneditable
        // from the Profile & Personas tab.
        coach_notes_avoid: hardConstraints,
        coach_notes_strengths: strengths,
        coach_notes_concerns: concerns,
      })
      .select("id")
      .single()

    if (profileErr || !newProfile) {
      console.error("[create-client] Profile insert failed:", profileErr?.message)
      // Cleanup: delete auth user
      await supabase.auth.admin.deleteUser(createdAuthUserId)
      createdAuthUserId = null
      return withCorsJson(req, { ok: false, error: `Failed to create profile: ${profileErr?.message || "unknown error"}` }, 500)
    }

    createdProfileId = newProfile.id

    // Create the initial persona row from the resume so the new client's
    // Profile & Personas tab shows it as "Primary" out of the gate. Mirrors
    // the rule used by scripts/_backfill-personas.ts for existing clients:
    // skip when resume_text is empty.
    if (resumeText && resumeText.trim().length > 0) {
      const personaName = `${firstName}'s Resume`
      const { error: personaErr } = await supabase
        .from("client_personas")
        .insert({
          profile_id: createdProfileId,
          name: personaName,
          resume_text: resumeText,
          is_default: true,
          display_order: 1,
        })
      if (personaErr) {
        // Non-fatal: profile is usable; coach can re-add via Profile & Personas tab
        console.warn("[create-client] Initial persona insert failed:", personaErr.message)
      }
    }

    // ── STEP 6: Link client to coach ──
    const { error: linkErr } = await supabase
      .from("coach_clients")
      .insert({
        coach_profile_id: coach.id,
        client_profile_id: createdProfileId,
        invited_email: email,
        access_level: "full",
        status: "active",
        accepted_at: new Date().toISOString(),
      })

    if (linkErr) {
      console.error("[create-client] Coach link failed:", linkErr.message)
      // Non-fatal — profile exists, coach can re-invite
    }

    // ── STEP 7: Generate magic link ──
    const { data: linkData, error: magicErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: "https://wrnsignal-api.vercel.app/dashboard",
      },
    })

    if (magicErr) {
      console.error("[create-client] Magic link generation failed:", magicErr.message)
      return withCorsJson(req, {
        ok: true,
        message: "Account created but invite link failed — client can use magic link login",
        clientId: createdProfileId,
        emailSent: false,
      })
    }

    const magicLink = (linkData as any)?.properties?.action_link
    if (!magicLink) {
      console.error("[create-client] Missing action_link from generateLink")
      return withCorsJson(req, {
        ok: true,
        message: "Account created but invite link missing — client can use magic link login",
        clientId: createdProfileId,
        emailSent: false,
      })
    }

    // ── STEP 8: Send invite email ──
    let emailSent = true
    try {
      await sendClientInvite({
        clientFirstName: firstName,
        clientEmail: email,
        targetRoles,
        targetLocations,
        timeframe,
        magicLink,
        coachName: coach.name || coach.coach_org || "Your coach",
      })
    } catch (emailErr: any) {
      console.error("[create-client] Email send failed:", emailErr?.message)
      emailSent = false
    }

    // ── STEP 9: Return success ──
    return withCorsJson(req, {
      ok: true,
      message: emailSent
        ? "Account created and invite sent"
        : "Account created but email failed to send — client can log in via magic link",
      clientId: createdProfileId,
      emailSent,
    }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[create-client] Error:", msg)

    // Cleanup on unexpected failure
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
