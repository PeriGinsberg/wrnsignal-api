# SIGNAL JobFit — Diagnosis Test Log

**Session started:** 2026-07-27
**Engine version under test:** `jobfit_logic_version: 54d8939dd3c30eb5ca470254981ad90b1b36a0a9`
**Eval wrapper:** `JOBFIT_EVAL_WRAPPER_STAMP__2026_03_07__DIRECT_DETERMINISTIC_ORCHESTRATOR__B`
**Renderer:** `RENDERER_V5_STAMP__2026_03__AI_BULLET_RENDERER__CLAUDE`
**Extractor model:** `claude-haiku-4-5-20251001`

> If any of these stamps change mid-session, start a new section — results before and after are not comparable.

> ⚠️ **Engine changed mid-session.** C001 and C002 both ran on `54d8939d` (pre-fix). DEF-005 is
> fixed on branch `jobfit-runon-jd-split` @ `966c797f`, which alters JD segmentation and therefore
> `requirement_unit` snippets. **Any case run after that commit is not comparable to C001/C002** —
> start a new section when the fix lands on `dev`.

---

## 1. HOW TO USE THIS LOG

1. Run a case (résumé + JD + raw JobFit result) through the diagnosis thread.
2. Copy the returned **LOG BLOCK** into §4 Case Log.
3. If the case surfaced a defect not already in §3, add a new `DEF-xxx` row. If it matches an existing one, increment its **Hits** count and add the case ID to **Seen in**.
4. At session end, hand §2 + §3 + §5 to a fresh Claude thread using the prompt in §6.

**The register (§3) is the deliverable.** The case log is evidence; the register is what gets prioritized.

---

## 2. SESSION SCOREBOARD

Update at the end of the session.

| Metric | Count |
|---|---|
| Cases run | 2 |
| Verdicts CORRECT | 0 |
| Verdicts BUG | 2 |
| False-fires | 4 |
| False-clears | 1 (unverified — see DEF-002) |
| Wrong-verdicts (top-line APPLY/REVIEW/PASS wrong) | 1 |
| Known-bug repeats (family-mismatch etc.) | 0 |
| New defects opened | 9 (DEF-005…009; DEF-008 closed NOT-A-DEFECT) |

**Detector fire tally** (how often each detector fired, and how often that fire was wrong):

| Detector | Fired | Wrong | False-fire rate |
|---|---|---|---|
| knockout gate ledger | 0 | 0 | — |
| RISK_OWNERSHIP_VERB_MISMATCH | 0 | ? | **unmeasurable** — detectors were OFF on both runs |
| RISK_MISSING_PROOF | 5 | 3 | 60% |
| RISK_MISSING_TOOLS | 2 | 1 | 50% |
| RISK_LIMITED_MATCH_EVIDENCE | 1 | 1 | 100% |
| domain_gap | 0 | 0 | — |
| scope_inversion | 1 | 1 | 100% |
| unsupported_skill_claim | 0 | 0 | — |
| hard_credential_absent | 0 | 0 | — |
| people_mgmt_absent | 0 | 0 | — |
| RISK_FAMILY_MISMATCH (known bug) | 0 | 0 | — |
| RISK_EXPERIENCE seniority | 0 | 0 | — |

> **Caveat on this tally.** The detector flags (`JOBFIT_DETECTORS*`) were off for C001 and
> their state is disputed for C002 (§5). Only `scope_inversion` is confirmed to have come
> from the defect #1–#3 detector set; every other row is core-path scoring. Treat the
> detector-set rows as **unmeasured**, not as zeroes.

---

## 3. DEFECT REGISTER

Severity key: **S1** = wrong top-line verdict, user acts on bad advice. **S2** = wrong risk/strength shown, verdict survives. **S3** = cosmetic / dedup / wording.

| ID | Detector / component | Type | Sev | Hits | Seen in | One-line symptom | Fix direction | Status |
|---|---|---|---|---|---|---|---|---|
| DEF-001 | `prospecting_pipeline_management` requirement key | false-fire | S2 | **5** | C001, prod b3e99f67, prod fe2bfe0e, prod 8a834c62, prod cdae93c3 | JD's "Pipeline Management" = data intake/validation, keyword-matched to sales pipeline; tagged `sales_bd` + `requiredness: core`, set `salesSubFamily: other_sales` on a pure analytics JD; −7.8 penalty. **Hit count raised 1 → 5 by the DEF-003 audit:** once duplicates were collapsed, this key is the *surviving* high-severity gap in 4 of the 11 upgraded prod cases — i.e. it is now the single most load-bearing risk in that set | Gate the key on sales-context co-occurrence (leads/quota/accounts/outreach/CRM-as-sales). Route "data pipeline / intake / ingestion / validation" to a new `data_pipeline_ops` key. **Priority raised:** if this false-fires on those 4 JDs the way it did on C001, they are still under-scored after DEF-003 and should upgrade further — so this now gates the accuracy of a verdict band, not just a displayed risk | OPEN — **next up** |
| DEF-002 | `RISK_OWNERSHIP_VERB_MISMATCH` | false-clear | S1 | 1 | C001 | JD demands "Lead the development…", "guides our data team", "technical authority"; résumé evidence on that object is contribution-only (Partnered/contributed/Supported/Assisted/Collaborated/Helped). Risk did not fire; renderer instead titled it "TABLEAU DASHBOARD LEADERSHIP" and called it "the exact proof point" | **Do not fix yet — cause not established.** Detector is wired (`verbMismatch.ts:106` ← `jobfitEvaluator.ts:294`) but runs only under `applyVerbMismatchRisk`, which `detectorFlagsForPath` leaves unset unless a `JOBFIT_DETECTORS*` flag is on. C001 ran with flags off, so "did not fire" is fully explained by "was never called." Re-run with PAID detectors on before touching detector logic | **UNVERIFIED** |
| DEF-005 | `splitEvidenceLines` `actionSplit` (`extract.ts:1890`) + `badJobFact` ceiling (`scoring.ts:627`) | wrong-verdict | **S1** | 1 | C002 | Run-on JD (newlines stripped, bullets without terminal punctuation) survives as one ~1900-char evidence line → all function/execution `requirement_unit`s share that snippet → every `job_fact` trips `badJobFact`'s `length > 700` → `why_codes: []` → zero-WHY guardrail (`decision.ts:153`) forces **Pass**. Same JD + résumé scores Apply/89 with newlines, Pass/55 without | **FIXED** on branch `jobfit-runon-jd-split` @ `966c797f`. (a) `actionSplit` gains a second alternation of JD present-tense imperatives, constrained by a following lowercase word/digit; résumé past-tense list kept as its own unconstrained branch. (b) `jobFactFromUnit` truncates >700-char facts at a word boundary instead of discarding the match | **FIXED-UNVERIFIED** — regression suite not yet adjudicated |
| DEF-006 | `extractToolRequirements` (`extract.ts:2742`) | false-fire | S2 | 1 | C002 | `requiredTools`/`preferredTools` **inverted**. `requiredLine` is a per-line keyword test (`required\|must have\|proficient\|experience with`) with no section awareness, so the Nice-to-Have line "Experience with creative tools such as Adobe Express, Canva…" pushes `canva` into `requiredTools`, while JIRA — an actual Key Responsibilities duty — falls to `preferredTools`. Emits `RISK_MISSING_TOOLS` high @ weight −8, the entire `penaltySum` on that run. Boilerplate guard at `extract.ts:2754` should have caught it but needs `tools.length >= 4` *after* alias resolution and only `canva` is in `TOOL_ALIASES` | Gate `requiredLine` on the enclosing section — `inRequiredSection` tracking already exists at `extract.ts:2408-2414` — or derive required/preferred from the unit-level `requiredness` that is already computed correctly. **Two code paths, one root cause:** the unit extractor tags the same `canva` unit `requiredness: "supporting"` (correct) while `extractToolRequirements` calls it required (wrong). Fix should collapse them onto one authority, not patch the regex twice | OPEN |
| DEF-007 | `scope_inversion` (`riskDetectors.ts:165`) | false-fire | S3 | 1 | C002 | The `inflated` branch fires on the **résumé alone** — a contribution verb near a size token ("Supported a 12-person growth marketing team") — without consulting the JD for any span demand, yet the emitted message asserts "Role's owned span exceeds the candidate's" (`riskDetectors.ts:168`). C002's JD contains no headcount or team-span requirement at all; it is an IC reporting to the CMO. Contradicts DIAGNOSIS §3, which specifies scope_inversion as JD-span-driven | Require a JD-side span signal for the `inflated` branch too, i.e. `(inflated && LARGE_SPAN_DEMAND.test(jobText)) \|\| spanBelow`, or re-word the risk so it does not assert a JD fact the detector never checked. Medium severity, weight 0 — did not move C002's verdict | OPEN |
| DEF-003 | `RISK_MISSING_PROOF` cross-path duplication | dup | **S1** (was S3) | 2 | C001, C002 | Same `job_fact` emitted twice, once weighted and once at weight 0. **ROOT CAUSE FOUND:** two independent emitters that never reconcile — `scoring.ts:599` (`buildMajorGapRisks`, display-only, weight 0, sorted core-first then capped at 3) and `scoring.ts:1594` (uncovered-capability penalty loop, weight-bearing, **uncapped and undeduped**). One uncovered capability therefore produces two risk codes. Deduping *within* either path is a no-op — measured, corpus HARD unchanged at 114 | One capability = one risk = one penalty. Reconcile the two emitters into a single per-key gap set: penalise once, display once. **Severity raised to S1** — each duplicate counts separately toward the high-severity ceilings in `applyEvidenceGuardrails`, which is enough on its own to move a verdict a band (proved on prod-7adf78ff, Review→Pass). **FIXED** @ `883b5b9f`: `dedupeRiskCodes` keys `RISK_MISSING_PROOF` on (code, job_fact) only — the capability is the identity, the prose is presentation — and callers merge penalty-bearing risks first so first-wins keeps the weighted copy; penalty loop additionally deduped by requirement key. prod-7adf78ff returns to Review/74. Follow-up: duplicates now merge at **max severity**, because the two emitters disagree on severity and first-wins was silently downgrading gaps (caught in the audit; corrected 3 over-upgraded cases) | **FIXED — AUDITED, BASELINE RE-FROZEN** |
| DEF-004 | `client_commercial_work` requiredness | mis-typed | S3 | 1 | C001 | Sourced from "Maintain accurate time records and participate in… client-facing meetings" — a duty line — but typed `requiredness: core`, severity high. Directionally right, severity inflated from a weak line | Weight requiredness by line strength; admin/logistics duty lines should not reach `core` | OPEN |
| DEF-008 | job `strength` vs snippet length (`extract.ts` `jobRuleStrength` / `scoreJobLine`) | — | — | 1 | C002 follow-on | Hypothesised that `strength` is contaminated by snippet length — raw char bonuses (`+1` at ≥20, `+2` at ≥30, `−2` at <16) plus segmentation-sensitive `hits` accumulation — so that fixing DEF-005 made requirements look weaker and pushed prod-7adf78ff Review→Pass | **CLOSED — NOT A DEFECT.** Probed the two units directly. The length term *cancels* (both pre- and post-split snippets clear 30 chars, so `+3` applies in both runs); the delta was `hits`-driven. More importantly the drop was the engine getting **more honest, not less**: pre-fix, `analysis_reporting` (strength 6) was anchored to a recruiting blurb — *"Growing together We are seeking a highly skilled Reporting Analyst…"* — and `operations_execution` (strength 10, `core`) to a logistics line with leaked CSS — *"…Minnetonka, MN location. a { text-decoration: none; color: #464feb"*. Post-fix they anchor to real requirement text (*"Analyze operational data to identify areas for process improvement…"*). Lower strength on junk lines is correct behaviour. The real cause of the 7adf78ff flip is DEF-003 + DEF-009 | **CLOSED** |
| DEF-009 | `software_engineering` CAPABILITY_RULE (`extract.ts:1366`) | false-fire | S2 | 1 | C002 follow-on | Fires `core` at strength 9 on a **Data Analyst** JD (prod-7adf78ff, UnitedHealth). `jobPhrases` contains bare `"api"` and `"cloud"` with no word boundaries, no `requiresNearby`, no negative context — the canonical instance of architectural debt #1. A quantitative-analytics qualifications block ("3+ years… statistics, business analytics or computer science…") is enough to trip it, and once `core` it drives a high-severity `RISK_MISSING_PROOF` **and** an uncovered-capability penalty. Amplified by DEF-003, which counts it twice | Pre-compile `jobPhrases` to word-boundary regexes and gate the generic tokens (`api`, `cloud`, `backend`, `frontend`) on software-context co-occurrence (engineer/developer/codebase/deploy/repository). Do **not** widen to `computer science`, which is a degree-field phrase, not a job duty. Blocked on the broader bare-word refactor (debt #1) unless fixed narrowly for this rule first | OPEN |

---

## 4. CASE LOG

### CASE C001 — Jordan Alvarez → RADaR, Senior Marketing Analyst

```
CASE ID:        C001
DATE:           2026-07-27
RUN ID:         399df277-4723-4b1c-bc4b-4e0849306af8
FINGERPRINT:    JF-CI7IAWAH  (hash e42ce9af…)
RÉSUMÉ:         Jordan Alvarez — 5 yrs marketing analytics, Northbrook Consumer Group (brand-side CPG)
JD:             RADaR — Senior Marketing Analyst (agency-side, KC/Columbia/StL MO, hybrid)
SHIPPED RESULT: Review / 74  (raw 87, clamped 74, penalty −9.8)
resume_source:  NOT PRESENT IN PAYLOAD  ← see gap note below
isSeniorRole:   true
gate_triggered: none
detector fires: RISK_MISSING_PROOF ×3 (high), RISK_MISSING_TOOLS ×1 (low)

VERDICT CHECK:  bug ×2, opposite directions — they cancel into a plausible-looking 74

BUG 1: prospecting_pipeline_management (RISK_MISSING_PROOF, high, −7.8) — FALSE-FIRE
  JD line is "Pipeline Management: Manage and optimize processes for data intake and
  validation from various Media Platforms and Google Analytics" — a DATA pipeline, not a
  sales pipeline. Keyword collision tagged it functionTag: sales_bd, requiredness: core,
  and dragged salesSubFamily → "other_sales" on a pure marketing-analytics JD.
  Fired twice on identical job_fact (dedup miss → DEF-003).
  KNOWN-BUG? no (new) → DEF-001

BUG 2: RISK_OWNERSHIP_VERB_MISMATCH — FALSE-CLEAR (core IP did not fire)
  JD ownership objects: "Lead the development and ensure the integrity of automated client
  reports and interactive dashboards"; "guides our data team"; "as the technical authority".
  Résumé evidence on that object: "Partnered with media agency to develop quarterly
  performance dashboards in Tableau; contributed to reporting reviewed by senior leadership."
  All other bullets: Supported / Assisted / Collaborated / Helped.
  Only ownership verb — "Built recurring reporting on paid media performance" — is
  TASK-scoped, sits in the junior 2021–23 role, and carries no FUNCTION_QUALIFIER.
  Renderer inverted it: bullet #2 titled "TABLEAU DASHBOARD LEADERSHIP", calls the
  partnered/contributed bullet "the exact proof point" for leading dashboard development.
  KNOWN-BUG? no (new) → DEF-002

MINOR: client_commercial_work high-severity sourced from "Maintain accurate time records
  and participate in… client-facing meetings" — a duty mis-typed as core. Directionally
  right (candidate is brand-side, zero external client work) but severity inflated.
  Weight 0, no score impact. → DEF-004

NOT BUGS (confirmed correct behavior):
  • No gate fires — 5 yrs vs 3–5 required, BS held, GA4 present. Correct.
  • Power BI flagged preferred/low, non-blocking. Correct.
  • No scope_inversion on "$400M portfolio" (dollar ≠ span). Correct — matches known-good.
  • No RISK_FAMILY_MISMATCH despite Marketing/Analytics dual target. Correct.
  • No RISK_EXPERIENCE seniority fire. Correct.

NET: Review is defensible as an outcome, but −10 came entirely from a phantom sales-pipeline
gap while the real disqualifier — contribution-only ownership on a senior "lead / mentor /
technical authority" role — went unpenalized AND was rendered as a strength.

PAYLOAD GAPS NOTED: resume_source and gate_ledger not present in the raw result. Could not
confirm LLM vs regex extraction path. Request these fields on future exports.
```

### CASE C002 — Jordan Alvarez → Nodal Exchange, event marketing

> **Same résumé as C001, different JD.** These are two independent cases and must not be
> merged: C001 is agency-side analytics (RADaR), C002 is an events-execution role at a
> derivatives exchange. The shared résumé is what makes the pair useful — it isolates
> JD-side extraction.

```
CASE ID:        C002
DATE:           2026-07-27
RUN ID:         c72475ed-5a2d-42b1-8746-768b89d13d50
FINGERPRINT:    JF-BTP1DYPN  (hash d7c06f25…)
RÉSUMÉ:         Jordan Alvarez — 5 yrs marketing analytics, Northbrook Consumer Group (brand-side CPG)
JD:             Nodal Exchange — event marketing, reporting to CMO (Tysons Corner VA; ~20-25
                conference sponsorships, 2-3 receptions, 12-15 internal events)
SHIPPED RESULT: Pass / 55  (raw 88, clamped 55, penalty −8)
resume_source:  MISSING — stripped by runJobFitForProfile's return whitelist (:411-440), not absent from the engine
isSeniorRole:   true
gate_triggered: none  (gate_ledger also stripped by the same whitelist — ledger produced
                zero blockers, confirmed by the absence of the "Blocked on…" next_step prefix)
detector fires: RISK_MISSING_TOOLS (high, −8), RISK_LIMITED_MATCH_EVIDENCE (high),
                RISK_MISSING_PROOF ×2 (high jira / medium canva), RISK_SCOPE_INVERSION (medium)

WHAT I'M PROBING WITH THIS CASE:
  First case run after flipping JOBFIT_DETECTORS_FREE/_PAID on in prod (state now disputed — §5).

VERDICT CHECK:  bug — wrong-verdict, forced by JD formatting rather than by fit

BUG 1: run-on JD collapses the WHY set → automatic Pass — WRONG-VERDICT (S1)
  Six of eight requirement_units carry a byte-identical 1,888-char snippet: the entire Key
  Responsibilities block. splitEvidenceLines (extract.ts:1886) split on newlines (absent),
  then sentence-enders (JD bullets have no terminal punctuation), then — for chunks >280 —
  actionSplit, whose verb list is past-tense résumé vocabulary and case-sensitive
  (Developed/Managed/Collaborated). This JD writes present-tense imperatives (Develop,
  Manage, Work, Provide, Negotiate, Support); the one present-tense entry, Build, is
  capitalised while the JD writes lowercase "build". No split fired.
  buildEvidenceMatches (scoring.ts:410) still matched correctly on key equality —
  brand_messaging, consumer_research, analysis_reporting all direct — which is where
  raw_score 88 comes from. selectWhyMatches then discarded ALL of them on badJobFact's
  `length > 700` (scoring.ts:627), giving why_codes: []. RISK_LIMITED_MATCH_EVIDENCE fired
  (scoring.ts:1628) claiming "No direct or adjacent matches found" — false. Zero-WHY
  evidence guardrail (decision.ts:153) then capped to Pass; capScoreForDecision clamped
  88 → 55.
  SIGNATURE TO WATCH: raw_score high alongside whyCount 0 in the same payload.
  REPRODUCED: tests/jobfit-regression/retest-nodal-runon.ts runs the same JD twice —
    newlines intact  → Apply / 89, 6 WHYs, max snippet 337, 0 units over 700
    newlines stripped → Pass  / 55, 0 WHYs, max snippet 1888, 7 units over 700
  Formatting, not fit, decided the verdict. Candidate-independent: a perfect-fit résumé
  scores identically.
  KNOWN-BUG? no (new) → DEF-005  [FIXED-UNVERIFIED, branch jobfit-runon-jd-split @ 966c797f]

BUG 2: requiredTools / preferredTools inverted — FALSE-FIRE (S2)
  requiredTools: ["canva"], preferredTools: ["jira"] — both backwards. Canva appears ONLY
  under "Nice to Have:"; JIRA is a Key Responsibilities duty ("Manage supplier management /
  procurement process in JIRA"). Cause is extract.ts:2742, a line-local keyword test with no
  section awareness: the nice-to-have line reads "Experience with creative tools such as
  Adobe Express, Canva…" and "experience with" trips requiredLine. Cost: RISK_MISSING_TOOLS
  at high severity, weight −8 — the entire penaltySum on this run, spent on a nice-to-have
  design tool. The engine contradicts itself in the same payload: the canva requirement_unit
  is correctly tagged requiredness: "supporting".
  KNOWN-BUG? no (new) → DEF-006

BUG 3: RISK_SCOPE_INVERSION fires with no JD span demand — FALSE-FIRE (S3)
  riskDetectors.ts:165 `inflated` branch keys on the résumé alone (contribution verb + size
  token → "Supported a 12-person growth marketing team") and never consults the JD, yet the
  message asserts "Role's owned span exceeds the candidate's". This JD has no headcount or
  team-span requirement. Medium, weight 0 — did not move the verdict.
  KNOWN-BUG? no (new) → DEF-007

NOT BUGS (confirmed correct behavior):
  • Gate ledger produced zero blockers — candidate meets both the 5-year minimum and the
    bachelor's requirement. Correct.
  • No domain_gap despite CPG résumé vs derivatives exchange — the JD lists derivatives
    knowledge as Nice-to-Have, so silence is defensible.
  • No RISK_FAMILY_MISMATCH. Correct.

INPUT CONFOUND (not an engine defect): job_signals.jobTitle is "Senior Marketing Analyst",
  which is the CANDIDATE's own current title, not this JD's title — the posting is an events
  role reporting to the CMO and never uses that phrase. userJobTitle is authoritative and
  feeds family inference + isSeniorRole, so this likely came from the intake form. Re-run
  with the real posting title before drawing conclusions from jobFamily or isSeniorRole.

NET: The shipped Pass is defensible as an OUTCOME for this pairing — an analytics-only
candidate against an events-execution role — but it was reached through a path that never
evaluated fit. Post-fix the engine returns Apply / 89 on the same input, which is arguably
wrong in the other direction: no requirement_unit for "events" is extracted at all
(the JD's core function is invisible to the engine — only the V5 renderer noticed it).
See §5.
```

#### C002 follow-on — prod-7adf78ff regression triage (Data Analyst @ UnitedHealth)

Fixing DEF-005 changed 11 prod-corpus cases. Ten were unit churn or small score
rises with no verdict movement; **one flipped Review/74 → Pass/55** and was
triaged before anything shipped. Corpus HARD counts: 52 pre-existing (stale
baseline) → 114 with the DEF-005 fix.

```
FINDING: the flip is NOT caused by the segmentation fix.

Exactly ONE software_engineering requirement unit exists on that JD
(requiredness core, strength 9) — but TWO high-severity RISK_MISSING_PROOF
entries carry its label. They come from two different emitters:
  scoring.ts:599   buildMajorGapRisks        — display, weight 0, capped at 3
  scoring.ts:1594  uncovered-capability loop — weight-bearing, uncapped
That is DEF-003. Two of the three high-severity risks on this run are the same
gap counted twice, which is what trips the ceilings in applyEvidenceGuardrails.

Underneath it, software_engineering should not fire on a Data Analyst JD at
all — bare "api"/"cloud" in jobPhrases (extract.ts:1366). That is DEF-009.

So: a pre-existing false-fire, double-counted. Better segmentation concentrated
the qualifications block into one unit that now trips the rule as core; it did
not create the defect.

FIXES TRIED AND REVERTED (recorded so they are not re-attempted):
  A. Cap the hits term — Math.min(hits, 2) in jobRuleStrength.
     REVERTED. 7adf78ff completely unchanged (its units already had hits <= 2)
     and corpus HARD rose 114 → 139. Cost 25 extra diffs for zero benefit.
  B. Dedup same-key units inside each RISK_MISSING_PROOF emitter.
     REVERTED. Measured a no-op — corpus HARD stayed exactly 114 and the
     duplicate survived, because the duplication is CROSS-path, not within-path.
     This is what localised the real root cause.
  D. Sort the gap list core-first, then strength.
     NOT APPLIED — already implemented at scoring.ts:562-567. The original
     proposal came from reading line 566 in isolation.

REPRO / PROBE: tests/jobfit-regression/probe-7adf78ff.ts

OUTCOME after the DEF-003 fix (883b5b9f): prod-7adf78ff returns to Review/74,
its duplicate gone (3 RISK_MISSING_PROOF -> 2), and it drops off the
decision-change list entirely. DEF-005 repro unaffected.
```

#### DEF-003 upgrade audit — all 14 adjudicated, baseline re-frozen

The DEF-003 fix released guardrail caps corpus-wide. Every upgraded case was
audited individually before the baseline was touched.

**Two structural guarantees, established first so the per-case work had a floor:**

1. **Labels are 1:1 with capability keys** — 45 rules, 45 labels, zero collisions.
   Since `job_fact` *is* the label, deduping on (code, job_fact) can only ever
   merge copies of the **same** capability. It is structurally incapable of
   hiding a distinct gap.
2. **Zero cases changed `raw_score`** between segmentation-only and +DEF-003.
   No scoring or penalty math moved; the only change is how many duplicate risks
   count toward the ceilings in `applyEvidenceGuardrails`.

Also measured: the penalty-loop key dedup is a **confirmed no-op** on the corpus
(disabling it reproduces identical HARD/soft/decision counts). It is retained as
an invariant, not a behaviour change.

**A real defect in the first version of the fix, caught by this audit.** First-wins
dedup kept the penalty-loop copy, but the two emitters compute severity
differently, so where they disagreed the collapse silently **downgraded** the gap.
Three cases were over-upgraded as a result. Fixed by merging at max severity:
`e48bf66c` Apply→Review, `d327635d` Apply→Review, `ea0de07f` back to Pass
(baseline), `b3e99f67` severity restored H2→H3. Decision changes 25 → 22.

**The 11 surviving upgrades — all confirmed correct.** Each collapses one verbatim
duplicate label; no distinct capability was lost in any of them.

| case | duplicated capability | highs | verdict |
|---|---|---|---|
| **40926m** (core canary) | consumer, market, or user research | 4→3 | Pass→Review |
| prod b3e99f67 | prospecting/pipeline + analysis/reporting | 4→3 | Pass→Review |
| prod 224d94b0 | territory coverage & field sales | 3→2 | Review→Apply |
| prod e851bee9 | account support & management | 4→3 | Pass→Review |
| prod be49b83a | medical device industry knowledge | 4→3 | Pass→Review |
| prod 2e80fb67 | post-sale support & follow-up | 3→2 | Review→Apply |
| prod 44491cdf | analysis, reporting & measurement | 3→2 | Review→Apply |
| prod fe2bfe0e | prospecting/pipeline | 4→3 | Pass→Review |
| prod cdae93c3 | account support + prospecting | 5→3 | Pass→Review |
| prod 8a834c62 | prospecting/pipeline | 4→3 | Pass→Review |
| prod f87cffb2 | customer service & issue resolution | 4→2 | Pass→Apply |

`40926m` is the cleanest proof: *"consumer, market, or user research"* was counted
**twice at high**, giving 4 highs and an automatic Pass at clamped 55. Collapsed,
it is 3 genuinely distinct gaps → Review/74, `raw_score` 83 unchanged either way.
The candidate was told "do not apply" solely because one gap was double-counted.

**NOT signed off — carried forward, not blockers:**
- `f87cffb2` is a **two-band jump** (Pass→Apply, H4→H2, crossing both ceilings at
  once). Mechanically correct, but worth human eyes.
- `224d94b0` / `2e80fb67` / `44491cdf` land on **Apply while still carrying 2
  high-severity gaps**. The dedup is right; whether Apply is the correct band at
  2 highs is a guardrail-threshold question, independent of this fix.
- **Structure verified, underlying text not.** For the 10 prod cases I confirmed no
  distinct capability was lost; I did NOT read each résumé/JD to confirm the
  *surviving* gaps are genuine. This matters — `prospecting, outreach, and
  pipeline management` is the survivor in 4 of them and is **DEF-001, a known
  false-fire**. If it false-fires there as it did on C001, those cases are still
  under-scored and should upgrade further. Residual risk runs toward too-harsh,
  not too-generous.

**Systemic implication.** Duplicates appeared across a wide slice of the corpus, so
the pre-fix engine was over-penalising fleet-wide — DEF-003 was suppressing
verdicts generally, not just on the one case that surfaced it. That is the larger
finding here, bigger than any of the 11 individual verdicts.

---

## 5. OPEN QUESTIONS / PAYLOAD GAPS

Things to resolve or capture better while testing:

- [ ] **🔴 BLOCKING — the true state of `JOBFIT_DETECTORS_PAID` in prod is contradictory.** My session notes and Claude's read of the evidence disagree, and **every ownership conclusion depends on which is right.** Resolve before running any further ownership case.
  - *Evidence that PAID detectors were ON for C002:* `RISK_SCOPE_INVERSION` fired, and that code exists **only** at `riskDetectors.ts:168`, which is unreachable unless `applyRiskDetectors` is set — and the only thing that sets it is `detectorFlagsForPath` (`jobfitEvaluator.ts:90-95`), which requires a `JOBFIT_DETECTORS*` flag.
  - *Evidence pointing the other way:* my own notes record the flags as off/unflipped around that window, and all three were explicitly turned **off** immediately after C002.
  - *Third possibility not yet ruled out:* Vercel env changes do not reach already-running deployments. If the flip happened without a redeploy, C002 may have run on a build that predates it — which would contradict the scope_inversion evidence and means one of the two observations is mis-dated.
  - **How to settle it:** (1) `vercel env ls` for the current values in the prod target; (2) pull the function log for run `c72475ed` and look for `[jobfitEvaluator] DETECTORS ON —` (`jobfitEvaluator.ts:379`) — present means detectors ran, absent means they did not, and the line also prints `resume_source`; (3) compare the prod deployment's build timestamp against when the vars were changed.
- [x] **`resume_source` not in the exported payload — CAUSE FOUND, still not exported.** It exists (`llmResumeExtractor.ts:300`), is set to `'llm'` at `:313` and `'regex'` at `:321` (fail-open), and is held as `resumeEv.source` in the evaluator — but its **only** consumer is a `console.log` at `jobfitEvaluator.ts:380`. It is never placed on `baseOut` (`:388-411`) or the return (`:415-443`), and `EvalOutput` has no such field. The paid path would strip it again anyway: `runJobFitForProfile.ts:411-440` returns an explicit field whitelist. **Two drop points to fix, or read it from the log line meanwhile.**
- [x] **`gate_ledger` not in the exported payload — CAUSE FOUND.** The ledger *is* computed when detectors are on (`jobfitEvaluator.ts:348-354`) and is set on `baseOut.gate_ledger`, but `runJobFitForProfile`'s return whitelist (`:411-440`) does not include the key. Not evidence the ledger is off. Interim read: a ledger blocker unconditionally prepends `"Blocked on unmet required gate(s): …"` to `next_step` (`jobfitEvaluator.ts:362-364`), so the absence of that prefix means zero blockers.
- [ ] **`detector_risk_codes` vs `risk_codes`** — the handoff doc names the former, the payload contains the latter. They are **not** the same: `detector_risk_codes` is a filtered view that exists only inside the log line at `jobfitEvaluator.ts:378-383` (regex-matched against `DOMAIN_GAP|OWNERSHIP_VERB|PEOPLE_MGMT|…`); `risk_codes` is the full set on the payload. Capture both.
- [x] **Is ownership detection wired into this code path at all? — ANSWERED: yes, but gated.** `detectOwnershipVerbMismatch` is defined at `verbMismatch.ts:106`; its only production call site is `jobfitEvaluator.ts:294`, inside `if (args.applyVerbMismatchRisk)`. That flag is set only by `detectorFlagsForPath` (`:92`). If it fires, it does reach output (`riskCodes` → `baseOut.risk_codes` at `:397`) and caps Apply→Review at `decision.ts:35-40`. **So C001's "did not fire" is fully explained by "was never called" — see DEF-002, now UNVERIFIED.**
- [ ] **Does the engine extract "events" as a requirement at all?** C002's JD is fundamentally an events role (~20-25 sponsorships, receptions, internal events) yet no `requirement_unit` covers events — the block was bucketed into brand_messaging / communications_writing / consumer_research / product_positioning / operations_execution. Only the V5 renderer noticed ("EVENT MARKETING EXPERIENCE ABSENT"), with no engine risk code behind it. **This is why the post-DEF-005 result (Apply / 89) may be too generous:** fixing segmentation restored the WHY set but the JD's core function is still invisible to CAPABILITY_RULES. Probe whether an `events_management` capability key exists; if not, that is a coverage gap, not a scoring bug.
- [ ] **Renderer vs engine.** C001's inversion ("TABLEAU DASHBOARD LEADERSHIP") came from the Haiku renderer, not the deterministic engine. Track whether a wrong output is an *engine* defect or a *renderer* defect — they have different owners and different fixes.
- [ ] `profile_signals.resumeText` contains only the 5-line header, not the résumé body. Is the full text reaching the extractor, or is it assembled from `profile_evidence_units` only?

---

## 6. END-OF-SESSION HANDOFF PROMPT

Paste this into a fresh Claude thread along with §2, §3, and §5.

```
I ran a testing session on SIGNAL JobFit's scoring engine. Below is my defect
register, the session scoreboard, and a list of open payload gaps.

I want a prioritized fix plan. Rank by (a) severity — does it change the
top-line APPLY/REVIEW/PASS a user acts on, (b) hit rate across cases tested,
(c) fix cost / blast radius.

For each defect give me:
  - Priority (P0/P1/P2) and the one-line justification
  - Which layer owns it: JD requirement extraction, résumé extraction,
    deterministic detector, scoring/penalty math, or the LLM renderer
  - The minimal change that fixes it without widening false-fires elsewhere
  - What regression case must pass before it ships

Flag any two defects that share a root cause and should be fixed as one change.
Call out anything I should NOT fix yet because the payload gaps in §5 mean I
can't verify the fix worked.
```

---

## 7. CASE INTAKE TEMPLATE

Copy for each new case before running it.

```
CASE ID:        C0xx
DATE:
RUN ID:
FINGERPRINT:
RÉSUMÉ:         [name] — [yrs] [domain], [employer(s)]
JD:             [company] — [title] ([any notable constraints])
SHIPPED RESULT: [verdict] / [score]  (raw X, clamped Y, penalty −Z)
resume_source:  llm | regex | MISSING
isSeniorRole:
gate_triggered:
detector fires:

WHAT I'M PROBING WITH THIS CASE:
  [e.g. "does ownership fire when the JD says 'own the X function' explicitly?"
   or "control: known-good SaaS-engineer-never-says-SaaS case"]

VERDICT CHECK:
IF BUG:   [detector] — [false-fire | false-clear | wrong-verdict]
REASON:
KNOWN-BUG? yes (___) / no (new)
FIX DIRECTION:
DEFECT IDs: DEF-___
```

---

## 8. COVERAGE PLAN — probes worth running

Tick off as you go. Mixing confirmed-good controls with suspected-bad cases is what
separates "the detector is broken" from "this one case is weird."

**Ownership (defect #2, the core IP) — highest value, currently 1 false-clear**
- [ ] JD says "own the X function" verbatim + résumé has one genuine ownership verb on X → must CLEAR
- [ ] Same JD + résumé has ownership verb on a *different* function → must FIRE (object-scoping)
- [ ] Ownership verb + FUNCTION_QUALIFIER ("across business units") → must read as function, clear
- [ ] Ownership verb, no qualifier, task-scoped only → should fire
- [ ] Contribution verb + FUNCTION_QUALIFIER → must still FIRE (qualifier never upgrades contribution)

**Gate ledger (defect #1)**
- [ ] JD with "must have" + résumé silent → UNKNOWN treated as unmet, caps below APPLY
- [ ] JD with a strong-sounding PREFERRED item absent → must NOT cap
- [ ] "At least N years" where résumé has N−1 → caps; N+1 → clears
- [ ] Clearance / license required, absent → hard_credential_absent
- [ ] Credential in progress, role accepts in-progress → must NOT fire (known-good control)

**Requirement-key collisions (new, from DEF-001)**
- [ ] Any JD using "pipeline" in a non-sales sense (data, product, hiring, deal-flow)
- [ ] JD using "portfolio" in a finance sense vs a project/brand sense
- [ ] JD using "campaign" in a political/nonprofit sense vs marketing
- [ ] JD using "account" as accounting vs account management

**Known-bug confirmation (don't re-open, just count)**
- [ ] Adjacent-family pair → RISK_FAMILY_MISMATCH caps (finance/investment, marketing/growth, analyst/data)
- [ ] Entry-level JD ("0–2 yrs, recent grads welcome") → RISK_EXPERIENCE must not fire

**Controls (must stay correct — regression canaries)**
- [ ] SaaS engineer who never writes "SaaS" → domain_gap silent
- [ ] Finance résumé "$17B portfolio" → scope_inversion silent
- [ ] Finance résumé vs SaaS role → domain_gap FIRES
