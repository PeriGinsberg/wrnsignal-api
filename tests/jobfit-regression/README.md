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
