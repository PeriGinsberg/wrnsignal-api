# SIGNAL Golden Test Set

Regression harness for the scoring engine. 8 cases, each isolating one defect,
scored **cold** and graded against explicit assertions.

## Layout
```
cases/case-0X.input.md   the ONLY thing the engine sees (resume + posting)
expected.yaml            assertions: verdict, gates, risk flags by id+severity
validate.py              lint + runner (wire one function to the engine)
README.md                this file
```

## The cold-scoring rule
The engine scores `cases/case-0X.input.md` and nothing else. It must never see
`expected.yaml` or any "planted defect" notes before producing a verdict.
`validate.py` enforces this by only ever passing the input file to the engine.

## What each case targets
| # | Case | Defect | Expected | Forbidden |
|---|------|--------|----------|-----------|
| 01 | Jordan / Threadline | all six at once; knockout + verb inversion | PASS | APPLY |
| 02 | Priya / Meridian | knockout on absent hard credential (clearance) | PASS | APPLY, REVIEW |
| 03 | Marcus / Vantail | seniority/scope inversion | PASS | APPLY |
| 04 | Dana / Corvel | stale skill vs "recent" requirement | REVIEW | APPLY |
| 05 | Tyler / Highfield | keyword-stuffed skills, no evidence | PASS | APPLY |
| 06 | Sofia / Nimbus | verb inversion #2 (generalization check) | REVIEW | APPLY |
| 07 | Reyna / Threadline | CONTROL — genuine strong fit | APPLY | REVIEW, PASS |
| 08 | Omar / Fernwood | CONTROL — borderline; preferred ≠ required | REVIEW | APPLY, PASS |

07 and 01 share the **same posting** on purpose: Reyna is the honest candidate
Jordan fakes. They must land on different verdicts (APPLY vs PASS). That single
comparison is the sharpest test in the set.

## Grading (in expected.yaml)
- **must_not_be** — verdicts that are a hard failure. Every adversarial case
  forbids APPLY; that's the bug being hunted. A false APPLY fails the case.
- **discriminator** — must match the expected verdict *exactly* (01, 02, 07, 08).
- **gates** — an unmet required gate must cap the verdict below APPLY regardless
  of score. `UNKNOWN` (not stated in resume) is treated as not-satisfied, never
  assumed. Preferred items (case 08) are **not** gates.
- **risks** — assert the flag *set* by stable id + minimum severity. Never a bare
  count; a count of 6 passes on 6 wrong flags. Ids come from the VOCAB in
  expected.yaml / validate.py.
- **your_move_must_not** — the advice must not point a recruiter at the
  candidate's weakest evidence (defect #6). A right verdict with harmful advice
  still fails the case.
- **invariants** (bottom of expected.yaml) — cross-case orderings
  (07 > 08 > 01, 07 > 06). Assert relationships, not just per-case verdicts.

## Use
```
python3 validate.py          # lint — works now, no engine needed
# implement score_resume() in validate.py, then:
python3 validate.py --run    # cold-run all 8 and grade
```

## Protocol
1. Run all 8 cold. Record verdict + gates + risks.
2. A pass = every case satisfies its assertions (esp. 01, 02, 07, 08).
3. After ANY logic change, re-run all 8. A fix that corrects 01 but breaks 07 is
   not a fix.
4. Every time a real resume gets a wrong verdict, add it as a new case here.
