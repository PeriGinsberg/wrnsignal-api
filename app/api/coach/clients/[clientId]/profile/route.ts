// app/api/coach/clients/[clientId]/profile/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { canonicalizeLegacyJobType, normalizeJobType } from "@/lib/jobType"

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

async function verifyCoachAccess(coachProfileId: string, clientProfileId: string, requiredLevel: string, supabase: any) {
  const levels: Record<string, string[]> = { view: ["view", "annotate", "full"], annotate: ["annotate", "full"], full: ["full"] }
  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status, accepted_at, lifecycle_status")
    .eq("coach_profile_id", coachProfileId)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
    .maybeSingle()
  if (!data) return null
  if (!levels[requiredLevel]?.includes(data.access_level)) return null
  return data
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()


    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)

    const access = await verifyCoachAccess(profileId, clientProfileId, "view", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship with view access" }, 403)
    }

    // Bump last_viewed_at on the coach_clients link. Powers the "since
    // last visit" indicator on My Clients cards + the "no recent coach
    // activity" predicate in Requires Action heuristics. Any tab open
    // counts as "I saw recent activity" (decision 2026-05-07). Fire-
    // and-forget — failure is non-fatal and bumps again on next visit.
    supabase
      .from("coach_clients")
      .update({ last_viewed_at: new Date().toISOString() })
      .eq("id", access.id)
      .then(({ error: bumpErr }) => {
        if (bumpErr) console.warn("[coach profile GET] last_viewed_at bump failed:", bumpErr.message)
      })

    const { data: profile, error: profileErr } = await supabase
      .from("client_profiles")
      .select("*")
      .eq("id", clientProfileId)
      .single()

    if (profileErr) throw new Error(`Profile lookup failed: ${profileErr.message}`)
    if (!profile) return withCorsJson(req, { ok: false, error: "Client profile not found" }, 404)

    const { data: personas } = await supabase
      .from("client_personas")
      .select("*")
      .eq("profile_id", clientProfileId)
      .order("created_at", { ascending: false })

    // Prospect-capture columns live on the SAME coach_clients row: a converted
    // prospect keeps its capture fields through convert (lifecycle just flips to
    // 'Active'), so they're already present on the linked-client row (NULL when
    // never captured — e.g. clients created via create-client). Surfaces the
    // coach_clients capture columns in the "Client Information" card on the
    // client detail page. Scoped SELECT by access.id; deliberately NOT folded
    // into the shared verifyCoachAccess helper (blast radius). Returned under a
    // dedicated `capture` namespace, never flattened into `profile`.
    const CAPTURE_COLS = [
      "source_category", "source_detail", "invited_email", "phone",
      "linkedin_url", "current_title", "current_company", "location",
      "years_experience_approx", "education_status", "university",
      "field_of_study", "grad_date", "target_roles", "target_locations",
      "preferred_locations", "timeline", "job_type", "tags", "invited_at",
      // phase _at columns — used only to compute last_activity_at (mirrors the
      // prospect route's computeLastActivityAt); not returned individually.
      "phase_initial_contact_made_at", "phase_discovery_call_scheduled_at",
      "phase_discovery_call_completed_at", "phase_sow_sent_at",
      "phase_sow_signed_at", "phase_invoice_sent_at", "phase_invoice_paid_at",
    ].join(", ")

    const { data: ccData } = await supabase
      .from("coach_clients")
      .select(CAPTURE_COLS)
      .eq("id", access.id)
      .maybeSingle()
    const cc = ccData as Record<string, any> | null

    let capture: Record<string, any> | null = null
    if (cc) {
      // last_activity_at: newest of the 7 phase timestamps (timestamp-or-null).
      // Each phase _at is a candidate in the max, so all 7 are required inputs.
      // (Note-derived activity dropped — phase timestamps only.)
      const activityCandidates = [
        cc.phase_initial_contact_made_at,
        cc.phase_discovery_call_scheduled_at,
        cc.phase_discovery_call_completed_at,
        cc.phase_sow_sent_at,
        cc.phase_sow_signed_at,
        cc.phase_invoice_sent_at,
        cc.phase_invoice_paid_at,
      ].filter((v): v is string => v !== null && v !== undefined)
      const lastActivityAt = activityCandidates.length
        ? activityCandidates.reduce((a, b) => (a > b ? a : b))
        : null

      capture = {
        source_category: cc.source_category,
        source_detail: cc.source_detail,
        invited_email: cc.invited_email,
        phone: cc.phone,
        linkedin_url: cc.linkedin_url,
        current_title: cc.current_title,
        current_company: cc.current_company,
        location: cc.location,
        years_experience_approx: cc.years_experience_approx,
        education_status: cc.education_status,
        university: cc.university,
        field_of_study: cc.field_of_study,
        grad_date: cc.grad_date,
        target_roles: cc.target_roles,
        target_locations: cc.target_locations,
        preferred_locations: cc.preferred_locations,
        timeline: cc.timeline,
        job_type: cc.job_type,
        tags: cc.tags,
        invited_at: cc.invited_at,
        last_activity_at: lastActivityAt,
      }
    }

    return withCorsJson(req, {
      ok: true,
      profile,
      personas: personas || [],
      capture,
      // The coach_clients.id for (this client_profile_id, authed coach) —
      // already resolved by verifyCoachAccess above (access.id). The
      // Engagements tab is keyed by it (the engagement API uses coach_clients.id,
      // not client_profile_id). Equivalent to resolveCoachClientId, reusing the
      // row this route already fetched.
      coach_client_id: access.id,
      // Engagement start = when the coach-client invite was accepted.
      // The Client Dashboard header uses this for "Client since [date]".
      // Null when the link has never been formally accepted (legacy data).
      accepted_at: access.accepted_at ?? null,
      lifecycle_status: access.lifecycle_status ?? "Active",
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

// Editable fields on client_profiles when a coach patches the row from
// the Profile & Personas tab. Anything outside this allowlist is ignored.
// Three fields stay OUT on purpose:
//   • email        — it is the auth identity (joins client_profiles↔auth.users);
//                    editing here would desync login + invite delivery.
//   • resume_text  — owned by the persona sync path (default persona → profile).
//   • profile_text — intake-derived narrative, rebuilt by the intake/self-serve
//                    writers; a coach edit here would be clobbered.
// `name` stays editable (the coach profile editor manages it; client-side
// blocks blank). Contact/education fields mirror the direct Create Client flow.
const COACH_EDITABLE_PROFILE_FIELDS = new Set([
  "name",
  "job_type",
  "target_roles",
  "target_locations",
  "preferred_locations",
  "timeline",
  "coach_notes_avoid",
  "coach_notes_strengths",
  "coach_notes_concerns",
  "phone",
  "linkedin_url",
  "education_status",
  "university",
  "grad_date",
])

// Columns that ALSO exist on the coach_clients row as denormalized prospect-
// capture copies. The Client Information card (buildClientInfoGroups in the
// client page) reads `capture ?? profile`, i.e. it PREFERS the coach_clients
// copy — so a client_profiles-only edit is invisible there whenever the
// capture column is non-null. On a successful profile edit we mirror the
// intersecting fields onto coach_clients so the card reflects the change.
// coach_notes_* are absent here (they have no coach_clients column).
const COACH_CLIENTS_CAPTURE_COLUMNS = new Set([
  "name",
  "job_type",
  "target_roles",
  "target_locations",
  "preferred_locations",
  "timeline",
  "phone",
  "linkedin_url",
  "education_status",
  "university",
  "grad_date",
])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)

    // Pilot decision (2026-05-07): profile edits require access_level = 'full'.
    // Annotate-only coaches see the page but can't write.
    const access = await verifyCoachAccess(profileId, clientProfileId, "full", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: full access required" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const updates: Record<string, any> = {}
    for (const [k, v] of Object.entries(body)) {
      if (!COACH_EDITABLE_PROFILE_FIELDS.has(k)) continue
      if (v === undefined) continue
      if (k === "job_type") {
        // Canonical multi-aware validate/normalize (replaces raw write).
        // Coerce legacy/dirty spellings before strict validation (prod-safety).
        const r = normalizeJobType(canonicalizeLegacyJobType(v as string | string[] | null))
        if (r.invalid.length) {
          return withCorsJson(req, { ok: false, error: `Invalid job_type: ${r.invalid.join(", ")}` }, 400)
        }
        updates.job_type = r.value
        continue
      }
      if (k === "education_status") {
        // Mirror the DB CHECK (and the direct Create Client guard) at the API
        // so a coach gets a clean 400, not a Postgres constraint 500.
        const s = v === null ? null : String(v).trim()
        const val = s && s.length ? s : null
        if (val && !["in_school", "graduated", "na"].includes(val)) {
          return withCorsJson(req, { ok: false, error: "Invalid education_status" }, 400)
        }
        updates.education_status = val
        continue
      }
      if (k === "grad_date") {
        // Same format the direct-create path enforces (YYYY-MM-DD), so a bad
        // date fails at the API rather than the date cast.
        const s = v === null ? null : String(v).trim()
        const val = s && s.length ? s : null
        if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
          return withCorsJson(req, { ok: false, error: "Invalid grad_date (expected YYYY-MM-DD)" }, 400)
        }
        updates.grad_date = val
        continue
      }
      // Empty string → null (so coach can clear a field by blanking it)
      const str = v === null ? null : String(v)
      updates[k] = str !== null && str.trim().length === 0 ? null : str
    }

    if (Object.keys(updates).length === 0) {
      return withCorsJson(req, { ok: false, error: "No editable fields supplied" }, 400)
    }

    updates.updated_at = new Date().toISOString()

    const { data: updated, error: updateErr } = await supabase
      .from("client_profiles")
      .update(updates)
      .eq("id", clientProfileId)
      .select("*")
      .single()

    if (updateErr) throw new Error(`Profile update failed: ${updateErr.message}`)

    // Write-through to the denormalized coach_clients capture copy. The Client
    // Information card reads `capture ?? profile` (capture-preferred), so a
    // client_profiles-only edit is invisible there when the capture column is
    // non-null. client_profiles is the source of truth (written above); this
    // mirror is best-effort — a failure is logged and the request still
    // returns 200 with the profile result (no fail on capture-copy drift).
    // Interim measure: flipping the card's read precedence to profile-first is
    // logged debt; until then write-through keeps the card consistent.
    const captureUpdates: Record<string, any> = {}
    for (const k of Object.keys(updates)) {
      if (COACH_CLIENTS_CAPTURE_COLUMNS.has(k)) captureUpdates[k] = updates[k]
    }
    if (Object.keys(captureUpdates).length > 0) {
      const { error: captureErr } = await supabase
        .from("coach_clients")
        .update(captureUpdates)
        .eq("id", access.id)
      if (captureErr) {
        console.warn("[coach profile PATCH] coach_clients capture write-through failed:", captureErr.message)
      }
    }

    return withCorsJson(req, { ok: true, profile: updated })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
