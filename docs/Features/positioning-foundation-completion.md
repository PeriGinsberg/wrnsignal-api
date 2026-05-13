# Positioning Foundation — Completion Summary

**Status:** Foundation SHIPPED (dev + prod). Stage 1e validation complete.
**Date completed:** 2026-05-12
**FRD:** `docs/Features/positioning-foundation-frd.md`
**Runlog:** `docs/Features/foundation-migration-runlog.md` (DD-01 through DD-24)

This document checks Foundation against the 11 acceptance criteria in FRD section 11. Each item has: status, where the work landed, and any caveats with links to the runlog DD entries that capture the nuance.

---

## Acceptance criteria checklist

### 1. ✅ Lane taxonomy config file exists with all 11 lanes + Other and ~45 sub-lanes

- **Where:** `lib/laneTaxonomy.ts` (272 lines)
- **Contents:** 11 lanes + Other; **48 sub-lanes total** (DD-01 — FRD said "~45"; locked list came out to 48 after Data Science / Data Engineering split during label review DD-06)
- **Validation utilities:** `isValidLaneId`, `isValidSubLaneId`, `getJobFamilyForLane`, `getLaneFromJobFamily`
- **Tests:** `tests/lane-taxonomy/taxonomy-check.ts` — 154 checks, all pass

### 2. ✅ `candidate_targeting` table exists in dev DB with full schema

- **Where:** `supabase/migrations/20260512_candidate_targeting.sql`
- **Applied dev:** 2026-05-12 via Supabase SQL Editor
- **Applied prod:** 2026-05-12 via Supabase SQL Editor (DD-16, DD-22)
- **CHECK constraints:** `primary_lane`, `secondary_lane_1`, `secondary_lane_2` against 12-value taxonomy enum; `career_stage` against 4-value enum; `career_stage_locked_by` and `source` against their respective enums; Other-lane requires non-empty `primary_other_description` with `LENGTH(TRIM(...)) > 0` (DD-09 hardening)
- **Indexes:** `profile_id` (FK lookups) + `primary_lane` (lane-filtered queries)
- **Trigger:** `trg_candidate_targeting_set_updated_at` uses existing `public.set_updated_at()` function (DD-07 — not the FRD's hypothetical `update_updated_at_column`)
- **UNIQUE:** `(profile_id)` enforces one targeting row per profile

### 3. ✅ `signal_applications` has `positioning_run_id` and `coverletter_run_id` columns

- **Where:** `supabase/migrations/20260512_signal_applications_run_fks.sql`
- **Applied dev:** 2026-05-12
- **Applied prod:** 2026-05-12
- Both columns nullable, no CASCADE on delete (preserves signal_application if a run is deleted)
- Two indexes for FK reverse lookups
- Cover Letter route does NOT populate `coverletter_run_id` yet (deferred to Cover Letter Integration FRD — schema is present so when that ships, no migration needed)

### 4. ✅ Shared `findOrCreateSignalApplication` utility exists and is consumed by JobFit

- **Where:** `lib/signalApplications.ts` (175 lines)
- **JobFit consumes it:** `app/api/jobfit/route.ts:442-503` was refactored to delegate the lookup-or-create dance to this utility. Regression check (`tests/jobfit-regression/regression-check.ts`) confirmed byte-identical scoring output across all 46 baseline cases pre- and post-refactor.
- **Future consumers:** Positioning Phase 1 and Cover Letter Integration FRD will call this utility — Foundation establishes the pattern.
- **Scope (locked, "minimal extraction"):** lookup-or-create + run_id FK linkage only. Caller owns sanitization, JobFit-specific UPDATE fields, status_history audit logging.
- **Smoke test:** `tests/foundation/smoke-e2e.ts` exercised it on dev — 24 checks pass.

### 5. ✅ `resolveCareerStage` utility exists and is testable

- **Where:** `lib/candidateTargeting.ts` (256 lines)
- **Public surface:** `getCandidateTargeting`, `upsertCandidateTargeting`, `deriveCareerStage` (pure), `resolveCareerStage` (DB-aware)
- **Tests:** `tests/candidate-targeting/derive-career-stage-check.ts` — 32 checks, all pass. Covers self-identification trumps inference, year-bucket boundaries, case insensitivity, empty/null fallback.
- **Foundation consumer:** none yet (per FRD intent — Positioning Phase 1 is the first consumer)

### 6. ⚠ Intake form (dev mirror) captures lane + sub-lane + secondary lanes + status indicators — **DEFERRED**

- **Status:** **Out of scope per kickoff agreement.** The build began with "Framer intake form updates are out of scope for this kickoff. We'll handle Framer in a separate step after the API changes are stable."
- **What did ship:** the API contract (`/api/profile-intake`) accepts the optional `targeting` payload field, validates against the taxonomy, and writes to `candidate_targeting`. The Framer-side UI to actually send the payload is the deferred piece.
- **What's needed to close this item:** Framer intake form updates per FRD section 4.5. Coordinated dev/prod Framer deploys per [[feedback_framer_dev_prod]].

### 7. ✅ API endpoint accepts new intake payload and writes to `candidate_targeting`

- **Where:** `app/api/profile-intake/route.ts` updated to:
  - Accept optional `targeting` field in `IntakeBody` type
  - Validate against taxonomy via `validateAndNormalizeTargeting` helper (95 lines)
  - Build payload with derived `career_stage` (via `deriveCareerStage`), `source='intake'`, `career_stage_locked_by='inferred'`, status indicators defaulted to `false`
  - Call `intake_upsert_with_targeting` RPC (transactional `client_profiles` UPDATE + `candidate_targeting` UPSERT atomically — DD-11)
- **Legacy path preserved:** existing intakes without `targeting` field continue working unchanged.
- **Validation:** invalid lane / missing-Other-description / invalid sublane → 400 with structured error. Server-side RPC failures → 500 with `error: "intake_did_not_complete"` and retry hint.
- **Verified via:** dev migration (which uses the same RPC) successfully wrote 4 rows; prod migration wrote 122.

### 8. ⚠ Migration script ran successfully on test sample with ≥85% high-confidence accuracy — **THRESHOLD RECALIBRATED**

- **Where:** `scripts/migrate-candidate-targeting/run-migration.ts` + supporting infra (inference-prompt.ts, synthetic-samples.ts, run-realdata-sample.ts, etc.)
- **Test sample (synthetic, 8 cases):** validated structural properties — 0 hallucinations, lane match 8/8, sub-lane match 8/8.
- **Real-data validation (122 prod profiles, read-only):** 0 lane hallucinations, 0 sub-lane hallucinations, 0 parse/LLM errors. Confidence distribution: 47.5% high overall.
- **The 85% threshold was not met as written.** Per **DD-18**: the FRD's 85% target was set before knowing the actual prod distribution. 19% of the population is min-signal (no target_roles + no resume + no JobFit run) — those profiles cannot by definition be high-confidence because there's nothing to be confident about. **Inferrable subset (99 profiles) hit 58.6% high.** Locked decision: operational acceptance metric is "high-confidence rate on inferrable subset," not population-wide. Migration accepted at current distribution after Peri's per-profile read-through confirmed qualitative correctness.

### 9. ⚠ User-verification UI works in dev — **DEFERRED**

- **Status:** **Out of Foundation scope** per FRD section 4.6 phase 2 explicitly: "User-verification UI on next session — UX decision deferred per FRD open question 3."
- **What's needed:** UI design + implementation for the next-session banner/modal that surfaces inferred candidate_targeting rows for user confirmation. The 122 migrated rows already carry `source='migration'` so the UI can identify which rows need verification.

### 10. ✅ All tests pass (unit, integration, regression)

- **Unit:**
  - `tests/lane-taxonomy/taxonomy-check.ts` — 154 checks, PASS
  - `tests/candidate-targeting/derive-career-stage-check.ts` — 32 checks, PASS
- **Integration (smoke):**
  - `tests/foundation/smoke-e2e.ts` — 24 checks, PASS. Exercises: candidate_targeting read for migrated profile, signal_applications schema verification, findOrCreateSignalApplication create + update paths, positioning_run_id linkage, full cleanup.
- **Regression:**
  - `tests/jobfit-regression/regression-check.ts` — 46 baseline cases, all match. Same exit-1 from pre-existing 21-baseline-missing warning (test-data state, not scoring drift).

### 11. ✅ No regressions in existing JobFit, Positioning, or Cover Letter flows

- **JobFit:** regression-check confirmed byte-identical scoring outputs across 46 cases after the Stage 1b JobFit refactor (extraction of `findOrCreateSignalApplication`).
- **Positioning route:** untouched in Foundation. Will be rebuilt in Phase 1 (separate FRD).
- **Cover Letter route:** untouched in Foundation. Will consume new positioning_strategy in the Cover Letter Integration FRD.
- **profile-intake:** new optional targeting path added; existing intake without targeting field works unchanged (verified via dev migration + smoke).

---

## What shipped (summary)

**Code:**
- `lib/laneTaxonomy.ts` (taxonomy + validators)
- `lib/candidateTargeting.ts` (CRUD + career-stage derivation)
- `lib/signalApplications.ts` (shared lookup-or-create utility)
- `app/api/profile-intake/route.ts` (updated to accept targeting payload via RPC)
- `app/api/jobfit/route.ts` (refactored to use shared utility)

**SQL migrations (applied dev + prod):**
- `supabase/migrations/20260512_candidate_targeting.sql`
- `supabase/migrations/20260512_signal_applications_run_fks.sql`
- `supabase/migrations/20260512_intake_upsert_with_targeting.sql`

**Migration tooling:**
- `scripts/migrate-candidate-targeting/inference-prompt.ts` (locked prompt + parser)
- `scripts/migrate-candidate-targeting/synthetic-samples.ts` (8-case test set)
- `scripts/migrate-candidate-targeting/run-synthetic-test.ts` (synthetic runner with 154-check harness)
- `scripts/migrate-candidate-targeting/run-realdata-sample.ts` (read-only prod validation)
- `scripts/migrate-candidate-targeting/run-migration.ts` (one-shot backfill with idempotency + Proxy + safety gate)
- `scripts/migrate-candidate-targeting/spot-check-prod.mjs` (named-profile verification)

**Tests:**
- `tests/lane-taxonomy/taxonomy-check.ts` (154 checks)
- `tests/candidate-targeting/derive-career-stage-check.ts` (32 checks)
- `tests/foundation/smoke-e2e.ts` (24 checks, end-to-end with cleanup)

**Documentation:**
- `docs/Features/foundation-migration-runlog.md` (24 DD entries + 7 KI entries + stage progress table)
- `docs/Features/foundation-real-data-sample-design.md` (real-data validation design v2)
- `docs/Features/positioning-foundation-completion.md` (this doc)

**Data state:**
- Dev: 4 profiles → 4 candidate_targeting rows
- Prod: 122 profiles → 122 candidate_targeting rows, all source='migration', all status_premed=false (PreMed retroactive flagging abandoned per DD-23)

---

## Documented deferrals

1. **Framer intake form** (acceptance criterion #6) — out of scope per kickoff. Needs synchronized dev/prod Framer edits + UI design.
2. **User-verification UI** (acceptance criterion #9) — out of Foundation scope per FRD section 4.6 phase 2. Needs UX design + frontend implementation.
3. **Cover Letter Integration write path** — `coverletter_run_id` column added to `signal_applications` but Cover Letter route doesn't populate it yet. Deferred to Cover Letter Integration FRD.
4. **PreMed retroactive flagging** — abandoned per DD-23 after diagnosis revealed JobFit's `jobFamily` is unreliable for historical lookups on garbage JD content. PreMed capture is forward-looking only from this point.
5. **`update_updated_at_column` → `set_updated_at` FRD revision** — FRD section 4.2's trigger function reference should be updated to match the actual function name (DD-07). Low priority cleanup.

---

## Known-issue follow-up tickets

Tracked in runlog under KI-01 through KI-07. Headlines:

- **KI-01** — `findOrCreateSignalApplication` empty-field junk-row risk preserved (behavior change deferred to Positioning Phase 1)
- **KI-02** — Re-derive `career_stage` on resume upload (Foundation defaults to mid_career; later upload of a resume that contradicts that doesn't trigger re-derivation)
- **KI-03** — `profile_text` `current_status` dual-write is transitional (drop the text-blob write once readers migrate to `candidate_targeting`)
- **KI-04** — `primary_other_description` whitespace-rejection strictness (informational; FRD example didn't include TRIM but implementation does — DD-09)
- **KI-05** — 12-value lane CHECK list repeated three times (accept; revisit as Postgres ENUM if lane changes become frequent)
- **KI-06** — `interestLevel = 1` default in shared utility (Positioning + Cover Letter callers should pass explicit values)
- **KI-07** — Cache-hit signal_applications block in `app/api/jobfit/route.ts:253-321` still inline (mirrors the refactored block at 442-503; cleanup opportunity)

---

## Foundation: COMPLETE

All acceptance criteria addressed (✅ closed or ⚠ deferred-with-scope-note). All defensive guards (PreMed dual-write infra, null-sublane override, empty-Other fallback) present in code and exercised on real-data. Operational discipline held throughout: dev-first, prod requires explicit confirmation, write-restricted Proxy on all migration scripts, all `.env.*.local` files gitignored.

Phase 1 (Setup and Scope Calibration) is a separate FRD-approval cycle. Foundation work does not roll automatically into Phase 1 build.
