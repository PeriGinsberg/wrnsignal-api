# Ticket 1 — Context-aware capability matcher (build plan)

**Status:** DRAFT for approval — no code until approved.
**Decision:** Ticket 1 is THE fix for the free-path over-crediting problem
(see [jobfit-ticket-acceptance-suite.md](./jobfit-ticket-acceptance-suite.md)).
Ticket 2 (tag-membership) is downgraded to an optional backstop.

## Problem (one line)
`CAPABILITY_RULES` phrases are bare `.includes()` substring matches with no word
boundaries or context, so generic language ("analysis", "report", "strategic
analysis", "Excel", "PowerPoint", "outreach") satisfies specialized requirements
(financial modeling, underwriting, etc.), producing false-positive Applies
(Jordan/Zurich Apply/80, Ava→IB, Catherine→FinAnalyst).

## Fix shape
Pre-compile each rule phrase to a **word-boundary regex** plus optional
**`requiresNearby`** (a finance/role anchor that must co-occur) and
**`negativeContext`** (kill matches in constraint/benefit/EEO lines). Touches
all 30+ detectors. (CLAUDE.md debt #1.)

---

## Stages (each = its own reviewable commit + gate)

### Stage 0 — Acceptance harness + baseline freeze (no engine change)
- Turn the ad-hoc validation into a committed, runnable harness that executes
  the frozen acceptance suite (Jordan, the 9 must-fire/must-not-fire cells,
  the discrimination sets) and the 26-case regression, capturing CURRENT
  (pre-fix) outputs as the "before" snapshot.
- **Gate:** harness runs green capturing baselines; zero engine code touched;
  `regression-check.ts` clean against existing `baseline.json`.

### Stage 1 — Rule-schema refactor + word boundaries (behavior-near-neutral)
- Introduce the compiled rule shape `{ phrase, requiresNearby?, negativeContext?,
  wordBoundary }` and the compiler (phrase → `\b…\b` regex). Migrate all 30+
  detectors to the new shape with NO nearby/negative context yet — i.e. a pure
  structural refactor that only adds word boundaries.
- Expected diffs: a controlled set where bare-substring bugs stop firing
  (e.g. `content_execution` on "no pure social media content roles").
- **Gate:** 26-case regression — review EVERY diff line; each must be an intended
  word-boundary improvement. Acceptance harness: no regressions on true-fits.

### Stage 2a — Context guards: FINANCE family first (highest-value)
- Author `requiresNearby` / `negativeContext` for the finance detectors driving
  the worst false-positives: `financial_analysis` / `analysis_reporting` require
  a finance/valuation anchor near "analysis"; "report/findings" ≠ financial
  reporting; "strategic analysis" (marketing) ≠ financial modeling; PowerPoint /
  Excel as weak-not-fit signals.
- **Gate (the money gate):** acceptance suite — **Jordan→Pass, Catherine→Pass,
  Ava down from Apply**, WHILE George/Matthew/true finance fits preserved.
  26-case regression reviewed.

### Stage 2b — Context guards: remaining detectors
- Apply the same treatment to the other detector families (marketing, sales,
  ops, legal, etc.) flagged by regression/acceptance diffs.
- **Gate:** acceptance suite all-green (all must-fire fire, all must-not-fire
  don't); 26-case regression reviewed.

### Stage 3 — (Optional, related) JD-classifier precision
- Tighten the JD-side misclassifications surfaced by the suite (SDR→IT_Software,
  Data Scientist→Engineering, underwriting→Sales). NOT required to fix Jordan
  (Stage 2 fixes him via requirement matching regardless of family), but it
  improves the classifier the whole engine relies on. Can be split to a
  follow-up ticket.
- **Gate:** Rutstein/J10 no longer mis-penalized in any backstop; no family
  regressions in the 26 cases.

### Stage 4 — Re-enable Fix C (family-distance override)
- Fix C was HELD pending this matcher upgrade ([[project_jobfit_fix_c_held]]).
  Reattempt now that matching is context-aware.
- **Gate:** Fix C's own regression cases + full 26-case + acceptance suite.

### Stage 5 — Baseline update + prod distribution recheck + ship
- After every diff is reviewed, update `baseline.json`; run
  `inspect-prod-runs.ts` and confirm the decision/score distribution shift is
  the intended reduction in over-credited Applies (no unexpected collapses).
- **Gate:** baseline committed with code; prod structural health reviewed.

---

## Regression plan (run at every gate)
1. **26-case baseline** (`tests/jobfit-regression/regression-check.ts`) — review
   every diff line; update `baseline.json` only after verification (CLAUDE.md
   workflow).
2. **Frozen acceptance suite** — Stage 0 makes it runnable; gate = all MUST-FIRE
   fire / MUST-NOT-FIRE don't, **including Jordan→Pass** and the true-fit
   protections (George, Matthew, Lees/J5, Allison, Catherine/J5, Ava/J7).
3. **Prod-run distribution** (`inspect-prod-runs.ts`) — before/after the decision,
   score, and family distributions; confirm the shift is the intended
   over-credit reduction, direction only (history is not rewritten).

## Blast radius
- **All 30+ CAPABILITY_RULES detectors** change shape (Stage 1).
- **Scores move broadly**: the over-credit class drops — expect a cohort of
  Apply→Review and Review→Pass, concentrated in cross-field / wrong-specialty
  résumés on specialized JDs. **True in-field fits should stay put** (protected
  by the acceptance suite's must-not-fire cases).
- **`baseline.json` changes materially** → all 26 cases must be re-audited.
- **508+ historical prod runs**: distribution shifts (some past Applies would now
  be Review/Pass); not rewritten, just confirmed in direction.
- **Unblocks Fix C** (Stage 4).
- **Primary risk:** over-correction (tightening starves true fits of matches).
  Mitigated by the must-not-fire / true-fit acceptance cases at every gate.

## Estimated session count
**~5–8 sessions** (largest refactor in the engine):
- Stage 0: ~0.5–1
- Stage 1: ~1–2 (30+ detectors)
- Stage 2a+2b: ~2–3 (judgment-heavy, iterative with regression)
- Stage 3 (if included): ~1
- Stage 4: ~0.5–1
- Stage 5: folded into gates + ~0.5 final

Each stage is independently shippable behind its gate; we can pause after any
stage with the engine in a consistent, regression-clean state.

## Investigation notes (from Stage 0)

- **Scorer reads the email local-part (candidate name).** Found while trying to
  PII-scrub the batch CSV: replacing candidate emails (even domain-preserving,
  `name@gmail.com` → `redacted@gmail.com`) shifts scoring on `batch-40926b` and
  `batch-40926d` (gain risks / drop a tier), while phone and LinkedIn scrubs are
  fully score-neutral. All email domains are `gmail.com`, so the signal is the
  **local part** — i.e. the contact-line name is leaking into extraction. The
  scorer should not depend on a contact-line name; investigate during Stage 1/2
  (likely the contact header bleeding into a requirement/section unit) and add a
  regression case once fixed. This is also why the batch CSV is kept local-only
  (can't be neutrally scrubbed) — see tests/jobfit-regression/README.md.
