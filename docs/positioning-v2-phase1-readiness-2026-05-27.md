> **⚠️ ABANDONED 2026-08-10.** Positioning v2 / Stage 1c was abandoned and its
> code deleted. This document describes a system that does not exist. It is kept
> as history, not as a spec — do not build from it. See
> [docs/positioning-v2-abandoned.md](positioning-v2-abandoned.md).

# v2 Phase 1 Production Readiness Assessment — 2026-05-27
# Investigator: Claude Code (read-only; no code/schema/commits)

> Pre-flight: origin/dev tip `cec0873e`, local in sync (0/0). Read-only.

## Headline

v2 Phase 1 is **well-built code** — complete handler, robust error handling,
8 green test files, already integrated into the dev frontend — but it is **NOT a
functional replacement for v1**, because it produces a *different deliverable*.
v1 hands the user concrete resume changes today (`resume_bullet_edits`,
`summary_statement`, `arrange_resume`); v2 Phase 1 hands back a **case diagnosis**
(A/B/C) + a **workflow preview** (estimated minutes + a sorted risk list) — the
"here's your situation and what we'll do" screen. The actual resume-changing work
lives in **Phase 2**, which is dev-only and blocked (KI-11 validator over-strictness,
0/9 accept). So promoting v2 Phase 1 would *remove* the actionable output users get
today and replace it with a diagnosis whose payoff phase isn't shippable.

## Verdict

**NOT READY — as a v1 replacement.** (The blocker is product-shape + the Phase 2
dependency, not code quality.)

Crucial distinction:
- **v2 Phase 1 the code:** READY. Complete, tested, robust, deterministic,
  dev-integrated. If the goal were "ship the case-diagnosis + workflow-preview
  screen," it's essentially there.
- **v2 Phase 1 as a replacement for what v1 *does* (deliver resume edits):** NOT
  READY, and not close. It doesn't deliver resume edits at all — Phase 2 does, and
  Phase 2 is blocked on KI-11 (a real validator-redesign project, deferred). Wiring
  v2 Phase 1 to prod tomorrow would be a **functional regression** for the D2C user
  (lose working bullet/summary output; gain a diagnosis + a "Phase 2 coming soon"
  dead end).

## Detailed findings

### Area 1 — Code completeness
- **Location:** route `app/api/positioning/v2/start/route.ts`; libs
  `lib/positioning/v2/{caseDetermination,workflowPreview,caseSpecific,
  responseBuilder,fingerprint,runLookup,runWriter,jobfitLookup,caseThresholds,
  types}.ts`.
- **Handler complete:** yes. Auth + persona guard (F6 → 400 `no_persona_configured`),
  JobFit fetch + ownership (F11 → 404 on wrong owner), targeting + career stage,
  fingerprint, a full **cache_hit / resume / new** outcome cascade, run creation,
  best-effort signal-application linking, visit append, and `buildStartResponse`.
- **Consumes JobFit:** yes, by design and structurally. It **requires**
  `jobfit_run_id` in the request body (`:223-230`), fetches `jobfit_runs.result_json`,
  and feeds it into `determineCase` / `generateWorkflowPreview` / `generateCaseSpecific`
  via `caseInputs.jobfit` (`:392-396`). It also has the **schema link** v1 lacks:
  `positioning_runs_v2.jobfit_run_id` is stored (`:448`).
- **Response shape — DIFFERENT from v1 (the headline blocker):**
  - **v1 returns:** `{ student_intro, role_angle, arrange_resume, summary_statement,
    resume_bullet_edits, keyword_analysis }` — actionable resume guidance.
  - **v2 Phase 1 returns** (`responseBuilder.ts:103-128`): `{ run_id,
    signal_application_id, outcome, case, case_reasoning, case_specific,
    workflow_preview, is_returning, last_visit_days_ago, current_phase, phase_data,
    cached, context }` — a diagnosis + workflow preview. **No bullet edits, no
    summary, no resume arrangement.**
  - `workflow_preview` (`workflowPreview.ts`) = `estimated_minutes` (Case A=0, B=17,
    C=37) + risks sorted by severity. It's a *preview of the upcoming workflow*, not
    resume changes.
- **Stubs/TODOs:** essentially none functional. One cosmetic `TODO` (a redundant
  second SELECT on `jobfit_runs` for `job_url`/`job_description`, `:292-298`) — a
  perf smell, not a correctness gap. `small_refinements` is intentionally inert
  ("no real signal source yet," `workflowPreview.ts:60-63`) — a known v2.5+ deferral,
  not a blocker.

### Area 2 — Error handling
**At parity with, arguably stronger than, v1.** Named machine-readable error codes
at every step (`invalid_json`, `missing_jobfit_run_id`, `unauthorized`,
`no_persona_configured`, `jobfit_not_found`, `persona_not_found`,
`server_misconfigured`). Documented failure-mode policy (`route.ts:36-43`):
create-run failure → 500; link/append/find-or-create failures → 200 + warn
(self-heal next visit); lookup-guard error → degrade to new-run. F11 ownership
mismatch returns 404 (no existence leak). v1's error handling is coarser (a single
try/catch mapping substrings to 401/404/403/500, `positioning/route.ts:836-848`).

### Area 3 — Test coverage
**Strong.** `tests/positioning-v2/` has 8 `*-check.ts` files —
`fingerprint`, `jobfit-lookup`, `run-lookup`, `run-writer`, `response-builder`,
`case-determination`, `workflow-preview`, `case-specific`. **All 8 passed** when run
earlier today (the Q4 regression run, 8/8 green). They cover the pure logic + DB
lookup/writer layers. v1, by contrast, has **no** dedicated test suite. So on test
coverage v2 Phase 1 is far ahead.

### Area 4 — Production-readiness signals
- **Telemetry:** grep-friendly log markers documented + emitted
  (`[positioning-v2/start] PLACEHOLDER_APPLICATION_CREATED / LINK_FAILED /
  APPEND_VISIT_FAILED / FIND_OR_CREATE_APP_FAILED / LOOKUP_ERROR`). At parity with
  v1's `[positioning]` logging.
- **FRD:** `docs/Features/positioning-phase1-frd.md` exists (well-specified;
  friction items F6–F14 tracked and resolved in code).
- **Dev-integrated:** the dev Framer wires it — `runPositioningV2(jobfitRunId)` →
  `/api/positioning/v2/start` (`framer/dev/maincomponent.txt:2073-2076`),
  auto-fired on Positioning-tab entry when a JobFit run exists. So it's been
  exercised against the real dev flow, not just unit fixtures.
- **⚠️ Determination-quality caveat:** project tracking flags that
  `case_determination` tuning was paused mid-Stage-1c (per the
  `case-determination-tuning-plan.md` track) — i.e. the **accuracy** of the A/B/C
  assignment may not be fully validated even though the plumbing is solid. Confirm
  current tuning status with Peri before trusting case assignments in production.
  *(This is background from project notes, not verified in this read; flag, don't
  assume.)*
- **Reliability/cost profile (a genuine plus):** v2 Phase 1 is **fully
  deterministic** — `determineCase`, `generateWorkflowPreview`, `generateCaseSpecific`
  are pure functions with **no LLM call**. v1 makes an OpenAI `gpt-4.1-mini` call per
  run. So v2 Phase 1 is cheaper and more reliable than v1 *for the diagnosis it
  produces* — but again, it produces a diagnosis, not edits.

### Area 5 — Migration delta (to wire v2 Phase 1 to prod)
1. **Frontend response handling — large, not a config flip.** The production
   Positioning tab renders v1's shape (drivers / bullet edits / summary panels;
   `framer` `runPositioning` → `setPositioningResult` → `posDrivers/posBullets/
   posSummary`). v2's `{ case, workflow_preview, case_specific }` needs an entirely
   different render (the case A/B/C screen + the "Phase 2 coming soon" CTA). Even the
   dev frontend keeps v1's bullets/summary as the user-facing output and runs
   v2/start *alongside* (auto-fired) — it has **not** replaced v1's UI even in dev.
2. **Flow change:** v2 requires `jobfit_run_id` (v1 takes just `{ job }`). The flow
   must run JobFit first and pass the run id. The Framer already does JobFit-first,
   and dev already passes the run id to v2/start — so feasible, but it makes JobFit a
   hard prerequisite for Positioning (v1 has no such requirement).
3. **Schema:** `positioning_runs_v2` already exists and is separate from
   `positioning_runs`. No new migration needed for v2 itself.
4. **Config:** prod Framer would need `runPositioningV2` wired (currently dev-only);
   no env vars/flags found gating it server-side.

### Area 6 — Risk assessment
- **The dominant risk:** v2 Phase 1 alone doesn't change the resume. The payoff
  (Phase 2 reframing) is **blocked on KI-11** (validator over-strictness, 0/9 accept
  measured today). Promoting Phase 1 without a working Phase 2 ships a diagnosis with
  no treatment — worse for the user than v1's imperfect-but-real edits.
- **Determination accuracy:** the A/B/C case assignment quality is the product;
  if `case_determination` tuning is incomplete (Stage 1c pause), users could be
  mis-bucketed. Lower stakes than a wrong bullet (it's a routing decision), but it
  drives the whole workflow.
- **Rollback story (favorable):** prod is still on v1, and v2 lives in a separate
  table + separate route. Promoting v2 is additive; rollback = keep pointing the
  frontend at v1. No destructive coupling. This is the one area where v2 is low-risk
  — *because* it hasn't displaced v1.
- **Cost/reliability:** better than v1 for Phase 1 (deterministic, no LLM). Neutral
  overall since the actual generation cost moves to Phase 2.

## Migration plan sketch

Not applicable as a near-term "replace v1" plan — v2 Phase 1 is not a functional
replacement (see Verdict). If Peri nonetheless wants the case-diagnosis screen in
prod *alongside* v1 (not replacing it), that's the dev configuration already: wire
`runPositioningV2` into prod Framer, render the case/workflow_preview screen, keep
v1's bullets/summary as the actionable output. But "replace v1 with v2" is gated on
**finishing Phase 2** (KI-11 validator redesign) + a frontend rebuild of the
Positioning tab. That's a multi-week project, not a wiring task.

## Comparison to "enhance v1" option

**Enhance-v1 wins decisively for the near term.**

| | Enhance v1 (thread JobFit into bullet eval) | Promote v2 Phase 1 |
|---|---|---|
| Keeps delivering resume edits today | ✅ yes | ❌ no — diagnosis only; edits need Phase 2 |
| Blocked on KI-11 (validator redesign) | ❌ no | ✅ yes (Phase 2 is the payoff) |
| Frontend work | small (thread `jobfit_result`; render unchanged) | large (new response shape, new render) |
| Schema work | none (client-threading) | none for v2 itself, but… |
| Net user impact near-term | strictly better bullets | functional regression until Phase 2 ships |
| Long-term ceiling | bounded (keyword-injection task) | higher (full reframing workflow) — *if* Phase 2 unblocks |

Enhance-v1 is the right near-term move: it improves the output users actually get,
with a small change, no dependency on the blocked Phase 2. Promote-v2 is the
*long-term* direction (richer workflow, JobFit-coupled by design, deterministic,
better-tested) — but it's gated on the KI-11 Phase 2 work and a frontend rebuild,
and shipping Phase 1 alone would regress the user experience.

**Recommended framing:** these aren't either/or on the same timeline. Enhance v1
now (cheap, additive, unblocked). Treat "promote v2" as a separate future bet that
only becomes real once Phase 2 (KI-11) is designed and shippable. Don't let the
existence of well-built v2 Phase 1 code create pressure to ship a half-workflow.

## Open questions for Peri

1. **Confirm the deliverable mismatch is understood:** v2 Phase 1 returns a case
   diagnosis + workflow preview, **not** bullet edits/summary. "Replace v1 with v2"
   means "replace working resume edits with a diagnosis whose treatment phase is
   blocked." Is that the intent, or was v2 Phase 1 assumed to produce v1-style edits?
2. **`case_determination` tuning status:** is the Stage-1c tuning pause resolved? The
   A/B/C accuracy gates the whole v2 workflow's usefulness. (Verify against
   `docs/Features/case-determination-tuning-plan.md`.)
3. **Is there appetite to unblock Phase 2 (KI-11)?** Promote-v2 is only viable after
   the validator redesign. If KI-11 isn't being scheduled, promote-v2 isn't a real
   near-term option and enhance-v1 is the path by default.
4. **Coexist vs replace:** would Peri value shipping the v2 case-diagnosis screen
   *alongside* v1 (informational "here's your situation"), or only as a full
   replacement? The former is low-risk and close to the dev state; the latter is the
   blocked, larger project.

## Bearing on the paused positioning→cover-letter fix

The earlier "thread Positioning to Cover Letter" fix passes **v1's** output shape
(which `summarizePositioning` parses). This assessment reinforces that **v1 is and
will remain the production Positioning path near-term**, so that fix is safe to
build against v1 — it is **not** about to be invalidated by a v2 promotion. (It does
still need to cover all three call sites: `framer/dev`, `framer/prod`,
`signal-mobile/lib/api.ts`.)

---

*Report file: `docs/positioning-v2-phase1-readiness-2026-05-27.md`*
