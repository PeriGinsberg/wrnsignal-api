-- 20260512_intake_upsert_with_targeting.sql
--
-- Foundation Stage 1b — Postgres function for transactional intake.
--
-- FRD: docs/Features/positioning-foundation-frd.md (section 4.5)
-- Runlog: docs/Features/foundation-migration-runlog.md (DD-11)
--
-- Wraps client_profiles UPDATE + candidate_targeting UPSERT in a single
-- transaction. Either both writes land or both roll back. Established as
-- the canonical pattern for cross-table atomic writes in the v2 architecture
-- (downstream features: positioning_runs_v2 + signal_applications linkage,
-- Phase 5 result snapshots, etc.).
--
-- Authorization:
--   - Function runs with caller's privileges (SECURITY INVOKER — default).
--   - EXECUTE granted only to service_role. authenticated and anon roles
--     are explicitly REVOKEd so an end user with a JWT cannot bypass the
--     route's input sanitization by calling /rpc directly.
--   - Service-role caller (the API route) is responsible for identity
--     resolution before calling. The function enforces ownership via
--     UPDATE WHERE id = p_profile_id AND user_id = p_user_id, raising
--     when no row matches.
--
-- Payload shape — p_profile_payload (jsonb):
--   { name, job_type, target_roles, target_locations, preferred_locations,
--     timeline, profile_text, resume_text, risk_overrides (jsonb),
--     profile_structured (jsonb), profile_complete (boolean) }
--   Missing/null fields are written as NULL into the column (matches the
--   current intake route's `field || null` pattern). The caller is expected
--   to send all fields each call; partial-update semantics belong to a
--   different function.
--
-- Payload shape — p_targeting_payload (jsonb, OPTIONAL):
--   When NULL, no candidate_targeting write happens (legacy intake without
--   the new lane fields). When non-null:
--   { primary_lane (required), primary_sublane, primary_other_description,
--     secondary_lane_1, secondary_sublane_1, secondary_lane_2,
--     secondary_sublane_2, career_stage (required), career_stage_locked_by
--     (required), status_premed, status_prelaw, status_pregrad, source }
--   Lane and career_stage values are validated by candidate_targeting CHECK
--   constraints; invalid values raise inside the transaction → both writes
--   roll back.
--
-- Return shape (jsonb):
--   { ok: true, profile_id: uuid, targeting_id: uuid | null,
--     targeting_is_new: boolean, targeting_written: boolean }
--
-- Error cases (RAISE → rollback → PostgREST surfaces error.message):
--   - 'profile_not_found_or_wrong_user' — UPDATE matched 0 rows
--   - CHECK constraint violations on candidate_targeting (bad lane, bad
--     career_stage, missing Other description, etc.)
--   - NOT NULL violations (missing required JSONB keys)
--   - JSONB cast failures
--
-- DEV ENV ONLY. Apply via Supabase SQL Editor. Document execution in runlog.

CREATE OR REPLACE FUNCTION public.intake_upsert_with_targeting(
  p_profile_id        uuid,
  p_user_id           uuid,
  p_profile_payload   jsonb,
  p_targeting_payload jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_updated     int;
  v_targeting_id     uuid    := NULL;
  v_targeting_is_new boolean := false;
  v_existing_id      uuid;
BEGIN
  -- ── 1. UPDATE client_profiles ──────────────────────────────────────────
  -- Straight assignment (no COALESCE) to preserve current intake behavior:
  -- missing JSONB key → SQL NULL → column set to NULL. Matches the existing
  -- `name: name || null` pattern in the route.
  UPDATE public.client_profiles
  SET
    name                = p_profile_payload->>'name',
    job_type            = p_profile_payload->>'job_type',
    target_roles        = p_profile_payload->>'target_roles',
    target_locations    = p_profile_payload->>'target_locations',
    preferred_locations = p_profile_payload->>'preferred_locations',
    timeline            = p_profile_payload->>'timeline',
    profile_text        = p_profile_payload->>'profile_text',
    resume_text         = p_profile_payload->>'resume_text',
    risk_overrides      = p_profile_payload->'risk_overrides',
    profile_structured  = p_profile_payload->'profile_structured',
    -- profile_complete is NOT NULL DEFAULT false. COALESCE to the column
    -- default so a missing/null payload key doesn't blow up the transaction.
    profile_complete    = COALESCE((p_profile_payload->>'profile_complete')::boolean, false),
    updated_at          = NOW()
  WHERE id      = p_profile_id
    AND user_id = p_user_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    -- Either the profile doesn't exist, or user_id doesn't match (spoofing
    -- attempt or stale identity). Both are real errors — abort so neither
    -- write happens. Previous intake route silently no-op'd; the function
    -- surfaces this loudly via exception → 500 → user retries.
    RAISE EXCEPTION
      'profile_not_found_or_wrong_user (profile_id=%, user_id=%)',
      p_profile_id, p_user_id;
  END IF;

  -- ── 2. UPSERT candidate_targeting (if payload provided) ────────────────
  -- Skipped entirely when p_targeting_payload IS NULL (legacy intake path,
  -- before Framer sends targeting fields). Existing intakes continue
  -- working unchanged; only new-payload intakes write the targeting row.
  IF p_targeting_payload IS NOT NULL THEN
    -- Select-then-decide to match the lib/candidateTargeting.ts pattern.
    -- The UNIQUE (profile_id) constraint is the safety net if a concurrent
    -- write sneaks between SELECT and INSERT — exception → rollback.
    SELECT id INTO v_existing_id
      FROM public.candidate_targeting
     WHERE profile_id = p_profile_id;

    IF v_existing_id IS NOT NULL THEN
      -- Existing row → UPDATE.
      UPDATE public.candidate_targeting
      SET
        primary_lane              = p_targeting_payload->>'primary_lane',
        primary_sublane           = p_targeting_payload->>'primary_sublane',
        primary_other_description = p_targeting_payload->>'primary_other_description',
        secondary_lane_1          = p_targeting_payload->>'secondary_lane_1',
        secondary_sublane_1       = p_targeting_payload->>'secondary_sublane_1',
        secondary_lane_2          = p_targeting_payload->>'secondary_lane_2',
        secondary_sublane_2       = p_targeting_payload->>'secondary_sublane_2',
        career_stage              = p_targeting_payload->>'career_stage',
        career_stage_locked_by    = p_targeting_payload->>'career_stage_locked_by',
        status_premed             = COALESCE((p_targeting_payload->>'status_premed')::boolean, false),
        status_prelaw             = COALESCE((p_targeting_payload->>'status_prelaw')::boolean, false),
        status_pregrad            = COALESCE((p_targeting_payload->>'status_pregrad')::boolean, false),
        source                    = p_targeting_payload->>'source'
      WHERE profile_id = p_profile_id;
      -- trg_candidate_targeting_set_updated_at advances updated_at.
      v_targeting_id     := v_existing_id;
      v_targeting_is_new := false;
    ELSE
      -- No row yet → INSERT.
      INSERT INTO public.candidate_targeting (
        profile_id,
        primary_lane,
        primary_sublane,
        primary_other_description,
        secondary_lane_1, secondary_sublane_1,
        secondary_lane_2, secondary_sublane_2,
        career_stage,
        career_stage_locked_by,
        status_premed, status_prelaw, status_pregrad,
        source
      )
      VALUES (
        p_profile_id,
        p_targeting_payload->>'primary_lane',
        p_targeting_payload->>'primary_sublane',
        p_targeting_payload->>'primary_other_description',
        p_targeting_payload->>'secondary_lane_1',
        p_targeting_payload->>'secondary_sublane_1',
        p_targeting_payload->>'secondary_lane_2',
        p_targeting_payload->>'secondary_sublane_2',
        p_targeting_payload->>'career_stage',
        p_targeting_payload->>'career_stage_locked_by',
        COALESCE((p_targeting_payload->>'status_premed')::boolean, false),
        COALESCE((p_targeting_payload->>'status_prelaw')::boolean, false),
        COALESCE((p_targeting_payload->>'status_pregrad')::boolean, false),
        p_targeting_payload->>'source'
      )
      RETURNING id INTO v_targeting_id;
      v_targeting_is_new := true;
    END IF;
  END IF;

  -- ── 3. Return success descriptor ───────────────────────────────────────
  -- The transaction commits on normal function return. Any RAISE EXCEPTION
  -- above (or any constraint failure) rolls back the entire body.
  RETURN jsonb_build_object(
    'ok',                true,
    'profile_id',        p_profile_id,
    'targeting_id',      v_targeting_id,
    'targeting_is_new',  v_targeting_is_new,
    'targeting_written', v_targeting_id IS NOT NULL
  );
END;
$$;

-- ── Permissions ──────────────────────────────────────────────────────────
-- Restrict EXECUTE so end-user JWTs can't bypass the API route's input
-- sanitization by calling /rpc/intake_upsert_with_targeting directly.
-- Only service_role (used by the API route's supabaseAdmin client) can call.
REVOKE EXECUTE ON FUNCTION public.intake_upsert_with_targeting(uuid, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT  EXECUTE ON FUNCTION public.intake_upsert_with_targeting(uuid, uuid, jsonb, jsonb)
  TO service_role;
