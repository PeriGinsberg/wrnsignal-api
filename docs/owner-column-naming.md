# The owner column is named two different things

Noted 2026-08-06, after a recon script queried
`client_personas.client_profile_id` and got
`column client_personas.client_profile_id does not exist`.

**This is not a bug, and it is not a documentation gap.** The column is
`profile_id`, the code uses `profile_id`, and `docs/DATABASE.md` already
documents it correctly. Nothing is broken. What is missing is a written note
that the convention SPLITS, which is what made the wrong guess feel safe.

---

## The split

Every table points at `client_profiles(id)`, under one of two names.

| Column | Tables |
|---|---|
| `profile_id` | `client_personas`, `signal_applications`, `signal_interviews`, `interview_prep_runs` |
| `client_profile_id` | `network_companies`, `network_contacts`, `network_comments`, `network_templates`, `network_client_profile`, `jobfit_runs`, `positioning_runs`, `coverletter_runs`, `networking_runs` |

Roughly: the **network tracker and the artifact run tables** use
`client_profile_id`; the **tracker and persona tables** use `profile_id`.
`jobfit_runs` is the one that trips people up, because it sits with the run
tables rather than with `signal_applications`, which it is joined to constantly.

`lib/positioning/v2/jobfitLookup.ts` already carries a comment about exactly
this:

> `jobfit_runs.client_profile_id` (NOT `profile_id`) — historical naming

## Why it matters more than it looks

A wrong guess does not always fail loudly. PostgREST rejects an unknown column
outright, which is the good case. But a query that filters on the *right* name
for the *wrong* table, or an embed that resolves through an unexpected path,
can return rows that are simply someone else's, with no error at all.

The company-link work in Phase 1 sits directly on this seam:
`signal_applications.profile_id` and `network_companies.client_profile_id` both
reference `client_profiles(id)`, and a foreign key between them cannot prove
they hold the SAME value. That is why the ownership check in
`lib/network-tracker/link-application.ts` is app-layer and has a test that
attempts a cross-profile link.

## What to do about it

**Nothing, for now.** Renaming either family would touch every query, every
route and every RLS policy for a consistency win, and the risk is far larger
than the annoyance.

The practical rule: **check the column before writing the query**, per the
existing "probe the exact artifact" habit. `docs/DATABASE.md` has the answer
for every table listed above.
