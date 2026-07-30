-- Per-client "I have read the help on this screen" flags.
--
-- One jsonb rather than a boolean per screen: the Templates callout is the first
-- of the help pass and the spreadsheet and dashboard follow the same pattern, so
-- this is `{"templates": true, "contacts": true, ...}` and needs no further
-- migration as those land.
--
-- Deliberately NOT one of the profile's ALL_FIELDS: those drive the form, the
-- completeness meter and touched_fields, and a UI preference among them would
-- make a finished profile read as "17 of 18". The route writes this only through
-- its own dismiss_help action.
--
-- Additive, defaulted, no backfill: every existing row reads as "nothing
-- dismissed yet", which is the correct starting state.

alter table public.network_client_profile
  add column if not exists help_dismissed jsonb not null default '{}'::jsonb;

comment on column public.network_client_profile.help_dismissed is
  'Per-screen help-callout dismissals, e.g. {"templates": true}. UI state, not profile content.';
