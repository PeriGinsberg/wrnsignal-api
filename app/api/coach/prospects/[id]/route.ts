// app/api/coach/prospects/[id]/route.ts
//
// Per-prospect operations (Prospects v0.1 Commit 4b, 2026-05-24).
// FRD: docs/Features/coaches-center-prospects-frd.md §6.4.3 (GET),
//      §6.4.4 (PATCH), plus DELETE design from Commit 4 pre-flight
//      (Q1: soft-revoke via status='revoked').
//
// Routes:
//   GET    — full detail including notes list
//   PATCH  — update fields (name, invited_email, source_*, phases,
//            lifecycle_status). Server-side phase _at timestamp logic.
//   DELETE — soft-revoke (status='revoked'); preserves audit trail
//            (notes not cascade-deleted).
//
// Ownership check: coach_clients.id = [id] AND coach_profile_id =
// caller's profile AND status='active'. Single 403 on any mismatch
// (existence-collapses-into-ownership, same security pattern as 2b/2c).
// Does NOT require lifecycle_status='Prospect' — also serves the
// post-conversion Client-without-profile case (FRD §6.4.3 explicit).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"

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
type PhaseKey = (typeof PHASE_KEYS)[number]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  // Configurable pipeline (Step 5): denormalized current stage + prospect
  // sub-status. Both nullable (added by the pipeline migration).
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

// ── Auth helpers (inline; same shape as 2c send-invite + sibling route.ts) ──

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

// Look up coach_clients by (id, coach_profile_id, status='active').
// Returns the full row when owned by the caller; null otherwise.
// Single null-return for both "doesn't exist" and "not owned" cases —
// callers translate to 403 to prevent existence-probing (same security
// pattern as 2b's verifyCoachClientAccess and 2c send-invite).
async function verifyProspectOwnership(
  coachClientId: string,
  coachProfileId: string,
  supabase: any,
): Promise<CoachClientRow | null> {
  const { data } = await supabase
    .from("coach_clients")
    .select(PROSPECT_SELECT_COLS)
    .eq("id", coachClientId)
    .eq("coach_profile_id", coachProfileId)
    .eq("status", "active")
    .maybeSingle()
  return (data as CoachClientRow | null) ?? null
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
    // Preserves coach edits made via the prospect detail page while
    // still rescuing seed-fixture rows from rendering as "Unnamed".
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
    created_at: row.invited_at,
  }
}

// Per-prospect stage progress (Step 5). Returns [{ stage_key, reached_at }]
// for the stage tracker; ordering is by the coach's pipeline on the client, so
// no order is imposed here.
async function fetchStageProgress(supabase: any, coachClientId: string) {
  const { data } = await supabase
    .from("prospect_stage_progress")
    .select("stage_key, reached_at")
    .eq("coach_client_id", coachClientId)
  return (data ?? []) as { stage_key: string; reached_at: string | null }[]
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ════════════════════════════════════════════════════════════════
// GET /api/coach/prospects/[id] — detail
// ════════════════════════════════════════════════════════════════
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, email: callerEmail } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, callerEmail)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 500)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403)
    const coachProfileId = coach.id as string

    const { id } = await params
    if (!id) return withCorsJson(req, { ok: false, error: "id is required" }, 400)

    const supabase = getSupabaseAdmin()
    const row = await verifyProspectOwnership(id, coachProfileId, supabase)
    if (!row) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    // Notes for the prospect, newest first. coach_client_id is the
    // canonical filter post-Commit-2a refactor.
    const { data: notesData, error: notesErr } = await supabase
      .from("coach_client_notes")
      .select("id, type, body, priority, completed_at, created_at, updated_at")
      .eq("coach_client_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
    if (notesErr) throw new Error(`Notes lookup failed: ${notesErr.message}`)
    const notes = notesData ?? []

    const latestNoteAt = (notes[0]?.created_at as string | null) ?? null
    const lastActivity = computeLastActivityAt(row, latestNoteAt)

    // Resolve display name from client_profiles when the prospect row
    // is linked to a profile (seed-fixture or post-conversion case).
    // Single-row lookup is fine for this single-prospect endpoint.
    let resolvedName: string | null = null
    if (row.client_profile_id) {
      const { data: prof } = await supabase
        .from("client_profiles")
        .select("name")
        .eq("id", row.client_profile_id)
        .maybeSingle()
      if (typeof prof?.name === "string" && prof.name.trim()) {
        resolvedName = prof.name
      }
    }

    const stageProgress = await fetchStageProgress(supabase, id)

    return withCorsJson(req, {
      ok: true,
      prospect: {
        ...buildProspectListItem(row, lastActivity, resolvedName),
        stage_progress: stageProgress,
        notes,
      },
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

// ════════════════════════════════════════════════════════════════
// PATCH /api/coach/prospects/[id] — update
// ════════════════════════════════════════════════════════════════
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, email: callerEmail } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, callerEmail)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 500)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403)
    const coachProfileId = coach.id as string

    const { id } = await params
    if (!id) return withCorsJson(req, { ok: false, error: "id is required" }, 400)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const supabase = getSupabaseAdmin()
    const row = await verifyProspectOwnership(id, coachProfileId, supabase)
    if (!row) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    // ── Build updates payload field-by-field ──
    //
    // Pattern: "X in body" distinguishes omitted (skip) from
    // explicit null (clear / reject depending on column nullability).
    const updates: Record<string, any> = {}

    if ("name" in body) {
      if (body.name === null) {
        updates.name = null
      } else if (typeof body.name === "string") {
        const trimmed = body.name.trim()
        // Reject explicit empty-after-trim; coach must use null to clear.
        if (!trimmed) {
          return withCorsJson(req, { ok: false, error: "name cannot be empty (use null to clear)" }, 400)
        }
        if (trimmed.length > 200) {
          return withCorsJson(req, { ok: false, error: "name too long (max 200 chars)" }, 400)
        }
        updates.name = trimmed
      } else {
        return withCorsJson(req, { ok: false, error: "name must be string or null" }, 400)
      }
    }

    if ("invited_email" in body) {
      if (body.invited_email === null) {
        updates.invited_email = null
      } else if (typeof body.invited_email === "string") {
        const trimmed = body.invited_email.trim().toLowerCase()
        // Empty-after-trim → null (not empty string). Avoids mixing
        // '' and NULL in the column for the cleared-email case.
        if (!trimmed) {
          updates.invited_email = null
        } else {
          if (!EMAIL_RE.test(trimmed)) {
            return withCorsJson(req, { ok: false, error: "Invalid invited_email format" }, 400)
          }
          updates.invited_email = trimmed
        }
      } else {
        return withCorsJson(req, { ok: false, error: "invited_email must be string or null" }, 400)
      }
    }

    if ("phone" in body) {
      if (body.phone === null) {
        updates.phone = null
      } else if (typeof body.phone === "string") {
        const trimmed = body.phone.trim()
        // Empty-after-trim → null (consistent with invited_email +
        // source_detail). No format validation; phone formats vary
        // and storing raw input keeps display flexibility.
        if (!trimmed) {
          updates.phone = null
        } else {
          if (trimmed.length > 50) {
            return withCorsJson(req, { ok: false, error: "phone too long (max 50 chars)" }, 400)
          }
          updates.phone = trimmed
        }
      } else {
        return withCorsJson(req, { ok: false, error: "phone must be string or null" }, 400)
      }
    }

    if ("source_category" in body) {
      if (body.source_category === null) {
        updates.source_category = null
      } else if (typeof body.source_category === "string" &&
                 (SOURCE_CATEGORIES as readonly string[]).includes(body.source_category)) {
        updates.source_category = body.source_category
      } else {
        return withCorsJson(req, {
          ok: false,
          error: `source_category must be one of: ${SOURCE_CATEGORIES.join(", ")}, or null`,
        }, 400)
      }
    }

    if ("source_detail" in body) {
      if (body.source_detail === null) {
        updates.source_detail = null
      } else if (typeof body.source_detail === "string") {
        const trimmed = body.source_detail.trim()
        // Empty-after-trim → null (consistent with invited_email).
        if (!trimmed) {
          updates.source_detail = null
        } else {
          if (trimmed.length > 500) {
            return withCorsJson(req, { ok: false, error: "source_detail too long (max 500 chars)" }, 400)
          }
          updates.source_detail = trimmed
        }
      } else {
        return withCorsJson(req, { ok: false, error: "source_detail must be string or null" }, 400)
      }
    }

    if ("lifecycle_status" in body) {
      // lifecycle_status is NOT NULL in schema (DEFAULT 'Active').
      // Explicit null is invalid input, not a clear.
      if (body.lifecycle_status === null) {
        return withCorsJson(req, { ok: false, error: "lifecycle_status cannot be null" }, 400)
      }
      if (!(LIFECYCLE_STATUSES as readonly string[]).includes(body.lifecycle_status)) {
        return withCorsJson(req, {
          ok: false,
          error: `lifecycle_status must be one of: ${LIFECYCLE_STATUSES.join(", ")}`,
        }, 400)
      }
      updates.lifecycle_status = body.lifecycle_status
    }

    // PATCH phase logic uses SELECT-then-UPDATE rather than a
    // single-statement CASE WHEN. UI concurrency is one coach at a
    // time on one prospect, race window is small, and the simpler
    // code path wins. Worst case under concurrent edits: a phase _at
    // timestamp slightly off, not a security or data-loss issue.
    // See Prospects v0.1 Commit 4 pre-flight (Q7).
    //
    // TODO post-v0.1: consider rejecting phase updates when
    // lifecycle_status != 'Prospect'. Currently API accepts the
    // update; UI doesn't expose this surface. If misuse appears,
    // gate at PATCH-time with 422. See pre-flight Q3 follow-up.
    if ("phases" in body) {
      // Reject arrays (typeof "object" is true for arrays). Allow null
      // as no-op (treat as "phases key absent").
      if (body.phases !== null && (typeof body.phases !== "object" || Array.isArray(body.phases))) {
        return withCorsJson(req, { ok: false, error: "phases must be an object" }, 400)
      }
      if (body.phases) {
        // Unknown keys in body.phases are silently ignored. Matches
        // the lenient pattern in other coach routes (e.g. 2c send-invite
        // body parsing). Strict mode would 400 on unknown keys.
        const nowIso = new Date().toISOString()
        for (const key of PHASE_KEYS) {
          if (!(key in body.phases)) continue
          const next = (body.phases as Record<string, unknown>)[key]
          if (typeof next !== "boolean") {
            return withCorsJson(req, { ok: false, error: `phases.${key} must be boolean` }, 400)
          }
          const colChecked = `phase_${key}` as keyof CoachClientRow
          const colAt = `phase_${key}_at`
          const prevChecked = row[colChecked] as boolean
          if (next === prevChecked) continue  // no-op
          updates[colChecked] = next
          updates[colAt] = next ? nowIso : null
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return withCorsJson(req, { ok: false, error: "No fields to update" }, 400)
    }

    // ── Apply update ──
    const { data: updatedData, error: updErr } = await supabase
      .from("coach_clients")
      .update(updates)
      .eq("id", id)
      .select(PROSPECT_SELECT_COLS)
      .single()
    if (updErr || !updatedData) {
      return withCorsJson(req, {
        ok: false,
        error: `Failed to update prospect: ${updErr?.message || "unknown error"}`,
      }, 500)
    }
    const updated = updatedData as unknown as CoachClientRow

    // Re-fetch notes for full detail response (per FRD §6.4.4
    // "updated full detail").
    const { data: notesData } = await supabase
      .from("coach_client_notes")
      .select("id, type, body, priority, completed_at, created_at, updated_at")
      .eq("coach_client_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
    const notes = notesData ?? []
    const latestNoteAt = (notes[0]?.created_at as string | null) ?? null
    const lastActivity = computeLastActivityAt(updated, latestNoteAt)

    // Same client_profiles name resolution as GET (single-row lookup).
    let resolvedName: string | null = null
    if (updated.client_profile_id) {
      const { data: prof } = await supabase
        .from("client_profiles")
        .select("name")
        .eq("id", updated.client_profile_id)
        .maybeSingle()
      if (typeof prof?.name === "string" && prof.name.trim()) {
        resolvedName = prof.name
      }
    }

    const stageProgress = await fetchStageProgress(supabase, id)

    return withCorsJson(req, {
      ok: true,
      prospect: {
        ...buildProspectListItem(updated, lastActivity, resolvedName),
        stage_progress: stageProgress,
        notes,
      },
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

// ════════════════════════════════════════════════════════════════
// DELETE /api/coach/prospects/[id] — soft-revoke
// ════════════════════════════════════════════════════════════════
//
// Q1 decision (Prospects v0.1 Commit 4 pre-flight): soft-revoke via
// status='revoked'. Matches Phase 1 precedent (existing DELETE on
// /api/coach/clients/[id] does the same). Preserves the row + all
// phase history + notes for audit. Removes the row from the prospects
// list (filtered status='active') and from My Clients. Reversible by
// a future UPDATE back to 'active'. Notes are NOT cascade-deleted
// (which would violate the "preserve coach work" principle).
//
// Already-revoked rows return 403 via the verifyProspectOwnership
// gate (which filters status='active') — same security pattern as
// 2b/2c.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, email: callerEmail } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, callerEmail)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 500)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403)
    const coachProfileId = coach.id as string

    const { id } = await params
    if (!id) return withCorsJson(req, { ok: false, error: "id is required" }, 400)

    const supabase = getSupabaseAdmin()
    const row = await verifyProspectOwnership(id, coachProfileId, supabase)
    if (!row) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    const { error: revokeErr } = await supabase
      .from("coach_clients")
      .update({ status: "revoked" })
      .eq("id", id)
    if (revokeErr) {
      return withCorsJson(req, {
        ok: false,
        error: `Failed to revoke prospect: ${revokeErr.message}`,
      }, 500)
    }

    return withCorsJson(req, { ok: true })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
