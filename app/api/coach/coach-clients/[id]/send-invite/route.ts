// app/api/coach/coach-clients/[id]/send-invite/route.ts
//
// Send SIGNAL invite endpoint for the Prospects v0.1 surface
// (Commit 2c, 2026-05-23). FRD: docs/Features/coaches-center-prospects-frd.md §6.5.
//
// Available on `coach_clients` rows where:
//   - lifecycle_status IN ('Active', 'Inactive')  (no Prospects, no Archived)
//   - client_profile_id IS NULL                    (no SIGNAL account yet)
//   - invited_email IS NOT NULL                    (we need somewhere to send the link)
//
// Two branches:
//   - create-new      → no client_profiles row exists for invited_email →
//                       create auth user + INSERT profile + (optional)
//                       INSERT persona + UPDATE coach_clients link.
//   - link-existing   → a client_profiles row already exists for the email
//                       (different coach prospected/converted them first, or
//                       same coach previously archived them). Skip creates;
//                       just UPDATE coach_clients link. resume_text in body
//                       is silently dropped (with a warn-log) — frontend
//                       Commit 4 surfaces this to the coach.
//
// URL path-prefix `/coach-clients/` (not `/clients/`) avoids semantic
// collision with the existing `/api/coach/clients/[clientId]/*` routes
// where `[clientId]` = `client_profile_id`. Here `[id]` = `coach_clients.id`.
//
// Failure handling mirrors `coach/create-client` (compensating delete on
// downstream failures during the create-new branch). Steps 4-6 (persona,
// magic link, email) are non-fatal — failure leaves a usable account.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { sendClientInvite } from "@/lib/email/sendClientInvite"
import { getAppUrl } from "@/lib/urls"

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

// Returns the caller's client_profiles row with id + name + is_coach +
// coach_org for the is_coach gate (3.5) AND for the email's coachName arg.
// Falls back to email lookup if user_id doesn't match (matches the pattern
// at coach/create-client/route.ts:52-65).
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

  // Track resources we created during this request so the outer catch
  // can clean them up on unexpected failure. Mirrors coach/create-client.
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

    // ── Gate 5: body parses ────────────────────────────────────────
    // Body is optional for this endpoint (only field is the optional
    // resume_text). Existing coach routes use req.json().catch(() => null)
    // which 400s on empty body — wrong semantics here. Use req.text()
    // + conditional JSON.parse to allow empty body and only reject
    // malformed JSON.
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

    // ── Gate 6: row exists + owned by caller + active ──────────────
    // Single lookup gates ownership AND existence (same 403 prevents
    // existence-probing). Returns the row's columns we need below.
    const { data: ccRow } = await supabase
      .from("coach_clients")
      .select("id, lifecycle_status, client_profile_id, invited_email, name")
      .eq("id", coachClientId)
      .eq("coach_profile_id", coachProfileId)
      .eq("status", "active")
      .maybeSingle()
    if (!ccRow) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    // ── Gate 7: lifecycle bucket ───────────────────────────────────
    if (ccRow.lifecycle_status !== "Active" && ccRow.lifecycle_status !== "Inactive") {
      return withCorsJson(req, {
        ok: false,
        error: "Cannot send invite for this lifecycle status; must be 'Active' or 'Inactive'",
      }, 422)
    }

    // ── Gate 8: invited_email present ──────────────────────────────
    if (!ccRow.invited_email || !String(ccRow.invited_email).trim()) {
      return withCorsJson(req, { ok: false, error: "Email missing on coach_clients row" }, 400)
    }

    // ── Gate 9: not already linked ─────────────────────────────────
    if (ccRow.client_profile_id) {
      return withCorsJson(req, { ok: false, error: "Already invited (profile already linked)" }, 409)
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
        // Q4 decision: silently drop resume_text on link-existing.
        // Warn-log preserves the coach's intent for post-hoc auditing;
        // frontend Commit 4 will surface this case at invite time.
        console.warn(
          `[send-invite] link-existing branch: resume_text provided but ` +
          `skipped because profile already exists. ` +
          `coach_client_id=${coachClientId} profile_id=${profileId}`,
        )
      }

      // Link the existing profile to this coach_clients row.
      const { error: linkErr } = await supabase
        .from("coach_clients")
        .update({ client_profile_id: profileId })
        .eq("id", coachClientId)
      if (linkErr) {
        throw new Error(`Failed to link profile to coach_clients: ${linkErr.message}`)
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
        console.error("[send-invite] Auth user create failed:", authErr?.message)
        return withCorsJson(req, {
          ok: false,
          error: `Failed to create auth user: ${authErr?.message || "unknown error"}`,
        }, 500)
      }
      createdAuthUserId = authData.user.id

      // Step 2: INSERT client_profiles
      const profileTextLines: string[] = []
      if (name) profileTextLines.push(`Name: ${name}`)
      if (resumeText) profileTextLines.push(`\nResume:\n${resumeText}`)
      const profileText = profileTextLines.join("\n").trim()

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
        })
        .select("id")
        .single()
      if (profileErr || !newProfile) {
        console.error("[send-invite] Profile insert failed:", profileErr?.message)
        // Compensating cleanup: delete the auth user we just created.
        await supabase.auth.admin.deleteUser(createdAuthUserId).catch(() => {})
        createdAuthUserId = null
        return withCorsJson(req, {
          ok: false,
          error: `Failed to create profile: ${profileErr?.message || "unknown error"}`,
        }, 500)
      }
      createdProfileId = newProfile.id as string
      profileId = createdProfileId

      // Step 3: UPDATE coach_clients link
      const { error: linkErr } = await supabase
        .from("coach_clients")
        .update({ client_profile_id: profileId })
        .eq("id", coachClientId)
      if (linkErr) {
        console.error("[send-invite] Link update failed:", linkErr.message)
        // Compensating cleanup: delete profile + auth user.
        // PostgrestFilterBuilder isn't a Promise so .catch() doesn't typecheck;
        // wrap in try/catch to swallow cleanup errors (best-effort).
        try { await supabase.from("client_profiles").delete().eq("id", createdProfileId) } catch {}
        await supabase.auth.admin.deleteUser(createdAuthUserId).catch(() => {})
        createdProfileId = null
        createdAuthUserId = null
        return withCorsJson(req, {
          ok: false,
          error: `Failed to link profile to coach_clients: ${linkErr.message}`,
        }, 500)
      }

      // Step 3 succeeded — the auth user + profile + link are now the
      // steady state. Clear our cleanup-tracking refs so the outer catch
      // doesn't roll them back if a later non-fatal step throws
      // unexpectedly. Without this, an exception in Steps 4-6 would
      // delete the profile, cascade-delete the coach_clients row via
      // client_profile_id FK, and destroy the coach's prospect record.
      createdProfileId = null
      createdAuthUserId = null

      // Step 4: (optional) INSERT client_personas — NON-FATAL.
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
          console.warn("[send-invite] Initial persona insert failed:", personaErr.message)
        }
      }
    }

    // ── Step 5: magic link — NON-FATAL ─────────────────────────────
    let magicLink: string | null = null
    {
      const { data: linkData, error: magicErr } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: normalizedEmail,
        options: { redirectTo: `${getAppUrl(req)}/dashboard` },
      })
      if (magicErr) {
        console.error("[send-invite] generateLink failed:", magicErr.message)
      } else {
        magicLink = (linkData as any)?.properties?.action_link ?? null
        if (!magicLink) {
          console.error("[send-invite] generateLink missing action_link")
        }
      }
    }

    // ── Step 6: send invite email — NON-FATAL ──────────────────────
    let emailSent = false
    if (magicLink) {
      try {
        await sendClientInvite({
          clientFirstName: firstName,
          clientEmail: normalizedEmail,
          // target/timeframe not captured on coach_clients rows; pass
          // empty strings and let the template's hasAnyTargets branch
          // render the alternate "your coach will be in touch" copy.
          targetRoles: "",
          targetLocations: "",
          timeframe: "",
          magicLink,
          coachName: coach.name || coach.coach_org || "Your coach",
        })
        emailSent = true
      } catch (emailErr: any) {
        console.error("[send-invite] Email send failed:", emailErr?.message)
      }
    }

    // ── Step 7: log a system note on the coach_clients record ─────
    //
    // NON-FATAL. Records "SIGNAL invite sent" as an audit-trail note
    // so the timeline of coach actions on a client is reconstructable
    // from the notes feed alone. type='other' (matches the FRD lock
    // for non-action notes); priority must be NULL for 'other' type
    // (table CHECK constraint). client_profile_id is denormalized
    // for index-only filtered queries — by this point `profileId` is
    // populated by the link UPDATE earlier in the flow.
    //
    // Wrapped in try/catch + console.warn so a note insert failure
    // can never block the success response. The invite was already
    // sent at this point; the note is background logging.
    try {
      const { error: noteErr } = await supabase
        .from("coach_client_notes")
        .insert({
          coach_client_id: coachClientId,
          coach_profile_id: coachProfileId,
          client_profile_id: profileId,
          type: "other",
          body: "SIGNAL invite sent",
          priority: null,
        })
      if (noteErr) {
        console.warn("[send-invite] System note insert failed:", noteErr.message)
      }
    } catch (noteErr: any) {
      console.warn("[send-invite] System note insert threw:", noteErr?.message)
    }

    return withCorsJson(req, {
      ok: true,
      client_profile_id: profileId,
      coach_client_id: coachClientId,
      branch,
      email_sent: emailSent,
    }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[send-invite] Error:", msg)

    // Outer cleanup: anything we created in this request gets removed.
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
