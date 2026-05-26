-- Migration: create jobfit_anonymous_runs
-- Purpose: anonymous analytics for /api/jobfit-run-trial-open
-- No PII. Append-only event log. No unique constraints (a session can rerun the same JD).

create table jobfit_anonymous_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- session correlation (no PII)
  session_id text,

  -- attribution
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer text,
  user_agent text,

  -- inputs (hashed only — never raw text)
  resume_hash text,           -- sha256 hex of resume_text
  jd_hash text,               -- sha256 hex of job_description
  resume_char_count int,
  jd_char_count int,

  -- engine outputs
  score int,
  decision text,              -- 'pass' | 'review' | 'apply' | 'priority' (whatever the engine emits)
  gate_triggered text,        -- null, or gate type string from gate_triggered.type
  why_code_count int,
  risk_code_count int,

  -- engine behavior flags (useful for debugging + monitoring)
  v5_fell_back_to_v4 boolean default false,

  -- performance
  ms_elapsed int
);

-- Indexes sized to expected query patterns
create index jobfit_anonymous_runs_created_at_idx
  on jobfit_anonymous_runs (created_at desc);

create index jobfit_anonymous_runs_session_id_idx
  on jobfit_anonymous_runs (session_id)
  where session_id is not null;

create index jobfit_anonymous_runs_utm_idx
  on jobfit_anonymous_runs (utm_source, utm_campaign)
  where utm_source is not null;

create index jobfit_anonymous_runs_jd_hash_idx
  on jobfit_anonymous_runs (jd_hash);

-- RLS: disabled. This table is server-write-only via the service role.
-- The anon key never touches this table. No client-side reads.
alter table jobfit_anonymous_runs enable row level security;
-- No policies = no access via anon key. Service role bypasses RLS by design.
