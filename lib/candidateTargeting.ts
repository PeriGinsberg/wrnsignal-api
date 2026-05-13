// lib/candidateTargeting.ts
//
// CRUD + derivation utilities for the candidate_targeting table.
//
// FRD: docs/Features/positioning-foundation-frd.md (section 4.4)
// Runlog: docs/Features/foundation-migration-runlog.md
// Schema: supabase/migrations/20260512_candidate_targeting.sql
// Taxonomy: lib/laneTaxonomy.ts (CareerStage, lane IDs, validation utilities)
//
// What's here:
//   - getCandidateTargeting: read by profile_id (UNIQUE → at most one row)
//   - upsertCandidateTargeting: select-then-decide (INSERT or UPDATE)
//   - deriveCareerStage: pure function — given current_status +
//     yearsExperienceApprox, returns CareerStage. Used by resolveCareerStage
//     here and by the Stage 1d migration script.
//   - resolveCareerStage: read candidate_targeting first; fall back to
//     deriving from client_profiles.profile_structured.intakeMeta (per
//     Stage 1b Friction 3 — structured JSONB is the canonical source).
//
// What's NOT here:
//   - Lane inference (Stage 1d migration script, with LLM fallback)
//   - Application linkage (lib/signalApplications.ts)
//   - Status-indicator side effects (FRD DD-04 keeps those in
//     migration / translation code, not here)

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { CareerStage } from "@/lib/laneTaxonomy"

// ============================================================================
// Types
// ============================================================================

export type CareerStageLockedBy = "intake" | "inferred" | "manual_override"
export type CandidateTargetingSource = "intake" | "migration" | "manual_update"

/** Full row shape as returned by SELECT * on candidate_targeting. */
export type CandidateTargetingRow = {
  id: string
  profile_id: string
  primary_lane: string
  primary_sublane: string | null
  primary_other_description: string | null
  secondary_lane_1: string | null
  secondary_sublane_1: string | null
  secondary_lane_2: string | null
  secondary_sublane_2: string | null
  career_stage: CareerStage
  career_stage_locked_by: CareerStageLockedBy
  status_premed: boolean
  status_prelaw: boolean
  status_pregrad: boolean
  source: CandidateTargetingSource
  created_at: string
  updated_at: string
}

/**
 * Payload for create/update. id/created_at/updated_at are managed by the DB
 * (DEFAULT + trigger). All other columns must be provided (NOT NULL or
 * DEFAULT-on-INSERT-only).
 */
export type CandidateTargetingPayload = {
  profile_id: string
  primary_lane: string
  primary_sublane?: string | null
  primary_other_description?: string | null
  secondary_lane_1?: string | null
  secondary_sublane_1?: string | null
  secondary_lane_2?: string | null
  secondary_sublane_2?: string | null
  career_stage: CareerStage
  career_stage_locked_by: CareerStageLockedBy
  status_premed?: boolean
  status_prelaw?: boolean
  status_pregrad?: boolean
  source: CandidateTargetingSource
}

// ============================================================================
// Career-stage derivation (pure function)
// ============================================================================

// Canonical intake current_status strings. Matching is case-insensitive
// because Framer / API submissions vary in capitalization.
const STATUS_STUDENT = "current student"
const STATUS_RECENT_GRAD = "recent graduate"
const STATUS_WORKING = "working professional"
const STATUS_PIVOT = "career pivot"

/**
 * Derive a career_stage from the two intake-time signals.
 *
 * Self-identification trumps inference: a candidate who marks "Current
 * student" is a student regardless of yearsExperienceApprox.
 *
 * Working professional / Career pivot fall back to year buckets:
 *   - null/undefined → mid_career (safe default; e.g. resume not parsed yet)
 *   - <= 2 → early_career
 *   - <= 15 → mid_career
 *   - > 15 → executive
 *
 * Empty / unrecognized status returns mid_career as the final fallback.
 *
 * Pure function — no I/O. Used by resolveCareerStage and by the Stage 1d
 * migration script. Per FRD section 4.4.
 */
export function deriveCareerStage(params: {
  currentStatus: string | null | undefined
  yearsExperienceApprox: number | null | undefined
}): CareerStage {
  const status = (params.currentStatus ?? "").trim().toLowerCase()
  const years = params.yearsExperienceApprox

  if (status === STATUS_STUDENT) return "student"
  if (status === STATUS_RECENT_GRAD) return "early_career"

  if (status === STATUS_WORKING || status === STATUS_PIVOT) {
    if (years === null || years === undefined) return "mid_career"
    if (years <= 2) return "early_career"
    if (years <= 15) return "mid_career"
    return "executive"
  }

  // Unrecognized / empty status
  return "mid_career"
}

// ============================================================================
// CRUD
// ============================================================================

/**
 * Read the candidate_targeting row for a given profile, or null if none
 * exists. UNIQUE (profile_id) at the DB level means there is at most one.
 */
export async function getCandidateTargeting(
  supabase: SupabaseClient,
  profileId: string,
): Promise<{ row: CandidateTargetingRow | null; error?: string }> {
  if (!profileId) return { row: null, error: "missing profileId" }

  const { data, error } = await supabase
    .from("candidate_targeting")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle()

  if (error) return { row: null, error: error.message }
  return { row: (data as CandidateTargetingRow | null) ?? null }
}

/**
 * INSERT or UPDATE a candidate_targeting row keyed by profile_id.
 *
 * Select-then-decide pattern: looks up the existing row first, then
 * INSERTs or UPDATEs accordingly. Avoids relying on Supabase JS upsert
 * semantics for partial-update behavior; the explicit branching is
 * easier to reason about.
 *
 * Race-condition note (Stage 1b): the lookup and the write are not in
 * a single transaction. A concurrent request between SELECT and INSERT
 * could trigger the UNIQUE (profile_id) violation. For single-user intake
 * flows this is extremely unlikely (UI debounces submit). If concurrency
 * becomes a real concern, switch to ON CONFLICT (profile_id) DO UPDATE
 * via raw SQL or Supabase's upsert with onConflict='profile_id'.
 */
export async function upsertCandidateTargeting(
  supabase: SupabaseClient,
  payload: CandidateTargetingPayload,
): Promise<{
  row: CandidateTargetingRow | null
  isNew: boolean
  error?: string
}> {
  if (!payload.profile_id) {
    return { row: null, isNew: false, error: "missing profile_id" }
  }

  const { row: existing, error: lookupErr } = await getCandidateTargeting(
    supabase,
    payload.profile_id,
  )
  if (lookupErr) return { row: null, isNew: false, error: lookupErr }

  if (existing) {
    const { data, error } = await supabase
      .from("candidate_targeting")
      .update(payload)
      .eq("profile_id", payload.profile_id)
      .select("*")
      .single()
    if (error || !data) {
      return {
        row: null,
        isNew: false,
        error: error?.message ?? "update failed",
      }
    }
    return { row: data as CandidateTargetingRow, isNew: false }
  }

  const { data, error } = await supabase
    .from("candidate_targeting")
    .insert(payload)
    .select("*")
    .single()
  if (error || !data) {
    return {
      row: null,
      isNew: false,
      error: error?.message ?? "insert failed",
    }
  }
  return { row: data as CandidateTargetingRow, isNew: true }
}

// ============================================================================
// Career-stage resolution (DB-aware)
// ============================================================================

/**
 * Resolve the career_stage for a profile.
 *
 * Resolution order (FRD section 4.4):
 *   1. candidate_targeting.career_stage if a row exists (authoritative)
 *   2. Else derive from client_profiles.profile_structured.intakeMeta
 *      (currentStatus + yearsExperienceApprox)
 *   3. Final fallback (no signals available): 'mid_career'
 *
 * Signature matches the FRD pseudocode `resolveCareerStage(profileId)`.
 * The optional `supabase` parameter lets callers pass an existing client
 * (e.g. profile-intake's supabaseAdmin) to avoid re-instantiating one per
 * call. When omitted, a service-role client is created from env.
 *
 * Foundation has no consumer yet — Positioning Phase 1 is the first
 * caller. Exposed in Foundation per FRD section 4.4 so the contract is
 * established before downstream features depend on it.
 */
export async function resolveCareerStage(
  profileId: string,
  supabase?: SupabaseClient,
): Promise<CareerStage> {
  if (!profileId) return "mid_career"

  const client = supabase ?? createServiceRoleClient()

  // 1. Authoritative: candidate_targeting
  const { row } = await getCandidateTargeting(client, profileId)
  if (row?.career_stage) return row.career_stage

  // 2. Fallback: derive from client_profiles.profile_structured
  const { data: profile, error } = await client
    .from("client_profiles")
    .select("profile_structured")
    .eq("id", profileId)
    .maybeSingle()
  if (error || !profile) return "mid_career"

  const structured =
    (profile as { profile_structured?: Record<string, unknown> })
      .profile_structured ?? {}
  const intakeMeta =
    (structured as { intakeMeta?: { currentStatus?: string | null } })
      .intakeMeta ?? {}
  const currentStatus = intakeMeta.currentStatus ?? null
  const yearsExperienceApprox =
    (structured as { yearsExperienceApprox?: number | null })
      .yearsExperienceApprox ?? null

  return deriveCareerStage({ currentStatus, yearsExperienceApprox })
}

function createServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "resolveCareerStage: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required when no supabase client is passed",
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
