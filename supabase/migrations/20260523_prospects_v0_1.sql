-- ═══════════════════════════════════════════════════
-- SIGNAL Coaches Center — Prospects v0.1 (2026-05-22)
-- ═══════════════════════════════════════════════════
--
-- Schema migration for the Prospects v0.1 feature.
-- FRD: docs/Features/coaches-center-prospects-frd.md (§6.1)
--
-- Filename note: FRD §6.1 references 20260522_prospects_v0_1.sql, but
-- that date prefix collides with 20260522_coach_engagement_signal_dismissals.sql
-- (Phase 3 Commit 3.2). Bumped to 20260523_ per the collision-bump
-- protocol; runlog entry records the bump.
--
-- Scope (six changes, one transaction's worth of DDL):
--   1. Add 17 prospect columns to coach_clients:
--        - 3 capture columns (name, source_category, source_detail)
--        - 7 phase boolean checkpoints
--        - 7 paired _at timestamps
--   2. CHECK constraint on source_category (nullable enum)
--   3. Drop NOT NULL on coach_clients.invited_email (prospects captured
--      without email)
--   4. Drop NOT NULL on coach_client_notes.client_profile_id (so
--      prospect notes can hang off coach_client_id alone)
--   5. Partial index for the prospects list query
--
-- Design notes (also documented in FRD §6.1):
--   - All new coach_clients columns are nullable OR have NOT NULL
--     DEFAULT false → existing 20 rows are unaffected, no backfill
--     required.
--   - lifecycle_status DEFAULT='Active' is INTENTIONALLY UNCHANGED
--     per FRD §12 Q3 (Interpretation #1, 2026-05-22): the pending-
--     invite flow correctly defaults to Active; new prospect inserts
--     will explicitly set lifecycle_status='Prospect'. Two entry
--     points, two defaults, no conflict.
--   - source_category CHECK allows NULL so the 20 existing rows
--     (which have NULL source_category by construction) satisfy it.
--   - The partial index targets the most common new query pattern
--     (filter by coach + Prospect lifecycle) and stays small because
--     prospects are expected to be a minority of rows.
--
-- Reversibility:
--   DROP INDEX IF EXISTS idx_coach_clients_prospect_list;
--   ALTER TABLE coach_client_notes ALTER COLUMN client_profile_id SET NOT NULL;
--   ALTER TABLE coach_clients ALTER COLUMN invited_email SET NOT NULL;
--   ALTER TABLE coach_clients
--     DROP COLUMN phase_invoice_paid_at,
--     DROP COLUMN phase_invoice_paid,
--     DROP COLUMN phase_invoice_sent_at,
--     DROP COLUMN phase_invoice_sent,
--     DROP COLUMN phase_sow_signed_at,
--     DROP COLUMN phase_sow_signed,
--     DROP COLUMN phase_sow_sent_at,
--     DROP COLUMN phase_sow_sent,
--     DROP COLUMN phase_discovery_call_completed_at,
--     DROP COLUMN phase_discovery_call_completed,
--     DROP COLUMN phase_discovery_call_scheduled_at,
--     DROP COLUMN phase_discovery_call_scheduled,
--     DROP COLUMN phase_initial_contact_made_at,
--     DROP COLUMN phase_initial_contact_made,
--     DROP COLUMN source_detail,
--     DROP COLUMN source_category,
--     DROP COLUMN name;
--   -- Reverse order of additions; CHECK on source_category goes with the column.
--   -- Reversal assumes no prospect rows have been written yet. If they
--   -- have, restoring NOT NULL on invited_email + client_profile_id
--   -- will fail until those rows are cleaned up.
--
-- DEV ENV ONLY first. Apply via Supabase SQL Editor (Path B per
-- Foundation Risk 6 — dev's schema_migrations tracker is in the
-- documented broken state, so supabase db push isn't reliable here).
-- Prod promotion is a separate explicit step Peri triggers. Document
-- execution in docs/Features/foundation-migration-runlog.md.

-- Change 1+2: prospect columns on coach_clients
ALTER TABLE coach_clients
  ADD COLUMN name text,
  ADD COLUMN source_category text
    CHECK (source_category IS NULL OR source_category IN
      ('referral','social_media','website','personal_contact','other')),
  ADD COLUMN source_detail text,
  ADD COLUMN phase_initial_contact_made boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_initial_contact_made_at timestamptz,
  ADD COLUMN phase_discovery_call_scheduled boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_discovery_call_scheduled_at timestamptz,
  ADD COLUMN phase_discovery_call_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_discovery_call_completed_at timestamptz,
  ADD COLUMN phase_sow_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_sow_sent_at timestamptz,
  ADD COLUMN phase_sow_signed boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_sow_signed_at timestamptz,
  ADD COLUMN phase_invoice_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_invoice_sent_at timestamptz,
  ADD COLUMN phase_invoice_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_invoice_paid_at timestamptz;

-- Change 3: relax invited_email NOT NULL for prospect rows captured
-- without an email address (the lightest-weight capture path —
-- coach scribbles a name + source, fills in email later if at all).
ALTER TABLE coach_clients
  ALTER COLUMN invited_email DROP NOT NULL;

-- Change 4: relax coach_client_notes.client_profile_id NOT NULL so
-- prospect notes (which have no client_profile_id until/unless the
-- prospect converts to a Client) can persist. The notes refactor in
-- the next commit canonicalizes reads on coach_client_id; this drop
-- removes the schema-level blocker.
ALTER TABLE coach_client_notes
  ALTER COLUMN client_profile_id DROP NOT NULL;

-- Change 5: partial index for the prospects list query. Only indexes
-- rows where lifecycle_status='Prospect', keeping the index small
-- (Prospects are expected to be a minority bucket vs. Active).
CREATE INDEX IF NOT EXISTS idx_coach_clients_prospect_list
  ON coach_clients (coach_profile_id, lifecycle_status)
  WHERE lifecycle_status = 'Prospect';
