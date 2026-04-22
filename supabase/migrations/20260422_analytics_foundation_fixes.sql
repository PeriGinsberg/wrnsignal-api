-- Phase 1 follow-up fixes per docs/signal-analytics-spec.md:
--   1. Archive the legacy jobfit_page_views table (Section 5 footer).
--   2. Add CHECK constraints missing from the initial migration so
--      platform/site domains match across all four analytics tables.

ALTER TABLE IF EXISTS public.jobfit_page_views
  RENAME TO jobfit_page_views_archived_2026_04;

ALTER TABLE public.analytics_sessions
  ADD CONSTRAINT analytics_sessions_platform_check
  CHECK (platform IN ('web','ios','android'));

ALTER TABLE public.analytics_attribution
  ADD CONSTRAINT analytics_attribution_platform_check
  CHECK (platform IN ('web','ios','android'));

ALTER TABLE public.analytics_attribution
  ADD CONSTRAINT analytics_attribution_site_check
  CHECK (site IN ('landing','signal'));
