-- Migration: create unlock_email_captures
-- Purpose: capture emails entered at the Unlock-for-$99 CTA, before the
-- Stripe redirect. Enables abandoned-checkout recovery and ties Unlock
-- back to the original anonymous scan via session_id.

create table unlock_email_captures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- The email entered at the Unlock submit
  email text not null,

  -- Which CTA fired ("upgrade_inline", "upgrade_checkout", or ctaSource-derived variants)
  source text,

  -- The Stripe Checkout Session this email was submitted to.
  -- NULL until the Stripe API call returns; populated by the chained UPDATE.
  stripe_session_id text,

  -- Correlation back to the original anonymous scan (jobfit_anonymous_runs.session_id).
  -- NULL if the user hit Unlock without going through the trial scan.
  session_id text,

  -- Webhook backfill (deferred to a SEPARATE commit; column exists now so the schema
  -- doesn't need a follow-up migration). Populated on checkout.session.completed.
  purchase_id uuid references purchases(id) on delete set null,

  -- Attribution (subset of getAttributionSnapshot() — drop utm_content/utm_term and IP/UA)
  utm_source text,
  utm_medium text,
  utm_campaign text,
  landing_page text,
  referrer text,

  -- Ad-platform click IDs
  fbclid text,
  ttclid text,
  gclid text,

  -- Ad-platform first-party cookies
  fbp text,
  fbc text,
  ttp text
);

create index unlock_email_captures_email_idx on unlock_email_captures (email);
create index unlock_email_captures_created_at_idx on unlock_email_captures (created_at desc);
create index unlock_email_captures_stripe_session_id_idx
  on unlock_email_captures (stripe_session_id) where stripe_session_id is not null;
create index unlock_email_captures_session_id_idx
  on unlock_email_captures (session_id) where session_id is not null;
create index unlock_email_captures_purchase_id_idx
  on unlock_email_captures (purchase_id) where purchase_id is not null;

alter table unlock_email_captures enable row level security;
-- No policies = server-write-only via service role.
