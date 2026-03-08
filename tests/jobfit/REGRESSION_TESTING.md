# SIGNAL JobFit Regression Testing
Version: Regression Harness V1  
Status: Active  
Scope: Deterministic JobFit engine only, outside UI and outside route-level orchestration

---

## 1. Purpose

This regression framework exists to validate the current deterministic JobFit logic before making changes to scoring, extraction, gates, thresholds, or downgrade behavior.

The goals are:

1. Freeze current engine behavior
2. Detect regressions after logic changes
3. Separate scoring changes from gate changes
4. Test JobFit without relying on UI flows
5. Preserve a repeatable local testing workflow

Important distinction:

- A baseline is **current behavior**
- A baseline is **not automatically correct behavior**

This framework first protects against accidental breakage.  
It does not by itself prove the logic is optimal.

---

## 2. Why Regression Testing Runs Outside the UI

Regression testing is intentionally run outside the UI and outside the API route layer.

We are not testing:

- Supabase auth
- route request handling
- CORS
- profile fetch behavior
- UI rendering
- frontend state flow

We are testing the deterministic JobFit engine directly.

This keeps testing focused on:

- extraction
- scoring
- gates
- decision thresholds
- downgrade rules

---

## 3. Core Deterministic Pipeline

Each regression case runs through this pipeline:

1. `extractJobSignals(jobText)`
2. `extractProfileSignals(profileText, profileOverrides)`
3. `evaluateGates(jobSignals, profileSignals)`
4. `scoreJobFit(jobSignals, profileSignals)`
5. `decision_initial = decisionFromScore(score)`
6. `decision_after_gate = applyGateOverrides(decision_initial, gate)`
7. `decision_final = applyRiskDowngrades(decision_after_gate, penaltySum)`

This is the local regression path.

---

## 4. Files Used by the Regression Harness

Core deterministic engine files:

- `app/api/jobfit/extract.ts`
- `app/api/jobfit/constraints.ts`
- `app/api/jobfit/scoring.ts`
- `app/api/jobfit/decision.ts`
- `app/api/jobfit/policy.ts`
- `app/api/jobfit/signals.ts`

Regression harness files:

- `tests/jobfit/runLocalCases.ts`
- `run-jobfit-regression.ps1`

Regression data folders:

- `tests/jobfit/cases`
- `tests/jobfit/results`
- `tests/jobfit/baselines`

Documentation file:

- `tests/jobfit/REGRESSION_TESTING.md`

---

## 5. Directory Structure

Current regression structure:

```txt
tests/
  jobfit/
    baselines/
    cases/
    results/
    REGRESSION_TESTING.md
    runLocalCases.ts

Purpose of each folder:

cases

Stores JSON regression input cases.
Each file represents one job/profile test scenario.

results

Stores outputs from the most recent regression run.

baselines

Stores frozen snapshots of previous results used for comparison.

6. Case File Format

Each regression case is a JSON file stored in:

tests/jobfit/cases/

Example:

{
  "id": "case-001",
  "label": "Basic marketing fit sanity check",
  "profileText": "Marketing student targeting full-time brand marketing roles in New York City. Experience with social media, campaign execution, Canva, Excel, and Google Analytics. Class of 2026. Wants full-time work in NYC.",
  "jobText": "Brand Marketing Coordinator role based in New York City. Full-time position supporting campaign execution, content calendars, cross-functional coordination, and performance tracking. Preferred tools include Excel and Google Analytics.",
  "profileOverrides": {
    "targetFamilies": ["Marketing"],
    "locationPreference": {
      "constrained": true,
      "mode": "in_person",
      "allowedCities": ["New York City", "NYC"]
    },
    "constraints": {
      "hardNoHourlyPay": false,
      "prefFullTime": true,
      "hardNoContract": false,
      "hardNoSales": false,
      "hardNoGovernment": false,
      "hardNoFullyRemote": false,
      "preferNotAnalyticsHeavy": false
    },
    "tools": ["Excel", "Google Analytics", "Canva"],
    "gradYear": 2026,
    "yearsExperienceApprox": 1
  }
}
Case rules

Every case must have a stable id

IDs should never be renumbered later

Labels should describe the scenario clearly

Case text should use realistic job language, not fake token spam

profileOverrides should be used when deterministic profile setup is required

7. Current Runner: runLocalCases.ts

The TypeScript runner does the following:

Loads all JSON files from tests/jobfit/cases

Executes the deterministic pipeline for each case

Writes full JSON results

Writes compact CSV results

Outputs written to:

tests/jobfit/results/results.json

tests/jobfit/results/results.csv

8. Current PowerShell Runner

The main local command is:

.\run-jobfit-regression.ps1

This script:

Runs npx tsx tests\jobfit\runLocalCases.ts

Verifies output files were created

Loads current results

Loads baseline results from baseline-001

Compares fields that matter

Prints a regression summary

Exports diff details to:

tests/jobfit/results/regression_diff.csv
9. Result Output Files
results.json

Contains the full structured output for each case, including:

job signals

profile signals

why codes

risk codes

gate output

score

decisions

results.csv

Contains a compact regression-friendly summary.

Current columns:

id

label

score

penaltySum

decision_initial

decision_after_gate

decision_final

gate_type

gate_code

gate_detail

why_code_list

risk_code_list

job_family

job_location_mode

job_location_city

profile_location_mode

profile_location_constrained

10. Why There Are Three Decision Columns

The regression system stores:

decision_initial

decision_after_gate

decision_final

This is intentional.

decision_initial

This is the score-only decision.

Logic:

Apply if score >= 82

Review if score >= 65

Pass if score < 65

decision_after_gate

This is the decision after gate logic is applied.

Rules:

force_pass makes final decision Pass

floor_review forces Apply down to Review

decision_final

This is the decision after risk downgrade logic is applied.

Rules:

Apply -> Review if penaltySum >= 28

Review -> Pass if penaltySum >= 40

Why this separation matters

This makes regressions diagnosable:

If decision_initial changes, scoring changed

If decision_after_gate changes, gate logic changed

If only decision_final changes, downgrade logic changed

11. Current Policy Values

Current thresholds:

Apply  >= 82
Review >= 65
Pass   < 65

Current downgrade thresholds:

Apply -> Review at penaltySum >= 28
Review -> Pass at penaltySum >= 40

Current gate types:

Force pass gates

GATE_MBA_REQUIRED

GATE_HARD_SALES

GATE_HARD_GOV

GATE_REMOTE_MISMATCH

GATE_GRAD_MISMATCH

Floor review gates

GATE_FLOOR_REVIEW_LOCATION

GATE_FLOOR_REVIEW_CONTRACT

12. Baselines

Baselines are stored in:

tests/jobfit/baselines/

Current baseline:

tests/jobfit/baselines/baseline-008/

Files:

results.json

results.csv

A baseline is a frozen snapshot of known engine behavior at a point in time.

Important:

Baselines should be updated only intentionally

Do not overwrite a baseline casually

New baselines should be created when logic changes are deliberately accepted

13. Current Known Working State

As of the first local regression setup:

Existing folders created

tests/jobfit/cases

tests/jobfit/results

tests/jobfit/baselines

Existing runner created

tests/jobfit/runLocalCases.ts

Existing PowerShell command created

run-jobfit-regression.ps1

Existing baseline created

baseline-001

Existing case created

case-001

14. Case-001 Current Behavior

Case:

case-001

Label: Basic marketing fit sanity check

Observed output:

score = 76

penaltySum = 0

decision_initial = Review

decision_after_gate = Review

decision_final = Review

gate_type = none

WHY codes:

WHY_FAMILY_MATCH

WHY_TOOL_MATCH

Current observation from this case:

A clean marketing-aligned role with tool overlap still scores Review, not Apply

Job location city extracted as New York City

Job location mode extracted as unclear

This suggests location mode extraction may be conservative

This is recorded as current behavior only, not a judgment of correctness.

15. Change Classification in PowerShell Diff

Current diff classification logic includes:

SCORING_CHANGE

GATE_CHANGE

FINAL_DECISION_CHANGE

DETAIL_CHANGE

NEW_CASE

REMOVED_CASE

This classification is designed to help isolate the source of changes quickly.

16. Rules for Safe Logic Changes

Before changing JobFit logic:

Run the regression harness

Confirm current outputs

Preserve the current baseline

Make one logic change at a time

Re-run regression

Review all changed cases

Decide whether changes are intended or regressions

Only then create a new baseline

Do not:

change multiple logic systems at once without a fresh diff

overwrite baselines blindly

treat changed output as automatically improved

17. Documentation Rule

Every material regression framework change should be documented here, including:

new case packs

new output columns

new baseline versions

changed comparison logic

changed runner commands

This file is the source of truth for how regression testing is performed.

18. Next Planned Expansion

The next major step is to create a larger case pack covering:

strong Apply scenarios

analytics-heavy roles

constrained location mismatches

remote mismatch hard stop

sales hard gate

government hard gate

contract mismatch

hourly mismatch

missing tools

years experience gap

MBA required

graduation window mismatch

downgrade threshold edge cases

That will turn the current single-case harness into a meaningful regression suite.

## 19. Regression Pack Expansion: Cases 002-005

Additional cases were added to expand coverage beyond the initial sanity case.

### Added cases

- `case-002` Strong marketing fit with explicit tool overlap
- `case-003` Marketing role with analytics-heavy signals
- `case-004` Constrained location mismatch should floor to review
- `case-005` Remote job conflicts with hard no remote constraint

### Observed outcomes

#### case-002
- score = 76
- decision_final = Review
- gate_type = none

Observation:
This stronger-looking marketing case scored the same as `case-001`, suggesting the current scoring model may not be sufficiently distinguishing stronger positive-fit marketing cases.

#### case-003
- score = 48
- decision_final = Pass
- gate_type = none
- job_family = Analytics
- risk codes = `RISK_MISSING_TOOLS`, `RISK_ANALYTICS_HEAVY`

Observation:
Analytics-heavy extraction is working well enough to materially lower score and final decision.

#### case-004
- score = 76
- decision_final = Review
- gate_type = none
- job_location_city = blank

Observation:
Expected constrained-city mismatch did not trigger because city extraction did not capture Chicago from the job text. This points to an extraction weakness, not a regression harness issue.

#### case-005
- score = 63
- decision_final = Pass
- gate_type = force_pass
- gate_code = `GATE_REMOTE_MISMATCH`

Observation:
The hard no remote gate path is functioning correctly.

### Interim conclusions

Current regression evidence suggests:

1. Positive-fit scoring for marketing roles may be too flat
2. Remote mismatch hard gate works
3. Analytics-heavy detection works
4. City extraction is currently too weak for reliable constrained-city gate testing

## 20. Extraction Fix: City Detection and Case-004 Behavior Change

A targeted extraction fix was applied to `extract.ts` by expanding `extractCity()` beyond New York City only.

Cities added:
- Chicago
- Boston
- Austin
- Miami
- Philadelphia
- Atlanta
- Charlotte
- Washington DC
- Los Angeles

### Resulting regression impact

`case-004` changed materially after the city extraction fix.

### Previous behavior
- score = 76
- penaltySum = 0
- decision_final = Review
- risk_code_list = none
- job_location_city = blank

### New behavior
- score = 63
- penaltySum = 12.8
- decision_final = Pass
- risk_code_list = `RISK_LOCATION`
- job_location_city = `Chicago`

### Interpretation

This confirms the city extraction fix worked.

It also revealed a policy behavior:
a constrained city mismatch currently reduces score enough to convert the case from Review to Pass, rather than behaving as a floor-to-review style outcome.

This may indicate that location mismatch is currently too punitive in scoring relative to desired JobFit behavior.

## 21. Extraction Fix: Graduation Year Hint and Case-013 Behavior Change

A targeted extraction fix was applied to `extractGradYearHint()` in `extract.ts`.

The previous implementation relied on `.find()` over regex match arrays to locate a `20xx` year token. In runtime, this failed to extract `2024` from a job text containing `Class of 2024`, even though the regex pattern itself matched correctly.

### Fix applied

`extractGradYearHint()` was updated to:
1. iterate explicitly through captured groups
2. detect exact `20xx` values using `/^20\d{2}$/`
3. fall back to searching the full matched string for a `20xx` token

### Resulting regression impact

`case-013` changed materially after the grad-year extraction fix.

### Previous behavior
- score = 76
- penaltySum = 0
- decision_final = Review
- gate_type = none
- gate_code = none

### New behavior
- score = 56
- penaltySum = 20
- decision_final = Pass
- gate_type = `force_pass`
- gate_code = `GATE_GRAD_MISMATCH`
- risk_code_list = `RISK_GRAD_WINDOW`

### Interpretation

This confirms the graduation-year extraction fix worked.

It also confirms that the grad mismatch hard gate now triggers correctly when the job posting screens for a different graduation year than the candidate profile.

## 22. Extraction Fix: Hourly Compensation Detection and Case-014 Behavior Change

A targeted extraction fix was applied to hourly compensation detection in `policy.ts`.

### Previous hourly keywords
- `hourly`
- `$/hour`
- `per hour`

This did not reliably match pay formats like:
- `$22/hour`
- `$18/hr`

### Fix applied

Hourly keywords were expanded to:

- `hourly`
- `/hour`
- `per hour`
- `/hr`

### Resulting regression impact

`case-014` changed materially after the hourly keyword fix.

### Previous behavior
- score = 76
- penaltySum = 0
- decision_final = Review
- risk_code_list = none

### New behavior
- score = 74
- penaltySum = 1.6
- decision_final = Review
- risk_code_list = `RISK_HOURLY`

### Interpretation

This confirms the hourly compensation extraction fix worked.

It also confirms that hourly mismatch currently behaves as a low-severity score penalty rather than a gate-triggering event.

## 23. Classification Fix: Reporting-Heavy Marketing Roles No Longer Forced into Analytics

A targeted classification fix was applied in `app/api/jobfit/extract.ts` and `policy.ts` to reduce false-positive Analytics classification for reporting-heavy marketing roles.

### Problem
Some marketing roles with reporting language were being classified as `Analytics` even when they were more accurately marketing coordination or marketing reporting roles.

This was driven by overly broad analytics indicators such as:
- `dashboard`
- `dashboard ownership`
- `kpi`
- `kpi ownership`

### Fix applied
The `data_analytics_bi` tag rule in `extract.ts` was tightened to remove dashboard/KPI ownership phrases.
The fallback Analytics classifier was also tightened so broad dashboard language no longer forced Analytics classification.

### Resulting regression impact

`case-021` changed materially after the classification fix.

### Previous behavior
- score = 52
- decision_final = Pass
- job_family = Analytics
- why_code_list = `WHY_TOOL_MATCH`

### New behavior
- score = 76
- decision_final = Review
- job_family = Marketing
- why_code_list = `WHY_FAMILY_MATCH`, `WHY_TOOL_MATCH`

### Interpretation
This confirms that reporting-heavy marketing roles are no longer being over-classified as Analytics solely because of dashboard/KPI-style language.

24. Real-Input Regression Layer (Real Case Pack)

The synthetic regression pack validates deterministic behavior under controlled scenarios.

However, synthetic cases alone cannot fully simulate the shape of real user input.

To address this, a second regression layer was created using:

real intake responses

real pasted resumes

real pasted job descriptions

This layer is designed to test:

raw text extraction behavior

realistic signal extraction

family classification under real language

constraint interpretation

tool detection

scoring stability with natural language noise

This suite intentionally runs without handcrafted signal overrides, except where needed to construct deterministic profile conditions.

Important:

The real-input regression pack is not a baseline correctness system.

It is used to reveal weaknesses in:

extraction

family mapping

tool detection

constraint interpretation

before modifying the scoring engine.

25. Real Case Data Source

Real cases are generated from a CSV dataset stored at:

tests/jobfit/real_cases_input.csv

Each row represents:

one candidate profile

one job description

Columns include:

case_id
profile_id
job_id
first_name
last_name
current_status
university
job_type_preference
target_roles
adjacent_roles
target_industries
specific_companies
do_not_want
openness_to_non_obvious_entry_points
location_preferences
timeline_for_starting_work
strongest_skills
job_search_concerns
feedback_style
resume_paste
cover_letter
extra_context
job_label
job_description
expected_direction

The CSV is treated as the source of truth for the real-input regression set.

New scenarios should be added by appending rows rather than rewriting existing cases.

26. Real Case Builder Script

Real regression cases are generated from the CSV using:

tests/jobfit/build-real-cases.ps1

The builder script performs the following steps:

Reads real_cases_input.csv

Derives basic profile overrides

Maps target roles into JobFit families

Extracts known tool signals

Converts location preferences into deterministic constraints

Writes case JSON files

Generated output:

tests/jobfit/real_cases/

Example generated file:

real-001.json
real-002.json
...

Each generated JSON file follows the same schema used by synthetic regression cases.

Important:

The builder script intentionally performs only minimal interpretation of the CSV.

The goal is to simulate realistic profile input, not perfect signals.

27. Real Case Runner

Real cases are executed using a separate runner:

tests/jobfit/runRealCases.ts

This runner performs the same deterministic pipeline used by synthetic cases:

extractJobSignals

extractProfileSignals

evaluateGates

scoreJobFit

decisionFromScore

applyGateOverrides

applyRiskDowngrades

Outputs are written to:

tests/jobfit/results/real_case_results.json
tests/jobfit/results/real_case_results.csv

These outputs should never overwrite synthetic regression outputs.

Synthetic and real suites must remain separate.

28. Real Case Output Fields

The real case CSV output includes:

id
label
profile_id
job_id
job_label
expected_direction
score
penaltySum
decision_initial
decision_after_gate
decision_final
gate_type
gate_code
gate_detail
why_code_list
risk_code_list
job_family
job_location_mode
job_location_city
profile_location_mode
profile_location_constrained

These fields allow comparison between:

expected human judgment

deterministic engine output

This comparison is used to guide improvements.

29. Known Limitations Revealed by Real Cases

Initial real-input runs revealed several important weaknesses.

These are not regressions. They are design insights.

Family classification gaps

Current JobFit families:

Consulting
Marketing
Finance
Accounting
Analytics
Sales
Government
PreMed
Other

Real cases revealed missing categories:

Design / UX / Product Design

Legal / Regulatory

Operations / Transformation

These roles are currently forced into inaccurate families.

Builder mapping limitations

The builder currently maps target roles using broad keyword rules.

This can misclassify roles such as:

UX/UI designer

product designer

legal assistant

policy analyst

process improvement analyst

These issues originate in the builder layer, not the engine.

Extraction noise

Real resumes and job descriptions introduce:

inconsistent formatting

tool mentions embedded in sentences

multiple role signals in the same text

The regression framework intentionally preserves this noise.

30. Synthetic vs Real Regression Suites

The JobFit regression framework now contains two layers.

Synthetic Regression Suite

Purpose:

deterministic protection of engine logic

Characteristics:

controlled inputs

deterministic overrides

frozen baselines

regression diffs enforced

Runner:

run-jobfit-regression.ps1
Real Regression Suite

Purpose:

evaluate real-world behavior

Characteristics:

natural language input

CSV-driven case generation

no baseline enforcement

exploratory analysis

Runner:

npx tsx tests/jobfit/runRealCases.ts
31. Regression Testing Philosophy

The JobFit regression system intentionally separates three concerns.

Synthetic regression

Protects the engine from accidental breakage.

Real-input regression

Reveals weaknesses in extraction and classification.

Human evaluation

Determines whether the engine behavior is desirable.

These layers must remain separate.

Synthetic regression ensures stability.

Real-input regression drives improvement.

Human judgment decides correctness.

32. Current Real Case Set

The first real regression pack includes 15 cases across five real profiles:

Ryan Rudnet
Benjamin Cleek
Spencer Levine
Mikaela Moskowitz
Zoe Siegel

Each profile includes three job scenarios.

These cases represent early real-world validation of JobFit behavior.

Future work should expand this pack to 50+ real scenarios.

33. Finance Tag Contamination Fix and Baseline-009 Update

A classification issue was discovered during real-input regression testing where marketing roles were incorrectly tagged as finance_corp.

Root Cause

The finance_corp phrase list in extract.ts included overly broad tokens such as:

investment

portfolio

These tokens appear frequently in non-finance contexts such as:

product investment

portfolio of products

investment in marketing initiatives

Because the phrase matching system uses substring detection, these broad tokens caused false positives that forced roles into the Finance job family.

This issue was first observed in the real case:

real-005
Benjamin Cleek – Product Marketing Intern

The role was incorrectly classified as Finance despite clear marketing signals.

Extraction Fix

The finance_corp phrase list was tightened to remove ambiguous terms.

Removed phrases:

investment
portfolio

The finance phrase list now focuses on unambiguous finance signals including:

investment banking
private equity
hedge fund
credit analysis
wealth management
financial advisor
capital markets
equity research
financial modeling
financial planning
valuation
lbo
asset management

This prevents cross-family contamination between Marketing and Finance roles.

Regression Impact
real-005

Previous behavior (baseline-008)

job_family = Finance
score = 48
decision_final = Pass

New behavior (baseline-009)

job_family = Marketing
score = 72
decision_final = Review

Interpretation:

The role is correctly classified as Marketing and is now treated as a viable opportunity.

real-015

A second change occurred during testing involving a legal assistant role.

The profile originally targeted only the Government family.

The legal assistant role was classified as Other, which caused the engine to treat it as misaligned.

The profile override was expanded to include both:

targetFamilies: ["Other", "Government"]

Previous behavior

score = 48
decision_final = Pass

New behavior

score = 72
decision_final = Review

Interpretation:

The role represents a legitimate entry path for a policy/legal candidate and should not be forced to Pass.

Baseline Update

Because the engine behavior changed intentionally, a new baseline snapshot was created.

Previous baseline:

baseline-008

New baseline:

tests/jobfit/baselines/baseline-009

Files stored:

baseline-009/results.csv
baseline-009/results.json

Future regression comparisons should use baseline-009 as the reference snapshot.

Expected Stability

All remaining real cases produced identical outputs relative to baseline-008.

Total real cases tested:

15

Only the following cases changed behavior:

real-005
real-015

These changes were intentional and reflect corrected classification behavior.

Regression Rule Reminder

Baselines should only be incremented when:

extraction rules change

classification logic changes

scoring policy changes

gate logic changes

downgrade logic changes

Refactors, formatting changes, or code restructuring do not require a new baseline.

34. Real-Input Classification and Builder Mapping Fixes

Additional real-input regression work identified multiple classification and builder-mapping failures that were not visible in the synthetic pack.

Problems identified

The following issues were observed during real-case testing:

wealth-management and client-associate roles were not reliably classified as Finance

product marketing roles were contaminated by Finance tagging

design roles were being forced into Finance, Accounting, or Marketing

operations / process roles were being forced into Finance or Accounting

legal assistant roles were not treated as viable adjacent paths for legal-policy profiles

communications_pr matching was too broad because the token pr triggered in unrelated text

phrase matching in extraction logic used substring matching, causing false positives

builder logic over-relied on broad keyword mapping and target-industry contamination

Builder changes applied

tests/jobfit/build-real-cases.ps1 was updated to improve profile family mapping.

Changes included:

family mapping was refocused on role intent rather than broad industry contamination

design / UX / product design targets now map to Other

legal / privacy / regulatory targets can map to Other

operations / process / transformation targets are no longer forced into Analytics

legal-policy profiles can now include mixed targeting such as:

Other

Government

false Sales matches from phrases such as non-sales were removed

policy was removed as a broad standalone Government trigger in the builder

Extraction and classifier changes applied

app/api/jobfit/extract.ts was updated to improve job-family precision.

Changes included:

removed the overly broad pr trigger from communications_pr

adjusted family priority so:

creative_design no longer loses to Finance or Accounting

operations_general maps to Consulting

added fallback handling for:

design-like roles

operations / transformation roles

legal-like roles

tightened finance_corp phrase detection

replaced raw substring matching with boundary-aware matching in:

includesAny()

countHits()

Real-case behavior changes from this phase
real-002

Previous:

job_family = Other

decision_final = Pass

New:

job_family = Finance

decision_final = Review

Interpretation:
Wealth-management client-associate language is now correctly recognized as Finance.

real-005

Previous:

job_family = Finance

score = 48

decision_final = Pass

New:

job_family = Marketing

score = 72

decision_final = Review

Interpretation:
Product Marketing roles are no longer contaminated by Finance tagging.

real-007 / real-008 / real-009

Previous:

misclassified into Accounting / Finance / Marketing-adjacent families

decision_final = Pass

New:

job_family = Other

decision_final = Review

Interpretation:
Design-oriented roles now land in a sane temporary family instead of unrelated ones.

real-011 / real-012

Previous:

misclassified into Accounting / Finance

decision_final = Pass

New:

job_family = Consulting

decision_final = Review

Interpretation:
Operations and process roles are now treated as Consulting-aligned.

real-015

Previous:

profile targetFamilies = Government only

job_family = Other

score = 48

decision_final = Pass

New:

profile targetFamilies = Other, Government

job_family = Other

score = 72

decision_final = Review

Interpretation:
Legal assistant roles are now treated as a viable adjacent path for mixed legal-policy profiles.

Conclusion from this phase

This phase confirmed that real-input regression is required not only for extraction quality, but also for:

builder family mapping quality

phrase-level classifier precision

cross-family contamination detection

It also confirmed that design, legal, and operations roles remain temporary fits inside the current family system and may justify future dedicated families.

35. Scoring Calibration Fix: Apply Was Mathematically Unreachable

A scoring calibration issue was identified after the classification fixes were completed.

Problem

Under the previous scoring model, Apply was mathematically unreachable.

Base scoring behavior was:

base score = 60

family match bump = 12

tool overlap bump = capped at 6

This meant the maximum pre-penalty aligned score was:

60 + 12 + 6 = 78

However, the policy threshold for Apply was:

Apply >= 82

As a result, even perfect family-aligned cases could not reach Apply.

Fix applied

app/api/jobfit/scoring.ts was updated to increase positive separation for aligned roles.

Changes included:

family match bump increased from +12 to +18

aligned roles received a small structure-based positive bump tied to explicit role structure:

years requirement present

location mode explicitly defined

tools explicitly listed

this structure bump was capped so it could create spread without overpowering family alignment

Updated aligned scoring now allows stronger cases to land in the mid-80s while weaker aligned roles remain below that range.

Calibration observations

After the first scoring adjustment, synthetic high-fit cases were finally able to reach Apply.

Examples included:

case-001 -> 84 -> Apply

case-002 -> 84 -> Apply

case-006 -> 84 -> Apply

case-022 -> 84 -> Apply

case-026 -> 86 -> Apply

This confirmed that the scoring system could now express strong-fit outcomes.

Remaining issue

Once Apply became reachable, the first threshold update was too permissive for student use cases.

Real-case distribution temporarily collapsed into:

Apply = 13

Review = 0

Pass = 2

This indicated that the Apply threshold had been lowered too far relative to the student-aligned score band.

Threshold recalibration

Thresholds were recalibrated to restore a meaningful middle band.

Updated thresholds:

Apply >= 80

Review >= 65

Pass < 65

A new top-tier decision was also introduced:

Priority Apply >= 85

This created the following final ladder:

Priority Apply: 85+

Apply: 80-84

Review: 65-79

Pass: below 65

Resulting distributions
Synthetic regression suite

Final observed distribution:

Priority Apply = 2

Apply = 8

Review = 4

Pass = 16

Real-input regression suite

Final observed distribution:

Apply = 4

Review = 9

Pass = 2

Interpretation

This distribution is materially healthier for a student and first-job / internship decision engine.

It preserves:

a rare high-confidence top tier

a usable Apply tier

a meaningful Review band

stable Pass behavior for misaligned roles

Baseline update

Because scoring policy and threshold behavior changed intentionally, a new baseline snapshot was created.

Previous baseline:

baseline-009

New active baseline:

tests/jobfit/baselines/baseline-010

Files stored:

baseline-010/results.csv

baseline-010/results.json

Future regression comparisons should use baseline-010 as the reference snapshot.

Rule reminder

New baselines should be created whenever intentional changes are made to:

scoring weights

thresholds

decision ladder structure

gate behavior

downgrade behavior

This calibration phase qualifies because it changed both score reachability and decision thresholds.

36. Decision Ladder Recalibration for Student and Early-Career Use Cases

A scoring and threshold recalibration phase was completed after the initial real-input regression pack revealed that Apply was either unreachable or too compressed.

Problem discovered

Two separate calibration issues were identified.

Phase 1 problem: Apply was unreachable

Under the previous scoring model, the maximum aligned pre-penalty score was too low to ever reach the Apply threshold.

This was caused by:

base score = 60

family match bump = 12

tool overlap bump capped at 6

Maximum aligned score:

60 + 12 + 6 = 78

At the time, the decision ladder was:

Apply >= 82

Review >= 65

Pass < 65

This made Apply mathematically unreachable even for strong aligned cases.

Phase 2 problem: Apply became too permissive

After increasing the aligned-family score contribution, Apply became reachable, but the first threshold adjustment produced too many Apply outcomes and collapsed the Review band.

Observed real-input distribution during that intermediate phase:

Apply = 13

Review = 0

Pass = 2

This was too permissive for a student-focused decision engine.

Scoring changes applied

app/api/jobfit/scoring.ts was updated to improve aligned-role separation.

Changes included:

family match bump increased from +12 to +18

a small structure-based positive bump was added for aligned roles when the posting includes:

years required

explicit work setup/location mode

explicit tools

This allowed stronger aligned synthetic cases to move into the low-to-mid 80s while preserving separation from weaker fits.

Threshold recalibration applied

Thresholds were intentionally recalibrated for student and internship use cases.

Final active thresholds:

Apply >= 80

Review >= 65

Pass < 65

A new top-tier decision was also introduced:

Priority Apply >= 85

This created the final decision ladder:

Priority Apply: 85+

Apply: 80-84

Review: 65-79

Pass: below 65

Rationale

This ladder better matches the reality of student and first-job applicants.

Students often will not have:

perfect direct experience

complete tool overlap

exact domain proof

Therefore, Apply should represent a role that is clearly viable, not a near-perfect match.

Priority Apply is reserved for the strongest early-career opportunities.

Final observed distributions
Synthetic regression suite

Final observed distribution:

Priority Apply = 2

Apply = 8

Review = 4

Pass = 16

Real-input regression suite

Final observed distribution:

Apply = 4

Review = 9

Pass = 2

Interpretation

This final distribution is materially healthier than the earlier calibration states because it preserves:

a rare top-confidence tier

a usable Apply tier

a meaningful Review band

stable Pass behavior

This is the first calibration state that behaves like a student-focused decision support system rather than a flat score bucket.

37. Regression Harness Expansion: Renderer Output Is Now Part of the Test Surface

The regression harness was expanded to include the live deterministic bullet renderer in addition to raw engine outputs.

Why this change was required

The original regression harness validated only:

extraction

scoring

gates

decisions

raw why_codes

raw risk_codes

However, the live product route also applies:

renderBulletsV4(out)

This means the user-facing output depends on two layers:

evidence generation layer

why_codes

risk_codes

rendering layer

rendered_why_bullets

rendered_risk_bullets

Without testing the renderer, regression was not protecting the actual bullet output that users see.

Files involved

Live renderer path confirmed:

app/api/jobfit/deterministicBulletRendererV4.ts

app/api/_lib/jobfitEvaluator.ts

app/api/jobfit/route.ts

Harness changes applied

Both regression runners were updated to call the live deterministic renderer:

tests/jobfit/runLocalCases.ts

tests/jobfit/runRealCases.ts

Each runner now:

builds the deterministic engine output

constructs a renderer input object

calls renderBulletsV4(...)

writes rendered bullets into result outputs

New regression output fields

The following fields were added to regression outputs:

JSON output

rendered_why_bullets

rendered_risk_bullets

renderer_debug

why_bullet_count

risk_bullet_count

why_bullets_joined

risk_bullets_joined

CSV output

rendered_why_bullets

rendered_risk_bullets

why_bullet_count

risk_bullet_count

why_bullets_joined

risk_bullets_joined

Important implementation note

The renderer does not accept the raw regression object directly.

It expects an EvalOutput-shaped input including:

decision

score

why_codes

risk_codes

gate_triggered

location_constraint

job_signals

profile_signals

The regression harness was updated to construct a renderer-specific input object before calling renderBulletsV4(...).

Why this matters

This update expands regression coverage from:

engine correctness

to:

engine correctness

live bullet rendering correctness

This is critical because the explanatory bullets are part of the product surface, not just internal debug output.

38. Why/Risk System Review: Current Live Renderer Works, but Evidence Layer Is Too Thin

A review of the live Why/Risk system was completed after the renderer was added to the regression surface.

Key finding

The live deterministic renderer is functioning correctly and is wired into the production route.

Confirmed live path:

app/api/_lib/jobfitEvaluator.ts imports and calls renderBulletsV4

app/api/jobfit/route.ts uses the evaluator output

This confirms that deterministicBulletRendererV4.ts is active production logic, not dead code.

Current live behavior

After wiring renderer output into regression, rendered real-case bullets were examined.

Observed behavior:

most viable cases render exactly one Why bullet

that Why bullet is almost always:

WHY_FAMILY_MATCH

most viable cases render zero risks unless a hard mismatch exists

Example rendered pattern:

“You’re targeting Finance; this role is Finance”

“You’re targeting Marketing; this role is Marketing”

Interpretation

This confirms:

the renderer is working

the evidence feeding the renderer is too weak

WHY_FAMILY_MATCH is currently dominating as the default explanation

rendered Risk bullets are currently more informative than rendered Why bullets

Strategic conclusion

The problem is no longer renderer wiring.

The problem is now the evidence architecture.

Current state:

score and decision logic are materially improved

rendered bullets are live in regression

explanatory value is still underpowered because the Why layer relies too heavily on family matching

Design principle confirmed

A Why bullet should answer:

“Why is this candidate competitively plausible for this role?”

It should not be driven by:

city preference match

timing match

internship timing

general logistics

table-stakes eligibility checks

Those are useful only when misaligned, in which case they belong in Risk.

Current conclusion

The next major system change should be a redesign of the deterministic Why evidence taxonomy so that user-facing bullets are built from:

resume evidence

adjacent experience proof

functional skill proof

domain proof

execution proof

rather than primarily from family labels.

39. Why/Risk Taxonomy Direction for Next Phase

The next phase of JobFit explanatory logic will redesign Why bullets around competitive proof.

Planned Why taxonomy

Tier 1 Why signals:

WHY_DIRECT_EXPERIENCE_PROOF

WHY_ADJACENT_EXPERIENCE_PROOF

WHY_EXECUTION_PROOF

Tier 2 Why signals:

WHY_FUNCTIONAL_PROOF

WHY_TOOL_PROOF

WHY_DOMAIN_PROOF

Tier 3 Why signals:

WHY_ROLE_ALIGNMENT

Planned Risk taxonomy additions

Existing risks remain active, but the following competitiveness-oriented risks are expected to matter more in the next phase:

RISK_SENIORITY_MISMATCH

RISK_DOMAIN_GAP

RISK_NO_DIRECT_PROOF

Expected architectural direction

The likely future architecture is:

scoring remains responsible for:

score

penalties

raw evidence codes

deterministic renderer remains responsible for:

prioritization

redundancy control

human bullet rendering

richer Why evidence will need to be generated from:

profileText

resume_paste

strongest skills

adjacent-role intent

role responsibility language

rather than only from coarse structured signals

Status

This redesign has not yet been implemented.

At this point, the system has only completed:

score calibration

renderer regression integration

live renderer validation

The Why/Risk evidence redesign remains the next major workstream.

40. Why Evidence Redesign Phase: Function-Tag Overlap Replaced Generic Family-Match Output

A major redesign phase was started to improve the quality of rendered Why bullets.

Problem observed

After renderer output was added to the regression surface, the live system was still producing weak explanations such as:

“You’re targeting Marketing; this role is Marketing”

“You’re targeting Finance; this role is Finance”

This confirmed that WHY_FAMILY_MATCH and similar generic alignment signals were dominating user-facing output.

Design goal

The Why layer needed to move away from category explanation and toward competitiveness explanation.

A Why bullet should explain:

what actual background proof exists

how that proof maps to the role

why the candidate is plausibly competitive

Architectural direction

The redesign introduced a new Why structure centered on proof categories rather than family labels.

Target Why hierarchy:

Tier 1

WHY_DIRECT_EXPERIENCE_PROOF

WHY_ADJACENT_EXPERIENCE_PROOF

WHY_EXECUTION_PROOF

Tier 2

WHY_FUNCTIONAL_PROOF

WHY_TOOL_PROOF

WHY_DOMAIN_PROOF

Tier 3

WHY_ROLE_ALIGNMENT

Implementation changes

app/api/jobfit/scoring.ts was updated so old Why outputs such as:

WHY_FAMILY_MATCH

WHY_ADJACENT_FAMILY_MATCH

WHY_LOCATION_MATCH

WHY_EARLY_CAREER_FIT

were removed from active scoring logic or demoted out of the main Why path.

The active scoring path now emits proof-oriented Why codes instead.

Renderer changes

app/api/jobfit/deterministicBulletRendererV4.ts was updated to:

allow the new Why codes

prioritize proof-oriented Why codes above role alignment

stop prioritizing WHY_FAMILY_MATCH

render proof-oriented bullets deterministically

Immediate regression impact

Rendered Why output improved from generic family statements toward proof-style language.

Examples of new patterns included:

functional overlap

execution overlap

domain familiarity

tool overlap

This phase did not yet produce resume-specific bullets, but it established the new architecture required for that later improvement.

41. Profile Function Tags Added to Deterministic Extraction

A major blocker to stronger Why bullets was identified during real-case regression testing:

the profile extractor was not emitting meaningful profile-side function evidence.

Problem observed

extractProfileSignals(...) was returning only limited structured information such as:

target families

constraints

tools from overrides

grad year

years of experience

Even though StructuredProfileSignals already had an optional function_tags field, that field was not being populated from real profile text.

As a result, the engine could not compare:

job-side function tags

profile-side function tags

and therefore could not generate strong overlap-based Why bullets.

Fix applied

app/api/jobfit/extract.ts was updated so extractProfileSignals(...) now computes:

profileFunctionTags = computeFunctionTags(t)

and stores the result in:

function_tags

Result

Profile-side deterministic extraction now emits tags such as:

brand_marketing

content_social

growth_performance

creative_design

operations_general

legal_regulatory

depending on the profile text.

Why this matters

This created the first deterministic profile-side proof vocabulary that could be compared against job-side function tags.

This was a necessary prerequisite for overlap-driven Why bullets.

42. Job-Side Function Tag Coverage Expanded for Growth / Performance Roles

Real-case and spot-check testing revealed that some hybrid marketing jobs, especially growth and performance roles, were under-tagged on the job side.

Problem observed

A sample Growth Marketing Analyst posting was initially tagged only as:

brand_marketing

content_social

It was not consistently tagging:

growth_performance

This weakened job/profile overlap and caused the Why system to fall back to generic alignment more often than desired.

Fix applied

app/api/jobfit/extract.ts was updated to expand the growth_performance tag rule with additional phrases such as:

growth marketing

growth team

campaign performance

campaign optimization

optimization

actionable insights

a/b testing

testing frameworks

pacing

scale client accounts

conversion

creative assets

google analytics

manage campaigns

The content_social rule was also expanded to better capture hybrid marketing roles that combine content and channel execution.

Result

Growth-oriented marketing jobs became more likely to emit:

growth_performance

content_social

brand_marketing

simultaneously, which improved overlap detection with marketing candidate profiles.

43. Shared Function Tag Overlap Added to Why Generation

After both job-side and profile-side function tags were available, the scoring layer was updated to use tag overlap as deterministic proof.

Problem observed

The system still relied too heavily on:

target family match

generic role alignment

generic domain familiarity

even when more specific overlap existed.

Fix applied

app/api/jobfit/scoring.ts was updated to compute:

jobTags

profileTags

sharedFunctionTags

and to use shared function tag overlap inside active Why generation.

This directly influenced:

WHY_EXECUTION_PROOF

WHY_FUNCTIONAL_PROOF

Result

Rendered Why bullets began to shift from:

generic role alignment

toward:

real functional overlap

execution overlap

domain overlap

This was the first stage where the engine could say something more meaningful than pure family match.

44. Legal / Regulatory Tag Added for Real-Case Coverage

Real-case regression continued to show weak explanation quality for legal and policy-adjacent roles.

Problem observed

Cases such as:

real-015 Entry Level Legal Assistant

were still collapsing to generic role alignment because neither the job nor the profile had a strong deterministic tag for legal / regulatory work.

Fix applied

app/api/jobfit/extract.ts was updated to add a new function tag:

legal_regulatory

The tag rule included phrases such as:

legal

legal assistant

regulatory

regulations

compliance

privacy

contracts

policy analysis

policy research

The classifier was also updated so:

legal_regulatory maps to job family Other

Result

Legal and policy-adjacent roles could now share a deterministic function tag, which enabled functional overlap to appear in Why bullets.

Real-case impact

real-015 changed from a generic alignment bullet to a proof-oriented bullet.

Previous pattern:

role-alignment-only output

New pattern:

legal and regulatory functional overlap

This confirmed that the overlap-based Why system works when the extraction vocabulary is sufficiently rich.

45. Function Tag Labels Were Humanized for User-Facing Output

After shared function overlap was introduced, rendered bullets initially exposed raw internal tags.

Problem observed

Examples included:

communications_pr

operations_general

legal_regulatory

These labels were understandable internally but looked poor in user-facing output.

Fix applied

app/api/jobfit/scoring.ts added deterministic tag-to-language mapping through describeFunctionTag(...).

Examples:

communications_pr -> communications and messaging

content_social -> content and social execution

operations_general -> operations and process work

legal_regulatory -> legal and regulatory work

Result

Rendered Why bullets stopped exposing internal tag names and began to read like actual explanation text.

46. Profile Evidence Snippets Added to Structured Profile Signals

The next major limitation identified was that overlap-based Why bullets were still abstract.

Problem observed

Even after function-tag overlap worked, output still sounded like:

“Your background shows overlap in communications and messaging”

“Your background shows overlap in legal and regulatory work”

This was better than family match, but still not strong enough.

The real target was to reference actual background evidence, such as:

internships

experience bullets

projects

research work

platform/tool usage

Fix applied

app/api/jobfit/signals.ts was updated so StructuredProfileSignals now supports:

function_tag_evidence?: Partial<Record<FunctionTag, string[]>>

app/api/jobfit/extract.ts was then updated to build deterministic evidence snippets for each function tag.

Example categories included:

brand_marketing

growth_performance

content_social

data_analytics_bi

legal_regulatory

operations_general

Result

Profile signals could now carry not just abstract tags, but concrete proof text associated with those tags.

This was the key prerequisite for résumé-grounded Why bullets.

47. Resume-Scoped Evidence Extraction Replaced Full Profile Blob Extraction

Initial evidence-snippet extraction used the full profileText payload.

Problem observed

Because the real-case builder assembles profileText from many fields, evidence extraction initially pulled junk such as:

current_status

target_roles

location_preferences

feedback_style

instead of clean resume proof.

Fix applied

app/api/jobfit/extract.ts was updated to isolate the resume_paste section from the full profile payload using regex extraction.

Evidence extraction for function_tag_evidence now prefers:

resumeEvidenceText

instead of the full profile blob.

Result

Evidence extraction began to pull actual resume material instead of profile metadata.

48. Profile Evidence Snippets Were Converted from Tag Labels to Resume-Grounded Proof

After resume-scoped evidence extraction was added, the scoring layer was updated to use profile evidence sentences when available.

Fix applied

app/api/jobfit/scoring.ts was updated so active WHY_FUNCTIONAL_PROOF generation now:

collects shared function tags

pulls candidate evidence snippets from profile.function_tag_evidence

ranks the snippets

selects the best snippet

uses that snippet as the profile-side Why evidence

If no snippet exists, the system still falls back to tag-label explanation.

Result

Why generation began to move from:

“Your background shows overlap in legal and regulatory work”

toward:

actual profile-derived language

This was the transition point from taxonomy-based explanation to resume-grounded explanation.

49. Evidence Ranking and Filtering Were Added to Prevent Junk Snippets

Once profile evidence snippets were introduced, the real-input regression suite exposed multiple noisy snippet problems.

Problems observed

The first extracted snippet was often poor quality, including:

clipped sentence starts

section headers

education blocks

core competency headers

truncated phrases

Examples included:

CORE COMPETENCIES ...

clipped words like earch

incomplete endings like across

Fix applied

app/api/jobfit/scoring.ts added ranking and filtering logic for evidence snippets.

Positive ranking features included:

action verbs such as conducted, prepared, reviewed, analyzed, built, developed, managed

moderate sentence length

job-title markers such as intern, analyst, assistant, clerk

Negative filters and penalties included:

CORE COMPETENCIES

EDUCATION

HONORS

COURSEWORK

broken starts

truncated endings

Result

The selected evidence snippets became materially better, although some noisy marketing examples remained unresolved by the end of the session.

50. Legal / Policy Why Bullet Reached First Clean Resume-Grounded State

A major milestone was reached for real-015 during this phase.

Previous state

The Why output for the legal assistant case had previously been generic and low-value.

Earlier variants included:

family alignment only

raw tag overlap

clipped metadata-like text

raw snippet dumps

Final improved state observed

For real-015, the Why bullet reached:

“Your experience conducting legislative and policy research supporting government affairs initiatives directly aligns with the role's focus on legal and regulatory work.”

Interpretation

This was the first clean Why bullet in the new system that met the intended standard:

specific

grounded in real background evidence

connected to the job

written like hiring judgment rather than internal classification

Importance

This confirmed that the redesigned extraction + scoring + rendering pipeline can produce SIGNAL-grade Why explanations when the evidence quality is high enough.

51. Marketing Why Bullets Improved, but Snippet Quality Remains Inconsistent

The same resume-grounded Why approach was then applied to marketing cases.

Observed improvement

Marketing cases began to move away from tag labels and toward real proof such as:

brand strategy work

messaging work

campaign work

go-to-market work

Remaining problem

Marketing snippet quality remained inconsistent due to flattened resume text and noisy evidence candidates.

Observed issues included:

clipped endings

core competencies leaking into explanation

malformed starts

overlong fragments

Current status

The architectural path is now correct:

function-tag overlap works

resume-grounded evidence is wired in

renderer can output clean proof sentences

However, marketing snippet selection still needs additional refinement before those cases consistently match the quality reached in the legal/policy example.

Interpretation

The system has now proven the explanation architecture works. The main remaining gap is evidence-snippet quality control, not the core Why design itself.

52. Current State at End of This Phase

At the end of this phase, the Why redesign has materially progressed beyond the original documented plan.

Completed during this phase:

proof-based Why taxonomy introduced

legacy family-match-dominant Why logic removed from active path

profile function tags extracted

job-side growth/performance tagging improved

legal/regulatory tag added

shared function-tag overlap added to Why generation

profile evidence snippets added to structured profile signals

scoring updated to prefer real resume evidence over generic overlap labels

renderer simplified so profile evidence can stand alone when strong enough

first clean SIGNAL-grade Why bullet achieved in real-case regression

Remaining known issue:

resume snippet quality for some marketing cases is still noisy

This phase therefore moved the system from:

generic category explanation

to:

early resume-grounded competitiveness explanation

without replacing the deterministic engine with an LLM.

## 53. Phase II Evidence-First Stability Pass: Harness, Selection, and Renderer Corrections

A major Phase II stabilization pass was completed to make the deterministic WHY pipeline usable for production launch without falling back into case-by-case patching.

This phase focused on:

- fixing harness compatibility after the evidence-first rewrite
- restoring deterministic renderer coverage in regression
- correcting evidence filtering bugs that were suppressing valid WHY bullets
- reducing duplicate WHY bullets caused by repeated match keys and repeated rendered output
- compressing overlong job requirement snippets so strong cases could keep evidence without flooding bullets
- improving real-case output quality while preserving deterministic scoring and auditability

This work was intentionally done at the engine layer rather than by patching individual regression cases.

### Core architectural principle reaffirmed

The engine must behave like this:

resume/profile text -> deterministic evidence units  
job text -> deterministic requirement units  
deterministic evidence matching -> WHY codes  
deterministic renderer -> user-facing WHY bullets

The fix strategy in this phase was:

1. identify where evidence was being lost
2. fix the engine layer that caused the loss
3. re-run the real regression pack
4. confirm that changes improved multiple cases, not just one case

### Files materially touched during this phase

Core engine / route-facing files:

- `app/api/jobfit/signals.ts`
- `app/api/jobfit/extract.ts`
- `app/api/jobfit/scoring.ts`
- `app/api/jobfit/deterministicBulletRendererV4.ts`
- `app/api/jobfit/evaluator.ts`
- `app/api/_lib/jobfitEvaluator.ts`

Regression harness files:

- `tests/jobfit/runLocalCases.ts`
- `tests/jobfit/runRealCases.ts`

### Harness compatibility fixes

After the evidence-first rewrite, the harness and wrapper layers no longer matched the updated evaluator contracts.

Problems observed included:

- wrapper/evaluator argument mismatches
- renderer calls receiving non-`EvalOutput` shaped objects
- missing regression CSV fields for rendered bullets
- `profileOverrides` typing mismatches in real-case runner
- stale backup file interference
- module resolution issues when running TypeScript directly with Node instead of `tsx`

Fixes applied included:

- aligning `app/api/jobfit/evaluator.ts` and `app/api/_lib/jobfitEvaluator.ts` with the deterministic wrapper flow
- restoring `renderBulletsV4(...)` as the active deterministic bullet path
- updating both regression runners so they construct renderer-compatible input objects
- extending CSV/JSON output fields to include rendered WHY/RISK bullets and counts
- standardizing execution on:
  - `npx tsx tests/jobfit/runLocalCases.ts`
  - `npx tsx tests/jobfit/runRealCases.ts`
- removing the broken backup TypeScript file from compilation by converting it to:
  - `extract.BROKEN_BACKUP.txt`

### Important tooling note

The real-case runner should be executed with:

`npx tsx tests/jobfit/runRealCases.ts`

Running the `.ts` file directly with Node caused ESM resolution issues and is not the supported command.

### Evidence filtering bug: good profile facts were being discarded

A major scoring bug was identified in `selectWhyMatches(...)` inside `app/api/jobfit/scoring.ts`.

Problem observed:

Strong, clean resume bullets such as:

- "Conducted legislative and policy research supporting government affairs initiatives"
- "Prepared case summaries and precedent research used in juvenile court hearings"

were being rejected as bad profile facts.

Root cause:

`badProfileFact(...)` contained an over-aggressive rule rejecting text that:

- had no period
- contained only letters/spaces/numbers/symbols after normalization

This incorrectly filtered out many legitimate resume bullets.

Fix applied:

The following rule was removed from `badProfileFact(...)`:

`if (/^[a-z\s|,&\-0-9]+$/.test(t) && !/[.]/.test(s)) return true`

Result:

Clean deterministic profile evidence began surviving selection again, especially for policy/legal cases such as:

- `real-013`

### Profile-noise suppression improvements

Once valid profile facts were restored, additional noise filters were added to reject profile fragments that still looked like pasted resume headers rather than evidence bullets.

Additional rejections were added for snippets that contained:

- pipe-delimited header fragments
- embedded month/year job-header style text

This improved cleanliness by suppressing bullets built from:

- resume header glue
- job-title/date-line fragments
- flattened metadata blocks

### Fallback selector bug: duplicate match keys were being re-added

Another bug was identified in `selectWhyMatches(...)`.

Problem observed:

The primary selection loop respected `usedKeys`, but the fallback loop that tries to fill to the minimum WHY count did not.

As a result:

- the same `match_key` could be selected multiple times in fallback
- WHY codes became artificially duplicated
- renderer output later collapsed these duplicates, producing:
  - inflated WHY code counts
  - under-filled WHY bullet counts

Fix applied:

The fallback loop was updated to also respect `usedKeys` and to add newly accepted match keys into `usedKeys`.

Result:

Selection became match-key diverse instead of repeatedly reusing the same evidence channel.

### Job-fact over-filtering bug: good matches were being discarded

A second major evidence-loss issue was found in `badJobFact(...)`.

Problem observed:

Strong job requirement snippets for real marketing and operations roles were often 500–600 characters long and were being rejected before match selection.

This caused the engine to lose good WHY matches even when profile evidence existed.

Fix applied:

The job-fact length ceiling in `badJobFact(...)` was raised from:

- `420`

to:

- `700`

This allowed long but valid requirement snippets to survive selection.

### Long job snippet compression added in extraction

Raising the job-fact ceiling restored matches, but it also revealed a new problem:

- repeated long job clauses caused repetitive WHY bullets
- strong cases inflated back toward 5–6 repetitive bullets
- some scores drifted too high again

To preserve evidence without preserving excessive verbosity, `extract.ts` was updated so job requirement units compress long requirement snippets before storing them.

Fix applied:

A `compressJobSnippet(...)` helper was added and used inside `makeJobUnit(...)`.

Compression behavior:

- strips repetitive prefixes such as:
  - "Responsibilities include"
  - "Responsible for"
  - "You will"
- keeps short snippets unchanged
- truncates long requirement text to the first few semicolon-delimited clauses instead of storing the entire paragraph

Result:

The engine retained requirement evidence while reducing downstream renderer repetition.

### Renderer duplication bug: duplicate rendered WHY bullets were not suppressed

A major renderer-level problem remained even after selection was improved.

Problem observed:

Different WHY codes could still render to effectively the same sentence.

Root cause:

`deterministicBulletRendererV4.ts` only deduped on:

- `match_key`
- broad group (`proof`, `execution`, `tools`)

This was insufficient because distinct match keys could still produce near-identical rendered bullets.

Fix applied:

Renderer-side deduplication was expanded to track:

- rendered WHY text
- normalized job-fact anchors

Specifically, the renderer now suppresses WHY bullets when:

- the exact rendered text was already used
- the same normalized job-fact anchor was already used

Result:

Strong cases stopped spraying repeated bullets that all pointed to the same job requirement sentence.

### Regression observations from this phase

This phase produced several meaningful real-case behavior changes.

#### `real-005` Product Marketing Intern

Early in this phase, the case oscillated through several states:

- too weak because good evidence was being filtered out
- too repetitive because long job snippets were over-admitted
- too inflated because duplicate rendered bullets were allowed

After selection and renderer fixes:

- classification remained correctly in `Marketing`
- WHY bullets became distinct instead of duplicated
- the case remained strong, though still somewhat generous relative to desired calibration

Interpretation:

This case served as the primary stress test for:

- job snippet filtering
- duplicate WHY suppression
- marketing evidence quality

#### `real-012` Process Improvement Analyst

Before renderer deduplication:

- 6 WHY bullets
- excessive repetition around the same process-improvement requirement paragraph

After renderer job-fact deduplication:

- WHY bullets reduced from 6 to 3
- bullets became materially more distinct
- decision remained `Apply`

Interpretation:

This confirmed that renderer deduplication improves quality without destroying strong-case viability.

#### `real-013` Florida Policy Analyst

This case was the clearest proof that the evidence filters were too aggressive.

Before fixes:

- valid policy-research proof existed in extracted evidence units
- WHY bullet count collapsed to zero or one
- strong direct proof was being lost before rendering

After profile-fact filtering fixes:

- clean policy-research proof survived
- WHY bullets became evidence-based again
- decision recovered into a viable band

Interpretation:

This case confirmed that the engine had real evidence but was discarding it due to bad filtering logic.

### Current real-case distribution after this stabilization pass

Observed distribution at the current working state:

- Pass: 5
- Review: 7
- Apply: 1
- Priority Apply: 2

Interpretation:

This is materially healthier than the earlier over-generous state and no longer looks like a collapsed high-score system.

However, it is not yet the final calibration state for launch.

### Current known remaining issues

The following issues remain active after this phase:

1. Some strong cases still appear somewhat generous:
   - especially `real-005`
   - possibly also `real-011`

2. Some viable Review cases are still under-filled on WHY count:
   - especially `real-013`
   - also some other Review/adjacent-fit cases

3. Some bullets remain too job-clause-heavy even after compression:
   - cleaner than before, but still longer than ideal

4. The engine is now much better at preventing duplication, but selection diversity for viable Review cases still needs refinement

### Strategic conclusion at end of this phase

This phase did not solve final WHY quality or final scoring calibration.

What it did accomplish was more foundational:

- the harness now runs cleanly again
- renderer output is back inside the regression surface
- valid evidence is no longer being accidentally filtered out
- repeated WHY bullets are materially reduced
- long job snippets are compressed
- strong cases are no longer inflated purely by duplicate rendering

This means the system is now in a much safer state for the next phase:

- improving `selectWhyMatches(...)` diversity
- tightening score generosity where needed
- preserving 3–6 strong WHY bullets for viable roles without reintroducing duplication

54. Why Renderer Quality Lock Phase: From Technically Correct to Product-Grade

After the Phase II stability pass, the deterministic WHY system was structurally sound but still not good enough for a paid product.

Problems still observed:

bullets sounded like stitched debug text rather than hiring judgment

job-side requirement text was still too literal and JD-like

strong cases could repeat the same proof in slightly different forms

legal/policy cases could still anchor to weak education-style job lines

stated user interests were not yet available in the renderer

even when stated interests were available, literal exact-string matching was too weak

This phase was focused on closing the WHY workstream at a “shipworthy” level without reintroducing case-by-case patching.

The design standard used in this phase was:

A SIGNAL WHY bullet should read like a recruiter explaining why the candidate is viable for the role.

Not:

family match filler

pasted JD fragments

evidence glue code

exact internal tag labels

Strategic goal of this phase

The target final behavior became:

optional career-intent alignment bullet at the top

evidence-based WHY bullets below it

no duplicate rendered bullets

no duplicate resume evidence bullets

job fact phrasing compressed into capability language where possible

no education-only lines driving WHY output

This phase remained fully deterministic.

No LLM rendering layer was introduced.

55. Structured Profile Signals Expanded to Carry Stated Interests

To support a premium user-facing alignment signal, the structured profile contract was expanded to carry stated career intent into the deterministic renderer.

Change applied

app/api/jobfit/signals.ts was updated so StructuredProfileSignals now supports:

statedInterests?: {
  targetRoles?: string[]
  adjacentRoles?: string[]
  targetIndustries?: string[]
}
Why this mattered

Before this change, the profile carried:

target families

constraints

tools

grad year

years of experience

function tags

but it did not carry the user’s explicitly stated interests from intake, such as:

target roles

adjacent roles

target industries

As a result, the renderer could not say:

“This position aligns with your stated interest in ...”

even when that was obviously true.

56. Real Case Builder Updated to Pass Stated Interests into Profile Overrides

Once the signal contract supported stated interests, the real-case builder had to actually populate them.

Change applied

tests/jobfit/build-real-cases.ps1 was updated so each generated real case now writes:

targetRoles

adjacentRoles

targetIndustries

into:

profileOverrides.statedInterests

Result

Real-case regression output now carries the candidate’s stated interests all the way into:

row.profile_signals.statedInterests

This made deterministic career-alignment rendering possible.

Important implementation note

The real-case regression flow remains:

npx tsc --noEmit
.\tests\jobfit\build-real-cases.ps1
npx tsx tests/jobfit/runRealCases.ts

This remains the correct real-case regression harness and should continue to be used.

57. Renderer Templates Were Rewritten from Glue Phrases to Hiring-Judgment Phrases

Once evidence quality improved, the next visible problem was sentence quality.

Problem observed:

WHY bullets still sounded like:

“directly supports the ... this role requires”

“maps well to the execution side of this role”

“is relevant adjacent proof for ...”

These were technically correct but not premium.

Template changes applied

app/api/jobfit/deterministicBulletRendererV4.ts was updated so the core WHY templates now use cleaner phrasing such as:

gives you real proof for ...

also shows the structured execution this role depends on ...

is relevant adjacent proof for ...

Result

Why bullets began to sound more like judgment and less like evidence concatenation.

Example progression:

Previous pattern:

“Your experience X directly supports the Y this role requires”

Improved pattern:

“X gives you real proof for Y”

This change materially improved readability without changing underlying scoring or evidence selection logic.

58. Job-Fact Normalization Was Upgraded into Capability-Level Compression

Even after sentence template cleanup, job-side clauses still sounded too much like pasted job descriptions.

Problem observed:

Bullets such as:

“... aligns directly with ensuring compliance with state and federal regulations, conducting detailed analyses, and collaborating with various bureaus for process improvement”

“... aligns directly with development of business plans through market research, segment analysis, and evaluation of growth opportunities and risks”

were still too close to raw JD language.

Fix applied

normalizeWhyJobFact(...) in app/api/jobfit/deterministicBulletRendererV4.ts was upgraded from simple prefix stripping into deterministic capability compression.

Key recurring job-fact patterns now compress into cleaner capability phrases, for example:

compliance / regulation / analysis clusters
-> the compliance and analysis work this role requires

process design / documentation / governance clusters
-> the process design and documentation work this role requires

cross-functional strategy execution clusters
-> the cross-functional execution this role requires

market research / growth opportunity clusters
-> the market research and growth strategy work this role requires

product strategy / analytical work clusters
-> the product strategy and analytical work this role requires

Result

The renderer now speaks in capability summaries rather than pasted responsibilities, while remaining fully deterministic.

This was one of the highest-value readability upgrades in the entire WHY workstream.

59. Education-Only Job Lines Were Blocked from Driving WHY Evidence

A major quality bug surfaced in policy/regulatory cases.

Problem observed:

The engine could generate WHY bullets anchored to lines like:

“Ideal candidates will have a bachelor's degree in Public Policy or Administration...”

These are table-stakes eligibility statements, not competitiveness proof.

Initial mitigation

badJobFact(...) in app/api/jobfit/scoring.ts was tightened to reject WHY rendering from job facts containing:

bachelor's degree

bachelors degree

degree in

This improved renderer output, but did not fully solve the problem because education-style lines were still being extracted as job requirement units.

Final fix applied

buildUnitsFromLines(...) in app/api/jobfit/extract.ts was updated so job lines matching patterns such as:

ideal candidates will have

bachelor's degree

bachelors degree

degree in

are skipped entirely during job requirement unit generation.

Result

Education-only lines no longer enter the WHY evidence pipeline at all.

This materially improved cases such as:

real-013

where the system stopped anchoring good legal/policy evidence to a degree requirement.

60. Operations Adjacency Was Expanded for Policy / Documentation / Process Roles

After education-line cleanup, some viable Review cases still under-produced WHY bullets because the adjacency map was too narrow.

Problem observed:

In real-013, the job still contained a useful execution-style requirement, but Zoe’s profile evidence in:

drafting_documentation

policy_regulatory_research

was not broad enough to consistently connect into:

operations_execution

Fix applied

The ADJACENCY map in app/api/jobfit/scoring.ts was expanded so:

operations_execution

now also recognizes adjacency to:

drafting_documentation

policy_regulatory_research

in addition to its prior adjacency paths.

Result

Policy/legal/process roles regained viable execution-style WHY support without reopening broad family-match filler.

This helped restore better explanation quality for adjacent-fit Review cases.

61. Renderer Dedupe Was Expanded to Suppress Duplicate Resume Evidence

A final quality issue remained in strong cases such as:

real-005

real-011

Problem observed:

The same profile evidence line could still render more than once if it appeared under different code types, for example:

direct proof

adjacent proof

Even when renderer text changed slightly, the bullet still felt duplicated from a user point of view.

Previous renderer dedupe covered:

rendered text

job fact anchors

match keys

broad groups

This was not enough.

Fix applied

renderBulletsV4(...) in app/api/jobfit/deterministicBulletRendererV4.ts was updated to also track:

usedProfileFacts

and suppress rendering when the same normalized profile_fact had already been used.

Result

Duplicate resume evidence bullets are now suppressed across direct and adjacent matches.

This materially improved strong marketing and operations cases by reducing repetition without weakening decisions.

62. Career-Intent Alignment Bullet Added as a Separate Top WHY Bullet

The product requirement was clarified during this phase:

If the role aligns with the user’s stated target role or direction, SIGNAL should say so explicitly.

Important design decision:

This should not be appended to every WHY bullet.

Doing that created repetition and clutter.

Final behavior chosen

The renderer now supports one optional standalone alignment bullet that appears at the top of the WHY section.

Desired pattern:

alignment bullet, if deterministically supported

evidence bullet 1

evidence bullet 2

additional evidence bullets if caps allow

Change applied

renderBulletsV4(...) now computes:

interestAlign = buildInterestAlignmentClause(...)

using:

out.profile_signals

out.job_signals

and, if non-null, pushes that bullet into why before the normal WHY rendering loop.

Result

The WHY section can now begin with a sentence such as:

This position aligns with your stated interest in marketing roles.

This is a high-value product signal because it tells the user not only that they have proof, but also that the role matches the direction they said they want.

63. Career-Intent Matching Was Upgraded from Literal String Matching to Deterministic Role Buckets

The first version of stated-interest matching was too literal.

Problem observed:

The renderer initially used logic similar to:

jobText.includes(norm(role))

This required the job description to contain the exact target role phrase.

That was too weak.

For example, a candidate might state interest in:

Policy Analyst

Regulatory Affairs Analyst

Compliance Analyst

while the job text uses broader policy/compliance language without those exact titles.

Fix applied

buildInterestAlignmentClause(...) in app/api/jobfit/deterministicBulletRendererV4.ts was upgraded to use deterministic grouped matching.

The function now:

inspects normalized target role text

inspects job text

inspects job family

maps recurring patterns into grouped role categories

Examples of grouped output include:

policy and regulatory roles

operations and transformation roles

marketing roles

finance roles

legal and policy-adjacent roles

Important behavior rule

The alignment bullet is only emitted when the matcher finds deterministic support.

It is not a generic family-match bullet.

It is meant to represent the user’s stated direction, not just system classification.

Current status

This logic now works for some cases, especially marketing-aligned roles.

It is still intentionally conservative and may be expanded later for broader policy and operations coverage.

64. Why Renderer Output Was Locked at “Shipworthy” Quality

By the end of this phase, the WHY renderer crossed the line from:

technically functioning

structurally deterministic

to:

readable

evidence-based

user-defensible

suitable for a paid product

Achievements completed in this lock phase

sentence templates rewritten into cleaner hiring-judgment phrasing

capability-level job-fact compression added

education-only job lines blocked from WHY extraction

stated interests added to structured profile signals

real-case builder updated to carry stated interests

standalone career-alignment WHY bullet added

exact-string alignment logic replaced with grouped deterministic alignment logic

duplicate rendered bullets suppressed

duplicate job-fact anchor bullets suppressed

duplicate profile-fact bullets suppressed

Resulting renderer behavior

The WHY section now behaves like this:

optional alignment bullet

direct experience proof

execution proof

tool proof

adjacent proof

subject to caps and dedupe rules.

Important conclusion

The WHY system is not perfect-perfect.

Remaining polish opportunities still exist, including:

stronger capability-bucket dedupe for very strong cases

broader stated-interest matching coverage

one more compression pass on certain repetitive strong-case outputs

However, the system is now in a state that is reasonably described as:

shipworthy

The renderer is no longer broken, embarrassing, or debug-like.

It is now stable enough to lock and move on to other workstreams.

65. Updated Real-Case Regression Commands and Validation Discipline

The regression command sequence used during this phase should be treated as the standard real-case validation flow:

npx tsc --noEmit
.\tests\jobfit\build-real-cases.ps1
npx tsx tests/jobfit/runRealCases.ts

This flow validates:

TypeScript integrity

real-case generation

deterministic extraction

scoring

decision ladder

live renderer output

Validation discipline used in this phase

Each substantive WHY-system change followed this sequence:

compile cleanly

rebuild real cases if builder inputs changed

re-run real-case regression

inspect selected real cases directly

confirm:

bullet counts

bullet distinctness

wording quality

decision stability

This should remain the standard for future WHY or renderer work.

66. Current End-of-Phase Real-Case Quality Summary

At the end of this phase:

real-013 Florida Policy Analyst

This case reached a strong, product-worthy explanation state.

Observed WHY pattern:

direct policy-research proof

execution/documentation proof

This case no longer anchors to education-only requirement language and now reads like a credible adjacent-fit Review explanation.

real-005 Product Marketing Intern

This case improved substantially.

Observed WHY pattern:

optional top alignment bullet

multiple distinct marketing-related evidence bullets

repetition reduced materially compared with earlier states

This case may still benefit from future capability-bucket dedupe, but it is no longer spraying duplicate garbage.

real-011 Business Process / Operations Case

This case is also materially cleaner.

Observed WHY pattern:

process design / documentation proof

cross-functional execution proof

reduced duplication compared with earlier states

This case remains somewhat clustered around a small set of capability buckets, but is now readable and defensible.

Overall conclusion

The WHY renderer is now stable enough to close this workstream and move on.

Future improvements can be treated as polish rather than rescue work.

67. Active Baseline and Documentation Reminder

The active synthetic/real behavior baseline described earlier in this document remains:

baseline-010

No new baseline version was formally created during this WHY renderer lock phase.

Reason:

This phase was primarily focused on:

renderer quality

extraction cleanup for WHY suitability

real-case output refinement

rather than a formal accepted recalibration snapshot across the full synthetic baseline process.

68. Current Active Regression Workflow and Source-of-Truth Update

The regression system now has two distinct input modes, and it is critical not to confuse them.

Synthetic case pack

Synthetic cases continue to live in:

tests/jobfit/cases/*.json

These are hand-authored deterministic regression scenarios used to validate controlled logic behavior.

Real case pack

The real-case regression pack is now generated from:

tests/jobfit/real_cases_input.csv

Important clarification:

tests/jobfit/real_cases/*.json is not the source of truth

those JSON files are generated artifacts

they are rebuilt from the CSV every time the real-case builder runs

This means:

manually creating a new real-0XX.json file is not sufficient

the next run of build-real-cases.ps1 will delete and recreate the folder contents from CSV

new real cases must be added by appending rows to real_cases_input.csv

This is now the active real-case workflow.

69. Real-Case Builder Behavior: Generated JSON Files Are Rebuilt from CSV

The current real-case builder script is:

tests/jobfit/build-real-cases.ps1

Its behavior is now confirmed to be:

read tests/jobfit/real_cases_input.csv

clear existing JSON files in tests/jobfit/real_cases/

regenerate JSON files from the CSV rows

write one JSON file per row

This means the following behavior is intentional and expected:

existing JSON files in tests/jobfit/real_cases/ are deleted before rebuild

the count of built files equals the number of rows in real_cases_input.csv

manually added JSON files that are not represented in the CSV will be removed on rebuild

Operational rule

When adding a new real regression case:

append a row to tests/jobfit/real_cases_input.csv

run:

.\tests\jobfit\build-real-cases.ps1

verify the generated JSON appears in:

tests/jobfit/real_cases/

run:

npx tsx tests/jobfit/runRealCases.ts

Do not treat tests/jobfit/real_cases/*.json as manually maintained source files.

70. Real Regression Expansion: Added New Anchor Cases for Will, Zoe, and Jacob

The real-case regression pack was expanded with three additional anchor scenarios based on active product testing.

New cases added:

real-016 — Will Friedman / Alton Aviation Management Consulting Intern

real-017 — Zoe Siegel / Planned Parenthood Policy Analyst

real-018 — Jacob Kanterman / GeistM Growth Marketing Analyst

These were added to:

tests/jobfit/real_cases_input.csv

and then generated into:

tests/jobfit/real_cases/

Why these three cases matter

These cases were chosen because they expose three different classes of engine behavior:

real-016 — strong early-career consulting fit

Purpose:

validate that a strong internship-level consulting candidate can reach a viable high-confidence outcome

test direct proof in market research, analytics, and finance fundamentals

Observed behavior at current state:

score = 82

no risk codes

Interpretation:
This behaves like a healthy Apply-type early-career consulting case.

real-017 — policy-adjacent candidate vs. specialized policy role

Purpose:

validate that a policy/legal student with advocacy and legislative research experience does not get over-promoted into a highly specialized health-policy role

test missing domain-specific proof behavior

Observed behavior at current state:

score = 76

no risk codes

Interpretation:
The case still exposes a known weakness:
the decision band is plausible, but the engine is still under-surfacing meaningful domain/specialization risks.

real-018 — direct growth-marketing fit

Purpose:

validate that a direct-fit entry-level growth/digital marketing candidate is not scored too conservatively

test campaign, content, analytics, and NYC-location alignment

Observed behavior at current state:

score = 81

risk codes included:

RISK_EXPERIENCE

RISK_MISSING_TOOLS

Interpretation:
This case is useful, but it also exposed a test-harness distortion:
the builder currently underestimates years of experience for some student profiles, which can generate misleading experience-gap risk output.

71. Real-Case Testing Revealed a Builder-Layer Experience Approximation Distortion

The addition of the new anchor cases revealed that some apparent JobFit issues were actually coming from the real-case builder rather than the engine itself.

Problem observed

In real-018 (Jacob / GeistM), the regression result included:

RISK_EXPERIENCE

profile experience approximated as 1 years

This was not a trustworthy reflection of the intended candidate scenario.

Root cause

tests/jobfit/build-real-cases.ps1 currently contains a simplified approximation:

default yearsExperienceApprox = 1

Early stage professional -> 3

This is too coarse for many student cases.

It can artificially create:

experience-gap risks

lower scores

distorted decision outcomes

especially for strong seniors and juniors who have multiple relevant internships, projects, or direct role proof.

Current interpretation

This is not yet a solved engine change.

It is currently documented as an identified builder-layer limitation that can distort real-case interpretation.

This matters because the real-case suite is intended to reveal engine behavior, and builder distortion can make a case appear worse than the engine logic actually is.

72. Active Real-Case Validation Sequence

The current standard validation flow for real-case regression is now:

npx tsc --noEmit
.\tests\jobfit\build-real-cases.ps1
npx tsx tests/jobfit/runRealCases.ts

This validates:

TypeScript integrity

CSV-driven real-case generation

deterministic extraction

scoring

gate behavior

downgrade behavior

live rendered WHY/RISK output

Direct inspection pattern

After running the real-case suite, targeted cases should be inspected directly from:

tests/jobfit/results/real_case_results.json

Typical inspection fields include:

decision

score

risk_codes

bullets

risk_bullets_joined

This remains the fastest way to inspect specific real-case behavior without relying on the UI.

73. Current Product Direction: Score Remains Internal, Decision Is User-Facing

During current ship-readiness work, product direction was clarified:

the student should not see the numeric score

the score remains useful internally for:

debugging

regression analysis

calibration

decision ladder logic

Implication

Going forward, regression testing should continue to track score internally, but product quality should be judged primarily by:

correct decision bucket

high-quality Why bullets

high-quality Risk bullets

This is especially important for a student and entry-level product, because numeric scores create false precision and can encourage over-filtering.

74. Current Ship-Readiness Focus

The active ship-readiness focus has now narrowed to three engine outputs:

scoring and decision correctness

“Why this works” bullet quality

risk bullet quality

Other concerns such as UI rendering, score display, and route orchestration are temporarily secondary.

Current working objective

For the next iteration window, the JobFit engine should be treated as ship-ready only when it consistently delivers:

correct Apply / Review / Pass judgment for student and early-career candidates

Why bullets that sound like hiring judgment, not debug text

Risk bullets that surface meaningful competitiveness gaps without over-penalizing normal entry-level limitations

This is now the active optimization target for the next few hours of work.

75. Locked Workflow for Adding New Real Regression Cases

A new operating rule was established for future real-case additions.

When adding any new real JobFit regression case:

use the existing tests/jobfit/real_cases_input.csv workflow

use a PowerShell-first workflow to append and verify rows

rebuild JSON cases from the CSV

verify the generated cases before running the suite

Locked standard

Future additions of JobFit real regression cases should use:

the existing tests/jobfit/real_cases_input.csv source-of-truth pattern

the generated tests/jobfit/real_cases/*.json artifact pattern

a PowerShell-first workflow to create and verify them

This should be treated as the standard real-case workflow going forward.

