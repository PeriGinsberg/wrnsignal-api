# Positioning v2 (Stage 1c) — abandoned 2026-08-10

**This was not dropped by accident, and it is not paused. It is abandoned. We
are not building it.** If you have found a reference to it and are wondering
whether to pick it back up, the answer is no.

Removed in one commit off `5c3a0887`.

---

## ⚠️ Read this first: the table names are backwards

| Table | Status |
|---|---|
| `positioning_runs` | **LIVE.** Written by `app/api/positioning/route.ts`. 656 rows on prod. This is the real one. |
| `positioning_runs_v2` | **ABANDONED.** Empty on prod, 26 test rows on dev. Nothing writes it — its writer was deleted. |

The `_v2` suffix reads like the newer, better table. It is the opposite. Both
tables now carry `COMMENT ON TABLE` saying so, so `\d+` tells you before you get
it wrong.

**`positioning_runs_v2` was deliberately kept.** Three live routes still read it
and tolerate it being empty:

- `app/api/coach/client-runs/[client_profile_id]/route.ts` — warns and omits
- `app/api/feedback/positioning/route.ts` — returns `run_not_found`
- `app/api/networking/route.ts` — degrades

Dropping it would mean editing three live routes to delete an empty table. Not
worth it. If you are adding positioning storage, use `positioning_runs`.

---

## What it was

An attempt to replace the Positioning tab with a case-based flow. On entering
the tab with a completed JobFit run, the frontend auto-fired
`POST /api/positioning/v2/start`. The backend classified the user into one of
three cases from a coherence/lane analysis of their résumé against the job:

- **Case A** — strong fit; small refinements, plus an "I'm ready to apply" CTA
- **Case B** — workable with real work; offered a phase 2 generation run
- **Case C** — lane mismatch; explained the gap and offered a reconsider path

Phase 2 (the actual generation) was specified, costed, and **never built**. Only
phase 1 — classification and the three case screens — existed.

It reached prod schema but never prod behaviour: `positioning_runs_v2` was
created on prod by the 2026-05-26 migration catch-up, and no user ever produced
a row in it.

## Why it was abandoned

Work stopped after D4 pending case-determination tuning, which never happened.
The classifier put too many real users in the wrong case, and the tuning plan
(`docs/Features/case-determination-tuning-plan.md`) was never worked through. It
sat paused from late May to August 2026. Rather than leave ~7,900 lines of
unreachable code and a Framer block that could not ship, it was deleted
outright. JobFit, Positioning and Cover Letter are being redesigned instead.

## What was deleted

| | |
|---|---|
| `app/api/positioning/v2/start/route.ts` | 577 lines |
| `lib/positioning/v2/` (10 modules) | 2,118 lines |
| `tests/positioning-v2/` (8 check scripts) | 4,585 lines |
| `tests/jobfit-regression/inspect-case-determination-inputs.ts` | — |
| `framer/dev/maincomponent.txt` — 32 statements | 1,310 lines |
| `lib/ai/costPolicy.ts` — `MAX_COST_CENTS`, `COST_CENTS_PER_ATTEMPT` | dead exports |

The Framer block was already dead before removal: `renderPositioningV2()` had no
call site. `framer/prod` never carried any of it.

## What was kept, and why it nearly went

**`lib/coherence/`** — moved out of `lib/positioning/v2/coherence/`.

This is the part worth remembering. `scoreCoherence` is called by
`app/api/jobfit-run-trial-open/route.ts` — **the free scan, live in production**.
It was written for v2 and left sitting under a `positioning/v2/` path. Deleting
the v2 tree wholesale would have taken down the free scan, and nothing in the
directory name warned of it.

It was moved rather than left in place precisely so this cannot happen to the
next person: no live code now sits under a path named after abandoned work.

**`lib/ai/`** — `anthropicClient.ts` and `costPolicy.ts` were also written for
v2 phase 2 and are now core infrastructure. Live callers: `app/api/networking`,
`app/api/interviews/[id]/prep/generate`, `app/api/coverletter`,
`lib/resume/extractGraduationDate`. Their comments referenced
`lib/positioning/v2/phase2/*` modules that were never built; those references
have been corrected.

**`phase2_runs`** — referenced in comments, designed, never created. It does not
exist in any database and has no migration. Any comment you find mentioning it
is describing something that was never real.

## Design docs

Kept as the historical record, each marked ABANDONED at the top:

- `docs/Features/case-determination-tuning-plan.md`
- `docs/Features/positioning-design-reference-v2.md`
- `docs/Features/positioning-foundation-frd.md`
- `docs/Features/positioning-phase1-frd.md`
- `docs/positioning-v2-phase1-readiness-2026-05-27.md`
- `docs/dev-positioning-routing-investigation-2026-05-27.md`

They describe a system that does not exist. Read them as history, not as a spec.
