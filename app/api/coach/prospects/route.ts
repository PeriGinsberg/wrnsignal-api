// app/api/coach/prospects/route.ts
//
// Prospect list + create endpoints (Prospects v0.1 Commit 4b,
// 2026-05-24). FRD: docs/Features/coaches-center-prospects-frd.md §6.4.1, §6.4.2.
//
// Routes:
//   GET    — list prospects for the authed coach (lifecycle='Prospect',
//            status='active'). Sorted last_activity_at DESC NULLS LAST,
//            then created_at (invited_at proxy) DESC.
//   POST   — create a new prospect + optional initial_note.
//
// Per-prospect operations (detail/update/delete) live in ./[id]/route.ts.
// Per-prospect notes operations (GET/POST/PUT/DELETE) live in
// ./[id]/notes/* (shipped in Commit 2b, 0b00c599).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── Constants + types (inlined per coach-route duplication pattern) ──

const SOURCE_CATEGORIES = ["referral", "social_media", "website", "personal_contact", "other"] as const
type SourceCategory = (typeof SOURCE_CATEGORIES)[number]

const LIFECYCLE_STATUSES = ["Prospect", "Active", "Inactive", "Archived"] as const
type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number]

const PHASE_KEYS = [
  "initial_contact_made",
  "discovery_call_scheduled",
  "discovery_call_completed",
  "sow_sent",
  "sow_signed",
  "invoice_sent",
  "invoice_paid",
] as const

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Capture-field constants + validators (Prospects v0.2) ──
// Shared shape with the PATCH route ([id]/route.ts) — each returns { value }
// on success or { error } (a 400 message). All fields are optional; empty
// input normalizes to null rather than empty string.
const EDUCATION_STATUSES = ["in_school", "graduated", "na"] as const
const JOB_TYPES = ["Full Time Role", "Internship", "Both"] as const

type FieldResult<T> = { value: T } | { error: string }

function optText(raw: unknown, field: string, max: number): FieldResult<string | null> {
  if (raw === undefined || raw === null) return { value: null }
  if (typeof raw !== "string") return { error: `${field} must be a string` }
  const t = raw.trim()
  if (!t) return { value: null }
  if (t.length > max) return { error: `${field} too long (max ${max} chars)` }
  return { value: t }
}

function optEnum(raw: unknown, field: string, allowed: readonly string[]): FieldResult<string | null> {
  if (raw === undefined || raw === null || raw === "") return { value: null }
  if (typeof raw !== "string" || !allowed.includes(raw)) {
    return { error: `${field} must be one of: ${allowed.join(", ")}` }
  }
  return { value: raw }
}

// Non-negative whole number. Accepts a number or numeric string; empty → null;
// anything non-numeric is rejected with a 400 (never reaches the int column to
// throw). This is one of the two fields where capture historically breaks.
function optInt(raw: unknown, field: string): FieldResult<number | null> {
  if (raw === undefined || raw === null || raw === "") return { value: null }
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0) return { error: `${field} must be a whole number (0 or more)` }
    return { value: raw }
  }
  if (typeof raw === "string") {
    const t = raw.trim()
    if (!t) return { value: null }
    if (!/^\d+$/.test(t)) return { error: `${field} must be a whole number (0 or more)` }
    return { value: parseInt(t, 10) }
  }
  return { error: `${field} must be a whole number (0 or more)` }
}

// Date as YYYY-MM-DD. Empty → null; partial/invalid rejected with a 400 so a
// bad string never reaches the date column and throws. The other field where
// capture historically breaks.
function optDate(raw: unknown, field: string): FieldResult<string | null> {
  if (raw === undefined || raw === null || raw === "") return { value: null }
  if (typeof raw !== "string") return { error: `${field} must be a date (YYYY-MM-DD)` }
  const t = raw.trim()
  if (!t) return { value: null }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) {
    return { error: `${field} must be a valid date (YYYY-MM-DD)` }
  }
  return { value: t }
}

// Raw shape of a coach_clients row after SELECT-ing the 18 columns we
// need. Used by helpers below.
type CoachClientRow = {
  id: string
  name: string | null
  invited_email: string | null
  phone: string | null
  source_category: string | null
  source_detail: string | null
  lifecycle_status: string
  invited_at: string
  client_profile_id: string | null
  // Configurable pipeline: denormalized current stage + prospect sub-status
  // (Polish B — surfaced on the list rows). Both nullable.
  current_stage_key: string | null
  prospect_status: string | null
  phase_initial_contact_made: boolean
  phase_initial_contact_made_at: string | null
  phase_discovery_call_scheduled: boolean
  phase_discovery_call_scheduled_at: string | null
  phase_discovery_call_completed: boolean
  phase_discovery_call_completed_at: string | null
  phase_sow_sent: boolean
  phase_sow_sent_at: string | null
  phase_sow_signed: boolean
  phase_sow_signed_at: string | null
  phase_invoice_sent: boolean
  phase_invoice_sent_at: string | null
  phase_invoice_paid: boolean
  phase_invoice_paid_at: string | null
}

const PROSPECT_SELECT_COLS = [
  "id",
  "name",
  "invited_email",
  "phone",
  "source_category",
  "source_detail",
  "lifecycle_status",
  "invited_at",
  "client_profile_id",
  "current_stage_key",
  "prospect_status",
  "phase_initial_contact_made",
  "phase_initial_contact_made_at",
  "phase_discovery_call_scheduled",
  "phase_discovery_call_scheduled_at",
  "phase_discovery_call_completed",
  "phase_discovery_call_completed_at",
  "phase_sow_sent",
  "phase_sow_sent_at",
  "phase_sow_signed",
  "phase_sow_signed_at",
  "phase_invoice_sent",
  "phase_invoice_sent_at",
  "phase_invoice_paid",
  "phase_invoice_paid_at",
].join(", ")

// ── Auth helpers (inline; same shape as 2c send-invite) ──

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

// ── Response shape transformers (inlined per file) ──

function computeLastActivityAt(row: CoachClientRow, latestNoteCreatedAt: string | null): string | null {
  const candidates = [
    row.phase_initial_contact_made_at,
    row.phase_discovery_call_scheduled_at,
    row.phase_discovery_call_completed_at,
    row.phase_sow_sent_at,
    row.phase_sow_signed_at,
    row.phase_invoice_sent_at,
    row.phase_invoice_paid_at,
    latestNoteCreatedAt,
  ].filter((v): v is string => v !== null && v !== undefined)
  if (candidates.length === 0) return null
  return candidates.reduce((a, b) => (a > b ? a : b))
}

function buildProspectListItem(
  row: CoachClientRow,
  lastActivityAt: string | null,
  resolvedName: string | null = null,
) {
  return {
    id: row.id,
    // Coach-edited name (coach_clients.name) wins; resolvedName from
    // client_profiles only fills in when coach_clients.name is NULL.
    // This preserves coach edits made via the prospect detail page
    // while still rescuing seed-fixture rows (where coach_clients.name
    // is NULL but client_profile_id points at a real "Ryan Rosen"
    // profile) from rendering as "Unnamed".
    name: row.name ?? resolvedName,
    invited_email: row.invited_email,
    phone: row.phone,
    source_category: row.source_category as SourceCategory | null,
    source_detail: row.source_detail,
    phases: {
      initial_contact_made:     { checked: row.phase_initial_contact_made,     at: row.phase_initial_contact_made_at },
      discovery_call_scheduled: { checked: row.phase_discovery_call_scheduled, at: row.phase_discovery_call_scheduled_at },
      discovery_call_completed: { checked: row.phase_discovery_call_completed, at: row.phase_discovery_call_completed_at },
      sow_sent:                 { checked: row.phase_sow_sent,                 at: row.phase_sow_sent_at },
      sow_signed:               { checked: row.phase_sow_signed,               at: row.phase_sow_signed_at },
      invoice_sent:             { checked: row.phase_invoice_sent,             at: row.phase_invoice_sent_at },
      invoice_paid:             { checked: row.phase_invoice_paid,             at: row.phase_invoice_paid_at },
    },
    lifecycle_status: row.lifecycle_status as LifecycleStatus,
    client_profile_id: row.client_profile_id,
    current_stage_key: row.current_stage_key,
    prospect_status: row.prospect_status,
    last_activity_at: lastActivityAt,
    // Schema has no created_at on coach_clients; invited_at is the
    // temporal anchor (DEFAULT now() at INSERT). Aliased here so the
    // API surface reads naturally.
    created_at: row.invited_at,
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    // Gate 1+2: auth
    const { userId, email: callerEmail } = await getAuthedUser(req)
    // Gate 3+3.5: is_coach
    const coach = await getCoachProfile(userId, callerEmail)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 500)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403)
    const coachProfileId = coach.id as string

    const supabase = getSupabaseAdmin()

    // Query prospects for this coach.
    const { data: rowsData, error: listErr } = await supabase
      .from("coach_clients")
      .select(PROSPECT_SELECT_COLS)
      .eq("coach_profile_id", coachProfileId)
      .eq("status", "active")
      .eq("lifecycle_status", "Prospect")
    if (listErr) throw new Error(`Prospects list failed: ${listErr.message}`)
    const rows = (rowsData ?? []) as unknown as CoachClientRow[]

    if (rows.length === 0) {
      return withCorsJson(req, { ok: true, prospects: [] })
    }

    // Batch query for latest note timestamp per prospect. One query +
    // in-memory groupBy beats N queries.
    const ids = rows.map((r) => r.id)
    const latestNoteByCoachClient = new Map<string, string>()
    {
      const { data: noteRows, error: notesErr } = await supabase
        .from("coach_client_notes")
        .select("coach_client_id, created_at")
        .in("coach_client_id", ids)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
      if (notesErr) throw new Error(`Notes lookup failed: ${notesErr.message}`)
      for (const n of (noteRows ?? []) as Array<{ coach_client_id: string; created_at: string }>) {
        if (!latestNoteByCoachClient.has(n.coach_client_id)) {
          latestNoteByCoachClient.set(n.coach_client_id, n.created_at)
        }
      }
    }

    // Batch profile lookup for rows with a linked client_profile_id.
    // When coach_clients.name is NULL but the row points at a real
    // client_profiles record (seed-fixture pattern), prefer the
    // profile name over the empty coach_clients.name.
    const profileIds = Array.from(new Set(
      rows.map((r) => r.client_profile_id).filter((id): id is string => !!id),
    ))
    const profileNameById = new Map<string, string>()
    if (profileIds.length > 0) {
      const { data: profs } = await supabase
        .from("client_profiles")
        .select("id, name")
        .in("id", profileIds)
      for (const p of profs ?? []) {
        if (typeof p.name === "string" && p.name.trim()) {
          profileNameById.set(p.id as string, p.name)
        }
      }
    }

    const prospects = rows
      .map((row) => {
        const lastActivity = computeLastActivityAt(row, latestNoteByCoachClient.get(row.id) ?? null)
        const resolvedName = row.client_profile_id
          ? profileNameById.get(row.client_profile_id) ?? null
          : null
        return buildProspectListItem(row, lastActivity, resolvedName)
      })
      .sort((a, b) => {
        // last_activity_at DESC NULLS LAST, then created_at DESC.
        const aAct = a.last_activity_at
        const bAct = b.last_activity_at
        if (aAct && bAct) return bAct.localeCompare(aAct)
        if (aAct) return -1
        if (bAct) return 1
        return b.created_at.localeCompare(a.created_at)
      })

    return withCorsJson(req, { ok: true, prospects })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function POST(req: NextRequest) {
  try {
    // Gate 1+2: auth
    const { userId, email: callerEmail } = await getAuthedUser(req)
    // Gate 3+3.5: is_coach
    const coach = await getCoachProfile(userId, callerEmail)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 500)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403)
    const coachProfileId = coach.id as string

    // Gate 5: body parses as JSON. POST requires a body (name is
    // required), so empty body is invalid.
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    // ── Validation ──

    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return withCorsJson(req, { ok: false, error: "name is required" }, 400)
    if (name.length > 200) return withCorsJson(req, { ok: false, error: "name too long (max 200 chars)" }, 400)

    const sourceCategoryRaw = typeof body.source_category === "string" ? body.source_category.trim() : ""
    if (!(SOURCE_CATEGORIES as readonly string[]).includes(sourceCategoryRaw)) {
      return withCorsJson(req, {
        ok: false,
        error: `source_category must be one of: ${SOURCE_CATEGORIES.join(", ")}`,
      }, 400)
    }
    const sourceCategory = sourceCategoryRaw as SourceCategory

    // invited_email: empty-after-trim → null (not empty string). Avoids
    // mixing '' and NULL in the column for the no-email case.
    const invitedEmailRaw = typeof body.invited_email === "string"
      ? body.invited_email.trim().toLowerCase()
      : null
    const invitedEmail = invitedEmailRaw && invitedEmailRaw.length > 0 ? invitedEmailRaw : null
    if (invitedEmail && !EMAIL_RE.test(invitedEmail)) {
      return withCorsJson(req, { ok: false, error: "Invalid invited_email format" }, 400)
    }

    // phone: same empty-after-trim → null pattern. No format
    // validation — phone formats vary (international, extension,
    // formatting variants); storing raw input keeps display
    // flexibility. tel: links in the UI work regardless of format.
    const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : null
    const phone = phoneRaw && phoneRaw.length > 0 ? phoneRaw : null
    if (phone && phone.length > 50) {
      return withCorsJson(req, { ok: false, error: "phone too long (max 50 chars)" }, 400)
    }

    // source_detail: same empty-after-trim → null pattern.
    const sourceDetailRaw = typeof body.source_detail === "string"
      ? body.source_detail.trim()
      : null
    const sourceDetail = sourceDetailRaw && sourceDetailRaw.length > 0 ? sourceDetailRaw : null
    if (sourceDetail && sourceDetail.length > 500) {
      return withCorsJson(req, { ok: false, error: "source_detail too long (max 500 chars)" }, 400)
    }

    const initialNoteRaw = typeof body.initial_note === "string"
      ? body.initial_note.trim()
      : null
    const initialNote = initialNoteRaw && initialNoteRaw.length > 0 ? initialNoteRaw : null
    if (initialNote && initialNote.length > 5000) {
      return withCorsJson(req, { ok: false, error: "initial_note too long (max 5000 chars)" }, 400)
    }

    // ── Modal-captured optional fields (v0.2 "add details" expander) ──
    // The rest of the v0.2 field set is detail-page-only (PATCH /[id]).
    const linkedin = optText(body.linkedin_url, "linkedin_url", 500)
    if ("error" in linkedin) return withCorsJson(req, { ok: false, error: linkedin.error }, 400)
    const targetRoles = optText(body.target_roles, "target_roles", 1000)
    if ("error" in targetRoles) return withCorsJson(req, { ok: false, error: targetRoles.error }, 400)
    const educationStatus = optEnum(body.education_status, "education_status", EDUCATION_STATUSES)
    if ("error" in educationStatus) return withCorsJson(req, { ok: false, error: educationStatus.error }, 400)
    const university = optText(body.university, "university", 200)
    if ("error" in university) return withCorsJson(req, { ok: false, error: university.error }, 400)
    const gradDate = optDate(body.grad_date, "grad_date")
    if ("error" in gradDate) return withCorsJson(req, { ok: false, error: gradDate.error }, 400)

    // ── Side effects ──

    const supabase = getSupabaseAdmin()

    // 1. INSERT coach_clients. lifecycle_status explicit (schema
    //    default is 'Active' — Prospects v0.1 Commit 1 / FRD §12 Q3).
    const { data: createdData, error: insertErr } = await supabase
      .from("coach_clients")
      .insert({
        coach_profile_id: coachProfileId,
        client_profile_id: null,
        status: "active",
        access_level: "full",
        lifecycle_status: "Prospect",
        name,
        invited_email: invitedEmail,
        phone,
        source_category: sourceCategory,
        source_detail: sourceDetail,
        // v0.2 modal-captured optionals (null when not provided).
        linkedin_url: linkedin.value,
        target_roles: targetRoles.value,
        education_status: educationStatus.value,
        university: university.value,
        grad_date: gradDate.value,
        // invite_token defaults via gen_random_uuid()
        // invited_at defaults via now()
        // 14 phase columns default per schema (booleans false, _at null)
      })
      .select(PROSPECT_SELECT_COLS)
      .single()
    if (insertErr || !createdData) {
      return withCorsJson(req, {
        ok: false,
        error: `Failed to create prospect: ${insertErr?.message || "unknown error"}`,
      }, 500)
    }
    const created = createdData as unknown as CoachClientRow

    // 2. Optional initial_note. Non-fatal: prospect is usable
    //    regardless; coach can add notes via /notes routes (2b).
    if (initialNote) {
      const { error: noteErr } = await supabase
        .from("coach_client_notes")
        .insert({
          coach_client_id: created.id,
          coach_profile_id: coachProfileId,
          client_profile_id: null,  // legal post-Commit-1 schema
          type: "other",            // FRD §6.4.2 lock
          body: initialNote,
          priority: null,
        })
      if (noteErr) {
        console.warn("[create-prospect] initial note insert failed:", noteErr.message)
      }
    }

    // 3. last_activity_at computation. If the initial note succeeded,
    //    re-query for the actual created_at (Postgres timestamp). If
    //    no note was requested, skip the query.
    let latestNoteAt: string | null = null
    if (initialNote) {
      const { data: latest } = await supabase
        .from("coach_client_notes")
        .select("created_at")
        .eq("coach_client_id", created.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      latestNoteAt = (latest?.created_at as string | null) ?? null
    }

    const lastActivity = computeLastActivityAt(created, latestNoteAt)

    // New prospects always have client_profile_id=NULL (Add Prospect
    // modal never sets it). Pass `null` explicitly for resolvedName so
    // the call is unambiguous; coach_clients.name (`name` var above)
    // is the authoritative value here.
    return withCorsJson(req, {
      ok: true,
      prospect: buildProspectListItem(created, lastActivity, null),
    }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
