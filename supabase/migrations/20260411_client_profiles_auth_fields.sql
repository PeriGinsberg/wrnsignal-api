-- Add profile_complete flag and stripe_customer_id to client_profiles
-- for the auth/payment overhaul.

-- profile_complete: true when all 5 required onboarding fields are set.
-- Controls magic link redirect: false -> /dashboard/onboarding, true -> /jobfit
ALTER TABLE public.client_profiles
ADD COLUMN IF NOT EXISTS profile_complete boolean NOT NULL DEFAULT false;

-- stripe_customer_id: set by the Stripe webhook on checkout.session.completed
ALTER TABLE public.client_profiles
ADD COLUMN IF NOT EXISTS stripe_customer_id text NULL;

-- Backfill: mark existing profiles with all required fields as complete
UPDATE public.client_profiles
SET profile_complete = true
WHERE resume_text IS NOT NULL
  AND target_roles IS NOT NULL
  AND job_type IS NOT NULL
  AND name IS NOT NULL
  AND target_locations IS NOT NULL;
