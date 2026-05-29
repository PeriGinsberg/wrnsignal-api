# SIGNAL Build — State Snapshot

**Last updated:** 2026-05-29

This doc captures current state of the SIGNAL platform build. Update after major commits, milestone changes, or when planning context shifts.

---

## Where things stand

### Phase 1 — Positioning & JobFit
Production-grade. Working end-to-end. Includes positioning_runs_v2, jobfit_runs, case_determination with tuned bullet content, cover letter strategy generation. Peri's evaluation: working well. This is the current production-grade surface for all testing and any near-term feedback capture.

### Phase 2 — Resume Reframing Workflow
**Status: parked as of 2026-05-29.**

No active development. The Stage 2b real itemPopulator was canned (not deferred). Endpoints and frontend prototype remain in the codebase but are non-functional end-to-end for real users (itemPopulator returns `[]`). The `phase2_runs` table exists on both dev and prod (it landed on prod 2026-05-25 as collateral in a drift-repair sync, not an intentional promotion); with Phase 2 parked it's orphaned and unused on prod. See runlog entry 2026-05-29 for full parking detail. The Phase 2 FRD remains as a forward-looking spec but is not authoritative for current product behavior.

### Mobile app
TestFlight only. Working but not the current focus.

---

## Current scoped work

**Dev-only feedback capture widget for Maleri's testing.**

Maleri is evaluating JobFit scoring, decision rendering, and bullet quality against dev Positioning v2. She needs a structured way to capture good/mixed/bad ratings with categories and freetext, linked back to the underlying jobfit_run / positioning_run_v2 for full context.

Design locked:
- Two tables: `jobfit_feedback` and `positioning_feedback`. Dev Supabase only; `❌ never` on prod promotion.
- Three-state rating (good/mixed/bad), constrained categories multi-select, optional freetext. CHECK constraint requires categories OR freetext when rating ≠ 'good'.
- Side toggle UX (small pill bottom-right of result pages, expands to panel).
- Multiple rows allowed per (run, tester); query latest in SQL when triaging.
- Five-layer dev-only fence: schema never promoted, `lib/devOnly.ts` project-ref check, route-level `assertDevEnvironment()`, frontend render-null guard, banner comments on all dev-only files. Runlog row marked `❌ never`.
- SQL-only read side for v0; sample queries in migration header.

Build is a single commit. Not yet started.

---

## Open work (tracked, no current sprint)

Not scoped for immediate work. Captured for future surfacing.

- workflow_preview.estimated_minutes for Case A with refinements (cosmetic; runlog 2026-05-15)
- Stage 1c D5/D6/D7 polish (returning banner, error states, mobile / loading polish)
- Inspect scripts committed
- bulletGeneratorV5 consolidation with invokeClaude helper
- HR + Operations cleanup in jobfit-family-inference.ts (behavior-changing; runlog 2026-05-16, scope documented)
- URL refactor cleanup for INTAKE_REDIRECT_URL (runlog 2026-05-13, five routes hardcode production hostnames)
- peri+test100 profile_complete=false bug
- Framer prod theme updates (5 modified files; runlog 2026-05-13)
- Supabase Studio allowlist tightening (Fix C)

---

## Key references

- Phase 2 FRD: `docs/Features/positioning-phase2-frd.md` (forward-looking spec; not authoritative for current behavior)
- Foundation runlog: `docs/Features/foundation-migration-runlog.md`
- Repo: PeriGinsberg/wrnsignal-api, working branch `dev`
- Staging: https://wrnsignal-api-staging.vercel.app (points at dev Supabase)
- Production: https://wrnsignal-api.vercel.app (points at prod Supabase)
- Dev Supabase: zydrqckpwidipwbhrfgd
- Prod Supabase: ejhnokcnahauvrcbcmic

---

## Test fixtures

- **Test user:** peri+test100@workforcereadynow.com
- **Primary persona:** f283397c-f26d-43bc-9095-0f77c7d9cea9 (Catherine Lees, OSU Strategic Communication, 3,694 char resume)
- Phase 2 fixture runs (9d5ebb75, e12c8b08, d20210b7, 426f306d) remain on dev for any future ad-hoc inspection but are not active test targets

---

## How to update this doc

Update sections that change. Keep it under 2 pages. The point is fast context-load, not comprehensive history (the runlog does that). If a section is no longer accurate, replace it. Don't append; replace.
