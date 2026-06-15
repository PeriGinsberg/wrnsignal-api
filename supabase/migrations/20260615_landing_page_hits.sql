-- Migration: create landing_page_hits
-- Purpose: anonymous hit logging for the /signal marketing landing page.
-- Mirrors the jobfit_anonymous_runs convention: append-only event log, no PII,
-- server-write-only via the service role (RLS enabled, no policies). Correlates
-- to the scan/unlock funnel via session_id (the jobfit_session_id localStorage
-- value the scan/unlock flow already uses).
-- No unique constraints (a session can load the landing more than once).

create table landing_page_hits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- session correlation (no PII) — same id as jobfit_anonymous_runs.session_id
  session_id text,

  -- attribution
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer text,
  user_agent text,

  -- which landing path was hit (e.g. /signal)
  path text
);

-- Indexes sized to expected query patterns (mirror jobfit_anonymous_runs)
create index landing_page_hits_created_at_idx
  on landing_page_hits (created_at desc);

create index landing_page_hits_session_id_idx
  on landing_page_hits (session_id)
  where session_id is not null;

create index landing_page_hits_utm_idx
  on landing_page_hits (utm_source, utm_campaign)
  where utm_source is not null;

-- RLS: enabled, no policies. This table is server-write-only via the service role.
-- The anon key never touches this table. No client-side reads.
alter table landing_page_hits enable row level security;
-- No policies = no access via anon key. Service role bypasses RLS by design.
