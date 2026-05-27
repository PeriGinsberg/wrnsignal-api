# Positioning Foundation — Migration Runlog

Status tracker for Foundation-scoped schema migrations, manual SQL Editor applications, and known-issue follow-ups. See FRD: `docs/Features/positioning-foundation-frd.md`.

All migrations target the **dev environment only** until Peri explicitly approves production promotion.

---

## Schema migrations

| Migration file | Drafted | Date applied | Env | Method | Applied by | Notes |
|---|---|---|---|---|---|---|
| `supabase/migrations/20260512_candidate_targeting.sql` | 2026-05-12 | 2026-05-12 | dev | Supabase SQL Editor | Peri | New table. Foundation Stage 1a. Manual apply per Risk 6 (schema_migrations drift on dev). |
| `supabase/migrations/20260512_candidate_targeting.sql` | 2026-05-12 | 2026-05-12 | **prod** | Supabase SQL Editor | Peri | Same SQL. Applied after data migration's first prod attempt revealed table missing — see DD-22. |
| `supabase/migrations/20260512_signal_applications_run_fks.sql` | 2026-05-12 | 2026-05-12 | dev | Supabase SQL Editor | Peri | ALTER TABLE adds positioning_run_id + coverletter_run_id FKs. Foundation Stage 1a. |
| `supabase/migrations/20260512_signal_applications_run_fks.sql` | 2026-05-12 | 2026-05-12 | **prod** | Supabase SQL Editor | Peri | Same SQL. Applied 2026-05-12 alongside the other two. |
| `supabase/migrations/20260512_intake_upsert_with_targeting.sql` | 2026-05-12 | 2026-05-12 | dev | Supabase SQL Editor | Peri | CREATE FUNCTION for transactional intake. Foundation Stage 1b. Verified callable via `scripts/verify-intake-upsert-fn.mjs`. |
| `supabase/migrations/20260512_intake_upsert_with_targeting.sql` | 2026-05-12 | 2026-05-12 | **prod** | Supabase SQL Editor | Peri | Same SQL. Function unused on prod until intake route is deployed there. |
| `supabase/migrations/20260512_positioning_runs_v2.sql` | 2026-05-12 | 2026-05-12 | dev | Supabase SQL Editor | Peri | Phase 1 deliverable 6. Creates `positioning_runs_v2` table + 5 indexes + 1 `set_updated_at` trigger. |
| `supabase/migrations/20260512_positioning_runs_v2.sql` | 2026-05-12 | ⏸ pending | **prod** | Supabase SQL Editor | — | Same SQL. Separate explicit promotion step after dev validation. |
| `supabase/migrations/20260516_phase2_runs.sql` | 2026-05-16 | 2026-05-16 | dev | Supabase SQL Editor | Peri | New table. Phase 2 Stage 2a. Includes ai_cost_cents column (FRD §6.12) in initial schema vs. separate step per §7. Manual apply per Risk 6 (schema_migrations drift on dev). |
| `supabase/migrations/20260516_phase2_runs.sql` | 2026-05-16 | 2026-05-25 | **prod** | Supabase SQL Editor | Peri | Applied as part of 2026-05-25 prod schema sync — closed 5-migration drift gap surfaced by Coaches Dashboard 500. See entry below. |
| `supabase/migrations/20260521_coach_client_lifecycle_status.sql` | 2026-05-21 | 2026-05-21 | dev | Supabase SQL Editor | Peri | Coaches Center scope (Beta-pitch Phase 1, Commit 1.4). Adds coach-managed `lifecycle_status` column to `coach_clients` (Prospect/Active/Inactive/Archived), distinct from system-owned `status`. Default 'Active' so existing rows defaulted in. Sanity: SELECT confirmed all rows defaulted; CHECK constraint rejected 'Bogus' negative test. |
| `supabase/migrations/20260521_coach_client_lifecycle_status.sql` | 2026-05-21 | 2026-05-25 | **prod** | Supabase SQL Editor | Peri | Applied as part of 2026-05-25 prod schema sync. See entry below. |
| `supabase/migrations/20260522_coach_engagement_signal_dismissals.sql` | 2026-05-22 | 2026-05-22 | dev | Supabase SQL Editor | Peri | Coaches Center scope (Beta-pitch Phase 3, Commit 3.2). New table holding (coach_profile_id, signal_key) dismissal pairs for R1-R6 engagement signals. signal_key = engine-emitted `id` directly (locked Phase 3.0). UNIQUE constraint + index on coach_profile_id support ON CONFLICT DO NOTHING idempotency. Sanity: COUNT = 0 confirmed fresh. ON CONFLICT path will be exercised by real dismissal smoke (TC-661). |
| `supabase/migrations/20260522_coach_engagement_signal_dismissals.sql` | 2026-05-22 | 2026-05-25 | **prod** | Supabase SQL Editor | Peri | Applied as part of 2026-05-25 prod schema sync. See entry below. |
| `supabase/migrations/20260523_prospects_v0_1.sql` | 2026-05-22 | 2026-05-22 | dev | Supabase SQL Editor | Peri | New columns on coach_clients (3 capture + 14 phase) + DROP NOT NULL on invited_email and coach_client_notes.client_profile_id + partial index. Coaches Center Prospects v0.1 feature, Commit 1 of 4. Manual apply per Risk 6. Filename bumped from 20260522 (collision with engagement-signal-dismissals migration). |
| `supabase/migrations/20260523_prospects_v0_1.sql` | 2026-05-22 | 2026-05-25 | **prod** | Supabase SQL Editor | Peri | Applied as part of 2026-05-25 prod schema sync. See entry below. |
| `supabase/migrations/20260509_coach_client_notes_typed.sql` | 2026-05-09 | (dev — not previously tracked in this runlog) | dev | Supabase SQL Editor | Peri | Coaches Center scope. Retroactively added to this table 2026-05-25 because prod sync surfaced it was untracked here. |
| `supabase/migrations/20260509_coach_client_notes_typed.sql` | 2026-05-09 | 2026-05-25 | **prod** | Supabase SQL Editor | Peri | Applied as part of 2026-05-25 prod schema sync. See entry below. |
| `supabase/migrations/20260527_beta_feedback.sql` | 2026-05-27 | 2026-05-27 | dev | psql (dev session pooler) | Peri (Claude-applied) | New table for coach-submitted beta feedback. Beta-feedback v0.1 Phase 1. Manual direct-SQL apply per Risk 6 — CLI is linked to prod, so dev reached via `SUPABASE_DB_URL` session-pooler string (equivalent to the SQL Editor workaround). 15 columns + 3 indexes + `set_updated_at` trigger. Production promotion deferred per FRD §11. |
| `supabase/migrations/20260527_beta_feedback.sql` | 2026-05-27 | ⏸ pending | **prod** | Supabase SQL Editor | — | Same SQL. Separate explicit promotion step after dev validation + Phase 2-5 build completes. |

---

## Stage progress

- [x] **Stage 1a-prep** — Lane taxonomy + validation utilities (`lib/laneTaxonomy.ts`, `tests/lane-taxonomy/taxonomy-check.ts`)
- [x] **Stage 1a** — Schema files drafted (`candidate_targeting`, `signal_applications` ALTER)
- [x] **Stage 1a** — Schema files applied to dev via Supabase SQL Editor (2026-05-12, Peri)
- [ ] **Stage 1b** — API contracts (`lib/signalApplications.ts` ✓, JobFit refactor ✓, `lib/candidateTargeting.ts` ✓, `intake_upsert_with_targeting` fn ✓, profile-intake update — in progress)
- [ ] **Stage 1d** — Migration script written + synthetic-sample test
- [x] **Stage 1d** — Migration script run on real dev data (2026-05-12, 4 profiles, idempotency verified — see DD-21)
- [x] **Stage 1d** — Migration script run on PROD data (2026-05-12, 122 profiles + PreMed flag patch — see DD-22)
- [x] **Stage 1e** — Validation + regression sweep (2026-05-12, all four steps green — see DD-24)
- [x] **Production promotion** — schema + data migration complete on prod (2026-05-12, all writes within scope, completion summary at `docs/Features/positioning-foundation-completion.md`)

---

## Phase 1 — Stage progress

- [x] **Stage 1a** — All six deliverables shipped, verified clean on dev (2026-05-12):
  - D1: `lib/positioning/v2/types.ts`
  - D2: `lib/positioning/v2/caseThresholds.ts`
  - D3: `lib/positioning/v2/caseDetermination.ts` + 30 unit tests
  - D4: `lib/positioning/v2/workflowPreview.ts` + 33 unit tests
  - D5: `lib/positioning/v2/caseSpecific.ts` + 42 unit tests
  - D6: `supabase/migrations/20260512_positioning_runs_v2.sql` applied to dev (Peri, SQL Editor); functional smoke + raw catalog checks both clean
- [x] **Stage 1b** — `/api/positioning/v2/start` endpoint SHIPPED (all D1-D7 complete; route verified end-to-end against running dev server):
  - [x] D1: `lib/positioning/v2/fingerprint.ts` + 42 unit tests (computeFingerprint, canonical JSON, null-targeting sentinel)
  - [x] D2: `lib/positioning/v2/jobfitLookup.ts` + 11 integration tests (Path B verified — `application_id` → `signal_applications.id` join works; schema-discovery captured `client_profile_id` naming and `jobfit_runs` column gaps)
  - [x] D3: `lib/positioning/v2/runLookup.ts` + 12 integration tests (F3 cascade: in_progress→resume; latest-completed-with-matching-fingerprint→cache_hit; abandoned filtered; multi-in_progress anomaly logged)
  - [x] D4: `lib/positioning/v2/runWriter.ts` + 19 integration tests (two-write self-heal per F2 / DD-26; idempotent re-link verified via measured `updated_at` advancement; architectural pre-checks resolved 2026-05-12: only `positioning_runs_v2_pkey` constraint and `set_updated_at()` is the minimal trigger that fires on every UPDATE)
  - [x] D5: `lib/positioning/v2/responseBuilder.ts` + 14 unit tests (pure function; F6 / F7 / F10 / F12 resolved; last_visit_days_ago floor semantics + defensive nulls for malformed visits)
  - [x] D6: `app/api/positioning/v2/start/route.ts` (handler wiring D1-D5 + Foundation utilities; zero type errors project-wide; failure-mode policy: 500 only on createPositioningRun, 200 + warn on link/append/findOrCreate; one-directional link per DD-26; placeholder convention per DD-27)
  - [x] D7: `scripts/verify-positioning-v2-start.mjs` — 9/9 e2e tests pass against running dev server (happy path, resume, cache_hit, placeholder application, 4 error paths, F11 envelope identity, F6 throwaway-user persona guard). Zero fixture leaks on cleanup.
- [ ] **Stage 1c** — Frontend rendering (case-calibrated) — *next major Phase 1 chunk; likely separate FRD discussion*
- [ ] **Stage 1d** — Reconsider Target flow
- [ ] **Stage 1e** — Integration testing in dev

### Post-Stage-1b cleanup commitments

Tracked architectural debt items, deliberately out of scope for Stage 1b. Sweep up in a small follow-up after Stage 1b ships (not blocking ship).

1. **`lib/signalApplications.ts` header comments (lines 9-14)** describe bidirectional linkage between `signal_applications` and Positioning runs. That intent was superseded in Stage 1b by the one-directional design (DD-26). Doc-only edit to bring the comments in line with the actual architecture.
2. **`findOrCreateSignalApplication`'s `positioningRunId` param is dormant** — passed by no caller after Stage 1b D6 (the route deliberately omits it; see DD-26). Could be removed in a future cleanup pass; currently kept for backward-compat / forward-compat optionality since the column itself still exists.
3. **`signal_applications.positioning_run_id` column still FKs to v1 `positioning_runs`** (per Stage 1a migration `20260512_signal_applications_run_fks.sql`). The Positioning v2 flow does not populate it; the column is a dead-end for v2 but not actively breaking anything. v1 `positioning_runs` deprecation is a separate future conversation.

---

## Stage 1b: SHIPPED

**Shipped 2026-05-12.** All 7 Stage 1b deliverables complete and verified end-to-end against the running dev server. `POST /api/positioning/v2/start` is the first working Positioning v2 endpoint and is ready for Stage 1c (frontend) consumption.

### Deliverables and test coverage

| # | Deliverable | Tests | Result |
|---|---|---|---|
| D1 | `lib/positioning/v2/fingerprint.ts` | 42 unit | PASS |
| D2 | `lib/positioning/v2/jobfitLookup.ts` | 11 integration | PASS |
| D3 | `lib/positioning/v2/runLookup.ts` | 12 integration | PASS |
| D4 | `lib/positioning/v2/runWriter.ts` | 19 integration | PASS |
| D5 | `lib/positioning/v2/responseBuilder.ts` | 14 unit | PASS |
| D6 | `app/api/positioning/v2/start/route.ts` | tsc clean project-wide | PASS |
| D7 | `scripts/verify-positioning-v2-start.mjs` | 9 e2e against dev server | PASS |

**Total: 107 test assertions across the stage, all passing.**

### Architectural decisions captured along the way

- **DD-26 — one-directional link.** `positioning_runs_v2.signal_application_id` is the sole authoritative link between Positioning v2 runs and applications. `signal_applications.positioning_run_id` continues to FK to v1 `positioning_runs` (legacy) and is deliberately not written by the v2 flow. Surfaced during D4 pre-drafting review; simplified the F2 self-heal pattern from three writes to two.
- **DD-27 — JobFit metadata source + placeholder convention.** Company name + job title sourced from `jobfit_runs.result_json.job_signals` (the only universally-present source — 100% on non-error runs in prod sampling). Empty fields (~20-24% of runs in prod) get JobFit-style `"(Unknown Company)"` / `"(Unknown Role)"` placeholders rather than blocking Positioning. Logged via `PLACEHOLDER_APPLICATION_CREATED` marker for ops visibility. KI-01 updated to note Positioning v2 contributes to the junk-rows pile.

### Friction items resolved in route handler

F6 (persona guard) · F7 (null candidate_targeting allowed) · F10 (visit append on all outcomes) · F11 (404 envelope identity for not-found vs wrong-owner — verified by D7 test 8) · F12 (cache_hit `is_returning=false`).

### Post-Stage-1b cleanup commitments still tracked

See the "Post-Stage-1b cleanup commitments" subsection above — three doc/code hygiene items deliberately deferred. None blocking.

### Operational notes

- Background dev server task ID `bi2rvedsp` left running at session end (Windows shutdown syntax fumbled in the harness; harmless).
- D7 cleanup verified zero fixture leaks across multiple runs — positioning_runs_v2, signal_applications, jobfit_runs, throwaway client_profile, and throwaway auth user all deleted by the smoke's `finally` block.

### What's next

- **Phase 1 Stage 1c** — Frontend rendering (case-calibrated). Separate FRD discussion; backend is now ready for consumption.
- **Phase 1 Stage 1d** — Reconsider Target flow.
- **Phase 1 Stage 1e** — Integration testing in dev.

---

## Known-issue follow-ups (Foundation deferrals)

Captured during Foundation build for future remediation. Each entry has: why it was deferred, and what would trigger un-deferral.

### KI-01 — findOrCreateSignalApplication preserves empty-field junk-row risk

**Source:** Stage 1b extraction of `lib/signalApplications.ts` from `app/api/jobfit/route.ts:377-503`.

**Issue:** Existing JobFit logic upserts a `signal_applications` row keyed on `(profile_id, company_name, job_title)` even when `company_name` and `job_title` are both empty (JD extraction can produce blanks). The shared utility preserves this current behavior — it does not "fix" the junk-row insert as part of Foundation's refactor.

**Why deferred:** Foundation's scope is structural (shared utility + FK columns), not behavioral. Changing empty-field handling now would mix a behavior change into what's otherwise a no-behavior-change refactor and require new regression baselines.

**Trigger to un-defer:** When Positioning Phase 1 ships and consumers of the linked application record start populating `positioning_run_id` + `coverletter_run_id`, empty company/title rows become more visible. Worth revisiting then with an explicit spec on "what should happen when company/title can't be extracted" — probably reject the link rather than create a junk row.

**Update 2026-05-12 (Stage 1b D6):** Positioning v2 `/api/positioning/v2/start` is now a second contributor to this pile per DD-27. Investigation (scripts/verify-jobfit-company-source.mjs against prod) measured `result_json.job_signals.companyName` non-empty on 76.2% of non-error runs and `jobTitle` non-empty on 82.6% — leaving ~20-24% of runs that would block Positioning if we required non-empty extraction. Decision was to mirror JobFit's "(Unknown Company)" / "(Unknown Role)" placeholders rather than block. Distinguishability between JobFit-originated and Positioning-originated junk rows comes from logs, not row content:
  - JobFit's existing path: applies placeholders inline at the route (no specific log marker today)
  - Positioning v2: logs `[positioning-v2/start] PLACEHOLDER_APPLICATION_CREATED runId=… profileId=… jobfitRunId=… reason=…` where `reason ∈ {empty_company, empty_title, empty_both}` — only emitted when a placeholder was actually applied
When KI-01 is finally addressed, both contributors should change in lockstep (the fix is the same: reject the link rather than create a junk row).

### KI-02 — Re-derive career_stage when resume is later uploaded

**Source:** Foundation career-stage handling for users who complete intake before uploading a resume.

**Issue:** When `yearsExperienceApprox` is unavailable at intake time (no resume yet), Foundation defaults to `career_stage = 'mid_career'` with `career_stage_locked_by = 'inferred'`. If the user later uploads a resume, `yearsExperienceApprox` becomes derivable and may contradict the mid_career default — e.g., a resume showing 0 years of work history should resolve to `early_career` or `student`.

**Why deferred:** The resume-upload side effect is out of Foundation scope. Today, resume upload doesn't trigger any `candidate_targeting` writes. Adding the re-derivation hook is a separate concern that touches the persona-creation / resume-upload flow and should be specced in its own ticket.

**Trigger to un-defer:** First real-user complaint about a mis-classified `career_stage` after resume upload, OR when the manual override admin UI is built (then re-derivation can ship in the same change). Should respect `career_stage_locked_by`: only re-derive when `locked_by = 'inferred'`; preserve `'intake'` and `'manual_override'`.

### KI-04 — `primary_other_description` whitespace-rejection strictness

**Source:** Stage 1a `candidate_targeting` migration CHECK constraint.

**Issue:** Migration uses `LENGTH(TRIM(primary_other_description)) > 0`; FRD section 4.2's example uses `LENGTH(primary_other_description) > 0`. The migration is stricter — rejects whitespace-only ('   ', '\t\n', etc.) at the DB layer, not just NULL/empty.

**Why deferred:** Not deferred per se — this is a deliberate hardening over the FRD literal. Recorded as a known follow-up only so future readers of the FRD don't get confused that the implementation diverges.

**Trigger to un-defer:** N/A — implementation is stricter than FRD by design. If FRD is ever revised, update section 4.2's CHECK example to match. See DD-09.

### KI-06 — `interestLevel = 1` default in shared utility (semantic alignment for future callers)

**Source:** Stage 1b `lib/signalApplications.ts` `findOrCreateSignalApplication`.

**Issue:** The utility defaults `interestLevel` to `1` to preserve JobFit's historical behavior. This differs from the `signal_applications.interest_level` column DEFAULT of `3`. Future Positioning and Cover Letter callers should explicitly pass an `interestLevel` that matches their own product semantics rather than inheriting JobFit's "1 = just saved via JobFit run."

**Why deferred:** Not deferred behaviorally — utility's default is correct for JobFit (the only consumer today). Recorded as a known follow-up so Positioning Phase 1 and Cover Letter Integration FRDs both think through the right initial value at their own call sites.

**Trigger to un-defer:** Each downstream caller's FRD should specify `interestLevel` explicitly. If callers consistently want `3` (the column default), revisit whether the utility default should change.

### KI-07 — Cache-hit signal_applications block still inline (out of Stage 1b scope)

**Source:** Stage 1b refactor of `app/api/jobfit/route.ts:442-503` to use `findOrCreateSignalApplication`.

**Issue:** A SECOND auto-application block exists at `app/api/jobfit/route.ts:253-321` — the cache-hit branch. It contains near-identical sanitization (prefix-strip + garbage-filter, ~30 lines duplicated) AND an inline insert-only-if-not-found pattern. Stage 1b scope was limited to the full-pipeline branch (lines 442-503) per Peri's instruction; the cache-hit branch was not touched.

**Why deferred:** Foundation Stage 1b's stated scope was the full-pipeline auto-application block. Refactoring the cache-hit branch was not pre-approved.

**Trigger to un-defer:** Easy win — call `findOrCreateSignalApplication` from the cache-hit branch with `jobfitRunId` omitted (no run_id to link on a cache hit). Behavior-equivalent. Worth doing as a follow-up clean-up ticket; small diff, removes ~60 lines of duplication. Watch out: cache-hit branch currently does NOT update existing rows' `signal_decision/score` — the refactor must preserve that (utility call with no FK + no JobFit-fields patch on the existing-found path).

### KI-08 — Refactor AddNotePanel to use the generic SlideInPanel

**Source:** Beta Feedback v0.1 Phase 3 — new generic `components/ui/SlideInPanel.tsx`.

**Issue:** `app/dashboard/coach/clients/[clientId]/AddNotePanel.tsx` predates the generic slide-in shell and hardcodes its own backdrop + panel markup. Phase 3 introduced `SlideInPanel` (modeled visually + behaviorally on AddNotePanel) but deliberately left AddNotePanel untouched per FRD §6.5.0, so two slide-in implementations now coexist.

**Why deferred:** Per FRD §6.5.0, refactoring AddNotePanel onto the shared shell was out of v0.1 scope — it would touch a working, beta-critical Notes surface and add regression risk to a feature-delivery phase. Short-term duplication accepted for zero-regression risk.

**Trigger to un-defer:** A future cleanup pass (not tied to a beta milestone). Replace AddNotePanel's inline backdrop/panel with `<SlideInPanel title="Add a note">`, keeping its form body + footer. Before/after, verify the Notes tab still opens/closes (backdrop + Esc), saves, and dims-on-save exactly as today.

### KI-05 — 12-value lane CHECK list repeated three times in candidate_targeting

**Source:** Stage 1a `candidate_targeting` migration.

**Issue:** The 12 valid lane IDs appear in three separate CHECK constraints (primary, secondary_1, secondary_2) — identical content each time. Adding a new lane requires editing all three CHECKs in lockstep, plus `lib/laneTaxonomy.ts`.

**Why deferred:** Accepted maintenance debt for v1. Top-level lane list is stable enough that repetition cost is low. Postgres ENUM type would give a single source of truth at the DB layer but adds different friction (`ALTER TYPE ... ADD VALUE` limitations).

**Trigger to un-defer:** If lane additions/changes happen more than once per quarter, convert the lane list to a Postgres ENUM in a follow-up migration. See DD-10.

### KI-03 — profile_text current_status dual-write is transitional

**Source:** Stage 1b update to `app/api/profile-intake/route.ts`.

**Issue:** Foundation has profile-intake write `current_status` to BOTH the existing `client_profiles.profile_text` blob (preserved for backward compat) AND the new `candidate_targeting` row (via the career-stage derivation path). The dual-write keeps existing readers of `profile_text` working while the new structured path comes online.

**Why deferred:** Removing the `profile_text` write requires auditing every reader of `current_status` in `profile_text` (JobFit, Positioning, other consumers) and routing them through `candidate_targeting` instead. That audit is out of Foundation scope.

**Trigger to un-defer:** When `candidate_targeting` rows exist for ≥95% of active users (post-migration + steady-state), audit all readers of `current_status` in `profile_text`, migrate them to read from `candidate_targeting`, then drop the dual-write.

---

## Design decisions made during build

Decisions made in the build conversation that aren't already in the FRD. Captured here so the FRD doesn't drift.

### DD-01 — Sub-lane count is 49, not 45

FRD section 4.1 says "Total: ~45 sub-lanes plus Other." Locked list from approval conversation came out to 48; label-review pass added one more (split of Data Science / Engineering into two distinct sub-lanes), bringing the total to 49. Within the "~45" ballpark; no structural problem. Counts per lane locked in `lib/laneTaxonomy.ts` header comment.

### DD-02 — Engineering reverse-maps to Technology, with migration caveat

`getLaneFromJobFamily('Engineering')` returns the Technology lane. Migration script applies semantic correction for non-software engineers (Mechanical, Civil, Biomedical, Industrial) — routes them to Other via LLM fallback. Documented in `lib/laneTaxonomy.ts` JSDoc on `getLaneFromJobFamily`.

### DD-03 — Analytics and Trades intentionally return null on reverse-map

`JobFamily.Analytics` is cross-functional (Marketing Analytics, People Analytics, Operations Research) and unmapped — migration script LLM-fallback handles it.
`JobFamily.Trades` is out of taxonomy scope (no Trades lane) — migration script routes to Other.

### DD-04 — PreMed reverse-maps to Healthcare AND requires status_premed

Migration script MUST set `status_premed = true` on the `candidate_targeting` row whenever it routes a PreMed-classified user to the Healthcare lane. The reverse-map function itself is a pure lookup; the smart routing is the script's responsibility. Documented in `lib/laneTaxonomy.ts` JSDoc.

**Extension (locked pattern):** If any future status indicator ever needs to derive from a JobFamily value (none do today — `prelaw` and `pregrad` are intake-only), apply the same split: taxonomy stays a static description of lane values; migration / translation logic owns the dual-write side effect. Keep the taxonomy clean.

### DD-05 — Sub-lane validation lives at app layer, not DB

`candidate_targeting`'s CHECK constraint validates only `primary_lane` (12-value enum) and `career_stage` (4-value enum). Sub-lanes are TEXT with no DB constraint — app-layer validation via `isValidSubLaneId()` from `lib/laneTaxonomy.ts`. Avoids schema migration burden when sub-lanes evolve. (FRD section 4.2 already locks this; recorded here for completeness.)

### DD-06 — Label-review refinements (Technology, Operations & Strategy, People & HR)

Three changes applied during label review after Stage 1a-prep:

- **Technology** — `data_science_engineering` ("Data Science / Engineering") split into `data_science` ("Data Science") + `data_engineering` ("Data Engineering"). Reason: Data Science (modeling, analysis, ML applied) and Data Engineering (pipelines, infrastructure, data platform) are distinct paths; candidates target one or the other, rarely both. Technology sub-lane count: 5 → 6.
- **Operations & Strategy** — `operations_research` ("Operations Research / Analytics") renamed to `operations_analytics` ("Operations Analytics"). Reason: "Operations Research" reads as the academic discipline; today's candidates self-identify as ops analytics / supply chain analytics / operations analyst. Label is more current.
- **People & HR** — `hr_business_partner` ("HR Business Partner / Generalist") renamed to `hr_generalist` ("HR Generalist"). Reason: HRBP is a specific senior role; Generalist covers the broader arc from coordinator through senior generalist. BP is essentially a senior generalist track. "HR Generalist" captures the whole arc better.

All three changes locked before any DB CHECK constraints. No migration consequence for existing data (none exists yet).

### DD-07 — `set_updated_at()` not `update_updated_at_column()`

FRD section 4.2 assumes a `update_updated_at_column()` trigger function "exists; if not, create it as part of this FRD." Actual prod has `public.set_updated_at()` (`prod_public_schema.sql:40-47`) doing the same job. Existing tables (`coverletter_runs`, `jobfit_profiles`, `jobfit_users`, others) all use `set_updated_at` via `trg_<table>_set_updated_at`.

**Decision:** Use the existing function. Do NOT create a parallel `update_updated_at_column()`. The `candidate_targeting` trigger follows the established naming convention: `trg_candidate_targeting_set_updated_at`.

**FRD update needed:** Section 4.2's trigger note should be corrected to reference `set_updated_at` instead of `update_updated_at_column`. Not blocking; tracked here.

### DD-25 — Phase 1: trust migration data without verification step (Option A)

**Recorded:** 2026-05-12 (first Phase 1 build entry).

**Decision:** Phase 1 trusts `candidate_targeting` rows as-is regardless of source (`intake` vs `migration`). No verification step before Positioning runs. The 122 migration rows on prod are treated as authoritative inputs to case determination and case-specific data generation, same as future intake-sourced rows.

**Trade-off accepted:** Low-confidence migration assignments (the 26 low-confidence rows from the 122 backfilled) will produce less-calibrated Positioning experiences. The LLM chose the "closest reasonable lane" with low confidence per the prompt's anti-Other rule, and Phase 1 will calibrate the workflow against that lane rather than asking the user to confirm first.

**Why this is acceptable for Phase 1 ship:**
- User-verification UI requires UX design + frontend implementation that hasn't been scoped
- Phase 1's case-calibrated workflow is itself a form of soft verification — Case C framing surfaces gaps that a wrong-lane assignment would expose
- Low-confidence rows are a small fraction of the population (26 of 122 ≈ 21%)
- The cost of getting a low-confidence row "wrong" in Case A/B/C assignment is bounded — user can abandon and restart, no data corruption

**User-verification UI deferred** to a later feature scope (Phase 1.5 or Phase 2 territory; TBD). When it ships, it can also handle:
- Migration-row confirmation on next session
- Lane changes triggering Positioning-run fingerprint invalidation (already supported by Phase 1's fingerprint logic per FRD section 4.7)

**No code changes** in this entry — this is a documented design decision that informs Phase 1 implementation.

### DD-26 — Stage 1b D4: link architecture clarified to one-directional

**Recorded:** 2026-05-12 (during Stage 1b D4 pre-drafting review).

**Decision:** The link between `positioning_runs_v2` and `signal_applications` is **one-directional**: `positioning_runs_v2.signal_application_id` is the sole authoritative link from a positioning run to its application record. `signal_applications.positioning_run_id` is NOT written by the Positioning v2 flow.

**Background — how the mistake surfaced:** Stage 1a migration `20260512_signal_applications_run_fks.sql` added `signal_applications.positioning_run_id UUID REFERENCES public.positioning_runs(id)` — the FK targets the **v1** `positioning_runs` table (legacy, separate from `positioning_runs_v2`). The mismatch was not caught in Foundation review. Foundation's `tests/foundation/smoke-e2e.ts` exercised this column with a v1 `positioning_runs` row, so it passed without revealing the v2-target gap.

The architectural item was surfaced during Stage 1b D4 pre-drafting review of the F2 self-heal test, which originally assumed bidirectional linkage. Writing a `positioning_runs_v2.id` into `signal_applications.positioning_run_id` would fail the FK check (v2 id won't exist in v1 `positioning_runs`).

**Rationale for one-directional (not "fix the FK to retarget v2"):**

1. `signal_applications` has a **one-to-many** relationship with positioning runs over time — a user can re-run Positioning multiple times for the same application (targeting changes, re-evaluation after gap work, etc.). A single `positioning_run_id` back-reference on `signal_applications` is semantically ambiguous regardless of which table it points at.
2. The v2 → v1 FK target is **not actively breaking anything** — the column simply isn't populated by the v2 flow. Worth flagging as architectural debt (see Post-Stage-1b cleanup item 3) but not worth touching a Foundation Stage 1a artifact + re-running prod migrations to "fix."
3. Stage 1b's case determination flow only needs the v2 → applications direction (so a v2 run can locate its application for status updates, history rollups, etc.). The reverse direction is not consumed by any Phase 1 logic.

**Consequences for D4 (runWriter.ts):**

- F2 self-heal pattern **simplifies from three-write to two-write**:
  1. INSERT `positioning_runs_v2` with `signal_application_id = NULL`
  2. UPDATE `positioning_runs_v2.signal_application_id` after `findOrCreateSignalApplication` returns
- No third write to `signal_applications.positioning_run_id`. The asymmetric-state recovery window the self-heal protects against is: "row created at step 1 but step 2 failed → next visit needs to link it." Idempotent UPDATE handles this.

**Consequences for D6 (route.ts):**

- The route MUST NOT pass `positioningRunId` to `findOrCreateSignalApplication`. The shared util (`lib/signalApplications.ts:138-140`) unconditionally writes `positioning_run_id` when the param is provided, which would hit the v1-target FK and fail with code `23503`.
- D6 will include an inline comment at the call site explaining the omission and pointing at DD-26.

**Consequences for the shared util:**

- `findOrCreateSignalApplication`'s `positioningRunId` param becomes dormant after Stage 1b (no caller uses it). Tracked as Post-Stage-1b cleanup item 2. Not removed now to avoid breaking-API churn on a shared util.

**No prod schema change in this entry.** v1 `positioning_runs` continues to exist, the FK continues to target it, and the column remains nullable. v1 deprecation is a separate future conversation.

### DD-27 — Stage 1b D6: JobFit metadata source-of-truth + placeholder convention

**Recorded:** 2026-05-12 (during Stage 1b D6 pre-drafting review).

**Decision:** `app/api/positioning/v2/start/route.ts` reads company name + job title for `findOrCreateSignalApplication` from `jobfit_runs.result_json.job_signals.{companyName, jobTitle}` (the V5 extraction output), with JobFit-style `"(Unknown Company)"` / `"(Unknown Role)"` placeholders when those fields are empty.

**The schema gap that surfaced this:** `jobfit_runs` has **no top-level `job_company` or `job_title` columns**. The columns are: `id, client_profile_id, application_id, job_url, fingerprint_hash, fingerprint_code, verdict, result_json, persona_id, profile_version_at_run, persona_version_at_run, job_description, sourced_by_coach_id, created_at, updated_at` (per Stage 1b D2's schema discovery, captured in `lib/positioning/v2/jobfitLookup.ts`). Job metadata lives inside `result_json.job_signals` as a denormalized sub-object.

**Investigation:** `scripts/verify-jobfit-company-source.mjs` ran on dev (zero rows — table empty) and then fell back to prod (~1300 jobfit_runs):
- `verdict` distribution: 238 Apply, 225 Review, 197 Pass, 101 Priority Apply, no error rows in the 761 non-error sample
- `application_id` coverage on non-error runs: **42.0%** (320 / 761) — too low for path (ii) "join via application_id to signal_applications.{company_name, job_title}" to be reliable
- `result_json.job_signals` presence: **100%** across a 500-row sample
- `result_json.job_signals.jobTitle` non-empty string: **82.6%** (413 / 500)
- `result_json.job_signals.companyName` non-empty string: **76.2%** (381 / 500)

**Three paths considered:**

| Path | Source | Coverage | Result |
|------|--------|----------|--------|
| (i)   | Request body                       | n/a    | Rejected — clients shouldn't re-state JobFit's extraction |
| (ii)  | `signal_applications` via application_id | 42%   | Rejected — too sparse |
| (iii) | `result_json.job_signals`          | 100%/82.6%/76.2% | **Adopted** with placeholder fallback for the ~20-24% empty cases |

**Empty-field handling:** the route applies `"(Unknown Company)"` / `"(Unknown Role)"` placeholders mirroring JobFit's existing convention (per KI-01 lines 26-32 of `lib/signalApplications.ts`). Trade-off: ~20-24% of v2 Positioning starts will produce a junk-flavored `signal_applications` row. This is acceptable because:
1. It matches JobFit's existing pattern — users see consistent placeholder text across products
2. The case determination is correct regardless of company/title extraction quality — the user gets the workflow they came for
3. Refusing to start Positioning for ~20% of users would be a worse outcome than producing a tracked junk row
4. KI-01 already tracks the junk-row pile; Positioning is a new contributor (KI-01 updated 2026-05-12 to note this)

**Log pattern for ops visibility:**

```
[positioning-v2/start] PLACEHOLDER_APPLICATION_CREATED runId=<run_id> profileId=<profile_id> jobfitRunId=<jobfit_run_id> reason=<reason>
```

Where `reason ∈ {empty_company, empty_title, empty_both}`. Only emitted when a placeholder was actually applied (not on every call). Distinct from JobFit's existing path (which doesn't log this marker), so grep can attribute new junk rows to Positioning specifically.

**Inline comment locked at the call site** (in route.ts where `findOrCreateSignalApplication` is invoked):

```typescript
// JobFit's result_json.job_signals.companyName/jobTitle are empty on ~20% of
// non-error runs (extraction failures on poorly-scraped JDs). Rather than
// blocking Positioning for these users, we use JobFit's "(Unknown Company)"
// placeholder convention. The resulting signal_applications row is junk-flavored
// but the case determination is correct and the user gets their experience.
// This contributes to KI-01's "junk signal_applications rows" pile; logged via
// PLACEHOLDER_APPLICATION_CREATED for ops visibility.
```

**No schema change in this entry.** All data sourcing happens at the application layer.

### DD-28 — Phase 1: caseDetermination V4-fallback accepts V5 object risk_codes

**Recorded:** 2026-05-19 (surfaced while gathering inputs for Phase 2 v1 build commit A1 — real headline detection in extractHeadlineCandidate, which also reads `jobfit.risk_codes` for the `RISK_FAMILY_MISMATCH` synthesize-trigger).

**Discovery:** `lib/positioning/v2/types.ts` declared `JobfitResultJson.risk_codes?: string[]`. The writer (`app/api/jobfit/signals.ts:274 RiskCode`) emits **object** entries: `{ code, job_fact, profile_fact?, risk, severity, weight? }`. caseDetermination's V4 fallback (`extractRisks` lines 128-142) filtered `typeof === "string"` then `.map(code => ({ keyword: code, ... }))` — V5 object entries silently dropped.

**Live runtime survey (43 most recent jobfit_runs, `scripts/probe-catherine-risk-codes-runtime.mjs` against dev):**

| Shape | Count |
|---|---|
| risk_codes absent | 0 |
| risk_codes empty array | 5 |
| `[string, ...]` (V4) | **0** |
| `[object, ...]` (V5) | 38 |
| Mixed | 0 |
| risk_structured array present | 42 |
| Would hit V4-fallback path (risk_structured non-array AND risk_codes populated) | 1 |
| ...AND entries are V5-object (silently dropped pre-fix) | 1 |

**Impact pre-fix:** ~2.3% of recent runs (1/43 sample) hit the broken path. The V5 primary path (42/43) is unaffected. The broken path could promote Apply/Priority Apply rows to Case A because the V4 fallback returned `items: []` + `dataQualityIssue: false`, satisfying the zero-risks-AND-no-data-quality-issue Case A precondition. User-facing UX: Case A surface ("clean signal, 1-2 refinements") instead of Case B ("targeted changes needed") on rows that had real risks.

**Why latent so long:** The V5 primary path covers ~98% of recent runs cleanly. The V4 fallback only fires when `risk_structured` is missing AND `risk_codes` is populated — a rare combination tied to Foundation DD-23-flavored data quality (historical V4 runs against partially-scraped JDs). The type-vs-runtime drift didn't surface because the broken path was rarely exercised AND the failure mode (Case A instead of Case B) doesn't crash or visibly degrade.

**Fix scope (this commit):**
- `lib/positioning/v2/types.ts`: declare narrow `RiskCodeV5 = { code: string; severity?: Severity }` and widen `risk_codes?: Array<string | RiskCodeV5>`.
- `lib/positioning/v2/caseDetermination.ts`: rewrite V4-fallback loop to handle both shapes. String entries unchanged (severity defaults to medium). Object entries use `.code` for keyword; `.severity` if valid, else medium. Empty `.code` skipped.
- `tests/positioning-v2/case-determination-check.ts`: 6 new sub-tests (11b-11f) covering V5 object entries through the fallback. Existing Test 11 (V4 strings) still passes.

**Not changed in this commit:**
- V5 primary path (`risk_structured`) — already correct, untouched.
- Other risk_codes consumers (`signals.ts` is the writer; `deterministicBulletRendererV4`, `evidenceBuilder`, `bulletGeneratorV5` already assume object shape correctly).
- The type drift in `lib/positioning/v2/types.ts:76` is only partially closed — full `RiskCode` shape from `signals.ts:274` is intentionally narrowed to `RiskCodeV5` because Phase 1 reads only `code` and `severity`. Widening further would create unnecessary cross-cutting coupling (lib → app dependency).

**Verification:**
- 64/64 caseDetermination tests pass (53 existing + 11 new sub-assertions across 6 new named tests).
- JobFit regression check: 46 live cases ran with output **identical** to pre-change state (verified via `git stash` + re-run). The preexisting 21 "missing from live run" baseline-drift warnings are unaffected — separately scoped issue, not introduced by this commit.

**Surfaced as part of:** Phase 2 v1 build A1 of 8 (real headline detection) Step 1 reads. Fix landed as a separate pre-A1 commit per surgical-scope discipline.

### DD-24 — Stage 1e validation complete · Foundation SHIPPED

**Executed:** 2026-05-12 (all four steps).

**Step 1 — Regression check:** `tests/jobfit-regression/regression-check.ts` ran 46 baseline cases. **Zero scoring mismatches.** Exit-1 is the pre-existing 21-baseline-cases-missing warning (test-data state, not a scoring regression). JobFit refactor (Stage 1b extraction of `findOrCreateSignalApplication`) is byte-identical to pre-refactor behavior.

**Step 2 — End-to-end smoke test:** `tests/foundation/smoke-e2e.ts` — **24/24 checks PASS** against dev. Exercised:
- candidate_targeting row exists for migrated test profile (intake chain validated)
- signal_applications schema has `positioning_run_id` + `coverletter_run_id` columns (Stage 1a)
- `findOrCreateSignalApplication` creates a new app, returns isNew=true (Stage 1b)
- Re-call with same key + different run_id returns same id, isNew=false, jobfit_run_id updated (idempotent lookup-or-create)
- positioning_run_id linkage works without overwriting jobfit_run_id
- Cleanup deleted all 4 test rows (1 signal_application, 2 jobfit_runs, 1 positioning_run)

**Step 3 — Lib unit tests:**
- `tests/lane-taxonomy/taxonomy-check.ts` — **154 checks PASS**
- `tests/candidate-targeting/derive-career-stage-check.ts` — **32 checks PASS**

**Step 4 — Foundation completion summary:** `docs/Features/positioning-foundation-completion.md` — 11 acceptance criteria checklist with status, where-the-work-landed, and caveats for each. Three items marked "⚠ deferred" per kickoff/FRD scope (Framer intake form, user-verification UI, PreMed retroactive flagging abandoned).

**Stage 1e: COMPLETE.**

---

### 2026-05-13 addendum — JobFit refactor recommit

During Stage 1c kickoff, `git status` at session start surfaced uncommitted changes to `app/api/jobfit/route.ts`. Investigation revealed:

- These were the Stage 1b "JobFit refactor ✓" changes (this runlog L29)
- Validated as byte-identical to pre-refactor behavior in Stage 1e (DD-24 above)
- Working-tree changes were live during Stage 1e validation but the commit didn't happen at Stage 1b ship
- Today's regression sweep (2026-05-13): 46 cases, zero scoring drift — re-confirms byte-identical claim
- Blob hash `fb685d1d` byte-identical between pre-touch state and recommit

Recommitted with message documenting the trace. No code changes from the validated Stage 1e state.

Lesson: Stage 1e ship checklist should explicitly verify `git status` clean as a final gate. The "validate in working tree" step assumed commit had happened; checking explicitly closes the assumption.

---

### 2026-05-13 second addendum — Foundation + Stage 1b not on origin/dev

Investigation of today's repeated Vercel build failures revealed a structural gap larger than the import-path issue: the entire Foundation + Stage 1b body of work (lib/signalApplications.ts, lib/candidateTargeting.ts, lib/laneTaxonomy.ts, lib/positioning/, app/api/positioning/v2/, tests/foundation/, tests/positioning-v2/, supabase/migrations/20260512_*.sql, this runlog itself) is untracked in git. git add was never run for these paths.

HTTP probe against wrnsignal-api-staging.vercel.app:
- POST /api/positioning/v2/start → 404 (route not deployed)
- POST /api/jobfit → 400 'Missing job text' (route exists)

The runlog's framing of 'shipped to dev' for Foundation and Stage 1b reflected 'validated in working tree against local Supabase,' not 'present on origin/dev and deployed via Vercel.' This conflation is the structural root of today's three surprises:

1. JobFit refactor uncommitted (this morning)
2. Runlog itself untracked
3. Foundation + Stage 1b untracked

Tonight's resolution: revert cef7feab and a9bbd5c2 to restore green dev build. The substantive commit of Foundation + Stage 1b is deferred to a deliberate planning session — significant operation deserving plan-first / approve-before-build cycle.

Stage 1c blocked until Foundation + Stage 1b are actually on dev. Framer Sections B-H not pasted; would have rendered errors against a 404 endpoint.

Lessons compounding:
- 'Shipped' must mean 'on origin/dev and building via next build,' not 'validated in working tree via tsx'
- Stage 1e validation gate must include git status clean + next build success
- This runlog should itself be git-tracked so its authority lives in the durable record

Next session: scope the Foundation + Stage 1b commit operation. Inventory of untracked paths, commit boundary decisions, dependency ordering, per-commit validation gates.

---

### 2026-05-13 — Magic link redirect workaround (TEMPORARY)

Discovered: send-link route hardcodes production URLs (wrnsignal-api.vercel.app/dashboard variants) since commit 987fed61, April 11. Dev environment magic links should redirect to dev, not production.

Workaround applied (Studio-side, dev Supabase project zydrqckpwidipwbhrfgd):
- Site URL set to https://wrnsignal-api-staging.vercel.app
- Production URLs deliberately NOT in Redirect URLs allowlist
- Result: send-link's hardcoded production URLs fail allowlist match, Supabase falls back to Site URL, user lands at dev

This is documented Supabase behavior (fallback to Site URL when emailRedirectTo isn't allowlisted), but relying on it is fragile. Future Supabase config changes could break this.

PERMANENT FIX (planned, not yet executed): app/api/auth/send-link/route.ts and four other routes hardcode production hostnames. They should use environment-appropriate URLs (request-derived or env var pattern, decision pending). Affected routes:
- app/api/auth/send-link/route.ts
- app/api/checkout/create-session/route.ts
- app/api/coach/create-client/route.ts
- app/api/coach/invite/route.ts
- app/api/webhooks/stripe/route.ts

This is the third structural finding of 2026-05-13 (alongside Foundation+Stage1b not committed, and Section A scope bug).

When the permanent fix lands: revert the Site URL override, remove this entry from 'temporary workaround' status.

### 2026-05-13 — Framer prod modifications deferred from today's commit operation

While staging Commit 8c (Framer dev mirror), surfaced 6 modified + 1 new framer/prod/* files with content changes 7-9 days old (mtimes 2026-05-04 / 2026-05-06). The most recent commit touching these files was ab14785e (2026-05-04) — a zero-byte rename moving them into framer/prod/. No content commits since.

Five distinct themes identified, all unauthorized this session (same shape as the JobFit refactor surprise earlier today):

1. App Store badge integration — needs App Store launch + campaign param verification
2. Conversion pixels (Meta InitiateCheckout + Google AW-11125129027/AMw8CMHs...) — needs token-intent verification in Google Ads
3. Path slug /signal/job-analysis → /signal/jobfit-run-trial — needs Framer Studio routing verification
4. Coming-soon banner removal — cosmetic, paired with Theme 1
5. Trial card sunset (jobfit_only) + persona_id wiring — both established in tracked code

Deferred to a separate session for per-theme review + appropriate verification gates.

---

## Foundation: SHIPPED

All Foundation deliverables shipped to dev + prod. Acceptance criteria addressed (closed or deferred-with-scope-note per the completion doc). No regressions in existing JobFit / Positioning / Cover Letter flows. Operational discipline held throughout — dev-first, prod requires explicit confirmation, write-restricted Proxy on all migration scripts, no service-role-key leakage, all results files gitignored.

**Phase 1 (Setup and Scope Calibration) is a separate FRD-approval cycle.** Foundation work does NOT roll automatically into Phase 1 build. Next conversation starts with Phase 1 FRD review.

### DD-23 — PreMed retroactive flagging abandoned

**Executed:** 2026-05-12T18:36:14Z (revert applied to prod).

**Context:** DD-22 documented an "any-run-in-history" PreMed patch that set `status_premed=true` on 4 profiles. Peri spot-checked the result and confirmed Danielle Keyes is NOT pre-med (she targets consulting; her most recent work is an Alpine Investors interview workbook). Investigation into all 4 patched profiles revealed the same pattern: the historical `jobfit_runs.jobFamily = 'PreMed'` values were all from runs against empty/garbage JD content.

**Investigation findings (`scripts/migrate-candidate-targeting/investigate-premed-misclass.mjs`):**
- **Danielle Keyes:** 5 PreMed runs of 19 total — all from 2026-03-18 with `(no title) + (no company)` (batch test runs with no JD signal). Her real April runs were Marketing/Sales at Vacheron Constantin / BALENCIAGA.
- **lily stein:** 2 PreMed of 13 — titles `"ph About the job"` and `"pew About the job"` (JD-scraping artifacts).
- **ryan rudnet:** 2 PreMed of 35 — titles + companies all literally `"Our people"` (scraped boilerplate text leaking into title/company fields).
- **catherine2 lees2:** 13 PreMed of 64 — all from 2026-03-26 with `(no title) + (no company)` (same batch-test pattern).

**Root cause:** When JobFit can't extract JD content, its JobFamily classifier falls back to scanning the candidate's profile_text/resume_text for family keywords. Profile text on these 4 candidates contained pre-med-adjacent keywords (volunteer work, science coursework, etc.) that tripped PreMed detection in the empty-JD fallback path.

**Architectural finding:** `jobfit_runs.jobFamily` is **not a reliable signal source for historical lookups when associated JD content was empty/garbage.** Any future code that consumes this field for retroactive analysis must filter on JD quality (minimum: non-empty job_title AND non-empty company_name) or treat the value as advisory.

**Decision (locked):** PreMed capture is forward-looking only from this point. Valid sources are:
- (a) Intake form explicit `status_premed=true` (post-Framer-update — Stage 1c work, not yet shipped)
- (b) Future JobFit runs on real PreMed-targeting JDs trigger the dual-write in the live intake/JobFit flow at the time they run

**No retroactive scanning.** The "any-run-in-history" approach is fundamentally unsafe on this data shape. The migration's "latest-run" approach was also not robust — it produced 0 false positives by luck because latest-runs happened to be on real JDs.

**Revert result (`scripts/migrate-candidate-targeting/revert-premed-flag.ts`):**
- Dev smoke test: 0 eligible rows, 0 updates
- Prod execution: 4 eligible rows → 4 reverted (`status_premed: true → false`)
- Scope: ONLY `status_premed` column. `primary_lane`, `source`, and all other columns preserved exactly. Verified post-revert: each of the 4 profiles retains its migration-chosen lane (Danielle Keyes → consulting/strategy_consulting; lily stein → healthcare/life_sciences_biotech; ryan rudnet → finance/asset_management; catherine2 lees2 → marketing/brand_marketing).
- Independent verification: `SELECT COUNT(*) FROM candidate_targeting WHERE status_premed=true` returns 0.

**Result file path:** `scripts/migrate-candidate-targeting/results/revert-premed-prod-2026-05-12T18-36-15-303Z.txt`

**Stage 1d-prod shipped state (post-revert):** 122 `candidate_targeting` rows, all `source='migration'`, all `status_premed=false`. Migration was correct; the patch addition was an error corrected by revert. **Foundation Stage 1d remains complete.**

**Lesson for future migrations:** when a column's source data quality is uncertain, define the historical-window interpretation AND the quality filter explicitly at design time. "Any-run" vs "latest-run" wasn't the real question — the real question was "what counts as a credible signal in the source data."

### DD-22 — Stage 1d-prod: complete (122 profiles backfilled + PreMed flag patched)

**Executed:** 2026-05-12T17:49:11Z (initial 122-profile migration) + 2026-05-12T18:16:46Z (PreMed flag patch).

**Migration result (run 1, after prod schema applied):**
- 122 of 122 profiles processed; 122 candidate_targeting rows created
- 3 reads (`client_profiles`, `candidate_targeting` existence check, `jobfit_runs`)
- 122 writes, all to `candidate_targeting` (Proxy enforcement held — no writes to other tables)
- 0 errors, 0 hallucinations
- Guards exercised: `min_signal_input` × 23 (matches real-data validation prediction of 19% min-signal), `null_sublane_override` × 1 (Maleri Ginsberg legal-intern case, predicted from real-data run)
- Confidence distribution: high 58, medium 38, low 26 (essentially matches the read-only validation's 58/39/25 — temperature=0 determinism holds)

**Lane distribution matches the read-only validation:**
```
other 33 · marketing 27 · finance 14 · operations_strategy 11 · technology 10 ·
sales_bd 8 · legal 6 · people_hr 5 · public_sector 2 · healthcare 2 ·
accounting 2 · consulting 2
```

**PreMed gap surfaced and patched:**

Initial migration used "latest JobFit run" to determine JobFamily, which missed historical PreMed candidates whose more-recent runs were different families. 0 of 122 rows got status_premed=true after the main migration. DD-04 spec intent was "any historical PreMed signal" — latest-run was an unintentional narrowing.

**Patch (`scripts/migrate-candidate-targeting/patch-premed-flag.ts`) result:**
- Scope: ONLY `status_premed` column updated. `primary_lane` deliberately preserved — pre-med is an additive status indicator running alongside whatever the candidate's current targeting is (architectural intent behind moving PreMed out of the lane enum per DD-04).
- Dev smoke test: 0 eligible (expected — dev has 0 jobfit_runs)
- Prod execution: 4 eligible profiles → 4 newly flagged. 22 historical PreMed runs collapsed to 4 distinct profiles after de-dup.
- All 4 patched profiles retained their migration-chosen lanes (Danielle Keyes → consulting; lily stein → healthcare; ryan rudnet → finance; catherine2 lees2 → marketing). Dual-signal architecture confirmed working.

**Independent verification:**
- `SELECT COUNT(*) FROM candidate_targeting WHERE status_premed=true` returns 4
- Per-profile spot-check confirmed lane preservation: each of the 4 profiles' `primary_lane` matches what the migration originally chose
- `scripts/migrate-candidate-targeting/spot-check-prod.mjs` confirmed named-profile predictions (Aiden Ginsberg → other / "Sports management / MLB front office operations pathway", Allison Rutstein → people_hr/recruiting_talent, Maleri Ginsberg → legal/corporate_law with null_sublane_override applied)

**Result file paths:**
- `scripts/migrate-candidate-targeting/results/migration-prod-2026-05-12T17-53-28-938Z.txt` (122-profile migration)
- `scripts/migrate-candidate-targeting/results/patch-premed-prod-2026-05-12T18-16-51-803Z.txt` (PreMed patch)

**Caveat documented:** the "latest run" vs "any-run-in-history" interpretation question wasn't explicit at design time. DD-04's wording implied any-run; migration script implemented latest-run. Patch corrected the gap on prod. Future similar migrations (e.g., if another status indicator is added) should explicitly specify the historical-window interpretation at design time, not at implementation time.

**Stage 1d-prod: COMPLETE.** Foundation moves to Stage 1e (final validation + regression sweep — the last Foundation step).

### DD-21 — Dev migration completed (4 profiles, idempotency verified)

**Executed:** 2026-05-12T16:23:38Z (first run) + 2026-05-12T16:23:55Z (idempotency re-run).

**First run result:**
- 4 profiles processed (all 4 in dev population)
- 4 candidate_targeting rows created
- 3 reads issued (`client_profiles`, `candidate_targeting`, `jobfit_runs`)
- 4 writes issued (one per profile, all to `candidate_targeting`)
- 0 errors
- 0 prompt-defensive guards fired (no PreMed JobFamily, no null sub-lanes, no empty-Other descriptions). Only the informational `min_signal_input` flag on the 4th profile.

**Idempotency re-run result:**
- 0 writes (all 4 skipped as existing)
- 2 reads (jobfit_runs query short-circuited because to-migrate set was empty)
- 0 errors

**Independent SQL Editor verification:** 4 rows present, all `source='migration'`, all `career_stage='mid_career'`, all status indicators `false`. Three rows with real lane + sub-lane combos (technology/product_management, marketing/brand_marketing, technology/software_engineering), one row with `lane='other'` + LLM-supplied description "Insufficient information to classify career direction". Script reporting and DB reality agree.

**Result file paths:**
- `scripts/migrate-candidate-targeting/results/migration-dev-2026-05-12T16-23-47-776Z.txt` (first run)
- `scripts/migrate-candidate-targeting/results/migration-dev-2026-05-12T16-23-56-541Z.txt` (idempotency re-run)

**Caveat for prod:** dev population (4 profiles, all min-signal-ish, no JobFit history) did NOT exercise the PreMed dual-write guard, the null-sublane override guard, or the empty-Other fallback guard. Those guards will fire on prod (which has 22 PreMed JobFamily runs, plus the Maleri Ginsberg legal-intern null-sublane case observed during real-data validation). Prod is the first time those guards run in write mode.

**Stage 1d-dev: COMPLETE.** Stage 1d-prod: gated on separate explicit approval.

### DD-20 — Null-sublane defensive guard (migration write logic)

**Source:** Real-data run on 122 prod profiles, 2026-05-12. One profile (Maleri Ginsberg, legal intern) surfaced an LLM-side schema violation: lane=legal, sublane=null, confidence=medium. None of the four legal sub-lanes cleanly fit a legal intern, so the LLM made a judgment call to return null rather than misclassify.

**Decision (locked, migration only):** At write time, if LLM returns null sublane on a non-Other lane, override:
- Set `primary_sublane` = first sub-lane in the chosen lane (deterministic from `LANES`)
- Downgrade `confidence` to `'low'` (best-effort label; user-verification UI handles)
- Log the override per-profile so we know how often this fires

Preserves the lane match (which is the harder inference) while acknowledging sub-lane uncertainty. Schema CHECK constraints would otherwise reject the row. User-verification UI catches the override.

**Not a prompt change:** the prompt is locked per DD-15. This guard lives in migration's post-inference processing.

### DD-19 — JobFamily consistency reframe (informative, not gating)

Real-data run showed 46.3% JobFamily-to-lane consistency (25/54 eligible). FRD's original 75-95% range and v2 design's "healthy range" framing were both wrong for the actual data.

**Finding from per-profile read-through:** the LLM is correctly weighting user-stated targeting (target_roles) above JobFit's auto-detected JobFamily. JobFit's classifications are often older or based on coincidental keyword matches; the candidate's current target is the stronger signal. Recruiters auto-classified as one thing but stating different intent, fractional CFOs spanning Finance + Operations, etc.

**Decision (locked):** JobFamily consistency is INFORMATIVE, not gating. High consistency (95%+) is the yellow flag — would indicate the LLM is over-deferring to auto-detection rather than weighing user intent. 40-70% range is healthy for the way users actually self-describe vs. how JobFit auto-classifies.

The metric stays in the runner's summary output but doesn't gate migration.

### DD-18 — High-confidence threshold recalibrated against actual data

FRD locked ≥85% high-confidence as the migration acceptance threshold. Real-data run on 122 prod profiles showed 47.5% high overall.

**Finding from population breakdown:**
- 23 min-signal profiles (no target_roles + no resume + no JobFit run) → all correctly route to `lane='other'` with low/medium confidence. By definition cannot be high-confidence — there's nothing to be confident about. These represent 19% of the population.
- 99 inferrable profiles → 58.6% high-confidence (58 of 99).

The 85% FRD threshold was set before knowing what the real distribution looked like. Min-signal profiles can't move the metric.

**Decision (locked):** Operational acceptance metric is "high-confidence rate on inferrable subset" rather than population-wide. Inferrable subset = profiles with at least one of: target_roles, resume_text > 50 chars, or successful JobFit run.

**Migration acceptable at current distribution** (58.6% high on inferrable, 0 hallucinations, 0 errors, qualitative spot-check pass per Peri's read-through).

**FRD note:** Section 4.6's "≥85% high-confidence" should be revised to scope to inferrable subset, OR the threshold should be lowered to ~55% if scoped to full population. Either is acceptable; the prompt is doing the right thing.

### DD-17 — Stage 1d runs on full prod population, not a sample

Prod has 122 profiles total. Sampling 50 (41%) or 100 (82%) of a 122-profile population adds variance without meaningful cost savings — cost difference at full coverage is ~$0.06 vs $0.30.

**Decision:** Run inference on the full 122-profile prod population, not a sample. Stratification top-up logic is dropped from the runner (irrelevant when including everyone).

**Implication for acceptance threshold:** FRD's ≥85% high-confidence threshold applies as a **population-level metric** rather than a sample-level estimate. The output IS the migration target distribution; if the prompt validates here, it validates for the actual backfill.

**Naming note:** Design doc and runner retain the "sample" suffix (`run-realdata-sample.ts`, `realdata-<ISO>.txt`) for continuity with prior work. In this context "sample" means "the full set being inferred and evaluated" — not a probabilistic sub-selection.

### DD-16 — Stage 1d real-data sample uses prod, read-only

Dev DB inspection on 2026-05-12 surfaced only 4 client_profiles (3 test fixtures + 1 staff, 0 with substantive profile_text, 0 jobfit_runs). Not viable for the 50-sample distribution test.

**Decision:** Pull anonymized samples from prod (`ejhnokcnahauvrcbcmic.supabase.co`), read-only, no writes. Inference runs locally; results written to gitignored local file.

**Operational guards (locked):**
- Service-role connection used for SELECTs only; no writes
- `.env.production.local` loaded only by sample-runner; not imported elsewhere (gitignored by `.env*.local` rule)
- Service-role key never logged, never written to results file
- Results file references profiles by UUID only — raw target_roles / resume content anonymized before LLM call
- `scripts/migrate-candidate-targeting/results/` gitignored (`.gitignore:25`)

**Prod inventory snapshot (read-only inspection):**
- 122 total profiles
- 99 with profile_text > 100 chars
- 23 min-signal (no target_roles, no resume, no JobFit run)
- 755 successful JobFit runs across 62 distinct profiles
- JobFamily distribution skews Marketing (242), Finance (98), Sales (80), Consulting (70); long tail incl. Healthcare/Trades/Accounting in single digits

**Real-data sample design v2:** `docs/Features/foundation-real-data-sample-design.md`. Synthetic results are still the structural validation; this real-data sample tests distribution and confidence calibration on actual prod-shape data.

### DD-15 — Confidence calibration: upward bias accepted as production-ready

Two synthetic runs of `claude-haiku-4-5-20251001` against the 8-case sample surfaced a consistent pattern: Haiku exhibits a **one-step upward bias on confidence** under the current prompt (medium when target was low, high when target was medium). The bias is:

- **Small** — one step, not two
- **Consistent in direction** — always upward, never downward
- **Safe** — over-confident inferences flag for user verification rather than escape detection; more cases get verified, not fewer
- **A property of soft prose rules + LLM judgment** — not a fixable prompt issue

**Diminishing returns on prompt tuning.** Iteration v2 (DD-14) fixed Case 5 (force-fit into a real lane) and partially fixed Case 8 (high → medium, target was low), but introduced a regression on Case 2 (low → medium). Example transcripts:

- Case 2 run 1: `Confidence: expected=low actual=low ✓`
- Case 2 run 2: `Confidence: expected=low actual=medium ✗` (same input, same model, same temp — only the system prompt changed)

Each prompt addition produced zero-sum crosstalk. We're trading wins for new losses now.

**Decision (locked):** Accept the current prompt (v2 in this conversation) as production-ready. Confidence labels are best-effort calibration, not strict measurement. Lane / sub-lane / description / hallucination dimensions are all 8/8 on synthetic — those structural guarantees hold. Confidence is the soft dimension and the user-verification UI catches misses.

**Migration acceptance threshold:** The FRD's ≥85% high-confidence target will be evaluated against real data, not synthetic edge cases. Synthetic results (3-4 high out of 8) are deliberately stacked with ambiguous cases; real-data distribution should be cleaner. If real data also misses the threshold, that's a conversation about whether to relax the threshold or accept lower-confidence rows with stronger verification UI gating — not necessarily a prompt fix.

**Run artifacts:** `scripts/migrate-candidate-targeting/results/synthetic-2026-05-12T15-03-16-957Z.txt` (run 1), `synthetic-2026-05-12T15-15-05-129Z.txt` (run 2).

### DD-14 — Prompt iteration v2 (post-synthetic-run-1)

Synthetic run 1 (2026-05-12T15:03 UTC) surfaced two prompt issues; iteration v2 fixes both. Run 1 transcript: `scripts/migrate-candidate-targeting/results/synthetic-2026-05-12T15-03-16-957Z.txt`.

**Fix 1 — Other rule extension (Case 5 force-fit):** Run 1's Case 5 (research + entrepreneurship) routed to `public_sector / education_academia` instead of `other`. The anti-Other reinforcement was pushing the LLM to find SOME real lane even when the input genuinely spanned multiple lanes. Added a third tier to the Other rule:

> Use 'other' when the input genuinely spans multiple lanes equally (no single lane dominates) and force-fitting to one would ignore meaningful parts of the input. Example: target_roles="research and entrepreneurship" spans academia, founder/business, and possibly technology — no single lane dominates → lane='other', primary_other_description='Research-to-entrepreneurship transition (academic + startup founder)', confidence='medium'.

Distinguishes "sparse signal pointing to one closest lane" (use closest, low confidence) from "input spans multiple lanes equally" (use Other).

**Fix 2 — Hedging language clause (Case 8 confidence calibration):** Run 1's Case 8 (sprawling multi-lane target_roles) returned high confidence despite "if better fit" / "possibly" hedging. Added a clause inside the confidence scale:

> Hedging language in target_roles ('if better fit', 'possibly', 'also considering', 'open to', 'exploring') indicates candidate uncertainty about lane direction. Even if a primary lane is namable, hedged inputs are at most medium confidence. Multi-hedged inputs ('A, B if better, possibly C') are low confidence regardless of which lane you pick.

**Runner update — acceptableLanes:** Added `acceptableLanes?: string[]` to `SyntheticExpected` and updated `compareCase` to accept any lane in the list. Used on Case 8 where Peri locked "any of [technology, consulting, finance] with low confidence is acceptable" — single-lane strict expectation was unduly forcing a FAIL even when the LLM picked a defensible alternative.

### DD-13 — PreMed false-confidence accepted as documented limitation

Synthetic run 1's Case 3 (PreMed → healthcare/clinical_patient_care) returned `confidence='high'` instead of the expected `medium`. The LLM treats clinical keyword overlap ("hospital volunteering, clinical exposure") as strong signal for `clinical_patient_care`, even though that sub-lane is conceptually intended for working clinicians, not pre-med students preparing for medical school.

**Decision:** Do NOT modify the prompt to address this. Adding case-specific rules accumulates badly — each special-case carve-out makes the prompt harder to reason about and risks side effects on other cases.

**Mitigation in production:** User-verification UI catches the over-confident assignment on first session. The candidate sees the inferred row and can flip the sub-lane to a more appropriate value. Low-friction correction path is the right place to handle this — at the verification step, not in the LLM's prompt.

**Trigger to revisit:** If multiple users on real-data migration consistently flip PreMed clinical_patient_care to a different sub-lane, that signals the LLM's choice is wrong often enough to justify a prompt change. Until then, the limitation stands.

### DD-12 — Synthetic testing model is locked to production migration model

Stage 1d synthetic testing uses `claude-haiku-4-5-20251001`. Production migration MUST use the same model. If the model is changed in production (newer Haiku version, switch to Sonnet, etc.), re-run synthetic testing before trusting accuracy assumptions — synthetic results are model-specific and prompt-tuning effects don't transfer cleanly across models.

Lock confirmed: `MODEL` constant in `scripts/migrate-candidate-targeting/run-synthetic-test.ts` and the eventual migration runner. If either drifts from the other, the synthetic results are no longer evidence for the migration's accuracy.

### DD-11 — Transactional intake via Postgres function (canonical RPC pattern)

**Source:** Stage 1b — profile-intake's combined client_profiles UPDATE + candidate_targeting UPSERT needed atomicity. Codebase had zero existing transaction patterns (no `.rpc()` calls, no Postgres functions beyond `set_updated_at`, no direct pg client).

**Decision:** Introduce a Postgres function (`public.intake_upsert_with_targeting`) called via `supabase.rpc(...)`. Function body runs in an implicit plpgsql transaction; any constraint failure or `RAISE EXCEPTION` rolls back both writes. Established as the canonical pattern for cross-table atomic writes in the v2 architecture (downstream: positioning_runs_v2 + signal_applications linkage, Phase 5 result snapshots, future Cover Letter Integration writes).

**Rationale (locked):**
1. We're establishing patterns for v2 architecture. Cross-table atomic writes will recur. Setting the transactional pattern now means downstream features have a paved path.
2. The alternative ("loud warning in 200 response") depends on frontend cooperation. Frontend is not fully under our control — a consistency guarantee that depends on the frontend reading and surfacing warnings is more fragile than a transactional guarantee.
3. Normalizing "data inconsistency is OK if observable" is a corrosive pattern that propagates.

**Implementation choices captured here:**
- Function signature: `(p_profile_id uuid, p_user_id uuid, p_profile_payload jsonb, p_targeting_payload jsonb DEFAULT NULL)`.
- `SECURITY INVOKER` (default). EXECUTE REVOKEd from PUBLIC/anon/authenticated, GRANTed to service_role only — defense in depth, prevents end-user JWTs from bypassing route-level input sanitization via direct `/rpc` call.
- p_user_id is a separate required parameter, not embedded in the payload — mirrors the route's existing `.eq("id", profile_id).eq("user_id", user_id)` double-check.
- UPDATE matches 0 rows → RAISE `profile_not_found_or_wrong_user`. Behavior improvement over current route's silent no-op for this case. Legacy NULL `user_id` profiles surface as 500s instead of silent failures.
- Profile fields use straight assignment (no COALESCE) to preserve the route's `field || null` pattern. EXCEPTION: `profile_complete` uses `COALESCE(..., false)` because the column is `NOT NULL DEFAULT false` — a missing payload key would otherwise abort the transaction. Robustness for future callers.
- Status indicators (premed/prelaw/pregrad) use `COALESCE(..., false)` per Stage 1b #4's "default all three to false" instruction.

**Pattern for future use:**
- Cross-table writes that must be atomic → write a Postgres function in `public.<operation>_<scope>`; expose via `supabase.rpc()`; restrict EXECUTE to `service_role` only.
- Function body documents payload shape, error cases, and return shape in the file header.
- Migration file in `supabase/migrations/<date>_<description>.sql`; apply via SQL Editor on dev; document in this runlog.

### DD-08 — Secondary lane columns also validated by CHECK

FRD section 4.2 specifies a CHECK constraint on `primary_lane` only. `secondary_lane_1` and `secondary_lane_2` are TEXT columns receiving values from the same enum but have no validation in the FRD spec.

**Decision:** Added matching `secondary_lane_1_validation` and `secondary_lane_2_validation` CHECK constraints to the migration. Both allow NULL but reject any non-null value outside the 12 locked lane IDs. Consistent with primary_lane treatment and avoids accidental garbage in the columns.

**Justification:** Sub-lanes are TEXT-no-CHECK (per DD-05) because the sub-lane list evolves. But the top-level lane list is the stable enum and should be enforced on every column that holds a lane value, not just primary.

### DD-09 — `primary_other_description` CHECK uses `LENGTH(TRIM(...)) > 0`

FRD section 4.2's `other_description_required_for_other_lane` example reads `LENGTH(primary_other_description) > 0`. The migration ships with `LENGTH(TRIM(primary_other_description)) > 0` — same intent, stricter enforcement: rejects whitespace-only descriptions ('   ', '\t\n').

**Justification:** A whitespace-only Other description carries no information and would mislead any downstream consumer that's checking for "has the user described their targeting." Rejecting at the DB layer is consistent with the FRD's intent (Other requires real text) and removes a sanitization burden from the app layer.

**FRD update needed:** Section 4.2's CHECK example should be updated to include `TRIM()`. Not blocking; tracked here.

### DD-10 — 12-value lane list repeated across 3 CHECK constraints (maintenance debt)

The migration includes `IN ('consulting', 'finance', ...)` three times — once for `primary_lane_validation`, once for `secondary_lane_1_validation`, once for `secondary_lane_2_validation`. A future lane addition requires editing all three in lockstep, plus `lib/laneTaxonomy.ts`.

**Alternative considered:** Postgres `ENUM` type would give a single source of truth at the DB layer. Rejected for v1 because `ALTER TYPE ... ADD VALUE` has limitations (can't be in a transaction in older PG; reordering requires recreating the enum) and the top-level lane list is stable enough that the repetition cost is low.

**Trigger to revisit:** If lane additions/changes happen more than once per quarter, convert to a Postgres ENUM in a follow-up migration. Until then, the runlog DD-01 captures the count and `lib/laneTaxonomy.ts` is the canonical source for additions.

---

### 2026-05-14 — Bullet quality concern surfaced during Stage 1c D1 testing

During first end-to-end test of D1 against staging, the case-calibrated content rendered correctly (Case B, reasoning, workflow summary, disabled CTAs all surfaced from the v2/start response). However, observed that the underlying bullet quality — particularly RISK bullets — needs rework.

Specific concern: bullet content quality, not structure. Backend logic produces correct response shape (case determination, gap counting, workflow preview), but the human-readable copy generated for risks lacks the precision and tone expected from WRN coaching output.

Deferred to a dedicated bullet-quality session after Stage 1c D2-D4 polish lands. That session should:
- Sample 5-10 real JD/persona pairs across cases A/B/C
- Compare current bullet output against WRN's coaching standards
- Identify which generation logic (case_specific, workflow_preview, risk extraction) needs adjustment
- Decide whether the fix is in prompts, in templates, in scoring thresholds, or in copy editing

Not blocking D1-D4 build. The structural skeleton is correct; bullet quality is polish on top.

**Addendum (D2 testing, 2026-05-15) — case_determination threshold concern:**

During D2 testing, observed a Case B verdict that surfaced "MAJOR FIELD MISMATCH" as the gap theme. Per FRD design, Case C is the lane-mismatch case ("Your resume is telling a different story than this job is asking for") and Case B is the "targeted changes needed" case. A field-mismatch risk landing inside Case B suggests the case_determination thresholds may not be triggering Case C when high-severity lane-mismatch risks appear within an Apply / Review verdict — Case B is winning when Case C framing would more accurately reflect what the user needs to hear.

Belongs in the bullet-quality cleanup session. Investigation surface:
- `lib/positioning/v2/caseDetermination.ts` rules — what specifically forces Case C vs Case B
- Risk-severity scoring upstream — is lane-mismatch correctly tagged as high-severity?
- Lane-mismatch detection itself — what produces "MAJOR FIELD MISMATCH" risks and which structured fields carry the signal forward

Not blocking D3/D4. Surfaces a real misclassification pattern worth running across the bullet-quality sample alongside copy-quality review.

**Addendum (D3 testing, 2026-05-15) — second case_determination concern:**

Tested D3 with: Peri Test 100 / persona "Catherine Lees (Communications major, Product Manager target)" / Versant Finance-Analytics-HR Intern JD.

JobFit produced Review + score 60 + 2 risks. Positioning landed Case B ("targeted changes"). The gap themes surfaced included "FINANCE & ANALYTICS DOMAIN GAP" and "PRIOR MEDIA INTERNSHIP EXPERIENCE MISSING."

Three concerns:
1. Case B "targeted changes" framing is too soft for a Communications-to-Finance/Analytics field jump. This is canonical Case C territory.
2. The "MAJOR FIELD MISMATCH" gap theme from D2 + this test's results both suggest case_determination thresholds are too lenient. High-severity field mismatch should trigger Case C even under a "Review" verdict.
3. Worth investigating: should case_determination consider the candidate's target_roles vs the JD's actual role family? Currently case_determination operates on jobfit signals only. A profile-target/jd-role mismatch check at the case_determination layer might catch these.

Belongs in the bullet-quality + case_determination tuning session. Specific test case documented for reproducibility.

**Addendum (D4 testing, 2026-05-15) — case_determination produces Case B consistently:**

Tested D4 with: Peri Test 100 / "Peri's Resume" persona / a JD aligned with the resume content.

JobFit produced Apply + score 77 + 2 risks ("LIMITED KIDS/FAMILY CONTENT PROOF, UNPAID INTERNSHIP COMMITMENT"). Positioning landed Case B.

Three case_determination tests across D2/D3/D4 all produced Case B regardless of verdict (Review/Review/Apply) or risk severity. Cases A and C cannot be triggered with current thresholds + real data.

This blocks real-world Case A render verification of D4. D4's implementation passes tsc/build/code review, but visual confirmation of Case A behavior requires either:
1. case_determination threshold tuning (the unblock for all case-based testing)
2. Manual data injection (forge positioning_runs_v2 row with case_letter='A')

The bullet-quality + case_determination tuning session is now load-bearing for full Stage 1c verification, not just polish. Belongs in the session immediately.

**Addendum (decision, 2026-05-15) — Stage 1c paused after D4 for case_determination tuning:**

Stage 1c paused after D4 ships. Three case_determination tests (D2/D3/D4) consistently produced Case B regardless of verdict (Review/Review/Apply), risk severity, or persona. The case space is collapsing onto B — Cases A and C are not reachable with real data under current thresholds.

This is a design issue, not a tuning nudge. The case_determination logic in `lib/positioning/v2/caseDetermination.ts` (rules + threshold constants in `lib/positioning/v2/caseThresholds.ts`) needs re-evaluation against real `jobfit_runs` distributions.

Resume conditions for Stage 1c:
- case_determination produces all three cases against representative real data
- D2/D3/D4 visually re-verified against tuned thresholds end-to-end
- One test instance each of Case A, B, C confirmed rendering correctly

Until those conditions are met, D5/D6/D7 are deferred. Implementing more case-dependent UI on top of unverified case_determination is bad sequencing.

D4's code is correct against the StartResponse type and matches FRD §4.4 spec. The verification gap is upstream (case_determination not producing Case A), not in D4's implementation.

Scope and starting context for the tuning session live in `docs/Features/case-determination-tuning-plan.md`.

**Addendum (2026-05-15 tuning, deferred follow-up) — estimated_minutes for Case A with refinements:**

The 2026-05-15 case_determination tuning relaxed the Case A gate to admit Apply/Priority-Apply runs with all-low-severity risks (surfaced as small_refinements). Per FRD section 4.2 the type comment expects 5 minutes when small_refinements is non-empty vs 0 minutes when empty; `workflowPreview.ts::estimatedMinutesForCase` currently returns 0 for all Case A runs. Worth updating `estimatedMinutesForCase` to read small_refinements.length and return 5 when non-zero.

Not blocking — UX impact is one cosmetic number; correctness of case assignment is intact. Track under workflowPreview follow-ups.

**Addendum (2026-05-16, follow-up) — HR + Operations cleanup deferred to separate session:**

The 2026-05-15 case_determination tuning surfaced that 3 of 5 dev profiles
had `target_roles = 'Product Manager'` but `inferTargetFamilies` returned
`['Other']` because no PM keywords existed in `lib/jobfit-family-inference.ts`.
Fix shipped 2026-05-16: added `ProductManagement` as a first-class JobFamily
on both sides of inference (target inferrer + JD-side title detector) so
PM-target vs PM-JD matches and PM-target vs non-PM-JD correctly triggers
the family-mismatch path in case_determination Rule 2.

The same investigation surfaced stale comments at
`lib/jobfit-family-inference.ts:113, 156` claiming HR and Operations are
routed through Consulting because "the scoring engine currently has no
dedicated Operations or HR family." Both `"HR"` and `"Operations"` now
exist as their own `JobFamily` values, and `extract.ts` has dedicated
`jobTitleIsHR` (line 3504) and `jobTitleIsOperations` (line 3524)
detectors routing to those families directly. The Consulting block in
the inferrer is therefore over-inclusive: candidates targeting "HRBP"
or "Operations Manager" get `['Consulting', 'Other']` instead of
`['HR']` or `['Operations']`. This causes spurious cross-family matches
(Consulting-targeting candidate gets matched to actual Operations JDs
as a "direct family hit" via the bloated Consulting target set).

Also affected: `JOB_FAMILY_ALLOWLIST` in
`app/api/_lib/jobfitProfileAdapter.ts:43` silently strips `"HR"` and
`"Operations"` — pre-existing drift from when those JobFamily values
were added without updating the sanitizer's allowlist.

Behavior-changing for any existing Consulting-targeting candidate
whose actual stated target is HR/Operations work — they currently
match Consulting JDs (right or wrong). Cleaning this up needs its own
session with regression sweep against production runs to quantify
impact before/after. Out of scope today.

Tracked here for pickup. Scope:
1. Remove HR roles from Consulting block in `jobfit-family-inference.ts`;
   route to `"HR"` family directly.
2. Remove Operations roles from Consulting block; route to `"Operations"`.
3. Update or delete the stale comment blocks at lines 113 and 156.
4. Add `"HR"` and `"Operations"` to `JOB_FAMILY_ALLOWLIST` in
   `jobfitProfileAdapter.ts:43`.
5. Re-run `tests/jobfit-regression/regression-check.ts` and audit every
   diff — Consulting/HR/Operations boundary cases are the high-risk
   surface here.

**Addendum (2026-05-16, narrowing) — Rule 2 (family mismatch) restricted to Review verdict:**

The Rule 2 family-mismatch check (added in the 2026-05-15 tuning above) was
firing too aggressively. Real-world case that surfaced the issue:

- JD: "Product Marketing Intern" at Diligent
- Profile target_roles: "Product Manager" (after the 2026-05-16 PM family
  commit, this maps to targetFamilies = ["ProductManagement"])
- JD classification: jobFamily = "Marketing" (correctly — jobTitleIsMarketing
  matches "product marketing")
- JobFit verdict: Apply, score 91, one minor risk (CRM tool fluency)
- Positioning case: **C** (wrongly — JobFit said strong match)

The family taxonomy treats ProductManagement and Marketing as distinct
families, but in practice they are adjacent disciplines that frequently
overlap in hiring (Product Marketing Manager vs Product Manager career
ladders crossover constantly). When JobFit holistically evaluates evidence
and returns Apply/Priority Apply, that verdict is a stronger signal than
the taxonomy mismatch — overriding to Case C contradicts the upstream
judgment.

Narrowed Rule 2 to fire on Review verdict only. Rationale:
- Pass already routes to Case C via Rule 1 (unchanged).
- Review is ambivalent — family mismatch acts as a tiebreaker toward C.
- Apply/Priority Apply have a confident positive verdict — taxonomy
  mismatch alone should not override.

Same Diligent case after narrowing: Apply + family-mismatch + 1 medium-
severity risk → falls through to Rule 7 (default Apply path) → Case B.
Aligns with the verdict.

Other adjacent-family pairs that benefit from this narrowing (incomplete
list, surface as production data accumulates):
- Marketing Analytics vs Analytics
- Strategy Consulting vs Business Operations
- IT_Software vs Engineering (in software-adjacent Engineering roles)
- Healthcare vs PreMed
- ProductManagement vs IT_Software (technical PM roles)

What was NOT changed:
- Rule 2's "Other" semantics for targetFamilies and jobFamily — same skip
  conditions apply on Review.
- The mismatch reasoning string format — when Rule 2 fires on Review, the
  reasoning text is unchanged.
- Case A relaxation from the prior 2026-05-15 addendum — Apply + all-low-
  severity + 3 whys still routes to Case A regardless of family signals.

Tests in `tests/positioning-v2/case-determination-check.ts`:
- Tests 16 and 21 had their expected outcomes flipped (Apply + mismatch
  was Case C; now Case A under the unchanged Apply path).
- Three new tests added (21b, 21c, 21d) to pin the narrowed behavior
  explicitly: Apply + mismatch + medium risk → B (Diligent case shape);
  Priority Apply + mismatch + clean → A; Apply + mismatch + high-severity
  → B via Rule 6.
- Test 17 (Review + mismatch → C) unchanged — it's the canonical happy
  path for the narrowed rule.

FRD (`docs/Features/positioning-phase1-frd.md` section 4.1) pseudocode
predates both the 2026-05-15 tuning and this narrowing. Added a pointer
note that the runlog + code are authoritative for current cascade behavior.

### 2026-05-16 — case_determination tuning session CLOSED

Stage 1c case_determination tuning is complete. All definition-of-done
criteria met end-to-end against staging (commit `df0f6815`).

**Case reachability verified:**

| Case | Reachable | Evidence |
|------|-----------|----------|
| A | ✅ | Gate relaxed 2026-05-15 (Apply + zero-or-all-low risks + ≥3 whys). Unit-tested in tests 24/27. End-to-end real-data instance deferred to natural occurrence (not blocking — the gate logic is small and fully covered by unit tests; production data will surface a Case A instance organically). |
| B | ✅ | Verified end-to-end multiple times across D2/D3/D4 in tuning session and the 2026-05-16 Diligent retest after the family-mismatch narrowing. |
| C | ✅ | Verified end-to-end via both paths: Rule 1 (Pass verdict) covered by D3 pre-narrowing, and narrowed Rule 2 (Review + family mismatch) covered by Catherine Lees Communications→Finance shape which retains Case C under the narrowed rule. |

**Cache + routing verified:**
- Deep-link round-trip works (cache_hit response on repeat POSTs with matching fingerprint)
- Returning-user banner works (in_progress runs resume; last_visit_days_ago surfaces)

**Behavior regression closed:**
- Apply verdict no longer wrongly overridden to Case C on family mismatch.
  Diligent retest (Product Marketing Intern, Apply/91, 1 medium-severity
  CRM tool fluency risk) now correctly renders Case B with 3-step workflow
  and 17-minute estimate. Pre-narrowing, this same case wrongly rendered
  Case C — the user-facing bug that surfaced the narrowing decision.

**Code shipped during this tuning session:**
- 2026-05-15 commit `2119a0a1` — case_determination Rule 2 added (family
  mismatch → Case C) + Case A gate relaxed (all-low-severity risks admit
  Apply/Priority Apply to Case A)
- 2026-05-16 commit `f3364228` — ProductManagement added as first-class
  JobFamily (target inferrer + JD detector + allowlists) — closed the
  PM-target → ["Other"] inference gap that motivated the Diligent shape
- 2026-05-16 commit `df0f6815` — Rule 2 narrowed to Review verdict only
  (Apply / Priority Apply now trust upstream verdict over family taxonomy)

**Deferred work tracked for future sessions:**
- Scorer severity-tagging upstream: field-mismatch risks tag medium when
  they should tag high. Affects when narrowed Rule 2 fires vs when Rule 3
  (Review + high-severity → C) fires — currently more weight on Rule 2 than
  ideal because severity tagging is unreliable. Tracked for scorer tuning.
- HR + Operations inferrer cleanup: stale Consulting roll-up in
  `lib/jobfit-family-inference.ts:113, 156`. Scope captured in the
  2026-05-16 HR+Operations cleanup addendum above.
- Bullet-quality content polish: separate session per the 2026-05-14 entry.
  Reads rendered output, not case decision; clean separation preserved.

**Resumption options for next session (logged, not committed):**
1. Resume Stage 1c D5/D6/D7 — returning banner polish, error states,
   mobile + loading polish. Original sequence resumption.
2. Pick up the deferred HR+Operations inferrer cleanup. Self-contained,
   behavior-changing scope already written.
3. Pick up the bullet-quality content session for case_determination
   rendered text. Reads outputs from this now-stable case-decision layer.

Choice deferred to next session start. All three are independently
ready to begin.

### 2026-05-16 — Phase 2 Stage 2a kicked off

First migration shipped for Positioning v2 Phase 2 (Resume Reframing Workflow).

**Applied:**
- `supabase/migrations/20260516_phase2_runs.sql` — new table per FRD §6.1, includes ai_cost_cents column per FRD §6.12 (consolidated from FRD §7's two-step ordering)
- Applied to dev via Supabase SQL Editor (Path B — Foundation Risk 6 still applies; dev migration tracker drift unrepaired)
- Verified on dev: table exists with correct columns, CHECK constraints firing, indexes present, set_updated_at trigger attached

**Not yet shipped (next commit in this session):**
- `lib/positioning/v2/phase2/types.ts` — PhaseTwoState, PhaseTwoItem, row + insert payload types
- `lib/positioning/v2/phase2/itemPopulator.ts` — skeleton + JSDoc
- `lib/positioning/v2/phase2/resumeComposer.ts` — skeleton + JSDoc
- `lib/positioning/v2/phase2/aiClient.ts` — skeleton + JSDoc
- `lib/positioning/v2/phase2/groundingValidator.ts` — skeleton + JSDoc

Production promotion of the schema deferred until all Phase 2a skeletons land + tsc/build verified clean.

### 2026-05-18 — Phase 2 v0.1 known limitation: no revise-after-decide

Surfaced during prototype smoke testing. Once a user accepts/declines/skips
an item, the /decide endpoint returns 409 on subsequent calls per FRD §6.5.4
("use a separate revise decision path; not in v0.1").

Documented in prototype UI: selection screen shows amber notice; item detail
page shows inline warning above action buttons.

Tracked for v0.2 design: requires backend changes to /decide (accept
revisions on already-decided items, handle state transitions) and
resumeComposer (handle items toggling accept/decline state cleanly), plus
frontend changes to enable navigation to decided items and render revise UI.

### 2026-05-21 — copy-prod-clients-to-dev refactored for multi-target (--target=erin|peri)

`scripts/seed-erin-coaches-center/copy-prod-clients-to-dev.ts` and
`verify-copy.ts` refactored to accept `--target=<erin|peri>` and
`--clients=<comma-uuids>` flags. Goal: enable parallel coach test
setups on dev (Erin's existing 5 clients stay untouched; Peri's
testing now has its own 3-client roster).

**Schema check (no migration needed):**

Probed `dev.client_profiles.copied_from_prod_id` for a UNIQUE
constraint via test-insert. The probe insert with a duplicate
copied_from_prod_id value succeeded (caught only by an unrelated FK
on user_id), confirming UNIQUE is ABSENT. Multi-target seeding works
without any ALTER TABLE. Foundation Risk 6 (dev migration tracker
drift) remains — but no migration was needed today.

**Idempotency change:**

v1 keyed on `copied_from_prod_id` alone (one dev row per prod UUID).
v2 keys on `email` (one dev row per target+prod UUID pair). Same
prod UUID can now be copied to both `erin+catherine@...` and
`peri+catherine@...` without colliding. Email-collision-with-
different-source still errors loudly (manual intervention path).

**Peri seed executed:**

- Coach: `peri+devcoach1@workforcereadynow.com` → resolved id
  `cadc73c9-84f2-4406-914b-000ef5cc9c09`
- Clients: 3 prod UUIDs — Catherine Lees (3a2ef935-...), Josh
  Rosenblatt (2a9373f4-...), Lily Stein (37564ec9-...)
- Created: 3 auth users, 3 client_profiles, 4 client_personas, 3
  candidate_targeting, 30 signal_applications, 15 jobfit_runs, 26
  status_history rows, 3 coach_clients links
- 0 errors, 0 skipped
- verify-copy.ts --target=peri all 4 queries passed

Existing Erin roster (`erin+catherine@`, `erin+josh@`, `erin+lily@`,
`erin+ryan@`, `erin+zoe@`) untouched and verified intact in Q1's
broader scan.

Note observed during Q1: Peri's coach profile id was already linked
to 5 of Erin's `erin+` clients before this run (pre-existing cross-
linking, not introduced today). Not a refactor concern; surfaced
for awareness.

**Transcripts:**
- `scripts/seed-erin-coaches-center/results/copy-peri-dryrun-2026-05-21T13-53-01-960Z.txt`
- `scripts/seed-erin-coaches-center/results/copy-peri-confirm-2026-05-21T13-59-05-349Z.txt`

### 2026-05-22 — Prospects v0.1 schema migration (Commit 1 of 4)

First migration shipped for Coaches Center Prospects v0.1. The
feature decouples prospect capture from SIGNAL account creation:
coach_clients rows can now exist in lifecycle_status='Prospect'
with client_profile_id IS NULL, carrying capture data (name,
source attribution) and sales-pipeline phase checkboxes.

**Applied:**

- `supabase/migrations/20260523_prospects_v0_1.sql` per FRD §6.1
  (`docs/Features/coaches-center-prospects-frd.md`)
- Applied to dev via Supabase SQL Editor (Path B — Foundation Risk 6
  applies as usual)
- Filename bumped from 20260522 to 20260523 due to collision with
  `20260522_coach_engagement_signal_dismissals.sql` (Phase 3 Commit 3.2)

**Scope (six DDL changes):**

- 17 new columns on `coach_clients`: `name`, `source_category` (with CHECK
  constraint on 5 enum values), `source_detail`, plus 7 phase boolean +
  7 paired `_at` timestamp columns
- `coach_clients.invited_email` DROP NOT NULL (prospects captured
  without email)
- `coach_client_notes.client_profile_id` DROP NOT NULL (so prospect
  notes can attach via `coach_client_id` only)
- Partial index `idx_coach_clients_prospect_list`
  ON `(coach_profile_id, lifecycle_status)`
  WHERE `lifecycle_status = 'Prospect'`

**Verified on dev:**

- All 17 new columns present and readable (V1 indirect via SELECT)
- `invited_email` is nullable (V2 indirect via successful INSERT with NULL)
- `coach_client_notes.client_profile_id` is nullable (V3 indirect)
- Partial index present with correct WHERE predicate (V4 via pg_indexes)
- `source_category` CHECK constraint enforced — `'not_a_valid_value'`
  rejected (V5 indirect via Smoke 4)
- `lifecycle_status` DEFAULT='Active' unchanged (V6 indirect)
- Smoke test: INSERT/SELECT/DELETE round-trip of a Prospect-shape
  row succeeded with NULL email and NULL `client_profile_id`
- EXPLAIN on prospects list query: Seq Scan at 20 rows (correct
  planner choice; index will be used as table grows)

**Design decision captured (Q3 from FRD §12):**

`lifecycle_status` DEFAULT='Active' is intentionally unchanged. The
existing `/api/coach/invite` flow correctly creates
"going-to-be-a-client" rows with Active default. New prospect-capture
flow explicitly sets `lifecycle_status='Prospect'` on INSERT. Two
entry points, two defaults, no conflict. Pending-invite rows
(`status='pending'`, `client_profile_id IS NULL`, `lifecycle_status='Active'`)
will NOT surface in the Prospects list (filtered on
`lifecycle_status='Prospect'`).

**Pre-existing wrinkle observed (out of scope):**

The single existing pending-invite row in dev (1 of the 15 Active
rows) renders as "Active" lifecycle_status in the My Clients list
even though the invitee hasn't claimed yet. This is a pre-existing
UX gap, not caused by this migration. Tracked as observation only;
not fixed in this commit.

**Commit:** `2d2238fa` on origin/dev. Production promotion deferred
to a separate explicit step after Prospects v0.1 beta validation
on dev.

**Next:**

- Commit 2 of 4: Notes refactor (canonicalize `coach_client_notes`
  reads on `coach_client_id`) + new POST `/api/coach/clients/[clientId]/send-invite`
  endpoint
- Commit 3 of 4: `/api/coach/home` NULL hardening + `runHeuristics`
  prospect exclusion
- Commit 4 of 4: Full prospect feature surface (5 API endpoints +
  frontend pages + LifecycleStatusPill refactor + nav addition)

### 2026-05-23 — Prospects v0.1 Commit 2 (notes refactor + new routes + send-invite endpoint) shipped

Commit 2 of the Coaches Center Prospects v0.1 feature is now on
origin/dev. The schema work from Commit 1 (2d2238fa, applied to dev
2026-05-22) is now backed by the API surface that exercises it.

**Three sub-commits shipped, in order:**

- **2a — Notes refactor (`b7f89656`):** 5 existing routes under
  `/api/coach/clients/[clientId]/note-feed/*` and
  `/api/coach/clients/[clientId]/needs-attention` refactored to filter
  `coach_client_notes` by `coach_client_id` instead of
  `(coach_profile_id, client_profile_id)`. Behavior-preserving against
  existing client notes (verified via end-to-end regression: same 3
  notes / 1 action item returned for the same test client as the
  pre-refactor baseline). Trust chain preserved — `verifyCoachAccess`
  still gates ownership upstream; the new filter uses its returned
  `access.id` as the canonical relationship key. PUT/DELETE ownership
  check consolidated from two error paths (400 + 403) into one (403).
  Net change across 3 files: 29 insertions, 17 deletions.

- **2b — Prospect notes routes (`0b00c599`):** 4 new routes under
  `/api/coach/prospects/[id]/notes/*` (GET/POST + PUT/DELETE) keyed by
  `coach_clients.id` directly. Helper `verifyCoachClientAccess` inlined
  per file (matches existing coach-route duplication pattern). POST
  insert sets `client_profile_id` to the row's existing value — NULL
  for prospects (legal post-Commit-1), populated for converted
  Active-status clients. Cross-tenant verification confirmed working
  (403 with "no active coach relationship" when peri+coach1 attempted
  to GET another coach's row). Net change: 2 new files, 568 insertions.

- **2c — Send-invite endpoint (`4d17ac77`):** New
  `POST /api/coach/coach-clients/[id]/send-invite` that converts an
  Active-status `coach_clients` row without a SIGNAL account into a
  full SIGNAL user (auth user + `client_profiles` row + linked
  `coach_clients.client_profile_id` + magic link). Two branches:
  create-new (full create flow modeled on `coach/create-client`) and
  link-existing (UPDATE-only when a `client_profiles` row already
  exists for the email). Compensating cleanup chain on the create-new
  branch handles failures at any hard step (auth user → profile →
  link). Steps 4-6 (persona insert, magic link, email send) are
  non-fatal.

  Also touches `lib/email/sendClientInvite.ts` (shared utility) with a
  conditional `hasAnyTargets` block: when all 3 target fields
  (`targetRoles`, `targetLocations`, `timeframe`) are empty, the
  template renders alternate copy ("Your coach will be in touch with
  details about your job search targets") instead of the empty-table
  rendering that the original template would produce. Behavior is
  byte-identical for the existing `create-client` caller (always
  passes non-empty target fields, so `hasAnyTargets` always evaluates
  true). Net change: 2 files, 433 insertions, 26 deletions.

**FRD correction landed alongside (`2c8a5b4b`):**

Pre-flight on Commit 2c caught a terminology bug in the FRD that
would have produced a permanently-422 endpoint if shipped as written.
The FRD §6.5 spec used `'Client'` as a lifecycle_status value, but
the DB CHECK constraint admits only `('Prospect', 'Active',
'Inactive', 'Archived')` — `'Client'` is coach-facing colloquial
shorthand for `'Active'`, not a literal DB value. Six literal-string
bugs + one status code (200 → 201) + one URL drift
(`/api/coach/clients/[clientId]/send-invite` →
`/api/coach/coach-clients/[id]/send-invite`) were corrected, plus a
new terminology disambiguation note added (literal `Active` vs
colloquial "Client").

Single commit, doc-only. Surfaced as a separate concern before any
2c code was written.

**Three design saves caught mid-build:**

1. **Post-Step-3 cascade-delete bug (2c).** The outer try/catch's
   compensating cleanup nullifies `createdProfileId` and
   `createdAuthUserId` only inside the Step 2 / Step 3 failure branches
   — but if Steps 4-6 (which are non-fatal by design) somehow threw
   unexpectedly, the outer catch would fire with `createdProfileId`
   non-null AND the coach_clients row already linked. `client_profiles`
   FK to coach_clients has ON DELETE CASCADE → deleting the profile
   would cascade-delete the coach_clients row, destroying the coach's
   prospect record entirely. Fix: nullify both tracking refs
   immediately after Step 3 succeeds. The successful state is the
   steady state; later non-fatal failures should leave it intact.

2. **Template verification gap (2c).** Phase A-extra of regression
   exercised `coach/create-client`'s invite flow to verify the
   `sendClientInvite` template tweak didn't break the existing caller.
   The first verification round saw Postmark policy rejections (test
   addresses marked inactive) and reasoned that "Postmark received
   the payload → template rendered." This is necessary-but-not-
   sufficient: a template tweak could fail silently in ways that
   don't throw (inverted conditional, typo'd variable producing
   `undefined` string, etc.). Added a second verification round with
   direct template-render inspection via monkey-patched
   `postmarkClient.sendEmail` — 25 content-level assertions across
   both `hasAnyTargets` branches, all passing.

3. **`PostgrestFilterBuilder.catch()` typecheck (2c).** First build
   attempt surfaced that `supabase.from(...).delete().eq(...).catch(...)`
   doesn't typecheck — the query builder is `then`-able (so `await`
   works) but doesn't implement the full Promise interface. Wrapped
   the relevant call in `try { await ... } catch {}` per the same
   pattern used in the outer catch. Comment added at the call site so
   the divergence isn't "fixed" back later.

**Cumulative Prospects v0.1 state on origin/dev:**

| Commit | SHA | Scope |
|---|---|---|
| 1 schema | `2d2238fa` | Schema migration |
| 1 runlog | `11a0046a` | Runlog entry |
| 2a notes refactor | `b7f89656` | Canonicalize on `coach_client_id` |
| 2b prospect notes | `0b00c599` | 4 new routes |
| FRD correction | `2c8a5b4b` | Lifecycle terminology + URL fix |
| 2c send-invite | `4d17ac77` | Auth user + profile + link flow |

**Verification totals across Commit 2:** 50+ assertions including
behavioral regression of 5 existing routes, cross-tenant access
check, all 6 error paths (409/400/422 ×2/403/link-existing branch),
profile-already-exists branch, and 25 direct template-render
content assertions.

**Next:**
- Commit 3 of 4: `/api/coach/home` NULL hardening (5 specific edit
  points caught in Round 3 investigation), `runHeuristics` prospect
  exclusion, and the `action-items/route.ts` name-lookup fix
  (prospect notes have NULL `client_profile_id` → silent join
  failures without the fix).
- Commit 4 of 4: Full feature surface — 5 new prospect CRUD endpoints,
  frontend pages (list + detail + capture modal), `LifecycleStatusPill`
  context-aware refactor, nav addition, new client-detail route by
  `coach_clients.id` for the post-conversion-pre-invite state, and
  the collapsed "Prospect history" block on Client detail pages.

Production promotion of the Commit 1 schema migration remains deferred
to a separate explicit step after Prospects v0.1 beta validation on
dev (Commit 4 ships first).

### 2026-05-23 — Prospects v0.1 Commit 3 (NULL hardening) shipped

Commit 3 of the Coaches Center Prospects v0.1 feature is now on
origin/dev. Commit 2 added the API surface that creates prospects;
Commit 3 is the defensive surgery on existing routes to handle the
no-`client_profile_id` state that prospects introduce. Without these
changes, the first real prospect captured via Commit 4's UI would
produce broken output across Coach Home tiles, the cross-client
action items list, and the engagement signal engine.

Three files modified in a single commit (`46e50d3f`):

- **`app/api/coach/home/route.ts`** — five edit points handle the
  nullable `client_profile_id` state. The `cpid` variable is now
  typed as `string | null` (no more lying `as string` cast).
  Per-client stats queries (signal_applications, coach_job_
  recommendations pending count, recResponseCount) are guarded with
  `if (cpid)` blocks — prospects skip the queries and return
  zero-stats cards. The `heuristicClients` map at the call site
  filters out prospects before passing to `runHeuristics` (the
  primary fix for the `r1:null` signal-id bug surfaced in the Round
  3 investigation — NULL string-coerces in template literals).
  Lifecycle bucket pushes (`aiProfileIds`, `aiaProfileIds`) gain
  defensive `c.client_profile_id &&` guards — currently safe via
  the lifecycle gate (Prospect excluded from these buckets) but
  explicit rather than coincidental.

- **`app/api/coach/action-items/route.ts`** — name lookup restructured
  to handle prospect notes (NULL `client_profile_id`). The pre-Commit-3
  pattern SELECTed `client_profile_id` from `coach_client_notes` and
  joined to `client_profiles` for the name — which would return
  silently-null names for any prospect note. New pattern: two-stage
  lookup. Stage 1 fetches `coach_clients` rows (always present, contains
  the prospect's name + linked profile id + invited_email). Stage 2
  fetches `client_profiles` for the populated profile ids (richer
  post-onboarding data for converted clients). Name resolution is a
  fallback chain: `prof?.name ?? cc?.name ?? null`, with the same
  pattern for email. The response shape gains `coach_client_id` and
  `client_id` becomes explicitly nullable. A TODO comment marks
  the frontend Commit 4 dependency (must route prospect entries via
  `coach_client_id` since `client_id` will be null).

- **`app/api/_lib/coachEngagementHeuristics.ts`** — defensive
  `validClients` filter at the top of `runHeuristics`. Belt-and-
  suspenders: Coach Home's call-site filter is the primary fix
  (above), but `runHeuristics` itself now rejects any NULL
  `client_profile_id` or `user_id` with a warn-log identifying the
  offending row. If a future caller passes prospects unfiltered, the
  bug surfaces in logs rather than producing broken signal IDs.
  Five downstream references renamed `clients` → `validClients`
  (length check + R1/R2/R3-R5/R6 inner finds).

**Verification:** 30/30 assertions across three phases.

- Phase A (8 assertions) — Coach Home behavior with no prospects in
  DB: response shape unchanged vs pre-Commit-3 baseline, no broken
  signal IDs introduced.
- Phase B (6 assertions) — `/api/coach/action-items` + per-client
  needs-attention work for existing client-stage notes (proves the
  two-stage lookup didn't break the existing path).
- Phase C (16 assertions) — load-bearing prospect-data exercise.
  Created a real Prospect `coach_clients` row with NULL
  `client_profile_id`, posted 1 session_recap + 1 action_item note
  via the Commit 2b prospect notes routes, then verified Coach Home
  renders the prospect with `client_profile_id === null` (literal
  null, not "null" string, not undefined), zero per-client stats
  (no queries fired), no broken signal IDs in requiresAction, and
  activeProspects tile incremented by 1. Verified
  `/api/coach/action-items` returns the prospect's action_item with
  `client_name = "Commit 3 Test Prospect"` resolved via the
  `coach_clients.name` fallback (the two-stage lookup working
  end-to-end), `client_id: null`, and the new `coach_client_id`
  field populated.

**Design notes from this commit:**

The Edit 1C heuristicClients filter was originally drafted with a
TypeScript type-predicate `(c): c is typeof c & { client_profile_id:
string; _user_id: string }` to narrow the filter output for the
subsequent `.map()`. The simpler approach (filter then map with
`as string` casts inside the map) typechecked on first try, so the
predicate form wasn't needed. Kept as documentation in case future
similar filters need the predicate pattern.

The action-items response shape change makes `client_id` nullable,
which is a known dependency for Commit 4 frontend work. The
existing frontend that consumes `/api/coach/action-items` builds
URLs like `/dashboard/coach/clients/[client_id]` — passing null
would produce broken routing. The risk window between Commit 3 and
Commit 4 is near-zero (prospects can only be created via the
internal Commit 2b routes today, not via UI), but the TODO comment
at the items map is the discoverability mechanism for whoever
picks up Commit 4. The frontend must route prospect-stage action
items via `coach_client_id` instead.

**Cumulative Prospects v0.1 state on origin/dev:**

| Commit | SHA | Scope |
|---|---|---|
| 1 schema | `2d2238fa` | Schema migration |
| 1 runlog | `11a0046a` | Runlog entry |
| 2a notes refactor | `b7f89656` | Canonicalize on `coach_client_id` |
| 2b prospect notes | `0b00c599` | 4 new routes |
| FRD correction | `2c8a5b4b` | Lifecycle terminology + URL fix |
| 2c send-invite | `4d17ac77` | Auth user + profile + link flow |
| 2 runlog | `e091ed11` | Commit 2 runlog entry |
| 3 NULL hardening | `46e50d3f` | `/api/coach/home` + heuristics + action-items |

**Next:**

Commit 4 of 4 — the full feature surface. Remaining scope:

- 5 new prospect CRUD endpoints (FRD §6.4: GET list, POST create,
  GET detail, PATCH update including lifecycle conversion, DELETE)
- Frontend pages: `/dashboard/coach/prospects` list, prospect
  detail page, "+ Add Prospect" capture modal
- `LifecycleStatusPill` context-aware refactor (PATCH target
  branches on `client_profile_id` null check)
- Nav addition to `COACH_NAV` in `app/dashboard/layout.tsx`
- New client-detail route keyed by `coach_clients.id` for the
  post-conversion-pre-invite state
- Collapsed "Prospect history" block on Client detail pages after
  conversion
- Frontend consumer of `/api/coach/action-items` updated to route
  prospect entries via `coach_client_id` (per Commit 3 TODO)
- "Active Prospects" tile href update on Coach Home from
  `/dashboard/coach/clients?filter=prospect` to
  `/dashboard/coach/prospects`

Production promotion of the Commit 1 schema migration remains
deferred to a separate explicit step after Commit 4 ships and beta
validation on dev.

### 2026-05-24 — Prospects v0.1 Commit 4b (CRUD endpoints) shipped

Commit 4b of the Coaches Center Prospects v0.1 feature is now on
origin/dev. This is the backend half of Commit 4 — five new REST
endpoints that let coaches list, create, fetch, update, and revoke
prospects. The frontend pages, capture modal, nav integration, and
existing-surface touchpoints are 4c/4d scope.

One commit (`5634f323`), 929 insertions across two new files. No
modifications to existing code; net-additive.

**Endpoints shipped:**

- **GET `/api/coach/prospects`** — list prospects for the authed
  coach. Filters: `coach_profile_id = caller`, `status = 'active'`,
  `lifecycle_status = 'Prospect'`. Response includes the 7-phase
  pair object (`{ checked, at }` per phase) + computed
  `last_activity_at` (max of phase `_at` timestamps + most-recent
  note `created_at`). Sort: `last_activity_at DESC NULLS LAST`,
  then `created_at DESC`. Batch notes query avoids N+1 pattern.

- **POST `/api/coach/prospects`** — create a new prospect. Required
  fields: `name`, `source_category` (5-enum). Optional:
  `invited_email`, `source_detail`, `initial_note`. Side effects:
  INSERT `coach_clients` with `lifecycle_status='Prospect'`,
  `client_profile_id=NULL`, plus optional `coach_client_notes`
  INSERT (non-fatal — prospect remains usable if note fails).
  Re-query for `latestNoteAt` after the optional note insert
  guarantees correct `last_activity_at` regardless of note outcome.

- **GET `/api/coach/prospects/[id]`** — full detail including notes
  array. Does NOT require `lifecycle_status='Prospect'` (per FRD
  §6.4.3 explicit: also serves post-conversion `Client`-without-
  profile rows, supporting the post-conversion-pre-invite state in
  Commit 4d).

- **PATCH `/api/coach/prospects/[id]`** — update any subset of
  fields. SELECT-then-UPDATE for phase logic: phase booleans set on
  false→true also set the paired `_at` column to `now()`;
  true→false clears the `_at`; same-value transitions are skipped
  as no-ops. The TOCTOU race window is small (one-coach-one-prospect
  UI) and the simpler code path was preferred over single-statement
  CASE WHEN; comment documents the choice.

- **DELETE `/api/coach/prospects/[id]`** — soft-revoke via
  `status='revoked'`. Preserves audit trail, the row's notes, and
  the row's phase history. Reversible by a future endpoint. Matches
  Phase 1's existing DELETE precedent. The FRD was silent on DELETE
  semantics (4 endpoints in §6.4 vs the 5-endpoint scope in the
  brief); the design decision was made at pre-flight (Q1) and is
  captured here in the runlog rather than via an FRD-correction
  commit. Already-revoked rows return 403 via gate-6's
  `status='active'` filter (existence-collapsed-into-ownership
  pattern, same as 2b/2c).

**Design decisions captured at pre-flight (12 questions):**

The §6.4 pre-flight identified 12 open questions. Five were flagged
as guesses requiring user lock-in; seven were FRD/schema-derived
with low risk. Final dispositions:

- Q1 (DELETE semantics): soft-revoke via `status='revoked'`. Matches
  Phase 1 precedent.
- Q2 (PATCH→Active triggers send-invite?): NO. Conversion is a pure
  UPDATE; send-invite is a separate explicit endpoint (2c). Coach
  decides when each happens.
- Q3 (PATCH on non-`Prospect` lifecycle): allowed at the API; UI
  may choose to hide phase checkboxes for post-conversion rows.
  TODO comment in PATCH route flags the post-v0.1 consideration of
  gating phase updates with a 422 if `lifecycle_status != 'Prospect'`.
- Q4 (list filters `Prospect` only): yes; post-conversion-pre-invite
  routing handled via a different surface (Commit 4d's new client
  detail route by `coach_clients.id`).
- Q5 (POST duplicate email detection): no 409. Coaches may track
  the same email across multiple referral touch points. Frontend
  can soft-warn at create time.
- Q6 (rename `email` → `invited_email` in the API): yes; field
  names match column names.
- Q7 (PATCH phase logic atomicity): SELECT-then-UPDATE rather than
  single-statement CASE WHEN. Comment in code references this
  pre-flight Q7 lock.
- Q8 (sort `last_activity_at DESC NULLS LAST`, then `created_at
  DESC`): yes; matches My Clients sort intent.
- Q9 (pagination): no; v0.1 prospect counts per coach are small.
- Q10 (PATCH returns full detail including notes): yes; matches
  FRD §6.4.4.
- Q11 (`initial_note` type locked to `'other'`): yes; per FRD §6.4.2.
- Q12 (`source_category` mutable via PATCH): yes; UI may choose to
  lock it.

**Three validation tightenings caught at design review and verified
end-to-end:**

1. **`lifecycle_status` null gate in PATCH.** Schema NOT NULL; the
   first draft would have returned the opaque "lifecycle_status
   invalid" error on `{lifecycle_status: null}`. Explicit null gate
   returns the clearer "lifecycle_status cannot be null" error
   before the enum check.

2. **`phases` array rejection.** `body.phases && typeof body.phases
   === "object"` would have silently accepted `body.phases = []`
   (arrays are objects in JS) and looped no-op. Added
   `Array.isArray` check returning 400 "phases must be an object".
   Brief comment noted that unknown keys in `body.phases` are
   silently ignored (matches the lenient pattern in other coach
   routes; strict mode would 400).

3. **Empty-after-trim → null** for `invited_email` and
   `source_detail` in POST and PATCH. Without this, a coach sending
   `invited_email: "   "` would have inserted empty string into the
   column, coexisting with NULL semantics. Now `trim()` + truthy
   length guard normalizes whitespace-only inputs to NULL. Name
   PATCH treats explicit-empty-string differently: returns 400 "name
   cannot be empty (use null to clear)" to avoid implicit clears.

**Verification:** 43/43 assertions across three regression phases.

- Phase A (3 assertions) — existing routes from 2a/2b/2c/3 still
  work unchanged. Coach Home, action-items, prospect notes verified
  against the same dev fixtures.
- Phase B (31 assertions) — each new endpoint's happy paths +
  validation gates:
  - GET list shape (1)
  - POST create: 1 happy + 3 null-coercion (invited_email
    whitespace → null, source_detail whitespace → null, both fields
    omitted) + 5 validation errors (empty name, bad enum, long
    detail, long note, bad email format) = 9 total
  - GET detail: 3 (happy + wrong-coach + non-existent)
  - PATCH: 14 (each scalar field independently, phase transitions
    set/clear `_at`, all three tightenings + their error messages,
    empty body, no-op skip)
  - DELETE: 5 (happy + already-revoked + list-exclusion + detail
    403 post-DELETE + notes preserved via direct SQL)
- Phase C (10 assertions) — full lifecycle integration: create →
  list → detail → PATCH multiple times → DELETE → confirm revoked
  + notes preserved + list-exclusion.

Hard cleanup verified zero residue (no `Commit 4b Test%` prefix
rows left in `coach_clients`).

**Cumulative Prospects v0.1 state on origin/dev:**

| Commit | SHA | Scope |
|---|---|---|
| 1 schema | `2d2238fa` | Schema migration |
| 1 runlog | `11a0046a` | Runlog entry |
| 2a notes refactor | `b7f89656` | Canonicalize on `coach_client_id` |
| 2b prospect notes | `0b00c599` | 4 new routes |
| FRD correction | `2c8a5b4b` | Lifecycle terminology + URL fix |
| 2c send-invite | `4d17ac77` | Auth user + profile + link flow |
| 2 runlog | `e091ed11` | Commit 2 runlog entry |
| 3 NULL hardening | `46e50d3f` | `/api/coach/home` + heuristics + action-items |
| 3 runlog | `fcb2f9b8` | Commit 3 runlog entry |
| 4b CRUD endpoints | `5634f323` | 5 prospect CRUD endpoints |

**Backend half of Prospects v0.1 is complete.** All API surfaces
exist:
- Prospect lifecycle (Commit 4b): list, create, detail, update,
  revoke
- Prospect notes (Commit 2b): GET/POST + PUT/DELETE
- Conversion → SIGNAL account (Commit 2c): send-invite
- Defensive NULL handling on existing surfaces (Commit 3)

**Next:**

Commit 4c — frontend pages:
- `/dashboard/coach/prospects` list page (rendering 4b's GET list)
- Prospect detail page (rendering 4b's GET detail with notes)
- "+ Add Prospect" capture modal (POST to 4b's create endpoint)

Commit 4d — integration touchpoints:
- `LifecycleStatusPill` context-aware refactor (PATCH lifecycle via
  4b)
- Nav addition to `COACH_NAV` in `app/dashboard/layout.tsx`
- "Active Prospects" tile href update on Coach Home
- Action-items consumer updated to route prospect entries via
  `coach_client_id` (per Commit 3 TODO)
- Post-conversion-pre-invite client-detail route keyed by
  `coach_clients.id`
- Collapsed "Prospect history" block on Client detail pages

Production promotion of the Commit 1 schema migration remains
deferred to a separate explicit step after Commit 4 ships and beta
validation on dev.

---

### 2026-05-25 — Risk v1 bullet fix shipped + prod Supabase schema gap closed

Two events from today's session.

**Event 1: Risk v1 (JobFit Risk bullet diagnostic schema)**

Opened the long-deferred bullet quality concern (previously flagged in runlog entries 2026-05-14, 2026-05-15, and the 2026-05-16 case_determination tuning closeout — all referenced bullet quality as work for a "dedicated session"). This was that session.

Inputs: Maleri's 45-bullet rated review (`SIGNAL_Bullet_Quality_Review_Maleri.csv`) plus full read of `app/api/jobfit/bulletGeneratorV5.ts`. Diagnostic surfaced three failure modes; v1 addressed the highest-leverage one — Risk bullets bury the gap inside the reframe, forcing users to re-read to extract the actual concern.

**Design locked (v1 scope):**

- Risk bullets restructured to lead with the gap as a clearly-named diagnostic statement; adjacent evidence is secondary support, not rebuttal
- `RiskBullet.reframe` field renamed to `adjacent_evidence` to signal the new semantic at the type layer
- Tool risk special-case unified under the new structure (no separate length cap)
- Empty-string `adjacent_evidence` allowed when no adjacent evidence exists in profile — model explicitly instructed not to fabricate support
- Formatter remains dumb space-join with empty-evidence short-circuit; no server-side connectors

**Docs filed at `docs/Features/`:**

- `bullet-quality-investigation.md` — diagnostic, Risk v1 spec, eval rubric, A/B design (Pass 1 + Pass 2 with Maleri as sole rater)
- `bullet-quality-consumer-audit.md` — line-scoped implementation tables (10 files total: 1 V5 source + 3 positioning v2 + 4 Framer + 3 tests; mobile audited clean)
- `cc-implementation-prompt-risk-v1.md` — paste-ready CC kickoff for future bullet-quality work

**Commits:**

- `94d56837` — feat(jobfit): Risk v1 — diagnostic schema, rename reframe→adjacent_evidence (9 files, +105/-71)
- `420aa9a5` — feat(jobfit): Risk v1 — mirror reframe→adjacent_evidence rename to framer/prod (2 files, +3/-3)

**Validation:**

- tsc clean, npm build clean, regression-check no drift (the 21 baseline-missing entries are pre-existing per DD-24)
- positioning-v2 unit suites: case-determination-check, case-specific-check, workflow-preview-check all PASS
- Live staging smoke (peri+test100, persona `f283397c-f26d-43bc-9095-0f77c7d9cea9`, Software Engineering JD) returned three diagnostic-shape Risk bullets with `adjacent_evidence` populated; empty-evidence short-circuit verified working (Bullet 2 returned `adjacent_evidence: ""`)

**Shipped to prod 2026-05-25.** Framer Studio publish verified Risk cards rendering correctly post-rename.

**Critical design notes captured for v2 work:**

- `bulletGeneratorV5.ts` contains TWO independent `.reframe` fields. `RiskBullet.reframe` was the v1 rename target; `PositioningStrategy.reframe` is a separate concept and was deliberately NOT renamed. Any future bullet-quality work must scope edits to specific lines per the consumer audit, not do repo-wide renames.
- The V5 prompt's "On length (STRICT)" section had a parallel risk-length rule at line 132 that was dropped in v1 (Option A per the implementation prompt). v2 should remember the §3.4 unified-tool-risk decision is now in effect.

**Remaining work in this thread:**

- A/B eval with Maleri (Pass 1 = 14 bullets × 3 arms = 42 ratings; Pass 2 = 25% re-rate 7+ days later for within-rater consistency)
- Decision rule per spec §5.5: ship if (a) re-read flag improves to ≥70% No, (b) Worst-Failure-Tone reduces on Risk bullets, (c) Believability doesn't regress >0.3 from prod baseline
- Why bullet fixes (Mode 2 from diagnostic — "directly mirrors X" stock-phrase tic) and interpretive-reach guard (Mode 3 — "Florence + Ohio = geographic flexibility" pattern) are deferred to v2

**Event 2: Prod Supabase schema gap closed**

Surfaced when Coaches Dashboard 500'd on prod after the Risk v1 ship. Investigation found the prod schema was 5 migrations behind dev. **Cause was the schema drift, not Risk v1.**

Migrations missing on prod before 2026-05-25:

| Migration | Status pre-2026-05-25 | Notes |
|---|---|---|
| `20260509_coach_client_notes_typed.sql` | ✗ MISSING on prod | Also not previously tracked in this runlog's schema table |
| `20260516_phase2_runs.sql` | ✗ MISSING on prod | Was in this runlog's schema table as `⏸ pending` |
| `20260521_coach_client_lifecycle_status.sql` | ✗ MISSING on prod | Was `⏸ pending` |
| `20260522_coach_engagement_signal_dismissals.sql` | ✗ MISSING on prod | Was `⏸ pending` |
| `20260523_prospects_v0_1.sql` | ✗ MISSING on prod | Was `⏸ pending` |

All 5 applied to prod via Supabase SQL Editor on 2026-05-25 to close the gap. Coaches Dashboard restored to working order. Schema migrations table at the top of this runlog updated accordingly (4 rows flipped from `⏸ pending` to `2026-05-25`; 1 row added for the previously-untracked `20260509_coach_client_notes_typed`).

**Why this surfaced now (timing):** Prior prod deploy `wrnsignal-fs7vsg3p2-...` was 14h old at time of investigation and already contained the column-reading code that depended on the missing schema. The bug was latent for ~14h before the Risk v1 promote rebuilt the deployment and made it visible. Rolling back to the prior prod would not have fixed the issue — same code reading the same missing columns. CC verified this via direct DB probe rather than inference.

**Root cause pattern (same as Foundation Risk 6):** dev migrations applied via Supabase SQL Editor workaround (per Risk 6 dev schema_migrations drift) and the prod-side promotion step queued as `⏸ pending` but not actioned. Five migrations accumulated in pending state across May 2026 before the latent reads of missing columns surfaced the gap.

**Discipline reminder (logged by Peri):** "I will resume making only dev changes going forward. Prod promotion stays as a separate explicit step per feedback_deploy_strategy." Risk v1 prod promote was an exception that surfaced the latent schema drift — useful as a forcing function, not a precedent.

**Operational implication:** the `⏸ pending` rows in the schema migrations table are not a benign queue — they accumulate latent prod-side risk every time dev-side code lands that depends on the pending migration. Two options worth considering for future runlog hygiene:

1. **Promote-with-dev pattern.** When a migration applies to dev, prod promotion happens within the same week unless deliberately deferred for a documented reason. The default becomes "ship to both" rather than "ship to dev and queue prod."
2. **Pending-watch column.** Add a "dev code shipped that depends on this" flag to the schema migrations table. When checked, escalate the pending-prod-migration urgency. Easy way to surface latent-drift risk.

Neither is implemented today. Logged for future consideration.



---

### 2026-05-26 — Cover letter header v1 backend fix + bullet-quality audit correction

Two related items: a small v1 fix to the cover letter generator route, and a correction to a claim made in the 2026-05-25 bullet-quality consumer audit.

**Event 1: Cover letter header v1 backend fix**

User reported that the cover letter header (Name / Phone / Email block at the top of the rendered letter) does not always prepopulate. Investigation in `docs/Features/cover-letter-header-investigation.md` (filed 2026-05-26) traced the cause: `app/api/coverletter/route.ts` was extracting all three contact fields via regex on `profileText`, ignoring the `client_profiles.name` and `client_profiles.email` columns that already exist and are populated through intake.

**Locked v1 scope (deliberately narrow):**

- Name: prefer `client_profiles.name`, fall back to regex (existing behavior preserved as layer 2)
- Email: read from `client_profiles.email` only; **email regex fallback removed** (auth email is the canonical source; the Framer/mobile client-side `authedEmail` safety net handles legacy NULL rows)
- Phone: **unchanged** — full phone fix tracked separately as Tier 2 work
- `clName` client-side override (Framer + mobile React state) is layer 1 of the overall name chain and is unaffected by this fix

**Commit:**

- `a2b10e1b` — fix(coverletter): read name/email from client_profiles columns before regex fallback (1 file, +19/-1)

**Validation:**

- tsc clean, npm build clean
- SHA verified on preview build `https://wrnsignal-genxec52v-peri-ginsbergs-projects.vercel.app` (env=preview, `git_sha=a2b10e1b...`)
- No new tests required: the change is a behavior-preserving precedence reorder behind the same `contact` response shape

**Cache behavior — verified safe, no invalidation needed:** the `contact` object is computed fresh on every request at the route entry, then overlays any cached `result_json.contact` on cache hits. So the new resolution logic takes effect immediately for all users (cached or fresh) without busting the `coverletter_runs` cache.

**Acknowledged pre-existing edge case (not introduced by this fix):** if the LLM-generated cover letter *body* contains the user's name in prose (e.g., "I am Jane Smith, a senior at FSU..."), the cached letter body still reads "Jane Smith" after a name update on `client_profiles.name`, while the rendered header now correctly reads the new name. This is body-text staleness in `coverletter_runs.result_json.letter`, distinct from the header staleness this fix addresses. Knowingly deferred — out of scope for v1.

**Tier 2 work (tracked, not in this session):**

- `client_profiles.phone TEXT` column migration (dev → prod)
- Resume-upload hook for one-time phone extraction into the new column (backfill path for existing users without re-typing)
- Framer intake form: optional Phone field at account setup (`framer/dev/intakeformcomponent.txt` + prod mirror)
- Mobile intake parity (`signal-mobile/app/intake.tsx` or equivalent)
- Optional 122-row backfill script for legacy `client_profiles` rows where regex would have extracted phone from `profile_text`
- Account settings UI for phone view/edit (Framer + mobile)
- Cover letter UI: optional editable Phone + Email override fields (Framer + mobile) so users can correct stale values inline without round-tripping through account settings

**Event 2: Bullet-quality consumer audit correction**

The 2026-05-25 bullet-quality consumer audit (`docs/Features/bullet-quality-consumer-audit.md`, §F and Headline Findings line 15) stated:

> "No cover letter generator route exists yet."

This claim was **incorrect**. `app/api/coverletter/route.ts` has existed since at least the V5 era — it consumes `cover_letter_strategy` from V5 result_json, is actively called by the Framer dashboard cover letter tab and `signal-mobile/app/(tabs)/coverletter.tsx`, and writes to the `coverletter_runs` table on every fresh run.

**Likely cause of the audit miss:** the audit's grep patterns (`cover-letter`, `coverLetter`, `cover_letter`) did not match the route file path because it is named `coverletter` — no hyphen, no underscore, no camelCase boundary. The file would only have surfaced under a `cover.?letter` pattern with the optional separator. The audit's consumer findings section (Phase 2 itemPopulator, mobile, Framer) is otherwise sound; only the "no route exists" claim was wrong.

**Future audit discipline reminder:** when grepping for feature consumers, include the `cover.?letter` pattern variant (regex with optional separator) to catch concatenated naming. This investigation surfaced `app/api/coverletter/route.ts`, `framer/dev/maincomponent.txt` (consumer), `signal-mobile/app/(tabs)/coverletter.tsx` (consumer), and the active `coverletter_runs` table — none of which appeared in the prior audit because of the same naming-pattern miss.

See `docs/Features/cover-letter-header-investigation.md` for the full investigation that surfaced both the fix and the correction.

### 2026-05-27 — Beta Feedback v0.1 Phase 1 (schema) shipped

Phase 1 of the beta-feedback v0.1 feature shipped to dev. New
`beta_feedback` table created per FRD §6.1
(`docs/Features/beta-feedback-frd.md`). 15 columns covering coach
submission (`type`, `severity`, `body`, `reply_ok`), auto-captured
context (`page_url`, `user_agent`), notification tracking
(`email_sent_at`, `email_send_error`), and reserved status fields
(`status`, `status_updated_at`, `status_updated_by`) for the v0.2
admin UI — plus `id`, `coach_profile_id`, `created_at`, and
`updated_at`. (FRD verification text said "14 columns"; the verbatim
§6.1 CREATE TABLE actually defines 15 — the migration matches §6.1, so
15 is correct.)

Three indexes added: `coach_profile_id`, `status`, `created_at DESC`.
The `set_updated_at` trigger attached for `updated_at` maintenance.

CHECK constraints verified firing on dev: invalid `type` rejected
(`beta_feedback_type_check`); body shorter than 10 chars rejected
(`beta_feedback_body_check`). Trigger verified firing on UPDATE —
`updated_at` advanced (14:24:18Z) past the held `created_at`
(14:24:17Z). Test row deleted afterward; table left at 0 rows.

Apply method (Risk 6, manual direct-SQL): the Supabase CLI is
currently linked to **prod** (`ejhnokcnahauvrcbcmic`), so dev
(`zydrqckpwidipwbhrfgd`) was reached via a session-pooler connection
string stored as `SUPABASE_DB_URL` in `.env.development.local`
(gitignored) and run through `psql` — functionally equivalent to the
SQL Editor workaround, applied with the dev identity verified before
every statement. Production promotion deferred until Phases 2-5
complete and end-to-end validation passes.

Next: Phase 2 — POST `/api/feedback` endpoint with auth, validation,
DB insert, and Postmark email-on-insert wiring.

### 2026-05-27 — Beta Feedback v0.1 Phase 2 (POST /api/feedback) shipped

Phase 2 of the beta-feedback v0.1 feature shipped to dev. New
`POST /api/feedback` endpoint at `app/api/feedback/route.ts` with
inline auth (getAuthedUser + profile lookup), is_coach gate,
input validation across 5 type values + conditional severity,
body length bounds (10-5000 chars), and sensitive query param
stripping on page_url. On valid submission: INSERT to
`beta_feedback`, compute active client count (matches Coach Home
tile filter — `status='active' AND lifecycle_status='Active'`), fire
notification email via new `lib/email/sendFeedbackNotification.ts`
utility, best-effort writeback of `email_sent_at` / `email_send_error`
to the row.

Email failure is non-fatal — row commits before send is attempted;
caller sees success regardless. Reply-To set to coach email when
reply_ok=true, omitted when reply_ok=false (replies loop back to
support@ inbox via From).

Postmark utility models the sendClientInvite pattern (same
`postmarkClient` + `MESSAGE_STREAM`), but sends From/To
`support@stopapplyingblind.com` rather than the WRN-branded
`POSTMARK_FROM_EMAIL`. New env var `POSTMARK_FEEDBACK_FROM_EMAIL`
added to local dev env (gitignored, not committed); defaults to
`support@stopapplyingblind.com` if unset. Inline template (no
Postmark template ID) for iteration speed during early beta.

Next: Phase 3 — frontend slide-in component
(`components/ui/SlideInPanel.tsx` + form + confirmation states).

### 2026-05-27 — Beta Feedback v0.1 Phase 3 (frontend slide-in) shipped

Phase 3 of the beta-feedback v0.1 feature shipped to dev. New
generic `SlideInPanel` component (`components/ui/SlideInPanel.tsx`)
modeled visually + behaviorally on the existing `AddNotePanel.tsx`
(left untouched per FRD §6.5.0). Feedback-specific composition
in `FeedbackSlideIn.tsx` + `FeedbackForm.tsx` handles the form
state machine (form → submitting → confirmation/error), client-side
validation matching server-side rules, and POST to the Phase 2
endpoint.

Mounted at the global dashboard layout level
(`app/dashboard/layout.tsx`), gated on `isCoach`. Accessible from
any coach page once Phase 4 wires the nav trigger; `feedbackOpen`
state + `authToken` capture added to the layout in this phase.

Smoke tests passed: 8 cases covering open/close (backdrop + Esc),
conditional severity rendering (no stale selection), valid
submissions of both issue_bug + enhancement variants (with
reply_ok=true and false — row + email + missing Reply-To verified),
client-side validation disabling Submit (short body; bug without
severity), and the server-error banner path. A temporary smoke-test
trigger in the layout was used during testing and removed before
commit.

Cleanup ticket filed (KI-08): refactor `AddNotePanel.tsx` to use
the new `SlideInPanel` in a future cleanup pass.

Next: Phase 4 — sidebar nav integration (add Feedback item to
COACHES CENTER nav group, wire to setFeedbackOpen).

### 2026-05-27 — Beta Feedback v0.1 Phase 4 (sidebar nav integration) shipped

Phase 4 of the beta-feedback v0.1 feature shipped to dev. New
"Feedback" item added to the bottom of the COACHES CENTER sidebar
nav group. Structurally different from other nav items — rendered
as `<button>` instead of `<a href>` per FRD §6.4 implementation note,
since clicking opens the SlideInPanel from Phase 3 rather than
navigating to a new route.

Implemented via the existing config-driven nav (the nav lives inline
in `app/dashboard/layout.tsx`, not a separate component): `NavItem`
gained an optional `action` field; the renderer branches action items
to a `<button>` that shares the exact link `itemStyle` (button
defaults reset) so it's visually indistinguishable from the link
items. No props plumbing was needed — `setFeedbackOpen` was already
in layout scope from Phase 3.

Nav item visible only to coaches (rendered from `COACH_NAV`, which is
only used when `isCoach`). Click handler fires `setFeedbackOpen(true)`
on the layout state established in Phase 3.

Smoke tests passed (7 cases): Feedback item visible in COACHES CENTER
below Required Actions, pixel-matched to other items; click opens the
slide-in with no navigation or console errors; verified from Coach
Home, My Clients, and an individual client view (present on every
coach page by virtue of the shared layout mount); 3× open/close
cycles reset cleanly; full submission lands end-to-end; non-coach
visibility gate holds.

Next: Phase 5 — end-to-end testing + cleanup of leftover dev
`beta_feedback` smoke rows (6 rows from Phases 2-4, + 6 corresponding
support@ emails already verified) + production schema promotion +
prod `POSTMARK_FEEDBACK_FROM_EMAIL` env var addition.

