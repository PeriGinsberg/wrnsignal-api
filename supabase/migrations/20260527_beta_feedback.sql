-- Migration: beta_feedback
-- Created: 2026-05-27
-- FRD: docs/Features/beta-feedback-frd.md §6.1
-- Scope: dev (apply via Supabase SQL Editor per Foundation Risk 6)
-- Production promotion: separate explicit step per FRD §11
--
-- Captures coach-submitted feedback during beta. Row-triggers-email
-- pattern (notification via Postmark in app layer, not DB trigger).
-- See FRD for full design context.

CREATE TABLE beta_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who submitted (must be a coach per app-layer is_coach gate)
  coach_profile_id UUID NOT NULL REFERENCES client_profiles(id),

  -- What they said
  type TEXT NOT NULL CHECK (type IN (
    'issue_bug', 'enhancement', 'technical_question',
    'general_feedback', 'other'
  )),
  severity TEXT CHECK (
    severity IS NULL OR severity IN ('blocker', 'high', 'medium', 'low')
  ),
  body TEXT NOT NULL CHECK (LENGTH(TRIM(body)) >= 10),
  reply_ok BOOLEAN NOT NULL DEFAULT true,

  -- Auto-captured context
  page_url TEXT,
  user_agent TEXT,

  -- Status (reserved for v0.2 admin UI; v0.1 always 'new')
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'acknowledged', 'in_progress', 'shipped', 'wontfix'
  )),
  status_updated_at TIMESTAMPTZ,
  status_updated_by UUID REFERENCES client_profiles(id),

  -- Notification tracking
  email_sent_at TIMESTAMPTZ,
  email_send_error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_beta_feedback_coach_profile_id
  ON beta_feedback(coach_profile_id);
CREATE INDEX idx_beta_feedback_status
  ON beta_feedback(status);
CREATE INDEX idx_beta_feedback_created_at
  ON beta_feedback(created_at DESC);

CREATE TRIGGER update_beta_feedback_updated_at
  BEFORE UPDATE ON beta_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
