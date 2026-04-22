-- Phase 1 of signal-analytics-spec.md: Foundation schema.
-- Archives the legacy jobfit_page_views table and creates the four
-- analytics tables (visitors, sessions, events, attribution) with
-- indexes and constraints exactly as specified in Section 5.

ALTER TABLE IF EXISTS public.jobfit_page_views
  RENAME TO jobfit_page_views_archived_2026_04;

CREATE TABLE IF NOT EXISTS public.analytics_visitors (
  visitor_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),

  fingerprint_hash     text,
  device_id            text,
  email                text,
  client_profile_id    uuid,

  is_paid              boolean NOT NULL DEFAULT false,
  paid_at              timestamptz,
  client_source        text CHECK (client_source IN ('self_serve','coach_onboarded')),

  first_platform       text,
  first_site           text,
  total_sessions       integer NOT NULL DEFAULT 0,
  total_events         integer NOT NULL DEFAULT 0,

  merged_from          uuid[],
  is_deleted           boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_visitors_email
  ON public.analytics_visitors (email)
  WHERE email IS NOT NULL AND is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_visitors_fingerprint
  ON public.analytics_visitors (fingerprint_hash)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_visitors_device
  ON public.analytics_visitors (device_id)
  WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_visitors_profile
  ON public.analytics_visitors (client_profile_id)
  WHERE client_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.analytics_sessions (
  session_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id      uuid NOT NULL REFERENCES public.analytics_visitors(visitor_id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  platform        text NOT NULL,
  app_version     text,

  entry_site      text NOT NULL CHECK (entry_site IN ('landing','signal')),
  entry_page      text,
  entry_referrer  text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  utm_term        text,

  event_count     integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_visitor
  ON public.analytics_sessions (visitor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_started
  ON public.analytics_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_utm
  ON public.analytics_sessions (utm_source, utm_campaign);

CREATE TABLE IF NOT EXISTS public.analytics_events (
  event_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name     text NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  visitor_id     uuid NOT NULL REFERENCES public.analytics_visitors(visitor_id),
  session_id     uuid REFERENCES public.analytics_sessions(session_id),
  platform       text NOT NULL CHECK (platform IN ('web','ios','android')),
  app_version    text,
  site           text NOT NULL CHECK (site IN ('landing','signal')),
  page_path      text,
  properties     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_name_time
  ON public.analytics_events (event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_visitor
  ON public.analytics_events (visitor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_session
  ON public.analytics_events (session_id);
CREATE INDEX IF NOT EXISTS idx_events_site_platform
  ON public.analytics_events (site, platform);

CREATE TABLE IF NOT EXISTS public.analytics_attribution (
  visitor_id       uuid PRIMARY KEY REFERENCES public.analytics_visitors(visitor_id),
  first_touch_at   timestamptz NOT NULL,

  platform         text NOT NULL,
  site             text NOT NULL,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_content      text,
  utm_term         text,
  referrer         text,
  landing_page     text,

  channel          text NOT NULL,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attribution_channel
  ON public.analytics_attribution (channel);
CREATE INDEX IF NOT EXISTS idx_attribution_first_touch
  ON public.analytics_attribution (first_touch_at DESC);
