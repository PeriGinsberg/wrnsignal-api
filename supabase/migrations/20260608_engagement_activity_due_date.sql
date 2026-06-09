-- Slice 4: per-activity due dates.
-- Adds an optional due date to the FROZEN engagement activity (per-client),
-- not the catalog activity. Nullable, no default — most activities carry no date;
-- the coach sets one per client where it matters.
ALTER TABLE coach_client_engagement_activities
  ADD COLUMN due_date DATE;
