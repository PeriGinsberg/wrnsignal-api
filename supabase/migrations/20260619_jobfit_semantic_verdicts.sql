-- Migration: create jobfit_semantic_verdicts
-- Purpose: observability for the gated semantic evidence-relevance layer
-- (docs/jobfit-semantic-relevance-layer-scope.md). One row per SUSPECT match
-- the layer evaluated on a scan, with the LLM verdict and whether it was
-- suppressed. Mirrors the jobfit_anonymous_runs convention: append-only event
-- log, server-write-only via the service role (RLS enabled, no policies),
-- fire-and-forget from the route (never blocks/breaks a scan).
--
-- PII posture matches jobfit_anonymous_runs: hashes only for resume/JD, NO raw
-- candidate evidence snippet. We keep requirement_snippet (employer JD text,
-- not candidate PII) and the LLM `reason` (a paraphrase) so verdicts are
-- reviewable for correctness without storing résumé text.
-- Additive: new table only, no changes to existing columns/tables.

create table jobfit_semantic_verdicts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- correlation (no PII) — same hashes jobfit_anonymous_runs records
  resume_hash text,
  jd_hash text,

  -- the suspect match that was judged
  job_unit_key text,            -- the JD requirement key
  profile_unit_key text,        -- the candidate capability credited toward it
  match_strength text,          -- 'direct' | 'adjacent'
  requirement_snippet text,     -- JD requirement text (employer, not candidate PII)

  -- the verdict
  satisfies boolean,            -- LLM: does the evidence satisfy the requirement
  confidence text,              -- 'high' | 'med' | 'low'
  reason text,                  -- LLM one-line rationale (paraphrase, no résumé text)
  suppressed boolean            -- true when satisfies=false AND confidence=high
);

create index jobfit_semantic_verdicts_created_at_idx
  on jobfit_semantic_verdicts (created_at desc);

create index jobfit_semantic_verdicts_jd_hash_idx
  on jobfit_semantic_verdicts (jd_hash)
  where jd_hash is not null;

-- RLS: enabled, no policies. Server-write-only via the service role. The anon
-- key never touches this table; no client-side reads.
alter table jobfit_semantic_verdicts enable row level security;
