# Positioning Phase 2 — State Check 2026-05-27

> Read-only state check. No code, schema, or DB changes were made. Scope:
> verify the actual code state of Positioning Phase 2 on dev against the
> assumptions in `docs/Features/positioning-phase2-frd.md` (2026-05-16) and
> the build snapshot that set the 3-day estimate.

## Summary

**The investigation's premise is stale across all three items.** The FRD's
"itemPopulator returns empty arrays" stub state has not been true since
~2026-05-19. Between the FRD date (2026-05-16) and today, a full **Phase 2
v1 build sequence shipped to dev**: Stage 2c (real Claude wiring + real
grounding validator, 6 commits), Stage 2b (real itemPopulator, 3 commits),
and a 13-commit v1 build (A1, A2, A3, B1–B4, C1, C2, G1, D1, D2, D3) whose
final commit message reads *"v1 build D3 of 1 remaining — v1 ships."*

What's actually true:
- **Stage 2b itemPopulator is fully real**, not a stub. It returns `[]` only
  for the documented Case A/C gate — correct v0.1 behavior, not a stub.
- **Pattern B prompt exists and works but has had zero tuning** since it was
  first written (commit `a4b614e2`). The documented "corporate paraphrase"
  failure mode is plausible but **unmeasured** — there is no telemetry, test
  data, or rejection-rate evidence anywhere in the repo.
- **Manual-entry pre-fill is NOT a regression** — the current behavior
  (pre-fill original bullet for Pattern B, empty for A/C) matches FRD §6.9.1
  verbatim.

**The surprise:** the real gap isn't build work — it's **verification**. ~22
feature commits shipped with (a) ~~**almost no automated tests** (one DB-lookup
test; none of the FRD §8 unit suites exist)~~ **[CORRECTED 2026-05-27 — this was
wrong; see Testing infrastructure §. A comprehensive 17-file Phase 2 suite
exists and passes 17/17; the FRD §8 suites and verbatim invariant ARE covered.
The claim was a probe error.]**, (b) **no runlog narrative** for the entire v1
build, and (c) **no live-client validation** (an FRD acceptance criterion). The
build is "done" by commit count and largely test-covered, but not yet
live-client validated against the project's own acceptance bar.

---

## State by area

### Stage 2b — itemPopulator

**Current state: SHIPPED and real.** `lib/positioning/v2/phase2/itemPopulator.ts`
(402 lines) orchestrates real candidate extraction. It is not a stub.

**a) What it returns:** A `PopulateItemsResult` = `{ items: PhaseTwoItem[],
aiCostCents }`. Items array is `[headline?, ...bullets(≤3), ...gaps(≤3)]` in
canonical order. It returns `{ items: [], aiCostCents: 0 }` in exactly one
case: `positioningRun.case_assigned !== "B"` (`itemPopulator.ts:178`). That is
the **documented v0.1 Case A/C gate** (FRD §6.5.1), not a stub — the `/start`
route 400s Case A/C upstream and this is defense-in-depth.

**b) What it consumes:**
- `positioning_run_v2` row — case gate + run id for telemetry (`itemPopulator.ts:178`).
- `jobfit.result_json` — `why_structured` → bullet candidates;
  `job_signals.requirement_units` → gap candidates; `job_signals.jobTitle/
  jobFamily` → headline candidate (`itemPopulator.ts:186-188`).
- `persona.resume_text` — the verbatim anchor source.
- `caseSpecific` — **passed through but unused** (`void caseSpecific`,
  `itemPopulator.ts:175`), wired for forward-compat.

It also makes **populator-time AI calls** per gap: G1 `classifyGapShape`
(heuristic-first, LLM fallback) and A3 `suggestBulletsForGap` (verbatim-filtered
top-3), run serially with cost-cap short-circuiting (`itemPopulator.ts:281-391`).

**c) FRD §6.2 delta:** The shipped code has moved beyond the FRD:
| FRD §6.2 says | Code reality |
|---|---|
| Headline from `case_specific.headline_recommendation` | From `job_signals.jobTitle` + **real resume headline detection** (A1: `extractHeadlineCandidate`, with `replace`/`synthesize` modes). `caseSpecific` unused. |
| Bullets from "risks tagged bullet-addressable" | From `why_structured` reframe-flavored entries anchored to a verbatim resume line |
| Gaps from "risks where gap maps to JD req" | From `job_signals.requirement_units` (core only) not represented in resume |
| Surface if high severity OR 5+ pt impact | No explicit severity/5-pt threshold visible; uses reframe-flavored filter + core-requirement filter, capped at 3 each |

**d) Architectural invariant (`original_bullet` verbatim in `resume_text`):
ENFORCED, real.** Multiple load-bearing layers:
- `anchorBullet.ts:107-137` (`anchorLeadToResume`) returns a verbatim `"\n"`-
  bounded slice of `resume_text`; bullet chars/whitespace/casing preserved.
- `itemPopulator.ts:232-236` explicitly forbids trimming/normalizing
  `c.original_bullet` before assignment.
- A3 `suggestBulletsForGap` post-filters every suggestion with
  `resume.includes(d)` (`aiClient.ts:407-410`).
- `resumeComposer.ts:36-42` documents first-occurrence locate-and-replace that
  depends on the invariant.

The invariant is the most carefully-defended part of the whole subsystem.

### Pattern B prompt

**Current state: exists, real, untuned.** Lives at
`lib/positioning/v2/phase2/prompts/bulletPrompt.ts` (not `patternB.ts`).
Shared system prompt at `prompts/systemPrompt.ts`.

**a) What it instructs:** 1 reframed bullet, 1–2 sentences, ≤30 words; use only
facts from original bullet + user's typed response; align language to the JD
excerpt; do NOT invent metrics/employers/certs; do NOT pull in unrelated resume
facts; return strict JSON `{"drafts":["..."]}`; insufficient-evidence escape
hatch `{"drafts":[],"reason":"insufficient_source_evidence"}`
(`bulletPrompt.ts:77-89`). System prompt carries the verbatim "no invention"
constraint (`systemPrompt.ts:38-40`).

**b) Documented failure mode:** The "tunes toward corporate paraphrases
(stakeholder/vision/drive) the validator rejects" failure mode is **not
documented anywhere in the repo** — not in the FRD, not in code comments, not
in the runlog. It exists only in the build snapshot/memory that drove this
investigation. The mechanism is plausible: the grounding validator's
`COMPETENCE_WORDS` set (`groundingValidator.ts:162-180`) does **not** include
"stakeholder" or "vision" (it does include "drove"), so a draft using those
words would be rejected by Rule 3 unless the source contains them.

**c) Tuning since FRD: NONE.** `git log` on `bulletPrompt.ts` shows exactly one
commit — `a4b614e2` (Stage 2c commit 1, the original template). The prompt has
never been edited since creation.

**d) Validator-rejection threshold / test data: NONE EXISTS.** The FRD §11
telemetry plan ("review first 100 rejections, loosen if false-reject rate >
20%") has not been exercised — Phase 2 is dev-only with no live traffic. The
`/draft` route logs `GROUNDING_REJECTED` / `INSUFFICIENT_EVIDENCE` markers
(`draft/route.ts:424-432`) but no rejection corpus has been collected and no
failure-rate number exists.

### Manual-entry pre-fill

**Current state: matches FRD spec — NOT a regression.**

**a) What the textarea pre-populates:** On a `/draft` 422 (grounding failure),
`handleGenerate` enters manual-entry mode and sets the override textarea:
original bullet for Pattern B, empty for gap/headline
(`items/[itemId]/page.tsx:225-232`):
```ts
if (item.type === "bullet") {
  setOverrideText(item.original_bullet)
} else {
  setOverrideText("")
}
```

**b) Where the value comes from:** `item.original_bullet` (the verbatim resume
bullet) for Pattern B; empty string otherwise.

**c) Regression present? NO.** This matches FRD §6.9.1 step 3 verbatim:
*"pre-populated with the original bullet (for Pattern B) or empty (for Patterns
A and C)."* The other textareas are also correct: the Pattern B/C "Your
response" field pre-fills from the saved `user_response` (resume behavior,
`page.tsx:169-171`); the edit-draft field pre-fills from `item.draft`
(`page.tsx:875-877`). **No textarea pre-fills incorrectly against the spec.**

If the snapshot treats original-bullet pre-fill as a regression, that's a
**product opinion that contradicts the written FRD**, not a bug — see Open
Questions.

### Testing infrastructure

> **⚠️ CORRECTED 2026-05-27 (Peri build session).** The original text below this
> callout was **WRONG** — it claimed "exactly one test file exists" and "none of
> the FRD §8 suites exist." Both false. A subsequent verification session found a
> **comprehensive, green Phase 2 test suite** and ran it. The corrected state is
> recorded here; the original (struck through) is kept for the record.
>
> **Probe error that caused the miss (so future sessions don't repeat it):** the
> original investigation globbed `**/*.test.ts` / `**/*.spec.ts` and
> `tests/**/*phase2*` (a *filename* match). The repo convention is `*-check.ts`
> run via `npx tsx`, living in a `phase2/` *directory*. The filename globs matched
> only the one file whose *name* contained "phase2" (`phase2-run-lookup-check.ts`)
> and missed the other 16. **Correct probe:** glob the directory
> (`tests/positioning-v2/**`), don't assume a `*.test.ts` naming convention.

**Corrected state: 17 Phase 2 test files exist, all passing (17/17 green).**

Located in `tests/positioning-v2/phase2/` (17 `*-check.ts` test files + a shared
`fixtures.ts` module = 18 files). Run 2026-05-27 via `npx tsx` (AI paths mocked
via `invokeClaudeImpl`/`fetchImpl` — no live Anthropic calls; the one DB test
`phase2-run-lookup-check.ts` ran against dev with `--use-system-ca`). Result:
**17 passed, 0 failed.**

Coverage of the FRD §8 surface (the suites the original text claimed absent **all
exist and pass**):
- **`groundingValidator`** — `grounding-validator-check.ts` (27 checks: numeric
  strict, proper-noun strict, content-word lenient, stem matching, paraphrase
  rejection, per-pattern A/B/C grounding, `isAcceptableAiResult`).
- **`resumeComposer`** — `resume-composer-check.ts`.
- **`itemPopulator`** orchestrator — `item-populator-check.ts` (happy path,
  caps, ordering, case gate, zero-item edges).
- **Verbatim invariant** — covered as a **permanent architectural test**:
  `item-populator-check.ts` **Test 2** loops every emitted bullet asserting
  `resume_text.indexOf(original_bullet) >= 0` (+ headline original verbatim for
  replace-mode), and `anchor-bullet-check.ts` tests 11/12/26/27 (substring,
  bullet-prefix preserved, internal whitespace preserved, tie-break order).
- **Pattern A1/A2** — `extract-headline-candidate-check.ts` +
  `item-populator-check.ts` Test 1 (replace) / Test 7a (synthesize) / 7b (null).
- **gap_shape** — `classify-gap-shape-check.ts` + `extract-gap-candidates-check.ts`.
- Plus: `ai-client-check.ts`, `anthropic-client-check.ts`,
  `suggest-bullets-for-gap-check.ts`, `extract-bullet-candidates-check.ts`,
  `draft-cache-check.ts`, `decision-resolver-check.ts`, `prompt-templates-check.ts`,
  `item-populator-templates-check.ts`, `classify-gap-shape-prompt-check.ts`,
  `phase2-run-lookup-check.ts`.

**Genuine remaining gaps** (small, and now correctly scoped):
1. **No live-Claude eval harness** — every AI path is mocked, so nothing measures
   the *real* Pattern B prompt's rejection rate against the validator. This is the
   one truly-new piece (Q3.1, feeds Q2 tuning).
2. **No route-handler (HTTP-layer) tests** — `/start` Case A/C → 400, 409
   conflict; `/draft` retry → 422, cost-cap → 429. The underlying lib logic IS
   tested (e.g. `item-populator-check.ts` Tests 3/4 cover the Case A/C gate at the
   populator level); only the HTTP envelope is untested. Deferred per Q3 re-scope.

So the verification debt is far smaller than originally claimed: the load-bearing
verbatim invariant and the grounding validator are already regression-protected
and green. The original "single largest gap" framing was an artifact of the probe
error.

~~**State: near-absent relative to FRD §8.**~~ *(struck — see correction above)*

~~- **Exactly one test file exists:** `tests/positioning-v2/phase2/phase2-run-lookup-check.ts`…~~
~~- **None of the FRD §8 suites exist:** no `itemPopulator` unit test, no `resumeComposer` determinism test, no `groundingValidator` accept/reject test…~~
~~- **No A/B/C pattern regression suite** exists. **Pass rate: unknown.**~~
~~This is the single largest gap: ~22 feature commits … with one lookup test as the only automated coverage.~~

---

## Drift from FRD

| # | FRD reference | FRD says | Code reality |
|---|---|---|---|
| 1 | §6.2 headline source | From `case_specific.headline_recommendation` | From `job_signals.jobTitle` + real resume headline detection (A1); `caseSpecific` passed but unused (`itemPopulator.ts:175`) |
| 2 | §6.2 bullet source | Risks "tagged bullet-addressable" | `why_structured` reframe-flavored entries anchored to verbatim resume lines |
| 3 | §6.10 composition | 3-way: headline replace, bullet replace, gap append to Skills/experience | **9-outcome** `compositional_outcome` model (reword_existing / add_new / note_for_cover_letter / acknowledge_genuine_gap + 5 shape-routed adds) — A2/C1/C2/B2/B3/B4. Entirely absent from FRD. |
| 4 | §6.3 state schema | No `gap_shape` field | `gap_shape` (7 values) classified at populator time by G1 hybrid heuristic+LLM. Absent from FRD. |
| 5 | §6.3 state schema | No `final_text` field | `final_text` added as composer source-of-truth on all three item types |
| 6 | §6.8 grounding validator | Tokenize into noun phrases / NER / numeric / tool-skill mentions | 3-rule heuristic (numeric strict / capitalized-proper-noun strict / content-word lenient w/ stem + `COMPETENCE_WORDS`). Documented deviation; consistent with FRD's "simple substring + entity overlap heuristics" fallback line. |
| 7 | §6.9.1 / §6.5.4 revise | Re-decide returns 409 ("not in v0.1") | Shipped + documented as known limitation (runlog 2026-05-18) |
| 8 | `draft/route.ts:14` comment | — | Stale: still calls aiClient "STUB v0.1" though Stage 2c wired real Claude. Cosmetic doc drift. |
| 9 | Runlog narrative | — | **Runlog stops at Stage 2a (05-16) + no-revise note (05-18).** The entire A1→D3 v1 build (~13 commits) has **no runlog entry.** Documentation gap. |

**Section-number note:** the investigation brief references "§10 Limitations"
and "§11 Open questions." The FRD has no Limitations section. Actual structure:
§9 Risks, §10 Dependencies, §11 Operational constraints, §12 Open questions.
Mapping to **§12 Open questions**: §12.4 (ordering: headline→bullets→gaps) is
implemented as specified; §12.5 (gap insertion anchor) was massively expanded
via `compositional_outcome` + `gap_shape`; §12.11 (revisability → 409) shipped
and documented; §12.1 (surfacing threshold) is only partially realized (caps at
3, no explicit 5-point impact threshold).

---

## Revised time estimates

**Original estimate: 3 days** (Stage 2b Day 1, Pattern B + UI polish Day 2,
beta onboarding Day 3 — per build snapshot).

That estimate assumed a stub. The build is shipped. Re-scoped against reality:

| Item | Original | Revised | Why |
|---|---|---|---|
| Stage 2b itemPopulator | 1 day (build) | **0h build / 2–4h verify** | Already shipped + real. Needs a unit test + a real-data spot-check, not a build. |
| Pattern B prompt tuning | part of Day 2 | **0.5–1 day** | Prompt is untuned but the fix is small. The cost is **building an eval harness + collecting a rejection corpus to tune against** — there is no data today. Iterate prompt → re-validate. |
| Manual-entry pre-fill fix | part of Day 2 | **0h (not a bug) / 15 min** | Matches FRD §6.9.1. Only work if Peri overrides the spec (one-line change). |

**Subtotal of the three named items: ~0.5–1 day** (almost entirely Pattern B,
which is gated on test data, not code).

**The work the snapshot didn't name (the real remaining scope):**

| Hidden item | Estimate | Why it blocks "v1 ships" |
|---|---|---|
| Test infrastructure (FRD §8 unit + integration suites) | **1.5–2.5 days** | itemPopulator, resumeComposer (9 outcomes), groundingValidator, gap classifier, and 5 API endpoints have ~no automated coverage. Verbatim invariant has zero regression protection. |
| Live-client validation (FRD acceptance criterion) | **0.5–1 day** | FRD §14 requires one real Case B client end-to-end, <15 min, zero grounding violations. Not done. |
| Runlog + FRD reconciliation | **2–4h** | Document the A1→D3 build; reconcile §6.2/§6.10/§6.3 drift; fix stale STUB comment. |

**Risk-adjusted estimate for a genuinely shippable v1: ~3–4.5 days** — but the
shape is inverted from the original plan. It is **verification + tuning +
validation**, not build-from-stub. The original 3 days of "build" is already
spent; the remaining 3–4.5 days is making sure what shipped is correct and
defensible.

---

## Recommended build sequence

1. **Reconcile docs first (½ day, do this before touching code).** Write the
   runlog entry for the A1→D3 build, update FRD §6.2/§6.3/§6.10 to match the
   shipped multi-outcome + gap_shape model, and fix the stale `STUB v0.1`
   comment. Rationale: the next builder (or Peri) needs an accurate map before
   sequencing anything; right now the FRD actively misdescribes the code.

2. **Test infrastructure (parallelizable, highest leverage).** Build the FRD §8
   unit suites — `groundingValidator` and `resumeComposer` first (pure
   functions, no I/O, fastest to cover and the highest-stakes correctness
   surface — the verbatim invariant and interview-integrity gate live here).
   Then `itemPopulator` with mocked AI deps (the DI hooks already exist:
   `suggestBulletsImpl`, `classifyGapShapeImpl`). This is independent of items
   3–4 and should run first/concurrently.

3. **Pattern B prompt tuning (depends on #2's harness).** Cannot tune
   responsibly without a way to measure rejection rate. Use the grounding
   validator + a small fixture set of realistic bullet+response pairs as the
   eval harness, then iterate the prompt. **Blocked on test data, not on
   Stage 2b** — so it does not block, and is not blocked by, the itemPopulator
   work.

4. **Manual-entry pre-fill: decide, don't build.** It's spec-compliant. Resolve
   the product question (below) first; only touch code if Peri overrides the
   FRD.

5. **Live-client validation last** (the FRD acceptance gate), once tests +
   prompt tuning give confidence.

**Parallelization:** Stage 2b is done, so it doesn't gate anything. Test
infra (#2) and prompt tuning (#3) share the eval harness but are otherwise
independent of the doc reconciliation (#1). The classic "Stage 2b blocks
Pattern B" dependency from the snapshot no longer exists.

**Hidden dependency the FRD didn't surface:** Pattern B tuning depends on the
**grounding validator's `COMPETENCE_WORDS` list and 3-rule heuristic**, not just
the prompt. If corporate paraphrases are the problem, the lever is split
between the prompt (stop generating them) and the validator (decide which
general-competence words are allowed). Tuning one without the other will
chase its tail.

---

## Open questions for Peri

1. ~~**Manual-entry pre-fill — is the FRD spec what you actually want?**~~
   **RESOLVED 2026-05-27 (Peri): option (b) — empty pre-fill.** The Pattern B
   manual-entry textarea will pre-fill empty (not the original bullet), forcing
   genuine reframing and avoiding "accept unchanged." This is a deliberate
   override of FRD §6.9.1, not a bug fix.
   - **Pending build work** (NOT done in this read-only check): change
     `app/api/.../items/[itemId]/page.tsx` ~line 228 so the Pattern B branch
     calls `setOverrideText("")` instead of `setOverrideText(item.original_bullet)`,
     and update FRD §6.9.1 step 3 to reflect "empty for all patterns."
   - Original options for the record:
     **(a)** keep original bullet (FRD spec, zero work) ·
     **(b)** ✅ empty pre-fill ·
     **(c)** pre-fill the user's typed response.

2. ~~**Pattern B prompt direction**~~
   **RESOLVED (deferred) 2026-05-27 (Peri): direction (c) — defer to a focused
   session.**

   The Q3.1 eval-harness baseline (**0/9 accept rate** — see
   `tests/positioning-v2/phase2/snapshots/pattern-b-eval-baseline-2026-05-27.json`)
   revealed the dominant failure mode is **validator over-strictness on ordinary
   English** (connectives, prepositions, paraphrase verbs, numeric-format
   variants — e.g. a draft rejected solely on the word "per"; another on
   "$5,000" vs source "5,000 dollar"), **NOT** prompt corporate-paraphrase
   issues (only 2/9). The original Q2 framing — "tune the prompt to stop
   corporate paraphrases" — was based on incomplete information.

   Validator-first tuning is the correct technical direction per the data, but
   the work is a **production-grade integrity change**: `groundingValidator.ts`
   guards against ungrounded claims — the methodology's load-bearing guarantee.
   Loosening it requires explicit design for what's safe to allow vs. what stays
   guarded, plus test coverage of the inverse failure mode (false-accepts). That
   deserves an FRD-level design pass, not a tail-end tune under time pressure.
   Deferring doesn't worsen Pattern B — it's already in this state in production
   today, beta hasn't started, and no urgency overrides designing it carefully.
   Tracked as **KI-11** in the runlog.

   Original options for the record:
   **(a)** validator-first — ✅ correct direction per data; deferred to focused
   session ·
   **(b)** prompt-first — ✗ wrong fix per data (addresses ≤2/9, degrades drafts) ·
   **(c)** ✅ defer — chosen.

3. ~~**Is "v1 ships" actually shippable, or code-complete-but-unverified?**~~
   **RESOLVED 2026-05-27 (Peri): Option (c) — middle ground.** A **minimum
   verification surface** (~1 day), not the full 3–4.5 day FRD §8 scope.
   Accepting "code-complete-but-not-fully-verified" for everything outside the
   critical scenarios below. The minimum surface:
   - **Regression coverage for the verbatim invariant** — the load-bearing
     guarantee that `original_bullet` appears verbatim in source `resume_text`
     (and that `resumeComposer` locate-and-replace depends on it).
   - **5–8 high-leverage scenario tests** — one per `gap_shape`, one per pattern
     (A1 / A2 / B1–B4 / C1 / C2), one per case determination.
   - **Eval harness for Pattern B tuning** (overlaps Q2 scope — built once,
     serves both).
   - **Skip** the comprehensive FRD §8 unit suites for itemPopulator /
     resumeComposer / groundingValidator.
     *(Superseded — the §8 suites already exist (17 tests, all passing); see
     Testing infrastructure §. The "skip" decision still holds in substance: we
     don't author parallel coverage. The rationale changed, not the decision —
     we skip because they exist, not because we'd choose to forgo them. Original
     premise was a probe error.)*

   Estimated scope: **~1 day** focused verification vs. 3–4.5 days for full
   coverage — ~80% of the safety for ~25% of the cost.

   Reasoning (for the record): beta coaches are partners helping shape the
   product, not production customers expecting polished output. The verbatim
   invariant is the load-bearing guarantee and deserves regression coverage.
   Comprehensive coverage of the entire feature surface isn't worth deferring
   beta outreach by 3–4.5 days.

   **Pending build work** (NOT done in this read-only check):
   - Verbatim-invariant regression test (highest priority).
   - 5–8 scenario tests across gap_shape / pattern / case.
   - Eval harness (shared with Q2).
   - Live-client validation (FRD §14 gate) once the above gives confidence.
   - Options for the record: **(a)** ship as-is (unverified) ·
     **(b)** full 3–4.5 day verification ·
     **(c)** ✅ minimum verification surface (~1 day).

4. ~~**`caseSpecific` is dead-wired into the populator.**~~
   **RESOLVED 2026-05-27 (Peri): Option A — remove now.** `caseSpecific` is
   structurally `null` in every Phase 2 path (`generateCaseSpecific` returns
   `null` for Case B at `caseSpecific.ts:231`; Phase 2 serves Case B only), and
   computing it costs **two extra DB round-trips per `/start`**
   (`getCandidateTargeting` at `start/route.ts:243` + `resolveCareerStage` at
   `:247`, used nowhere else) plus the `generateCaseSpecific` call — all in
   service of an always-`null` value the populator then `void`s
   (`itemPopulator.ts:175`).

   Reasoning (for the record):
   - The two DB round-trips per `/start` to compute structurally-null
     `caseSpecific` is real recurring latency cost.
   - The forward-compat justification is hollow — `headline_recommendation`
     was never on the `CaseSpecificData` type (`types.ts:199-204`), and
     headline handling is permanently owned by `extractHeadlineCandidate`
     (Pattern A1).
   - The v0.2 Case A/C consumer shape is different enough (promoting
     `small_refinements` into items, using `high_severity_gap_summary` as gap
     context) that the current plumbing would get refactored anyway.
   - Re-adding the param + two lookups in v0.2 is trivial; carrying dead
     plumbing now is the worse trade.

   **Pending build work** (NOT done in this read-only check; scoped into the
   next build session as Tier 2 + Q4):
   - `lib/positioning/v2/phase2/itemPopulator.ts` — remove the `caseSpecific`
     param (and the `void caseSpecific` line).
   - `app/api/positioning/v2/phase2/start/route.ts` — delete the
     `caseSpecific` block (`:249-261`) + the two upstream DB calls
     (`getCandidateTargeting` `:243`, `resolveCareerStage` `:247`) that only
     feed it.
   - Type/JSDoc updates as needed.
   - Verify no other consumer breaks (those imports must not be used elsewhere
     in the route).
   - Options for the record: **(a)** ✅ remove now ·
     **(b)** keep + fix the misleading JSDoc ·
     **(c)** actually wire it (not actionable in v0.1 — Case B `case_specific`
     is `null` by design).

---

## Risks

- ~~**Verification debt is the dominant risk.**~~ **[CORRECTED 2026-05-27 —
  overstated due to the probe error; see Testing infrastructure §.]** The
  verbatim invariant **does** have regression protection
  (`item-populator-check.ts` Test 2 "permanent architectural test" +
  `anchor-bullet-check.ts`), and the grounding validator, composer, and
  populator orchestrator are all unit-tested and green (17/17). A refactor to
  `anchorBullet`/`itemPopulator`/composer would be **caught** by the existing
  suite. The residual verification debt is narrow: (a) no live-Claude eval
  harness (Q3.1, in progress) and (b) no HTTP route-handler tests (deferred).
  Original "without tests, every change requires manual re-validation" framing
  no longer applies.

- **No telemetry to tune against.** Pattern B tuning, validator threshold
  (FRD §11's "first 100 rejections"), and cost-cap calibration (§12.7) all
  assume data that doesn't exist yet (dev-only, no live traffic). Tuning before
  data is guessing; the eval harness is a prerequisite, not optional.

- **FRD no longer describes the code.** The shipped 9-outcome composer +
  gap_shape classifier are substantial systems absent from the FRD. Anyone
  scoping from the FRD will mis-estimate. The doc reconciliation (sequence
  step 1) is risk mitigation, not bookkeeping.

- **Grounding validator is a heuristic, by design conservative.** The 3-rule
  approach (`groundingValidator.ts`) has a documented known leak
  (sentence-start proper-noun stem match) and an unknown false-reject rate.
  The FRD's own §6.8 flags moving to a classifier if false-rejects exceed ~20%.
  Until measured, the UX risk (users dumped into manual-entry too often) is
  unquantified.

- **Dev-only + migration drift.** `phase2_runs` was applied to dev via the SQL
  Editor workaround (Foundation Risk 6; runlog 2026-05-16) and to prod in the
  2026-05-25 schema sync. Any prod promotion of Phase 2 inherits the standing
  dev migration-tracker drift caveat.

---

*Report file: `docs/positioning-phase2-state-check-2026-05-27.md`*
