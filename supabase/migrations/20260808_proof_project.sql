-- 20260808_proof_project.sql
--
-- Proof Project — two columns, no new tables.
--
-- A "proof project" is an ordinary engagement flagged for a different PRESENTATION:
-- the client hub renders it as a journey with unlockable speaking points instead of
-- a plan list. Nothing about the engagement's data model changes, which is the point
-- — the flag is a view selector, not a new kind of engagement. Every existing read
-- (/api/me/activities, the coach's EngagementsTab, the events log) keeps working
-- untouched on a flagged engagement.
--
-- Both columns land on the FROZEN per-client snapshot tables, not the catalog
-- (coach_packages / coach_milestones), because both are per-client facts:
--   - whether THIS client's engagement is their proof project
--   - what THIS client can say once a deliverable is signed off
-- A catalog-level speaking point would be generic copy, which is the opposite of
-- what the feature is for.
--
-- CONSEQUENCE, AND IT IS DELIBERATE: attach_package_to_engagement does not copy
-- either column, so a newly attached package is never a proof project and carries
-- no speaking points until someone sets them. There is no backfill; both defaults
-- are the "off" value. See the note at the bottom about what still has to be built.
--
-- APPLICATION STATE:
--   DEV  (zydrqckpwidipwbhrfgd) — applied 2026-08-08.
--   PROD (ejhnokcnahauvrcbcmic) — applied 2026-08-08, deliberately and by hand,
--   to support the Proof Project dogfood on Aiden's engagement. This was NOT a
--   general opening of the coach-engagement closed gate: it is two additive
--   columns and an index, both defaulting to the inert value, read by nothing
--   that prod was serving at the time. Apply BEFORE
--   20260808_engagement_activity_editing.sql, which depends on speaking_point.

-- ── The flag: is this engagement the client's proof project? ──
--
-- NOT NULL DEFAULT false so every existing row is immediately valid and every
-- existing read that does `select *` is unaffected. There is deliberately NO
-- partial unique index forcing one proof project per relationship: a client CAN
-- have several engagements, the API orders and takes the first, and a DB
-- constraint here would turn a presentation choice into a write-blocking error
-- for a coach who flags a second one.
ALTER TABLE coach_client_engagements
  ADD COLUMN is_proof_project BOOLEAN NOT NULL DEFAULT false;

-- Partial: the page only ever asks for flagged rows, and on any real dataset
-- almost every row is false. Indexing the false side would be dead weight.
CREATE INDEX idx_cce_is_proof_project
  ON coach_client_engagements (coach_client_id)
  WHERE is_proof_project;

-- ── The reward: what the client can say once this deliverable is signed off ──
--
-- Nullable with no default, like every other optional per-client field on these
-- tables (fee_cents, category, due_date). NULL means "this deliverable has no
-- speaking point", which the page treats as a node that completes without
-- revealing a card — not as an empty card, and not as an error.
--
-- Prose, written by the coach, in the CLIENT'S voice: the page labels it
-- "You can now say:" and renders the text directly after that, so copy written in
-- the third person ("the client can discuss…") reads as broken. This is a
-- convention the writing has to hold; there is no way to enforce it in the column.
ALTER TABLE coach_client_engagement_deliverables
  ADD COLUMN speaking_point TEXT;

-- ── What this migration does NOT do, so it is not mistaken for finished ──
--
-- Nothing in the product WRITES either column yet. The Proof Project page is
-- read-only by scope, and no coach-side editor was built, so today both are set
-- by hand:
--
--   UPDATE coach_client_engagements
--      SET is_proof_project = true
--    WHERE id = '<engagement uuid>';
--
--   UPDATE coach_client_engagement_deliverables
--      SET speaking_point = 'I rebuilt their onboarding flow and cut drop-off by a third.'
--    WHERE id = '<deliverable uuid>';
--
-- A coach-facing control for both is the obvious next slice.
