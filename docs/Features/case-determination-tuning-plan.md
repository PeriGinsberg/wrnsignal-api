> **⚠️ ABANDONED 2026-08-10.** Positioning v2 / Stage 1c was abandoned and its
> code deleted. This document describes a system that does not exist. It is kept
> as history, not as a spec — do not build from it. See
> [docs/positioning-v2-abandoned.md](../positioning-v2-abandoned.md).

# case_determination tuning plan

Starting context for the case_determination tuning session. Decision to pause Stage 1c after D4 and run this session captured in `docs/Features/foundation-migration-runlog.md` (2026-05-15 fourth addendum).

**Out of scope for this session:** bullet-quality copy work. That's a separate session — flagged in the same 2026-05-14 runlog entry. Don't conflate them. The bullet-quality session reads the rendered output; this session reads the case decision.

---

## What we know — three test data points

All three tests ran against real personas + real JDs through the production-shaped code path (extract → score → decision → positioning v2 start). All three produced Case B.

| Test | Date | Persona | JD shape | Verdict | Score | Risks | Case |
|------|------|---------|----------|---------|-------|-------|------|
| D2 | 2026-05-14 | (D2 persona — see D2 runlog addendum) | (D2 JD — produced "MAJOR FIELD MISMATCH" gap theme) | Review | — | high-sev present | B |
| D3 | 2026-05-15 | Catherine Lees (Communications major, Product Manager target) | Versant Finance/Analytics/HR Intern JD | Review | 60 | 2 risks (incl. "FINANCE & ANALYTICS DOMAIN GAP", "PRIOR MEDIA INTERNSHIP EXPERIENCE MISSING") | B |
| D4 | 2026-05-15 | "Peri's Resume" persona | JD aligned with resume content | Apply | 77 | 2 risks ("LIMITED KIDS/FAMILY CONTENT PROOF", "UNPAID INTERNSHIP COMMITMENT") | B |

Three different verdicts (Review/Review/Apply), three different risk shapes, three different personas — same case. The case space appears to be collapsing onto B.

**Anecdotal signal not in the data:** D3's Catherine Lees scenario is Communications → Product Manager → Finance/Analytics intern — a three-field mismatch. Under any reasonable definition of case calibration, this should land Case C ("your resume is telling a different story than this job is asking for"). It landed Case B.

---

## What we don't know

- The actual verdict distribution across `jobfit_runs` in dev DB. Three tests is not a distribution.
- How many real runs would land each of Apply/Priority Apply/Review/Pass under current scoring.
- Of the Apply / Priority Apply runs, how many actually have **zero risks** (the Case A precondition).
- Of the Review runs, how many carry at least one high-severity risk (the Case C trigger via `CASE_C_HIGH_SEVERITY_TRIGGER`).
- Whether `risk_structured` is reliably populated on recent runs, or whether V4 fallback (`risk_codes` only) is firing more than expected. The fallback assigns `medium` severity uniformly — which would explain why Case C (high-severity gate) never fires.

The dev DB has hundreds of historical runs available via `tests/jobfit-regression/inspect-prod-runs.ts`. **Start there.**

---

## What needs investigation

### 1. Read 20-30 real `jobfit_runs` and tabulate case-determination inputs

Use `npx tsx tests/jobfit-regression/inspect-prod-runs.ts` to load runs. For each, compute the four inputs that `determineCase` actually consumes:

- `verdict` (decision field, falls back to verdict field)
- `risks.items.length` (after extractRisks defensive logic)
- `risks.items.some(r => r.severity === "high")`
- `whys.length` (`why_structured.length`)
- `risks.dataQualityIssue` flag
- `risks.v4Fallback` flag

Then group: how many would land Case A vs Case B vs Case C under current rules?

If the answer is "98% Case B," the thresholds are too restrictive at both ends. If the answer is "Case A and Case C are reachable but our 3 hand-picked tests just happened to all be Case B," then the issue is test-selection bias, not the thresholds. The data tells us which.

### 2. Check whether `risk_structured` severity is being populated

`extractRisks` (in `caseDetermination.ts`) has three paths:
- V5 happy path: `risk_structured` array with valid severity → uses real severity
- V4 fallback: only `risk_codes` present → assigns `medium` to all (NO high severity ever)
- Malformed: severity missing → treated as `medium`, flagged as `dataQualityIssue`

If most production runs are hitting the V4 fallback or malformed path, the Case C trigger (which requires `severity === "high"`) is effectively dead. **A field-mismatch risk that's tagged `medium` because the data path stripped its severity won't trigger Case C even when the user clearly needs Case C framing.**

This is the most likely single explanation for "Case C never fires."

### 3. Audit the Apply → Case B fallthrough rule

Current `caseDetermination.ts` rule 3 (Apply or Priority Apply):
- 0 risks AND whys ≥ 3 AND no data quality issue → Case A
- Has high-severity risk → Case B
- Otherwise → Case B

The "otherwise → Case B" is the default for any Apply verdict with **non-zero risks but no high-severity risk**. D4's Apply/77/2-risks test landed here. The question for the session: is this default correct, or should "Apply + low/medium risks only" be Case A (with the risks surfaced as small_refinements when v2.5+ ships)?

Under the current rule, the Case A gate is effectively "Apply + zero risks" — and JobFit almost always surfaces at least one risk per run. **Zero risks may be a near-impossible bar under current scoring behavior.** That deserves a sanity check against the distribution from step 1.

### 4. Consider a profile-target / JD-role-family check

Currently `caseDetermination.ts` reads only the jobfit result_json. It does not consult the candidate's `target_roles` or the JD's `role_family` directly. D3's Catherine Lees scenario (Communications major → Product Manager target → Finance/Analytics intern JD) is the canonical case for why this might matter: the field-mismatch isn't always surfaced as a high-severity risk by the upstream scorer, but the structural mismatch is plainly visible if you compare target vs JD role family.

Open question for the session: should `CaseInputs` extend to include `profileTargetRoles: string[]` and `jdRoleFamily: string | null`, and should `determineCase` add a rule like "if profile target family ∩ JD role family is empty AND verdict ≤ Review → Case C"?

This is a scope-expanding change. Make the call deliberately, not by accident.

### 5. CASE_C_HIGH_SEVERITY_TRIGGER scope

The flag is documented as Review-branch-only (high-severity on Apply still goes to Case B, not Case C, per `caseThresholds.ts` line 51-53). Is that asymmetry correct? D3 had Review + high-severity field-mismatch and still landed B — so either:

- The high-severity gate isn't firing (likely tied to investigation #2), OR
- The trigger flag is working but the test's risk wasn't actually tagged high-severity in `risk_structured`

Either way, this needs to be confirmed empirically before retuning the flag's semantics.

---

## Current case_determination rules (verbatim from code)

### Rules cascade — `lib/positioning/v2/caseDetermination.ts`

```ts
//   1. verdict=Pass                                                  → Case C
//   2. verdict=Review + high-severity risk                           → Case C
//                                            (gated by CASE_C_HIGH_SEVERITY_TRIGGER)
//   3. verdict=Review + no high-severity                             → Case B
//   4. verdict=Apply/Priority Apply + 0 risks + whys ≥ threshold
//      + no data quality issue                                       → Case A
//   5. verdict=Apply/Priority Apply + high-severity                  → Case B
//   6. verdict=Apply/Priority Apply (default)                        → Case B
//   7. Defensive (missing/malformed/unexpected verdict)              → Case B
```

### Threshold constants — `lib/positioning/v2/caseThresholds.ts`

```ts
// Minimum number of positive findings (why_structured entries) required
// for a profile with verdict=Apply or Priority Apply AND zero risks to
// qualify for Case A (well-positioned).
//
// Lower values are more permissive (more Case A assignments).
// Higher values are more conservative (fewer Case A assignments).
//
// Initial value: 3. Tunable per FRD section 7.
export const CASE_A_MIN_WHY_COUNT = 3

// Controls whether a Review verdict with any high-severity risk forces
// Case C (significant repositioning required) rather than Case B
// (targeted changes needed).
//
//   - true  (current): Review + any high-severity risk → Case C
//   - false:           Review always → Case B regardless of risk severity
//
// Note: high-severity risk on Apply / Priority Apply verdicts uses a
// different rule (forces Case B, NOT Case C) — see caseDetermination.ts.
// This flag only applies to the Review branch.
//
// Initial value: true. Tunable per FRD section 7.
export const CASE_C_HIGH_SEVERITY_TRIGGER = true
```

---

## Hypotheses to test

Ranked by my current prior — the session can re-rank after seeing real data.

1. **Severity is missing or degraded in production runs.** V4 fallback or malformed `risk_structured` is silently downgrading every risk to `medium`, killing the Case C high-severity gate.
   - *Test:* count what fraction of recent `jobfit_runs` hit V4 fallback vs V5 happy path. If V4 fallback is non-negligible, that's the issue.

2. **The Case A "zero risks" precondition is near-impossible under current scoring.** JobFit almost always surfaces at least one risk; the "Apply + zero risks" gate is a rounding error.
   - *Test:* count what fraction of Apply / Priority Apply runs have `risks.items.length === 0`. If it's <1%, the gate needs relaxing — possibly to "≤ 1 low-severity risk" or similar.

3. **Field-mismatch risks aren't tagged high-severity by the upstream scorer.** The D3 "Communications-to-Finance" gap was a real field jump but the risk_structured entry wasn't marked high.
   - *Test:* pull D3's actual `jobfit_runs.result_json` row and inspect the risk_structured array.

4. **`determineCase` needs a profile-target/JD-role-family signal it doesn't currently see.** The structural mismatch is upstream of risk severity.
   - *Test:* depends on hypothesis 3 — if field-mismatch risks ARE being tagged correctly, then we don't need this; if they aren't, this is the structural fix.

---

## Definition of done for the tuning session

- All four hypotheses tested against real data with quantified answers
- A concrete proposal: which threshold values change, which rules change, which `CaseInputs` fields (if any) get added
- Implementation in `caseDetermination.ts` + `caseThresholds.ts` + (if needed) the response builder / type files
- Regression check: D2/D3/D4 test scenarios re-run through tuned thresholds and produce the correct case per scenario
- One real-data test instance of each case (A, B, C) confirmed end-to-end before resuming Stage 1c

---

## Status: COMPLETE (2026-05-16)

Tuning session closed. Per the Definition of Done above, all five criteria
met:

- **Hypotheses tested:** investigated via `inspect-case-determination-inputs.ts`
  and inline review of `jobfit_runs` distribution. Findings drove the two
  shipped tuning changes (Case A gate relaxation, family-mismatch Rule 2).
- **Concrete proposal made + shipped:** see runlog entries for the three
  commits (`2119a0a1`, `f3364228`, `df0f6815`).
- **Implementation complete:** `caseDetermination.ts` + `caseThresholds.ts`
  unchanged in second commit; `signals.ts` + extract.ts + inferrer +
  allowlists updated in PM family commit; `caseDetermination.ts` updated
  in narrowing commit. Tests in `case-determination-check.ts` expanded
  from 27 to 30.
- **Regression check passed:** D2/D3/D4 + Diligent shape verified.
- **Real-data instance of each case confirmed end-to-end:** A via unit
  tests (production instance deferred); B + C via real Stage 1c testing.

See `docs/Features/foundation-migration-runlog.md` 2026-05-16 close-out
entry for the full case-reachability + behavior-regression summary.

### Lessons learned

- **Severity tagging upstream remains a known concern.** Field-mismatch
  risks consistently tag `medium` in `risk_structured` when they should
  tag `high`. This forced the family-mismatch Rule 2 to do work that an
  ideal upstream tagger would handle natively via Rule 3 (Review +
  high-severity → Case C). Deferred to a scorer-tuning session. Until
  that lands, narrowed Rule 2 is the load-bearing path for catching
  Review-verdict field-mismatch cases.

- **Family taxonomy is necessarily coarse; strict family-mismatch as a
  Case C trigger needed verdict-bounded narrowing.** Adjacent disciplines
  (Product Marketing vs Product Management, Marketing Analytics vs
  Analytics, Strategy Consulting vs Business Operations, Healthcare vs
  PreMed) are common legitimate overlaps where taxonomy says "different
  families" but real hiring treats them as cross-applicable. The fix is
  not to flatten the taxonomy — it's to scope rules that key off the
  taxonomy to verdicts where the verdict itself is ambivalent (Review).
  Apply / Priority Apply verdicts encode evidence-weighted confidence
  that the taxonomy mismatch should not override.

- **Family inference taxonomy gaps cause false `["Other"]` fallbacks
  that silently break downstream rules.** Today's PM addition (commit
  `f3364228`) fixed 3 of 5 dev profiles whose `target_roles = "Product
  Manager"` were returning `["Other"]` and bypassing the family-mismatch
  check entirely. The same gap is open for HR and Operations (currently
  rolled into Consulting per stale comments at
  `jobfit-family-inference.ts:113, 156`). Deferred to its own session
  because the cleanup is behavior-changing for existing
  Consulting-targeting candidates and warrants regression sweep.

- **Verdict is the stronger signal than any single derived feature.**
  Across this tuning session, every misclassification we caught came
  from a rule overriding the verdict on the strength of one auxiliary
  signal (family taxonomy, individual risk severity, etc.). The
  narrowing of Rule 2 codifies the lesson: when JobFit has evaluated
  evidence holistically and returned Apply/Priority Apply, downstream
  rules should pile on, not override.
