# JobFit Regression Test Harness

Runs a set of (profile, job) fixtures through the real `/api/jobfit` endpoint
and compares actual results against expected values. Purpose: catch
regressions after any scoring/extraction change, without manually re-testing
individual candidates.

## Quick start

```bash
# Set your environment
export SIGNAL_API_BASE="https://wrnsignal-api.vercel.app"
export SIGNAL_BEARER_TOKEN="eyJ..."  # Supabase session token for a test user

# Run the full suite
npx tsx tests/jobfit-regression/run.ts

# Run a specific fixture
npx tsx tests/jobfit-regression/run.ts --fixture reece-ubs

# Update baseline after intentional changes
npx tsx tests/jobfit-regression/run.ts --update-baseline
```

## Fixture format

Each fixture lives in `fixtures/*.json` and has this shape:

```json
{
  "id": "reece-ubs",
  "description": "Pharma sales EMT candidate vs UBS Client Associate. Clinical experience + B2B sales pipeline.",
  "profile": {
    "text": "Full profile text including resume, target roles, constraints...",
    "targetRoles": "Associate sales representative, Clinical sales, Medical sales"
  },
  "job": {
    "text": "Full job description text pasted from the posting"
  },
  "expected": {
    "decision": "Apply",
    "scoreRange": [75, 100],
    "requiredWhyKeys": ["clinical_patient_work"],
    "forbiddenRiskCodes": ["GATE_CREDENTIAL_REQUIRED"],
    "notes": "Clinical Sales Rep candidate — strong clinical match, should not be gated by FINRA."
  }
}
```

**Field explanations**:
- `expected.decision` — exact decision string expected (`Priority Apply`, `Apply`, `Review`, `Pass`)
- `expected.scoreRange` — `[min, max]` the score must fall within
- `expected.requiredWhyKeys` — array of match_keys that MUST appear in `why_codes`
- `expected.forbiddenRiskCodes` — array of risk codes that MUST NOT fire
- `expected.notes` — human notes for future debugging

Optional fields:
- `expected.requiredRiskCodes` — risk codes that MUST fire (e.g. confirming a known gap)
- `expected.forbiddenWhyKeys` — match_keys that should NOT appear (to catch false positives)
- `expected.requiredJobFamily` — the inferred job family (e.g., `"Sales"`, `"Consulting"`)
- `expected.forbiddenJobFamily` — family that must NOT fire (e.g., catching IB boilerplate leak)

## Adding a new fixture

1. Create `fixtures/YOUR-ID.json` following the format above
2. Include the full profile text and full JD text (verbatim)
3. Run the harness once, observe actual values, update `expected` to match
4. Commit the fixture
5. After any scoring change, re-run the harness to verify no regression

## Interpreting results

The script prints a table:

```
FIXTURE                 STATUS  DECISION      SCORE  ISSUES
reece-ubs              PASS    Apply         82     -
josselyn-fanatics       PASS    Priority Ap.  97     -
ryan-ubs-client-assoc   FAIL    Review        65     score out of range [75,100]; missing WHY:clinical
```

Exit code is 0 if all pass, non-zero otherwise. Use in CI.

## What this catches

- Score regressions (a fix for one candidate that accidentally lowers another)
- Missing WHY codes (extraction stopped finding evidence it used to)
- New false-positive RISK codes (filter over-firing)
- Gate regressions (credential gate suddenly firing on candidates it shouldn't)
- Family classification drift (the #1 bug we hit today — three copies of
  `inferTargetFamilies` drifting out of sync)

## What this doesn't catch

- Bullet quality (the LLM output varies run-to-run, can't be string-matched)
- Absolute cover letter wording
- Display/UI issues
- Performance

For bullet quality, use the `/api/jobfit/debug-review` endpoint which runs
an LLM sanity-check on any scoring result.

## Deterministic in-process suite (`regression-check.ts` + `baseline.json`)

Separate from the live-endpoint `run.ts` above, `regression-check.ts` runs all
cases **in-process through `runJobFit` (deterministic, no LLM)** and captures a
**v2 structured snapshot** per case — decision, score, gate, the full
requirement/profile units, the full match set (match_strength / weight /
coverageScore / kind / keys), all WHY/RISK codes, the programmatic scalar
manifest, and score_breakdown (see `lib/snapshot.ts`). It diffs against
`baseline.json` with a **tiered tolerant diff**:

- **HARD** (fail, exit 1): decision, gate type, per-match `match_strength`,
  WHY/RISK code-set add/remove, any scalar-manifest change, match/unit set
  add/remove, and any *unclassified* path (default-to-HARD — new fields are
  never silently ignored).
- **SOFT** (report, exit 0): score (±2), match weight (±5), coverageScore (±5),
  breakdown points (±3) — within-band deltas suppressed, outside-band reported
  but non-failing.

A `schema_version` mismatch is refused with a re-baseline instruction (exit 2).

```bash
npx tsx tests/jobfit-regression/regression-check.ts                  # tiered diff (exit 1 on HARD)
npx tsx tests/jobfit-regression/regression-check.ts --update-baseline  # re-freeze after reviewing every HARD diff
```

It runs 68 cases = 21 prod-issue batch + 41 synthetic CSV + 6 inline retest cases.

> **⚠ Fresh-checkout wrinkle (note, not fixed):** the 21 `batch-*` cases AND
> the frozen semantic verdicts (`semantic-verdicts.local.json`) are local-only /
> gitignored. On a clean checkout the harness runs **47 cases** (41 synthetic +
> 6 retest) and surfaces the 21 batch baseline entries as missing (HARD). See
> "Local-only batch fixture" below for recovery.

### ⚠ Local-only batch fixture — `issues/040926ProdIssues.csv` (NOT in git)

The 21 `batch-40926*` prod-issue cases load from `issues/040926ProdIssues.csv`
at the repo root. **This file is intentionally NOT committed** — it contains
real candidate contact PII (emails), and the scorer reads the email
local-part, so the contacts can't be scrubbed without changing scores (see the
Ticket 1 investigation note in `docs/jobfit-ticket1-plan.md`). `regression-check.ts`
**skips the batch silently** if the file is absent (you'll see "Baseline cases
missing from live run"), which previously hid this gap.

**Recover it (per checkout):**
```bash
mkdir -p issues
cp "/c/Users/perig/wrnsignal-api-archive/2026-04-28/issues/040926ProdIssues.csv" issues/040926ProdIssues.csv
```
`issues/.gitignore` keeps the CSV from being accidentally committed. After
recovery, `regression-check.ts` should report "All 68 cases match baseline."

## Acceptance gate (Ticket 1) — `acceptance/`

`acceptance/acceptance-check.ts` runs the frozen free-path acceptance suite
(real-world Jordan/Zurich + the false-positive and true-fit cases) and asserts
target verdicts:

```bash
npx tsx tests/jobfit-regression/acceptance/acceptance-check.ts                  # RED until Ticket 1 lands
npx tsx tests/jobfit-regression/acceptance/acceptance-check.ts --update-baseline
```

- **false-positive** cases must come down (Jordan→Pass, Catherine/J6→Pass,
  Ava/J4 & Ava/J6 → not Apply). **RED now by design**; flips green across Ticket 1
  Stages 1–2b.
- **true-fit** cases must stay (Apply-or-better; George must not drop to Pass).
  A true-fit failing = a regression / over-correction.

Inputs are **LOCAL-ONLY** (gitignored): `acceptance/fixtures.local.ts` (real
candidate résumés/JDs the scorer reads — can't be neutrally scrubbed) and
`acceptance/haiku-overrides.local.json` (frozen Haiku pre-pass output, so runs
are reproducible yet faithful to the live funnel). The harness +
`acceptance/acceptance-baseline.json` (outputs only) are committed; on a checkout
without the local fixtures the harness **skips**. Regenerate the fixtures from
the source résumé/JD text if lost.
