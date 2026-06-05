-- 20260605_engagement_proposal_status.sql
--
-- Proposal lifecycle on the engagement row: draft → sent → approved → declined.
-- Additive column on coach_client_engagements. New engagements default to
-- 'draft'; the attach_package_to_engagement RPC needs NO edit (it doesn't set
-- proposal_status, so the column default applies). Approve / Convert-to-Client
-- stay SEPARATE — this column has no relationship to coach_clients lifecycle.
--
-- DEV ENV ONLY. Applied to DEV (zydrqckpwidipwbhrfgd) via direct Postgres. Do
-- NOT promote to prod (joins the closed-gate pile).

ALTER TABLE coach_client_engagements
  ADD COLUMN proposal_status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE coach_client_engagements
  ADD CONSTRAINT coach_client_engagements_proposal_status_valid
  CHECK (proposal_status IN ('draft', 'sent', 'approved', 'declined'));

-- Existing dev fixtures were attached pre-lifecycle as effectively-live
-- engagements; backfill them so they don't read as drafts. (No-op when the
-- table was empty at apply time.)
UPDATE coach_client_engagements SET proposal_status = 'approved';
