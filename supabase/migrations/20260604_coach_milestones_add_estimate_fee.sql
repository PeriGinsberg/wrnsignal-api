-- Migration: coach_milestones — add time_estimate_days + fee_cents
-- Phase 1 follow-on for Coach Deliverables Library.
-- Two optional fields a coach can specify per deliverable:
--   - time_estimate_days: estimated effort in days, fractional allowed (0.5, 1.5)
--   - fee_cents: a-la-carte price in USD, stored as integer cents (never a float)
-- Spec: docs/coach-deliverables-phase1-spec.md (field extension)
--
-- Pricing model (Phase 2 context): fee_cents is the source of truth for pricing.
-- A Package sums its deliverables' fee_cents and may apply an overall discount on
-- top. So fee_cents here is load-bearing for Packages, not throwaway.
--
-- NULL semantics: fee_cents NULL = "unpriced" (distinct from $0 priced).
-- Both columns nullable (optional fields). CHECK constraints reject negatives.
--
-- Apply to DEV via Supabase SQL Editor (Path B — schema_migrations drift on dev,
-- "Risk 6"). Prod promotion deferred to the existing coach-settings prod gate.

ALTER TABLE coach_milestones
  ADD COLUMN time_estimate_days NUMERIC,   -- optional; fractional days allowed (0.5, 1.5)
  ADD COLUMN fee_cents          INTEGER;   -- optional; USD, integer cents (NULL = unpriced, distinct from $0)

ALTER TABLE coach_milestones
  ADD CONSTRAINT coach_milestones_time_estimate_days_nonneg
    CHECK (time_estimate_days IS NULL OR time_estimate_days >= 0),
  ADD CONSTRAINT coach_milestones_fee_cents_nonneg
    CHECK (fee_cents IS NULL OR fee_cents >= 0);
