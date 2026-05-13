# Real-Data Sample Design — Stage 1d (v2 — post-prod-inspection)

**Status:** Design draft v2 — refinements applied + prod source locked. No inference calls until approved.
**Runlog:** `docs/Features/foundation-migration-runlog.md`
**FRD:** `docs/Features/positioning-foundation-frd.md` (section 4.6)
**Prompt:** `scripts/migrate-candidate-targeting/inference-prompt.ts` (locked per DD-15)
**Synthetic results:** `scripts/migrate-candidate-targeting/results/synthetic-*.txt`
**Supersedes:** v1 of this design (dev DB source assumption now obsolete)

---

## Goal

Validate the locked prompt's inference quality against a representative sample of real-shape candidate profiles. Synthetic testing confirmed structural guarantees (lane, sub-lane, description, no hallucinations) and characterized confidence calibration. Real-data testing measures whether those properties hold on actual prod-shape data, and whether the confidence distribution clears the FRD's ≥85% high-confidence threshold.

This is **inference-only**. No `candidate_targeting` writes. No effects on prod. Output is a timestamped results file gitignored locally; migration execution is a separate explicit step.

---

## 0. Why the source changed: dev DB inspection

Dev DB (`zydrqckpwidipwbhrfgd.supabase.co`) inspection on 2026-05-12 returned:

```
Total profiles:                  4
With profile_text > 100 chars:   0
test_explicit emails:            3
workforcereadynow (staff):       1
JobFit runs:                     0
```

Dev contains 3 test fixtures + 1 staff profile, none with substantive `profile_text`. Not viable for a 50-sample distribution test. Peri authorized **Path A**: pull anonymized samples from prod, read-only, no writes.

---

## 1. Source — prod, read-only

**Prod project:** `ejhnokcnahauvrcbcmic.supabase.co`
**Credentials:** `.env.production.local` (gitignored by `.env*.local` rule at `.gitignore:11`)

### Prod inventory (read-only inspection on 2026-05-12)

```
Client profiles:
  Total:                            122
  With profile_text > 100 chars:     99
  With target_roles (any text):      61
  With resume_text > 50 chars:       97
  Min-signal (none of the above):    23 (19% of total)

Email pattern buckets:
  test_explicit ('test' in email):   41
  workforcereadynow (staff):         10
  plus_addressed (gmail aliases):     7
  other (likely real users):         64

JobFit runs:
  Successful runs:                  755
  Distinct profiles with ≥1 run:     62 (51% of total)

JobFamily distribution across 755 successful runs:
  Marketing      242
  Other          102
  Finance         98
  Sales           80
  Consulting      70
  Analytics       32
  Operations      27
  Engineering     26
  PreMed          22
  Legal           17
  IT_Software     14
  HR              14
  Accounting       4
  Trades           4
  Healthcare       3
```

### Operational guards (locked)

- **Read-only.** Service-role connection is used for SELECTs only; no INSERTs, UPDATEs, or DELETEs touch prod.
- **Cred isolation.** `.env.production.local` is loaded only by the sample-runner script; not imported into other scripts; not committed (verified gitignored).
- **Secret hygiene.** Service-role key never logged to stdout, never written to results file, never echoed in error messages.
- **No PII surfacing.** Raw `target_roles`, raw email strings, and raw resume content stay local. Results file references profiles by `profile_id` (UUID) only. Anonymization (section 2) runs before any text reaches the LLM.
- **No test-fixture filter.** Random sample doesn't filter on email pattern — the migration script doesn't filter either, so the sample matches what migration will encounter. A few test fixtures in the sample mirror migration reality.

---

## 2. Sample size

**Recommendation: 100 random profiles** (no stratification top-ups needed at this size).

Rationale given prod inventory of 122:
- 50 random of 122 = 41% of population — coverage is fine for distribution metrics
- 100 of 122 = 82% — effectively previews what migration will do, with one execution
- Difference in cost: ~$0.15 vs ~$0.30 (negligible)
- Difference in time: ~2 min vs ~4 min

100 also handles minority lanes naturally without stratification — at 82% coverage we'll catch Healthcare (3), Trades (4), Accounting (4) by inclusion rather than ad-hoc top-up.

**Alternative if Peri prefers:** 50 base + 5 stratification top-ups (original v1 plan). Works, but with 122 in population, the cost of going fuller is so small that 100 is the better default.

**Alternative if Peri prefers larger:** run on all 122. Same cost order of magnitude. Becomes effectively a migration dry-run rather than a sample.

Open question, section 6.

### Sampling logic

1. **Random base:** SELECT profiles from `client_profiles`. Random ordering via `ORDER BY random()` with `LIMIT <sample_size>`.
2. **No exclusions.** Per Peri's no-skip rule: include profiles with no `target_roles` AND no JobFit run AND empty `resume_text`. These are real users (19% of prod), and the migration script will encounter them. Measuring what the LLM does with min-signal inputs surfaces a real failure mode.
3. **No de-duplication.** UNIQUE on `client_profiles.id` makes each row distinct.

### What gets collected per profile

- `id` (kept locally for traceability; never shared externally)
- `target_roles` (raw, then anonymized)
- `profile_structured.intakeMeta.currentStatus` (enum-shaped, no anonymization)
- Most recent successful `jobfit_runs.verdict ≠ 'error'` → extract `result_json.job_signals.jobFamily` (may be null)
- `resume_text` (first 500 chars after anonymization)

---

## 3. Anonymization

Applied to `target_roles` and `resume_text` BEFORE inference. `currentStatus` and `jobFamily` are enum-shaped, no anonymization needed.

### What gets stripped

| Pattern | Replacement | Why |
|---|---|---|
| Email addresses (`\S+@\S+\.\S+`) | `[EMAIL]` | PII |
| Phone numbers (multiple US/intl formats) | `[PHONE]` | PII |
| Candidate's stored `name` field (case-insensitive whole-word) | `[NAME]` | PII; pulled from `client_profiles.name` so the regex is targeted not heuristic |
| URLs (`https?://\S+`) | `[URL]` | LinkedIn slugs, portfolio sites may identify |

### What stays

- Company names, school names, job titles, dates — inference signal, not PII at the levels we care about. Aspirational mentions ("targeting roles at McKinsey") are candidate preference, not historical employment. Keeping these improves inference quality.

---

## 4. Output measurement

Distribution-based, not per-case pass/fail. We don't have hypothesized outputs.

### Per-profile log (in the results file)

For each profile:
- `profile_id`
- Anonymized `target_roles` (so the input is visible against the inference)
- Sanitized `resume_snippet` (first 100 chars only, for legibility in the log)
- `currentStatus`, `jobFamily`
- LLM output: `lane`, `sublane`, `primary_other_description`, `confidence`, `reasoning`
- Min-signal flag: was this profile no-target-roles + no-resume + no-JobFit-run?
- Forward-map consistency flag: when JobFamily set, does `getLaneFromJobFamily(jobFamily)?.id === actual.lane`? (yes / no / N/A)

### Aggregate metrics

1. **Confidence distribution** — count and % at high / medium / low
2. **Lane distribution** — count per lane
3. **Other rate** — % at `lane='other'`
4. **Hallucination counts** — lane + sub-lane (both should be 0)
5. **JobFamily-to-lane consistency rate** — for profiles with JobFamily set, what fraction had `actual.lane === getLaneFromJobFamily(jobFamily)?.id`?
6. **Min-signal share** — % of sample that was min-signal (no target_roles + no resume + no JobFit run). Per Peri's no-skip rule.
7. **Min-signal outcome distribution** — for the min-signal subset, what lane/confidence did they land on? (Indicator of force-fit vs honest Other.)
8. **Parse error / LLM error counts** — should be 0 or single-digit

### Manual spot-check protocol (10 of N)

Per Peri's composition:
- **5 random** from the sample
- **3 from `lane='other'` cases** (if fewer than 3 exist, fall back to random)
- **2 from `confidence='low'` cases** (if fewer than 2 exist, fall back to random)

Inspection criteria (qualitative, Peri's judgment):
- Does the inferred lane + sub-lane read reasonable given the input?
- Does the confidence label match the input's actual ambiguity?
- For `other` cases: legitimate Other, or force-fit / escape-hatch?
- For low-confidence cases: genuinely ambiguous input, or LLM under-committing?

---

## 5. Acceptance thresholds

Per Peri's pre-aligned go/no-go decision tree:

| Metric | Threshold | Status |
|---|---|---|
| Lane hallucinations | **= 0** | Hard fail — pause and investigate before migration |
| Sub-lane hallucinations | **= 0** | Hard fail — pause and investigate |
| High-confidence rate | See decision tree below | Tiered |
| Other rate | **≤ 10%** | Investigate Other cases if exceeded |
| JobFamily-to-lane consistency | **75-80% informative range** | NOT a gating metric — see below |
| Manual spot-check pass | **≥ 8/10** | Trumps numeric metrics if fails |
| Parse error rate | **≤ 2/N** | Low rate tolerable; debug if higher |

### High-confidence decision tree (Peri-locked)

- **≥ 85%**: GREEN. Proceed to dev migration (and then prod migration after dev validates).
- **70-84%**: YELLOW. Do NOT iterate prompt automatically. Investigate distribution first. Are non-high cases reasonable given input quality? If yes, the FRD threshold may have been set too aggressively for actual data — consider relaxing to ≥80% with stronger user-verification UI.
- **< 70%**: RED. Three diagnostic paths: (a) prompt under-confidence on clear cases, (b) data is genuinely uncertain (lots of incomplete intakes), (c) FRD threshold was set without knowing actual distribution. Investigate root cause before iterating.

**Key principle:** don't iterate the prompt reflexively if confidence is low. Investigate data quality first. Per DD-15, prompt tuning produces zero-sum crosstalk.

### JobFamily-to-lane consistency (revised — informative, not gating)

The original v1 threshold of ≥90% treated LLM disagreement with JobFamily as inherently suspect. But legitimate disagreements exist — Case 4 of synthetic literally tested user-stated targeting winning over JobFamily-detected family.

**Revised: 75-80% informative range.** Treat as a diagnostic signal:
- **Above 95%:** YELLOW flag — LLM may be over-deferring to JobFamily even when target_roles suggests otherwise. Inspect a few disagreement-suppressed cases.
- **75-95%:** healthy range — LLM is using JobFamily as one signal among many.
- **Below 75%:** investigate which JobFamilies the LLM is overriding most. May surface upstream JobFamily-detection issues.

This metric is reported but does NOT gate migration approval.

---

## 6. Open questions for Peri

1. **Sample size:** 100 (recommended given 122-profile prod inventory) vs 50 (FRD-aligned but lower coverage) vs all 122 (effective dry-run). Cost differs by ~$0.15. Time differs by 2-3 min.

2. **Results file gitignore confirmation:** `scripts/migrate-candidate-targeting/results/` was added to `.gitignore` after synthetic run 2. Confirm this stays — results contain anonymized prod-shape data and shouldn't go into git.

3. **Manual spot-check timing:** the runner outputs all 10 spot-check candidates with their inputs and inferences visible in the results file. Peri reviews from the file; not real-time during execution.

---

## 7. No DB writes — operational confirmation

Runner does:
- ✓ READ `client_profiles` (random select)
- ✓ READ `jobfit_runs` (most recent per profile)
- ✓ Call Anthropic API
- ✓ WRITE timestamped results file to `scripts/migrate-candidate-targeting/results/realdata-<ISO>.txt` (gitignored)

Runner does NOT:
- ✗ INSERT `candidate_targeting`
- ✗ UPDATE `client_profiles`
- ✗ WRITE anything to prod
- ✗ Persist inference results to any DB table

Migration execution (actual backfill) is a separate script written AFTER this real-data sample validates the prompt. Migration script has its own approval gate.

---

## Status

- ✅ Design v2 drafted (prod source locked + Peri's refinements applied)
- ⏸ Awaiting Peri review + decision on sample size (Q1) + spot-check confirmations
- ⏸ After design approval: build runner (`run-realdata-sample.ts`)
- ⏸ Show runner code, await approval
- ⏸ Execute inference on the sample
- ⏸ Show results
- ⏸ Decision on dev migration (then prod migration is a separate explicit step)
