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
| Cases run | 16 |
| Verdicts CORRECT | 2 (C007: right band, wrong reason; C012: right band, wrong reason) |
| Verdicts BUG | 14 |
| False-fires | 18 |
| False-clears | 5 (DEF-019, DEF-027, DEF-028, DEF-016/C009 AI-tools requirement verified; DEF-002 unverified) |
| Wrong-verdicts (top-line APPLY/REVIEW/PASS wrong) | 13 |
| Known-bug repeats (family-mismatch etc.) | 3 (prod a4e1b70a Events Marketing Associate: Marketing vs Operations target, −12; C010 and C011: hospitality targets read as Sales only, −12) |
| New defects opened | 36 (DEF-005…036; DEF-008 closed NOT-A-DEFECT) |

**Detector fire tally** (how often each detector fired, and how often that fire was wrong):

| Detector | Fired | Wrong | False-fire rate |
|---|---|---|---|
| knockout gate ledger | 0 | 0 | — |
| RISK_OWNERSHIP_VERB_MISMATCH | 0 | ? | **unmeasurable** — detectors were OFF on both runs |
| RISK_MISSING_PROOF | 13 | 9 | 69% |
| RISK_MISSING_TOOLS | 4 | 2 | 50% |
| RISK_LIMITED_MATCH_EVIDENCE | 5 | 5 | 100% |
| GATE_FIELD_MISMATCH (force_pass) | 1 | 1 | 100% |
| GATE_CREDENTIAL_REQUIRED (force_pass) | 1 | 1 | 100% |
| RISK_SUBFAMILY_MISMATCH | 2 | 2 | 100% |
| domain_gap | 0 | 0 | — |
| scope_inversion | 1 | 1 | 100% |
| unsupported_skill_claim | 0 | 0 | — |
| hard_credential_absent | 0 | 0 | — |
| people_mgmt_absent | 0 | 0 | — |
| RISK_FAMILY_MISMATCH (known bug) | 2 | 1 | 50% (C010 wrong; C011 penalty applied but risk hidden, DEF-035) |
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
| DEF-005 | `splitEvidenceLines` `actionSplit` (`extract.ts:1890`) + `badJobFact` ceiling (`scoring.ts:627`) | wrong-verdict | **S1** | 2 | C002, C003 | Run-on JD (newlines stripped, bullets without terminal punctuation) survives as one ~1900-char evidence line → all function/execution `requirement_unit`s share that snippet → every `job_fact` trips `badJobFact`'s `length > 700` → `why_codes: []` → zero-WHY guardrail (`decision.ts:153`) forces **Pass**. Same JD + résumé scores Apply/89 with newlines, Pass/55 without | **FIXED** on branch `jobfit-runon-jd-split` @ `966c797f`. (a) `actionSplit` gains a second alternation of JD present-tense imperatives, constrained by a following lowercase word/digit; résumé past-tense list kept as its own unconstrained branch. (b) `jobFactFromUnit` truncates >700-char facts at a word boundary instead of discarding the match | **REOPENED (partial)**: C003 reproduces on dev. A Workday JD in third-person present ("Designs structural components…", "Demonstrates competency…") with no bullets is split by neither `actionSplit` branch, so Responsibilities + Qualifications survive as one 1,790-char line; every unit is typed `core` and the whole block counts as one `requiredLine` (feeds DEF-006) |
| DEF-006 | `extractToolRequirements` (`extract.ts:2742`) | false-fire | S2 | 2 | C002, C003 | `requiredTools`/`preferredTools` **inverted**. `requiredLine` is a per-line keyword test (`required\|must have\|proficient\|experience with`) with no section awareness, so the Nice-to-Have line "Experience with creative tools such as Adobe Express, Canva…" pushes `canva` into `requiredTools`, while JIRA — an actual Key Responsibilities duty — falls to `preferredTools`. Emits `RISK_MISSING_TOOLS` high @ weight −8, the entire `penaltySum` on that run. Boilerplate guard at `extract.ts:2754` should have caught it but needs `tools.length >= 4` *after* alias resolution and only `canva` is in `TOOL_ALIASES` | Gate `requiredLine` on the enclosing section — `inRequiredSection` tracking already exists at `extract.ts:2408-2414` — or derive required/preferred from the unit-level `requiredness` that is already computed correctly. **Two code paths, one root cause:** the unit extractor tags the same `canva` unit `requiredness: "supporting"` (correct) while `extractToolRequirements` calls it required (wrong). Fix should collapse them onto one authority, not patch the regex twice | OPEN |
| DEF-007 | `scope_inversion` (`riskDetectors.ts:165`) | false-fire | S3 | 1 | C002 | The `inflated` branch fires on the **résumé alone** — a contribution verb near a size token ("Supported a 12-person growth marketing team") — without consulting the JD for any span demand, yet the emitted message asserts "Role's owned span exceeds the candidate's" (`riskDetectors.ts:168`). C002's JD contains no headcount or team-span requirement at all; it is an IC reporting to the CMO. Contradicts DIAGNOSIS §3, which specifies scope_inversion as JD-span-driven | Require a JD-side span signal for the `inflated` branch too, i.e. `(inflated && LARGE_SPAN_DEMAND.test(jobText)) \|\| spanBelow`, or re-word the risk so it does not assert a JD fact the detector never checked. Medium severity, weight 0 — did not move C002's verdict | OPEN |
| DEF-003 | `RISK_MISSING_PROOF` cross-path duplication | dup | **S1** (was S3) | 2 | C001, C002 | Same `job_fact` emitted twice, once weighted and once at weight 0. **ROOT CAUSE FOUND:** two independent emitters that never reconcile — `scoring.ts:599` (`buildMajorGapRisks`, display-only, weight 0, sorted core-first then capped at 3) and `scoring.ts:1594` (uncovered-capability penalty loop, weight-bearing, **uncapped and undeduped**). One uncovered capability therefore produces two risk codes. Deduping *within* either path is a no-op — measured, corpus HARD unchanged at 114 | One capability = one risk = one penalty. Reconcile the two emitters into a single per-key gap set: penalise once, display once. **Severity raised to S1** — each duplicate counts separately toward the high-severity ceilings in `applyEvidenceGuardrails`, which is enough on its own to move a verdict a band (proved on prod-7adf78ff, Review→Pass). **FIXED** @ `883b5b9f`: `dedupeRiskCodes` keys `RISK_MISSING_PROOF` on (code, job_fact) only — the capability is the identity, the prose is presentation — and callers merge penalty-bearing risks first so first-wins keeps the weighted copy; penalty loop additionally deduped by requirement key. prod-7adf78ff returns to Review/74. Follow-up: duplicates now merge at **max severity**, because the two emitters disagree on severity and first-wins was silently downgrading gaps (caught in the audit; corrected 3 over-upgraded cases) | **FIXED — AUDITED, BASELINE RE-FROZEN** |
| DEF-010 | Profile family inference (`lib/jobfit-family-inference.ts:361-378, :424`) + `GATE_FIELD_MISMATCH` (`constraints.ts:42-50`) | wrong-verdict | **S1** | 1 | C003 | Bare target role "Engineer" matches no Engineering phrase (list has only qualified forms: "mechanical engineer", "civil engineer"…). Because `roles` is non-empty the résumé fallback (`:402`) never runs, so inference returns the catch-all `["Other"]`. The gate then reads `Other` as an asserted non-technical family and force-passes a BSME new grad on a Mechanical Engineer I role. The trial path already guards against this by forcing `[]` (`jobfit-run-trial/route.ts:337-367`); the paid/coach path (`runJobFitForProfile.ts:257` → `mapClientProfileToOverrides`) does not | (a) Gate: treat `Other` as unknown, i.e. skip `GATE_FIELD_MISMATCH` when `targetFamilies` is `[]` or only `["Other"]`. (b) Inference: match bare `engineer`/`engineering` (word-boundary, after the software/data/sales-engineer forms) to Engineering, and run the résumé fallback when roles resolve to nothing. (a) alone removes the force-pass; (b) restores the family bonus. Shares the "Other catch-all" root with known `RISK_FAMILY_MISMATCH`, but a different emitter (hard gate, not a risk) | **FIXED** @ `19c06c41` (inference side, `lib/jobfit-family-inference.ts`): any target-role item containing `engineer(s|ing)` that is not software/data/sales-type now maps to Engineering. Gate and penalty logic deliberately untouched. Two broader fixes were tried and rejected: (A) treating `Other` as unknown in the gate + both family-mismatch sites moved 44 prod decisions and regressed 0410q (psychology grad vs Meta SWE 3+ yrs, Pass→Review): `Other` is sometimes a genuine non-technical target with no family bucket. (B) falling back to résumé-tag families when roles resolve to `Other` re-labelled Property Manager targets as Marketing and dropped a Leasing Coordinator Apply→Pass. Regression: core 1 intended diff (0410n gains Engineering from "process engineer", decision unchanged), prod 0 (corpus freezes `profileOverrides`, so it cannot exercise inference). Live check on all 175 prod `client_profiles.target_roles`: exactly 2 move Other→Engineering (C003's "Engineer" and one "Analyst, Engineer"); no software/data profile gains Engineering. C003 after fix: gate clears (raw 65→87), still Pass/55 on DEF-005/006/011/012 |
| DEF-011 | `analysis_reporting` CAPABILITY_RULE `jobPhrases` (`extract.ts:264-275`) | false-fire | S2 | 1 | C003 | Bare `"analysis"` matches "thermal analysis" in an ME duty list; emits `analysis_reporting` (functionTag `data_analytics_bi`) as `core`, a high `RISK_MISSING_PROOF` ("analysis, reporting, and measurement work"), and adds `data_analytics_bi` to the JD's function_tags. The profile side already requires `QUANT_ANALYSIS_ANCHORS`; the JD side is unguarded. Same class as DEF-009 (debt #1) | Give JD-side `analysis`/`reporting`/`metrics` the same `requiresNearby: QUANT_ANALYSIS_ANCHORS` as the profile side, or negative context for engineering qualifiers (thermal/structural/stress/failure/finite element) | **FIXED** @ step-1 commit: `negativeContext` on bare `analysis` (thermal/structural/stress/failure/vibration/modal analysis, finite element, fea); `data analysis` still matches separately. Chose negativeContext over requiresNearby to avoid suppressing real analyst JDs that lack a quant anchor. Core diffs: 0410s and 0410ah lose the phantom unit; prod 0 |
| DEF-012 | `mechanical_engineering` CAPABILITY_RULE `profilePhrases` (`extract.ts:1332`) | false-fire (missing proof) | S2 | 1 | C003 | A BSME résumé with CAD-led design, FEA, heat-exchanger design, ~100 pages of drawings, GD&T and a CSWA yields **no** `mechanical_engineering` profile unit. `profilePhrases` is six narrow bigrams ("mechanical design", "thermodynamics", "cad design"…); "Thermodynamics" appears only in coursework (−6 at `extract.ts:2373`). Result: high `RISK_MISSING_PROOF` "Mechanical Engineering". Meanwhile `trades_construction` fires on "machining" in the summary and labels the candidate "Skilled Trades" | Widen profilePhrases to evidenced ME work: solidworks, fea / finite element, engineering drawings, gd&t, heat exchanger, prototype, cad (word-boundary), "mechanical engineering" gated off degree lines. Consider suppressing `trades_construction` when an engineering function unit is present | **FIXED** @ step-1 commit: added engineering drawings, finite element, fea, gd&t, heat exchanger, safety factor, thermal simulation, design loads. `trades_construction` suppression NOT done (no verdict impact seen). Core diffs: 0410d gains direct ME match; 0410ah (ME vs ME JD) Pass→Apply/77; 0410x gains units, no match; prod 0. C003 now Apply/89 on dev, only remaining high risk is ansys (DEF-005/006) |
| DEF-013 | V5 renderer (RISK bullets) | renderer | S3 | 1 | C003 | Renders "prioritizes candidates with 0-2 years of post-degree industry experience… no industry engineering" as a RISK for a May 2026 grad. The JD floor is 0 years; no engine risk code backs the bullet | Renderer should not surface an experience risk when `yearsRequired` is 0 and no engine experience risk exists | OPEN |
| DEF-004 | `client_commercial_work` requiredness | mis-typed | S3 | 1 | C001 | Sourced from "Maintain accurate time records and participate in… client-facing meetings" — a duty line — but typed `requiredness: core`, severity high. Directionally right, severity inflated from a weak line | Weight requiredness by line strength; admin/logistics duty lines should not reach `core` | OPEN |
| DEF-008 | job `strength` vs snippet length (`extract.ts` `jobRuleStrength` / `scoreJobLine`) | — | — | 1 | C002 follow-on | Hypothesised that `strength` is contaminated by snippet length — raw char bonuses (`+1` at ≥20, `+2` at ≥30, `−2` at <16) plus segmentation-sensitive `hits` accumulation — so that fixing DEF-005 made requirements look weaker and pushed prod-7adf78ff Review→Pass | **CLOSED — NOT A DEFECT.** Probed the two units directly. The length term *cancels* (both pre- and post-split snippets clear 30 chars, so `+3` applies in both runs); the delta was `hits`-driven. More importantly the drop was the engine getting **more honest, not less**: pre-fix, `analysis_reporting` (strength 6) was anchored to a recruiting blurb — *"Growing together We are seeking a highly skilled Reporting Analyst…"* — and `operations_execution` (strength 10, `core`) to a logistics line with leaked CSS — *"…Minnetonka, MN location. a { text-decoration: none; color: #464feb"*. Post-fix they anchor to real requirement text (*"Analyze operational data to identify areas for process improvement…"*). Lower strength on junk lines is correct behaviour. The real cause of the 7adf78ff flip is DEF-003 + DEF-009 | **CLOSED** |
| DEF-009 | `software_engineering` CAPABILITY_RULE (`extract.ts:1366`) | false-fire | S2 | 1 | C002 follow-on | Fires `core` at strength 9 on a **Data Analyst** JD (prod-7adf78ff, UnitedHealth). `jobPhrases` contains bare `"api"` and `"cloud"` with no word boundaries, no `requiresNearby`, no negative context — the canonical instance of architectural debt #1. A quantitative-analytics qualifications block ("3+ years… statistics, business analytics or computer science…") is enough to trip it, and once `core` it drives a high-severity `RISK_MISSING_PROOF` **and** an uncovered-capability penalty. Amplified by DEF-003, which counts it twice | Pre-compile `jobPhrases` to word-boundary regexes and gate the generic tokens (`api`, `cloud`, `backend`, `frontend`) on software-context co-occurrence (engineer/developer/codebase/deploy/repository). Do **not** widen to `computer science`, which is a degree-field phrase, not a job duty. Blocked on the broader bare-word refactor (debt #1) unless fixed narrowly for this rule first | **FIXED** (narrowly, as anticipated) @ the C004 commit: `api` / `cloud` / `backend` / `frontend` now carry `requiresNearby: SOFTWARE_ENGINEERING_ANCHORS`; the unambiguous phrases (`software engineer`, `microservices`, `devops`, …) stay ungated. First anchor list was too narrow and cost 3 legitimate technical matches, so it also carries data-platform vocabulary (database/databases, data pipeline(s), data platform(s), snowflake, databricks, data warehouse, etl) in singular AND plural, since anchors match on word boundaries. Second hit: C004 | **FIXED** |
| DEF-014 | `jobTitleIsConsulting` title regex (`extract.ts:4200-4201`) → family cascade (`extract.ts:4328`) | wrong-verdict | **S1** | 1 | C005 | Title "2027 Group Internal **Consulting** Graduate Talent Program" is not recognised: the regex only knows compounds (consultant, consulting analyst, strategy analyst…). Cascade falls to tag inference, whose only tags come from two junk units → `jobFamily: Operations`. Profile targets Consulting, so `computeBaseScore` takes −12 instead of +10 (`scoring.ts:847,854`), a 22-point swing: Review/66 instead of Apply. Title-only counterfactual → Apply/88 | Accept a bare `consulting` token in the title (internal consulting, consulting program/graduate/associate/intern). "Consulting Engineer" is safe: the engineering title wins earlier in the cascade. Audit every prod-corpus title containing "consulting" before shipping | **FIXED on dev, uncommitted (2026-10-01).** Bare `consulting` is tested against the TITLE only (`titleOnly`), never `jobTitleSlice`, which carries 1500 chars of body and would catch company blurbs; titles that also say engineer/engineering are excluded ("Consulting Engineer" was `Other` before and stays so). Regression: core 0 drift; prod 3 HARD, all adjudicated correct: Dekra "Consulting Intern" Marketing→Consulting (decision unchanged), Precision AQ "Analyst, Market Access Consulting" ×2 Marketing→Consulting, false RISK_FAMILY_MISMATCH removed, Apply/81→Priority Apply/97 (the 97 is DEF-017). Baseline re-frozen. Test: `app/api/jobfit/jobFamilyAndBoilerplate.test.ts` |
| DEF-015 | Non-requirement note read as a requirement: `SECTION_HEADER_RULES` (`extract.ts:1816`) + `drafting_documentation` bare `"documentation"` jobPhrase (`extract.ts:1379`) | false-fire (WHY) | S2 | 1 | C005 | "Program Details:" and the trailing "Note:" paragraph have no header rule, so they fold into the preceding Requirements section. The immigration line "UBS will not … sign any documentation in support of … immigration sponsorship (OPT/CPT)" becomes `drafting_documentation` **core**, matched direct (weight 103) to the résumé skills line "policy drafting". It is the case's top WHY. Here it hides DEF-016: remove it and the score falls 88 → 74 | Treat sponsorship/work-authorization lines as non-requirement text, alongside `EEO_BOILERPLATE` (`extract.ts:~1960`), segment-scoped like `stripLegalBoilerplate`. Separately, the bare `"documentation"` jobPhrase is the same bare-word class as DEF-009/DEF-011 | **FIXED on dev, uncommitted (2026-10-01).** Work-authorization / visa-sponsorship sentences added to `EEO_BOILERPLATE`, so `stripLegalBoilerplate` drops them segment by segment. Every pattern needs immigration/visa context ("sponsorship sales", "event sponsorships", "opt in" untouched). Corpus effect: zero. No frozen prod run had built a unit from this text, so C005 is the first sighting. Header rules for "Program Details" / "Note" not added (the sentence filter makes them cosmetic). The bare `"documentation"` jobPhrase is still open, as part of the bare-word class |
| DEF-016 | CAPABILITY_RULES coverage for consulting / graduate-program JDs (`strategy_problem_solving` `extract.ts:1170-1193`, `minMatches: 2`) + `isTrainingProgram` (`extract.ts:4734`) | coverage gap | S2 | 3 | C005, C008, C009 | The JD's actual work and requirements produce **zero** units: "structure complex challenges, develop actionable solutions, support execution across transformation and change initiatives", "experience working in a project-based environment", "strategic thinker with strong communication skills", "evidence … responsible use of AI". `strategy_problem_solving` needs 2 phrase hits in one segment, and no segment carries both "consulting" and "strategy"; there is no change/transformation key. `isTrainingProgram` also misses "Graduate Talent Program … professional and technical training … rotations" (its patterns want "training program", "gain exposure **in**"). With DEF-014 and DEF-015 both fixed, the case still lands Review/74 on one adjacent match | Add consulting/change-delivery vocabulary (structure problems, actionable solutions, transformation, change initiatives, project-based) and an AI-use requirement key. Extend `isTrainingProgram` to "graduate program / talent program / rotations / targeted training". Same shape of gap as the §5 "events" question: the JD's core function is invisible to the rules | OPEN. **Partial on branch `jobfit-unreadable-jd-review`** (C008, `ccd3796b`): new `partnerships_sponsorships` key on both sides, adjacent to brand_messaging / account_management / client_commercial_work. JD "sponsorship" excludes work-authorization and credential wording ("without company sponsorship", "not eligible for H-1B", "will sponsor Series"), which was most of its first-pass prod hits; résumé phrases exclude "targeting" / "seeking" lines. 94 cases gain units; 2 verdicts move, both correct (Audacy sports-sponsorship AE vs a candidate who sourced NFL brand partnerships → Priority Apply; BCLP with core sponsorship duties vs adjacent-only evidence → Apply). C005's consulting/change vocabulary still open |
| DEF-017 | Priority Apply on tool-only evidence (`computeBaseScore` `scoring.ts:843`, Priority Apply gate `decision.ts:8,49`) | wrong-verdict (over) | S2 | 1 | prod ad572717 / e37ae047 (surfaced by the DEF-014 fix) | Precision AQ "Analyst, Market Access Consulting" reaches Priority Apply/97 with three WHY codes, all office tools (Excel, PowerPoint, Word, direct), plus the target-title bonus and the family match. Before DEF-014 the false −12 family mismatch held it at Apply/81 and hid how thin the evidence is. Pre-existing scoring generosity, not caused by DEF-014 | Require at least one non-tool direct WHY (function/deliverable) for Priority Apply, or stop tool matches counting toward `directCount`. Audit the corpus for other Priority Apply rows whose direct WHYs are all `match_kind: tool` before choosing | **FIXED on branch `jobfit-unreadable-jd-review`**: guardrail rule 6 (`decision.ts`): Priority Apply needs 2+ quality direct WHYs (direct, weight ≥ 75, not skills-list boilerplate) whose `match_kind` is not `tool`, else Apply. Audit before choosing: 10 of 62 Priority Apply cases had fewer than 2 (4 rested on office tools alone, incl. both Precision AQ runs). Exactly those 10 move to Apply, nothing else. Also caps C008 with target roles (one partnerships match + training/family bonus = raw 97) at Apply/95 |
| DEF-018 | Credential gate on an encouraged, in-program SIE: `finraKeywords` (`policy.ts:551` "securities industry essentials") + `SPONSOR_PHRASES` (`extract.ts:4493-4545`) + `isTrainingProgram` (`extract.ts:4759`) → `GATE_CREDENTIAL_REQUIRED` force_pass (`constraints.ts:160-169`) | false-fire → wrong-verdict | **S1** | 1 | C006 | A bare mention of the SIE sets `requiresFinraLicense` (`extract.ts:4445`). The JD only says candidates are "highly encouraged to study for and complete the Securities Industry Essentials (SIE) licensing before the conclusion of the program". The ±200-char sponsorship window (`isCredentialSponsored`, `extract.ts:4583`) has no "encouraged" / "before the conclusion of" / "during the program" phrase, and `isTrainingProgram` never treats an internship as a program (`isInternship: true`, `isTrainingProgram: false`). Gate forced **Priority Apply/97 → Pass/55** on a junior Finance major who meets every stated requirement | (1) Add encouragement / in-program phrases to `SPONSOR_PHRASES` ("encouraged", "highly encouraged", "before the conclusion of", "by the end of the program", "during the program", "during the internship"). (2) Never hard-gate a FINRA/SIE credential on `isInternship` roles: an intern cannot hold a Series registration before a firm sponsors it, and the SIE is open to students. (3) Consider removing bare "securities industry essentials" from `finraKeywords`, keeping only "sie required" / "sie exam required" style phrasing. Regression: C006 must return Priority Apply/Apply with no credential gate; an Advisor posting that states "Series 7 and 66 required" must still gate. Related: DEF-016 (same `isTrainingProgram` narrowness, different root cause) | **FIXED on dev** @ `1f3d2c78` (phrases + internship rule; not yet in prod). C006 replays Priority Apply/97; regression 696 cases unchanged |
| DEF-019 | Language requirement invisible on the regex JD path: `bilingual_language` (`extract.ts:1517-1531`) has `jobPhrases: []` by design, emitted only by the LLM JD path | false-clear (coverage gap) | S2 | 1 | C007 | "Fluency in English and Spanish is required" produces no requirement unit and no risk. The résumé shows no Spanish. Here the verdict still lands Review (via the thin-evidence guardrail), but the same JD with stronger direct matches would reach Apply for a monolingual candidate: potential S1 | Either turn on the LLM JD path for this key in prod, or add narrow regex jobPhrases for explicit requirements only ("fluency in .* spanish is required", "bilingual .* required", "must be fluent in"), never bare "fluent in" (the profile-side comment at :1521 explains why). Treat an unmet *required* language as a high risk; preferred languages ("Portuguese proficiency is preferred") stay low | **FIXED on dev** @ `ad86fe1f` (required-only, never preferred; risk + 12-pt penalty, not a gate; not yet in prod). C007 replays Review/67 with RISK_LANGUAGE_REQUIRED; no outcome change across 696 regression cases |
| DEF-020 | Profile finance sub-family: `inferProfileFinanceSubFamily` (`extract.ts:3772`) checks IB keywords first (`:3782-3785`) | false-fire | S3 | 2 | C006, C007 | One club bullet ("prepare to enter the industry … Investment Banking") classifies the whole profile as `ib`, ahead of real wealth-management evidence (shadow at Westshore, Wealthspire academy) that only the later AM check would see. Emits RISK_SUBFAMILY_MISMATCH "Your finance experience is primarily in investment banking" on both of this candidate's jobs. Weight 0 (distance 1), so verdicts unaffected; the shown risk is wrong | Weigh experience over aspiration: count IB/AM signals in EXPERIENCE bullets (roles, employers) before club/program lines, or require 2+ IB signals before IB wins. Also: job side reads a wealth-management advisor internship as `asset_management` (C006) and Santander WM&I as `other_finance` (C007); consider a `wealth_management` sub-family | OPEN |
| DEF-021 | `includesPhrase` (`extract.ts:1748-1754`): CAPABILITY_RULES `jobPhrases` match as exact word-bounded strings, with no singular/plural handling | false-clear (coverage) | **S1** | 1 | C008 | "Strong Communication Skills" misses `communications_writing` (phrase is "communications") and "data-driven brand strategies" misses `brand_messaging` (phrase is "brand strategy"). Those were the only two lines in the JD that name a capability, so the JD yields no function units, WHYs are empty, and DEF-022 forces Pass. Respelling just those two words replays Review/65 with two WHYs | Fold an inflection rule into the phrase compiler (optional trailing s/es/ies on the last token, both directions) rather than adding variants rule by rule. Same refactor as architectural debt #1 (pre-compiled phrase regexes). Audit the 696-case diff: plural tolerance will widen some false-fires too | **PARTIAL on branch `jobfit-unreadable-jd-review`**: job-side y↔ies on the last word of multi-word phrases only ("brand strategy" ↔ "strategies"). 2 of 696 cases change, both correct reads (Deloitte "medical device industries"; Zacks "assigned territories … sales goals"), no verdict moves. C008 → Review/62 with brand_messaging. Measured and NOT shipped: singular→plural on all phrases (540 cases / 72 verdicts), plural→singular (431 / 36), y↔ies on bare words (bare "territory" caught "innovation territories"). A "communication skills" phrase for communications_writing was also rejected: it appears in 279/629 prod JDs (207 with "writ*" on the line), i.e. soft-skill boilerplate, not comms work. Open: the -s plural pass needs its own case-by-case audit | PARTIAL |
| DEF-022 | Evidence guardrail rule 1 (`decision.ts:152-160`) | wrong-verdict | **S1** | 1 | C008 | Zero WHYs force Pass, whatever caused them. Rule 1 cannot tell "the JD's requirements were read and the candidate matches none" apart from "the extractor read no requirements at all" (here only three office-tool units, one of them DEF-024). So every JD-coverage miss (DEF-016, DEF-021) becomes a confident "Pass. Do not apply." The engine's own risk text admits the ambiguity ("Either the job description is too vague … or your profile lacks evidence") | When the JD produced no non-tool requirement units, cap at Review with an "engine could not read this posting's requirements" risk instead of Pass. Keep Pass for JDs with real units and no matches. Measure how many prod Pass rows have zero non-tool units before choosing | **FIXED on branch `jobfit-unreadable-jd-review`** (not in dev or prod yet). Guardrail rule 0 (`decision.ts`): no non-tool units + zero WHYs + no gate + no risk beyond limited-match / ambiguous-role → Review with the score pinned to 60, plus a "could not read clear requirements" risk text (`scoring.ts`). 8 of 696 regression cases move Pass → Review: 6 were wrong Passes (Dimitri SWE, Lily ×2 scientist, GEO recruiting, Proxima consulting, trademark paralegal); 2 were right-by-accident Passes (Aiden sports-management × Luminace origination, × Alloy architecture), accepted by Peri 2026-10-15 since DEF-021/DEF-016 are the real cure. C008 replays Review/60 |
| DEF-023 | V5 renderer (RISK bullets) | renderer | S2 | 1 | C008 | The engine emitted only the generic RISK_LIMITED_MATCH_EVIDENCE ("no direct or adjacent matches found"). The renderer turned it into a specific claim: "lacks direct experience in talent representation, agent work, or brand partnership deal-making … None involve … structuring entertainment partnerships." The résumé shows partnerships with Live Nation, touring acts and artist management, plus sponsorships. The JD is the Marketing & Brand Partnerships track, not agent work | Do not let the renderer invent a specific gap when the engine's risk is generic: render RISK_LIMITED_MATCH_EVIDENCE from a fixed template, or pass the profile evidence so it cannot claim absence of something that is present. Related to DEF-013 (renderer asserting unsupported specifics) | OPEN |
| DEF-024 | Tool unit extraction: `extractToolMentions` (`extract.ts:2273-2276`) via TOOL_ALIASES `excel` (`:1539`) | false-fire | S3 | 1 | C008 | "You excel at finding fresh solutions" creates an `excel` tool requirement unit. The verb guard `bareExcelIsTool` (`:2260`) exists but is applied only on the flaggable-risk path (`:3027`), not when units are created | Apply `bareExcelIsTool` in `extractToolMentions` for the bare alias. No verdict effect here (supporting, no WHY, no penalty), but on other JDs it feeds tool counts and DEF-017 | OPEN |
| DEF-025 | Profile `degreeStatus` / `gradYear` (`inferCandidateDegreeStatus` `extract.ts:3224-3240`, `inferProfileGradYear` `:3168`) | false-fire | S3 | 1 | C008 | "B.A. in Organizational Studies … Expected May 2027" reads as `degreeStatus: has_degree`, `gradYear: null`. The "Expected May 2027" sits on the line above the degree, and Pattern A wants "expected graduation"; with no grad year, the bare "B.A." keyword returns has_degree | Accept "Expected <Month> <Year>" next to an education entry as a grad year. No verdict effect here because the JD's eligibility rule ("Must graduate before the program start date", cohorts Jan–Sep 2027) is not modelled; it would matter for any in-progress-only gate | OPEN |
| DEF-026 | Profile evidence text includes the intake header (`extractProfileSignals`, `extract.ts` `resumeEvidenceText`) | false-fire | **S1** | 1 | C008 follow-on (corpus-wide) | "Target roles:", "Strengths:", "What types of roles are you targeting" lines were split into evidence units like any résumé bullet, so an aspiration or self-assessment became proof. 247 of 629 prod runs (20 profiles) carried such units. Example: Daniel with "Target roles: Brand Marketing Associate" got a `brand_messaging` profile unit from that line, turning his one adjacent match direct (weight 106) and moving him Review → Apply/95 on target-role wording alone | Drop intake header lines (optional question number) before building profile units and tool mentions | **FIXED on branch `jobfit-unreadable-jd-review`**: header lines stripped; 0/629 runs keep header units. 312 cases change units underneath; 7 verdicts move, all down and all correct (William ×3 lost an operations match from "Strengths: … process improvement"; Laura lost coaching from "Target roles: Career Coach"; Lily ×3 lost analysis from "Strengths: analytical problem solving", and her batch fixture has a truncated résumé) |
| DEF-027 | CAPABILITY_RULES coverage for event-coordination JDs: no event planning/bookings key (`event_operations_live_execution` is game-day only); `operations_execution` and `customer_service_guest_experience` profilePhrases miss how résumés phrase vendor/logistics and retail/concierge work (`extract.ts:430`, `:1230`) | false-clear → wrong-verdict | **S1** | 1 | prod 936a360b (Event Sales Admin, 2026-10-20) | A short (949-char) Event Sales Admin JD yields 2 units (operations_execution core from "event logistics", customer service supporting); an event-planning résumé with vendor/timeline coordination, a co-planned on-site event and concierge client service matches neither, because each rule wants one exact compound ("event logistics", "customer service"). Zero WHYs → zero-WHY guardrail (`decision.ts:152`) → **Pass/55**. The V5 bullets on the same run describe a strong fit. Answers the §5 "events" question: no events key existed | New `event_coordination` key (`extract.ts:595`, adjacent to operations_execution and event_operations_live_execution only). Résumé bare event/events counts only with a run-it verb on the line (`EVENT_WORK_VERBS`, `:100`) and never on targeting/seeking lines. Added vendor/logistics coordination to operations_execution and concierge / per-shift / guest service to customer service. No JD "client service": finance postings use it for the CSA title and "client service oriented" traits | **FIXED on branch `jobfit-unreadable-jd-review`** (not in prod). Run replays Apply/92 (3 direct matches, no risks). Regression: 7 verdicts move, all up, each audited: Sports Events Coordinator, Athletics Development Coordinator, Zeno Brand Intern Review→Apply; Regional Philanthropy Dev Coordinator, Legal Recruitment Trainee, Hayes Locums Pass→Review; FWV Social Media Coordinator Apply→Priority Apply (borderline: credit comes from a game-day content line read as event work). First draft also linked events to customer service / stakeholder work and read finance "client service" as a requirement; that moved 14 verdicts incl. 5 downgrades and two Apply upgrades on a Red Cross events line, so both were cut. Remaining score drops (FENIX, FPHNYC, Evermore) add real event/customer-inquiry duties the candidates lack; verdicts hold. Test: `app/api/jobfit/eventCoordination.test.ts` |
| DEF-028 | No procurement capability key (`extract.ts:660`) + no buyer/procurement title rule in the family cascade (`extract.ts:4467`) | false-clear → wrong-verdict | **S1** | 2 | prod 2fb0aa34 (Buyer I), prod 7b39117d (Procurement Specialist), 2026-10-20 | A procurement résumé (sourced and quoted 150+ bids, compared vendors on cost and lead time) matched nothing on two buyer postings whose duties are supplier quotes, purchase orders and supplier management: no rule covered procurement on either side. Family also misrouted: Buyer I → Accounting (AP / payment-terms lines), Procurement Specialist → HR (scraped "Contact: Human Resources" in the first 1500 chars, which `jobTitleIsHR` reads). Both took −12 family mismatch vs an Operations target. Zero WHYs → Pass/42 and Pass/44 | New `procurement_sourcing` key (function, operations_general, adjacent to operations_execution). Résumé "sourced"/"sourcing"/"quotes" need a purchasing object nearby and skip recruiting ("sourced 40 candidates"). JD has no bare "sourcing" ("sourcing products" for a TV segment, "stock imagery sourcing"); bare procurement/purchasing/PO need buying context (`PROCUREMENT_JOB_CONTEXT`, `:113`), which keeps department lists and "purchase order creation, invoice processing" admin lines out. Title-only `jobTitleIsProcurement` → Operations ahead of HR; excludes media/ad buyers, talent sourcing and procurement consultants. **Not done:** `jobTitleIsHR` still reads the body slice; procurement-first ordering fixes this case, the general HR-from-body misroute is open | **FIXED on branch `jobfit-unreadable-jd-review`** (not in prod). Procurement Specialist Pass/44→Apply/89; Buyer I Pass/42→Review/73 (remaining gaps are real: inventory forecasting, PPV, ERP). Regression: 1 verdict moves, Proxima Procurement Consultant Intern Review→Pass (60→55) on a new procurement missing-proof for a strategy/finance candidate; borderline, and prod already shows it Pass/55. ITW Strategic Sourcing Intern Analytics→Operations, verdict unchanged. First draft (bare JD sourcing/procurement, no consultant exclusion) moved 5 verdicts incl. a Video Design Intern Pass→Apply on "stock imagery sourcing"; tightened. Test: `app/api/jobfit/eventCoordination.test.ts` |
| DEF-029 | V5 risk bullets not tied to engine risk codes (`bulletGeneratorV5.ts`): the prompt said "only for risk_codes provided" but nothing in code checked it | false-fire (rendered) | **S1** | 1 | prod 378022a7 (FOX News Media Data Analytics Internship, 2026-10-22); scan of 645 runs since 2026-09-01 | One engine code (RISK_LIMITED_MATCH_EVIDENCE, "could not read clear requirements") became two writer risks the posting never states: "no professional experience in media" and "no SQL or cloud tools FOX's BI team **likely** uses". 30/645 runs had more risk bullets than codes; 39 runs whose only code was limited-match got 51 bullets. Seen also: "JLL typically seeks 2-3 years", "requires learning Sprout Social" on a line saying "a plus, but not required" | Codes go to the writer numbered (R1…); each bullet names its risk_id; `groundRiskBullets` keeps one per known id and drops unknown, repeated and speculative ("likely", "typically") gaps. RISK_LIMITED_MATCH_EVIDENCE is not sent (its fixed wording already reaches the user via risk_flags). Up to 2 extra risks allowed only with a `jd_quote` verified verbatim inside a required qualifications section (not responsibilities, not preferred / "successful students have" / bonus headers, not an optional line). A missing tool raised as both MISSING_TOOLS and MISSING_PROOF reaches the writer once | **FIXED on branch `jobfit-grounded-risks`** (not in prod). Live replays (real writer) of 16 prod runs: FOX, Dow Jones, Affiliate Video now show no invented risks; Karpo "NYC creators" and Amsive Asana dropped; true stated gaps kept via quotes (sports-betting knowledge on 63b4e8bc lost in one replay: its requirement sits outside a recognised qualifications header). Test: `app/api/jobfit/groundedRisks.test.ts` |
| DEF-030 | `segmentJobText` (`extract.ts:2154`): an unrecognised header never ends a dropped section, so everything after "TO APPLY:" / "WHO WE ARE:" was skipped | false-clear | **S1** | 1 | prod 378022a7 (FOX) | FOX's posting puts ELIGIBILITY, STANDING OUT AS A TOP CANDIDATE and AREAS OF PLACEMENT after "TO APPLY:"; none matched a header rule, so all of it stayed in how_to_apply and was dropped: **zero requirement units**, Review/60 on nothing, which left the V5 writer to invent risks (DEF-029). Family also Other: "Data Analytics" was not an analytics title | `looksLikeHeader` (short colon line, ≤6 words, no digits, or an all-caps line) ends a skipped section as `other`. New header rules: eligibility, standing out, successful students have → qualifications; areas of placement → overview; program features, what you'll gain/get → benefits; diversity / EEO headers → company. Title-only `jobTitleIsDataAnalytics` → Analytics | **FIXED on branch `jobfit-grounded-risks`**. FOX Review/60 Other → Review/74 Analytics. Regression 9 cases, 2 verdicts, all audited: Xerox AI Internship Review→Apply ("JOB SCOPE:" after "WHO WE ARE:" now read); Staffing Consultant Apply→Review (old Apply leaned on "allowing them to **excel**" in a perks section matched as the Excel tool). First draft also took "Requires two (2) years of experience with the following skills:" as a header (Morgan Stanley lost its SWE unit) and added JD "business intelligence" (weaker BI lines displaced core SQL lines on 4 cases); both cut. Numerator Consulting Intern (Pass/55, analytics on a "business intelligence platform") stays Pass as a result: open |
| DEF-031 | Years parser (`extract.ts:3142`) reads years of school as years of experience | false-fire → wrong-verdict | **S2** | 2 | prod 9875d6c0 (Dow Jones Communications Intern), prod 318bb989 (JLL Communications Internship) | "Completed at least two years toward your bachelor's degree" and "with 2-3 years completed majoring in Communications" became yearsRequired 2 → RISK_EXPERIENCE "requires 2+ years of experience" on internships; the writer then said "JLL typically seeks 2-3 years" | `ACADEMIC_YEARS_AFTER`: a match followed by toward/in a degree/college/major, "of college/coursework/study", or "completed" is skipped, and later matches are still read (all matches, not just the first) | **FIXED on branch `jobfit-grounded-risks`**. Dow Jones Review/71 → Apply/78; JLL Pass/55 → Review/63. Regression: Cushman & Wakefield EIC Intern ×2 and IMEG Sustainability Intern lose the same false 2-year floor; no verdict change |
| DEF-032 | `drafting_documentation` (`extract.ts:1445`): job side bare `"documentation"` (`:1579`) + profile side bare `"wrote"` (`:1475`) put PR writing and technical/solution-design documentation under one key, and same-key = direct | false-fire (WHY) → wrong-verdict | **S1** | 1 | C009 | West Monroe "supporting the creation of functional, technical, and solution design documentation" (a Salesforce/ServiceNow configuration duty) matched "Wrote and pitched 5+ press releases" as **direct / 104**. That is the only quality direct WHY (`decision.ts:109`), so it alone escapes the no-quality-direct Review cap (`decision.ts:252`). Removing that JD clause replays Review/74 | Split technical/solution/functional documentation (requirements docs, solution designs, user stories, SOPs, test scripts) from PR/editorial writing, or make the press/editorial ↔ technical pair adjacent-only. Related to DEF-015 (same bare `"documentation"` job phrase) and architectural debt #3. Audit the corpus for direct drafting_documentation WHYs whose job line names technical/solution/functional docs before choosing | **FIXED on branch `jobfit-documentation-match`** (not in dev or prod). Audit first: 78 direct drafting_documentation WHYs in the 629-run corpus; the false ones were JD lines whose only writing cue is bare "documentation" (records, billing, audit, process, technical/solution docs) matched to press releases, memos, essays or floor plans. Fix is a shape check in `evidenceShapeCompatible` (`scoring.ts`): a documentation-only JD line (no press/legal/report/memo/presentation/materials genre word) is direct only when the résumé line shows documentation work (documentation, SOPs, procedures, process maps, manuals, requirements, records, files, templates); otherwise adjacent. Regression: 24 cases change underneath, 35 matches direct→adjacent, nothing outside this key moves. 5 verdicts move, all down, each audited: Jefferies WM CSA Apply→Review ("follow up on outstanding documentation" ↔ investment memo); Crisis24 Ops Specialist PA→Apply ("accurate documentation" ↔ event logistics; its remaining directs are thin, incl. DEF-024 excel); Josselyn HR Manager and Strategy & Ops PA→Apply/95 (personnel-file / current-state documentation ↔ restructuring communications); Delray Beach police SPA intern Review→Pass/51 (admin documentation ↔ essays; poli-sci student targeting court internships, borderline, Pass defensible). C009 replays Review/74. Test: `app/api/jobfit/documentationMatch.test.ts` |
| DEF-033 | `customer_service_guest_experience` job phrase `"customer service"` (`extract.ts:493`) | false-fire (risk) | S3 | 1 | C009 | "improve the customer experience and performance across marketing, sales, commerce, and customer service **functions**" (the client functions a consultant transforms) became a candidate customer-service duty and a RISK_MISSING_PROOF "customer service, guest experience, and issue resolution". Weight 0, no verdict effect | Skip "customer service" when it sits in a list of business functions ("…, and customer service functions/teams/organizations") or on a consulting-transformation line. Context fix, same shape as architectural debt #1 | OPEN |
| DEF-034 | Profile family inference has no hospitality vocabulary (`lib/jobfit-family-inference.ts` Sales `:60-77`, Operations `:185-205`) | wrong-verdict | **S1** | 2 | C010, C011 | Target roles "Hospitality Front Desk, Guest Services, Sales, Food and Beverage, Sales" resolve to `["Sales"]` only: front desk, guest services and food and beverage match no family, and the bare "Sales" token wins. Front-office postings classify Operations (tag inference, no title rule), so `computeBaseScore` takes −12 instead of +10 (`scoring.ts:873-881`), a 22-point swing. Loews Review/69 → Apply/91 and Hyatt Review/62 → Apply/84 with Operations added. Already listed in §5 ("sports management / guest services") | Map hospitality roles (front desk, front office, guest services, guest relations, concierge, hotel, hospitality, food and beverage, F&B, banquet, rooms division) to Operations, the family the JD side already gives front-office postings. Pair with a JD title rule (front desk / front office / guest services agent / night auditor / concierge → Operations in the cascade at `extract.ts:4536`) so a front-desk posting stops drifting to Sales on post-sale tags (C012). Audit the 629-run corpus diff | **FIXED on branch `jobfit-hospitality-family`** (not in dev or prod). Profile: front desk, guest services/relations, concierge, hospitality, hotel, food and beverage, F&B, banquet(s), rooms division, night audit(or) → Operations. No bare "front office" on the profile side: Aiden's MLB "front office role" target matched it in the first draft. JD: title-only `jobTitleIsFrontOffice` (front desk, front office, guest services, guest relations, night auditor, concierge) → Operations, beside procurement in the cascade. Regression: 0 drift on 68 core + 628 prod (the corpus freezes targetFamilies and has no front-office title). Live check on 198 prod `client_profiles.target_roles`: 3 move, all intended (Cole Sales → Sales + Operations; Zach Sherman "Front Desk, Concierge, Guest Services" Other → Operations; Peri's coach test profile "guest services, fan engagement" Other → Operations). C010 Apply/91, C011 Apply/84, C012 Apply/93 now on Operations. Tests: `lib/jobfit-family-inference.test.ts`, `app/api/jobfit/jobFamilyAndBoilerplate.test.ts` |
| DEF-035 | `RISK_FAMILY_MISMATCH` hidden while its −12 stays in the score: risk suppressed on `strongTitleMatch` (`scoring.ts:1720-1728`), base penalty not (`scoring.ts:880-881`; the title-match offset at `:902` covers hard-tech families only) | wrong-verdict (unexplained) | S2 | 1 | C011 | Hyatt "Front Office Agent" shares "front" with target "hospitality front desk"; "agent" is a noise token (`scoring.ts:784`), so overlap = 1/2 and the risk is suppressed. The −12 is still taken, so the user sees Review/62 with only the generic limited-match risk and no reason. Loews ("Front Office Agent - OVN", overlap 1/3) shows the same penalty as a risk. A one-token match on "front" is also weak evidence of a title match | Make the two sites agree: if a strong title match suppresses the risk, cancel the −12 for non-technical families too (same rationale as `:902`), or keep showing the risk. Separately, require a shared token that is not a generic modifier ("front", "office", "desk" alone) before counting a title match as strong | OPEN. **Measured and NOT shipped (2026-10-27):** showing the risk on a strong title match for non-technical families added RISK_FAMILY_MISMATCH to 86 of 696 regression cases and moved 2 verdicts down (Rubenstein PR Internship Apply → Review, GEO Recruiting Coordinator Review → Pass): the risk is not display-only, it feeds the guardrails and the score again. Needs its own audit, or the other half (cancel the −12 when the title match is strong) |
| DEF-036 | Front-desk vocabulary on both sides: `customer_service_guest_experience` profilePhrases (`extract.ts:461-487`) and no JD key for registration / check-in / reservations / payment processing | coverage gap | S2 | 2 | C010, C011 | Cole's front-desk bullets ("Managed all reservations… check-ins, check-outs, and credit card payments in HMS", "Resolved guest concerns as Manager on Duty", "Worked a 3-person front desk… check-ins") produce **no** profile unit. His customer-service evidence is the summary's aspiration sentence ("Pursuing a Front Desk Agent… role", the DEF-026 class, résumé side) plus the skills line and one concierge bullet at strength 4. Hyatt's JD yields one unit: "guest registration process", "processing forms of payment", "responding to guest inquires", "communication of hotel services" read nothing. Misreads alongside: "food safety standards" → policy_regulatory_research; "Completed 8-week management training" → product_training_enablement (receiving training, not delivering it). Not decisive here (the concierge bullet still carries the direct match when the aspiration line is removed), but it leaves Hyatt on one WHY | Add front-desk phrases on both sides (check-in(s), check-out(s), reservations, guest registration, front desk, guest inquiries/concerns, payment processing) under customer_service_guest_experience or a new front_office_operations key; drop "Pursuing / Seeking … role" summary sentences from profile units like the DEF-026 header lines | OPEN |

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

### CASE C003 — C.P. → AeroVironment, Mechanical Engineer I

```
CASE ID:        C003
DATE:           2026-09-22
RUN ID:         adcdb9fa-273c-44cd-900b-7c8be78b735d  (prod, coach-sourced)
FINGERPRINT:    COACH-MUCPSW7K
RÉSUMÉ:         C.P. — BSME CU Boulder May 2026 (GPA 3.79), FE passed, CSWA; lead CAD on
                senior-design Peltier cooling system, FSAE suspension design, mechatronics robots
JD:             AeroVironment — Mechanical Engineer I (UAV design, 0-2 yrs, SolidWorks; Workday
                posting ingested as ONE run-on paragraph, no newlines)
SHIPPED RESULT: Pass / 55  (raw 65, clamped 55, penalty −8)
resume_source:  MISSING (same whitelist strip as C002)
isSeniorRole:   false
gate_triggered: GATE_FIELD_MISMATCH (force_pass) — "Your profile targets Other"
detector fires: RISK_MISSING_TOOLS ansys (high, −8), RISK_LIMITED_MATCH_EVIDENCE (medium),
                RISK_MISSING_PROOF ×3 high (Mechanical Engineering / ansys / analysis_reporting)
case files:     evals/jobfit/cases/C003/ (resume.txt, jd.txt, result.json, run-row.json) — gitignored, contains PII
repro:          tests/jobfit-regression/_cole-repro.local.ts (dev engine reproduces prod exactly)

WHAT I'M PROBING WITH THIS CASE:
  Coach report: "scoring / risks too severe" on a textbook new-grad ME fit.

VERDICT CHECK:  bug — wrong-verdict (S1). Three independent layers, each sufficient to force Pass.

BUG 1: GATE_FIELD_MISMATCH force-pass on an Engineering→Engineering pairing (DEF-010, new)
  client_profiles.target_roles = "Engineer". inferTargetFamilies only knows qualified forms
  ("mechanical engineer", "aerospace engineer"…, jobfit-family-inference.ts:361-378); bare
  "Engineer" matches nothing, roles is non-empty so the résumé fallback (:402) is skipped,
  and :424 returns ["Other"]. constraints.ts:42-50 treats any non-empty, non-technical
  family list as a mismatch → force_pass. "Other" means "unknown", not "business".
  LAYER: extraction-resume (profile intake) + detector (gate).

BUG 2: run-on JD → every unit `core` + whole block counts as a "required" line (DEF-005 + DEF-006)
  All function/tool units share one 1,790-char snippet spanning Responsibilities AND Basic
  Qualifications. The DEF-005 actionSplit fix on dev does not split this JD (third-person
  "Designs…", "Demonstrates…"). extractToolRequirements (extract.ts:2785) sees "required" /
  "Proficient" anywhere in that mega-line and marks ansys REQUIRED, though the JD names it
  only as an example ("simulation tools (SolidWorks Simulation, ANSYS)") and the candidate
  has SolidWorks thermal simulation + FEA. → RISK_MISSING_TOOLS high −8.
  LAYER: extraction-jd.

BUG 3: two capability false-fires stack the high-risk count to 4 (DEF-011, DEF-012, new)
  • analysis_reporting core on "thermal analysis" (bare "analysis" jobPhrase, extract.ts:264-275).
  • mechanical_engineering "not proven" for a BSME: profilePhrases (extract.ts:1332) lack
    CAD/FEA/drawings/SolidWorks vocabulary; the résumé instead earns trades_construction.
  With 4 highs the ceiling at decision.ts:165 caps to Pass even with the gate removed.
  LAYER: detector (CAPABILITY_RULES).

COUNTERFACTUALS (dev engine, same résumé):
  A. as prod (roles "Engineer")                     → Pass / 55, gate fired, raw 65
  B. roles "Mechanical Engineer" (gate clears)      → Pass / 55, raw 87, 4 highs
  C. B + JD section/bullet newlines restored        → Apply / 91, 0 highs, ansys → preferred (−4)
  One intake word plus JD formatting decided the verdict, not fit.

RENDERER (DEF-013, S3): RISK bullet frames "0-2 years… no industry engineering" as a gap for a
  new grad against a 0-year floor. The composite-parts RISK bullet is fair (steel used in final build).

NOT BUGS (confirmed correct behavior):
  • No experience/seniority fire: yearsRequired 0, isSeniorRole false. Correct.
  • No credential gate on "Public Trust" / "ability to obtain a security clearance". Correct.
  • Excel/Word/PowerPoint typed supporting/preferred. Correct.

NET: Should be Apply (arguably Priority Apply: SolidWorks CSWA, thermal design of an
  electro-mechanical system, prototype build, drawings and machining map 1:1 to the JD).
  Shipped Pass with "Do not apply." Even counterfactual C under-credits: only 1 WHY
  (solidworks), because DEF-012 leaves the ME function unmatched.
```

### CASE C004 — A.N. → KPMG, Advisory Intern, Customer & Operations

```
CASE ID:        C004
DATE:           2026-09-22
RUN ID:         9738a05d-fda3-421a-b2ea-4c72a176f7f5  (prod, coach-added)
RÉSUMÉ:         A.N. — in-school, ~1 yr; business development at an athlete agency,
                economic modelling / statistics in R, editorial data work
JD:             KPMG — Advisory Intern, Customer & Operations, Summer 2027 (7.6k chars)
SHIPPED RESULT: Pass / 52  (raw 52, penalty -3.92)
gate_triggered: GATE_FIELD_MISMATCH (force_pass) — "This is a IT/Software role… your
                profile targets Consulting, Marketing, Analytics, ProductManagement"
detector fires: RISK_MISSING_PROOF operations_execution (high, -3.92),
                RISK_FAMILY_MISMATCH (high, -30), RISK_MISSING_PROOF Software Engineering (high)
case files:     evals/jobfit/cases/C004/ (gitignored, contains PII)
repro:          tests/jobfit-regression/_alex-repro.local.ts

REPORTED AS:    "he got Pass because of lack of experience, but this is an internship and
                none of the experience mentioned is required"

VERDICT CHECK:  bug — wrong-verdict (S1). NOT an experience defect.

  The engine never applied an experience rule: yearsRequired is null, isSeniorRole false,
  internship.isInternship true, no experience gate. What fired is GATE_FIELD_MISMATCH —
  the JD was classified jobFamily IT_Software. The coach read it as an experience problem
  because the V5 renderer explains the -30 family mismatch in terms of missing systems
  experience ("no cloud platform, ERP, or systems implementation experience"), which is
  the renderer describing a family gap in the only vocabulary the JD gave it.

ROOT CAUSE: DEF-009, second sighting. The ENTIRE IT_Software classification rests on the
  bare token "cloud" matching twice (extract.ts software_engineering jobPhrases):
    "Utilize cutting-edge technology trends, including cloud, machine learning and AI"
    "…vendor technologies including cloud-based technology platforms (Oracle, Workday, SAP)"
  That emits software_engineering core, adds functionTag software_it, and the JD
  family-distance override (Fix C) lets the body tag beat the "Advisory Intern" title —
  Consulting and IT_Software are distance 2, so the override is eligible. Hence force_pass
  on a candidate whose stated targets include Consulting.
  No other jobPhrase in that rule matched: verified by probing all 10 against the JD text.

FIX: gate api / cloud / backend / frontend on SOFTWARE_ENGINEERING_ANCHORS.
  After: Pass/52 -> Apply/92, gate none, jobFamily Marketing (matches his targets, so the
  -30 becomes a +10), 4 WHY codes, one remaining risk (operations_execution proof).

REGRESSION: core 1 (40926e QC Analyst I drops a phantom Software Engineering gap, +8, no
  decision change); prod 14 cases, 4 decision changes, ALL Pass->Apply and all the same
  defect — Social Media Content Creator, Social Media Coordinator, Assistant Director of
  Communications and Video Design Intern were each classified IT_Software and force-passed.
  One case loses a software WHY without changing decision (Product Manager, Enterprise
  Digital Product Office, 70->61: its only software signal is the blurb line "leveraging
  modern technologies-including cloud platforms, data, and AI").
  Salesforce Life Sciences Functional Architect reclassifies IT_Software -> Sales, decision
  unchanged — arguably under-classified now; noted, not fixed.

NOT BUGS: no experience gate fired at any point; internship correctly detected
  (isInternship true, isSummer true).

NET: the reported symptom (experience) and the actual defect (family classification off one
  bare word) are different layers. Worth remembering when triaging coach reports: the
  renderer's prose names whatever the JD talks about, not the code that capped the verdict.
```

---

### CASE C005 — S.Z. → UBS, 2027 Group Internal Consulting Graduate Talent Program

```
CASE ID:        C005
DATE:           2026-10-01
RUN ID:         000c3c78-321f-436d-960f-3c093aace889  (prod, 2026-10-01 13:20, persona "Consulting Resume")
RÉSUMÉ:         S.Z. — Duke B.A. Psychology, expected May 2027, GPA 3.935. Workforce integration
                analysis project (AI-directed roster merge + Excel reconciliation), legal intern
                (led an enterprise AI use policy, presented to the Board), research assistant, Pendo
                product-strategy project; chapter president
JD:             UBS — 2027 Group Internal Consulting Graduate Talent Program (2.5k chars, has newlines)
SHIPPED RESULT: Review / 66  (raw 66, penalty 0, gate none)
detector fires: none. risk_codes [], risk_structured [] — the empty risk bullets are the ENGINE's
                output, not a renderer drop
case files:     evals/jobfit/cases/C005/ (gitignored, contains PII)
pull:           tests/jobfit-regression/pull-prod-case.ts --run 000c3c78-… --case C005
repro:          tests/jobfit-regression/_sami-repro.local.ts (dev reproduces prod exactly: Review/66)

REPORTED AS:    "scored 66 with Review and no risk bullets"

VERDICT CHECK:  bug — wrong-verdict (S1), under-scored. Expected Apply.
  She meets every stated requirement: graduating May 2027 (window Dec 2026–Jun 2027), GPA 3.935
  (≥ 3.0), project-based work, and explicit responsible-AI evidence (directed AI tooling and then
  verified it; authored an AI use policy). Profile targets Consulting.

WHAT THE ENGINE ACTUALLY SAW: two requirement_units, both junk.
  - drafting_documentation / core — from the OPT/CPT sponsorship note ("sign any documentation"),
    matched DIRECT (weight 103) to the skills line "policy drafting"                    → DEF-015
  - stakeholder_coordination / supporting — from "You'll build … stakeholder management … skills",
    i.e. what she will LEARN, matched adjacent to the Pendo bullet
  Nothing from the Requirements block or the role duties                                → DEF-016
  Sections: [overview] (Your Role / Your Team unrecognised) + [qualifications] (Requirements, with
  Program Details and the Note folded in).

ROOT CAUSE OF THE VERDICT: DEF-014. The title regex misses bare "consulting", so jobFamily falls to
  tag inference = Operations (tags operations_general + communications_pr, both from the junk units).
  Profile targets [Consulting, Analytics] → no family match → −12 instead of +10.

COUNTERFACTUALS (dev engine, same résumé/profile):
  A. as prod                                         Operations  Review/66  why: drafting(direct), stakeholder(adj)  risks: none
  B. title the regex recognises ("Consulting Analyst - …")   Consulting  Apply/88   same 2 units
  C. B + sponsorship note removed                    Consulting  Review/74  why: stakeholder(adj)  risks: RISK_LIMITED_MATCH_EVIDENCE
  → Fixing DEF-014 alone gives the right band for the wrong reason: B's 88 is propped up by the
    DEF-015 junk WHY. Fixing DEF-014 + DEF-015 without DEF-016 drops to Review/74. All three are
    needed for an honest Apply.

NOT BUGS: no experience gate or seniority fire (yearsRequired null, isSeniorRole false). The
  sponsorship line produced no risk, which is right for this candidate. RISK_FAMILY_MISMATCH did
  not fire (the −12 is the base-score family term, not that risk).

LAYER: extraction-jd (title family, section headers, capability coverage). Scoring math and
  renderer are behaving as designed on the bad inputs.
```

---


```
CASE ID:        C006
DATE:           2026-10-08
RÉSUMÉ:         E.B. — FSU B.S. Finance, May 2028, 3.8 GPA. Valuation Intern (Property Tax Alliance, 2026),
                Acquisition Intern ROW (Bowman, 2025), Wealth Management Shadow (Westshore, 2025),
                Wealthspire Rising-Gen Academy (2026), Finance Society, Securities Society.
                Holds no SIE or Series registration.
JD:             Raymond James 2027 Summer Internship, Wealth Management, multiple locations (9.3k chars, has newlines)
SHIPPED RESULT: Pass / 55  (raw 97, decision_initial Priority Apply, penalty 0, gate GATE_CREDENTIAL_REQUIRED force_pass)
detector fires: GATE_CREDENTIAL_REQUIRED (force_pass); RISK_SUBFAMILY_MISMATCH (low, weight 0)
case files:     evals/jobfit/cases/C006/ (gitignored, contains PII)
pull:           tests/jobfit-regression/pull-prod-case.ts --run 96b96094-87af-46aa-89ac-6d3c2e1c0324 --case C006

REPORTED AS:    "internship scoring too severe; expects experience the job description doesn't require"

VERDICT CHECK:  bug, wrong-verdict (S1). Expected Priority Apply / Apply.
  He meets every stated requirement: junior standing, graduating May 2028 (window Dec 2027 to May 2028),
  bachelor's in finance, and directly relevant wealth-management exposure. The JD's only experience line is
  Workday boilerplate ("General Experience - 4 to 6 months"), and the engine did NOT gate on experience:
  yearsRequired null, isSeniorRole false, penalty_sum 0. The user's "experience" reading is the gate's
  message, not an experience rule.

ROOT CAUSE: DEF-018. The only licensing language is "Successful candidates are highly encouraged to study
  for and complete the Securities Industry Essentials (SIE) licensing before the conclusion of the program".
  - policy.ts:551 lists bare "securities industry essentials" as a FINRA requirement keyword, so
    requiresFinraLicense = true (extract.ts:4445).
  - isCredentialSponsored (extract.ts:4583) looks ±200 chars for SPONSOR_PHRASES (extract.ts:4493-4545);
    none of "highly encouraged", "before the conclusion of the program" is in the list. credentialSponsored false.
  - isSupportAssociateTitle (extract.ts:4606) does not cover "Internship".
  - isTrainingProgram (extract.ts:4759) is false: "internship program" and "developmental programs" match
    none of its patterns, although job_signals.internship.isInternship is true.
  - constraints.ts:160-169 then returns force_pass with "This role requires FINRA registration or securities
    license", clamping 97 to 55.
  Source of the flag is the regex extractor, not the LLM job-signals adapter (llmJobSignalsAdapter.ts:241):
  credentialDetail is the regex's fixed string (extract.ts:4691).

SECONDARY (not investigated further, weight 0): RISK_SUBFAMILY_MISMATCH says "Your finance experience is
  primarily in investment banking" and "This is a asset management role". The résumé is closer to wealth
  management / valuation (one IB-prep club line), and a wealth-management advisor internship is read as
  asset_management. Low severity, did not move the verdict.

NOT BUGS: no experience or seniority gate; no family mismatch; zero penalties.

LAYER: extraction-jd (credential requirement extraction). The gate and the clamp behave as designed on a
  wrong `credentialRequired: true`.

COUNTERFACTUAL: from the payload itself, decision_initial = Priority Apply at raw 97 before the gate;
  removing the false credential flag alone restores it.
```


```
CASE ID:        C007
DATE:           2026-10-08
RÉSUMÉ:         E.B. (same candidate as C006). No Spanish anywhere on the résumé.
JD:             Santander Future Talents: WM&I Summer Internship Program 2027, Miami (6.1k chars, has newlines)
SHIPPED RESULT: Review / 74  (raw 79, decision_initial Apply, penalty 0, gate none, final clamp to 74)
detector fires: RISK_SUBFAMILY_MISMATCH (low, weight 0); evidence guardrail rule 2 (no quality direct WHY)
case files:     evals/jobfit/cases/C007/ (gitignored, contains PII)
pull:           tests/jobfit-regression/pull-prod-case.ts --run d120eac5-d089-4b35-b6aa-c0828e1646bb --case C007

REPORTED AS:    second job on the same candidate's tracker, reviewed alongside C006

VERDICT CHECK:  correct band (Review), wrong reason.
  The JD's requirements are eligibility lines: undergraduate in Business/Economics/Finance graduating
  May-June 2028 (met), GPA above 3.5 (3.8, met), "Fluency in English and Spanish is required" (no evidence),
  US work authorization without sponsorship (not stated on résumé). An unmet required language justifies
  Review. The engine never saw it.

WHAT THE ENGINE ACTUALLY SAW: two requirement_units, both `supporting`, both matched ADJACENT:
  - stakeholder_coordination  "Contribute to client-focused solutions…"  ↔ Wealthspire mentorship bullet (w 77)
  - operations_execution      "Skills: GPA above 3.5; demonstrated leadership…" ↔ P&L reconciliation bullet (w 78)
  Apply at raw 79 was capped to Review by decision.ts rule 2 (no quality direct WHY, decision.ts:200-218)
  and clamped to 74 (decision.ts:234-235). The cap is working as designed on thin, adjacent-only evidence.

DEFECTS:
  - DEF-019: "Fluency in English and Spanish is required" emits nothing. bilingual_language has empty
    jobPhrases on purpose (extract.ts:1517-1531); only the LLM JD path emits it.
  - DEF-020: RISK_SUBFAMILY_MISMATCH again calls the profile investment banking (profile financeSubFamily
    "ib" from one Securities Society bullet; extract.ts:3782-3785). Job read as other_finance.

NOT BUGS: no credential or experience gate (credentialRequired false, yearsRequired null); the Review
  guardrail fired as designed.

LAYER: extraction-jd (language requirement coverage) + extraction-resume (profile sub-family). Scoring and
  guardrails behaved as designed.
```

### CASE C008 — D.R. → UTA, Marketing & Brand Partnerships Training Program 2027

```
CASE ID:        C008
DATE:           2026-10-15
RUN ID:         5d026b0e-f6b6-40f6-a070-88fb18a01870
FINGERPRINT:    COACH-MV9HDW8M
RÉSUMÉ:         D.R. (persona "Music Resume"). Michigan Org Studies + Ross minor, Expected May 2027, 3.94.
                Co-President of two 50+ member music orgs (Live Nation / artist management partnerships,
                sponsorships, fundraising, four events a year); five media/content/comms internships (ESPN
                Chicago, Illinois Policy, sports management). No target roles stated.
JD:             UTA "Marketing & Brand Partnerships Training Program - 2027" (Agent Training Program; LA/NY,
                $23/hr; must graduate before start; cohorts Jan/Mar/Jun/Sep 2027). Soft-skill requirements only.
SHIPPED RESULT: Pass / 55  (raw 82, decision_initial Apply, penalty 0, gate none, guardrail rule 1)
resume_source:  MISSING (not exported, see §5)
isSeniorRole:   false
gate_triggered: none
detector fires: RISK_LIMITED_MATCH_EVIDENCE (high, weight 0)
case files:     evals/jobfit/cases/C008/ (gitignored, contains PII)
pull:           tests/jobfit-regression/pull-prod-case.ts --run 5d026b0e-f6b6-40f6-a070-88fb18a01870 --case C008
repro:          tests/jobfit-regression/_daniel-repro.local.ts (dev engine reproduces Pass/55, raw 58)

REPORTED AS:    user disagrees with the Pass.

VERDICT CHECK:  BUG, wrong-verdict (S1). Expected Apply. The JD asks for entertainment and branding passion,
  internships or projects showing complex work under deadlines, client-focused creative thinking, strong
  written and presentation communication, organizational skill, and Google Suite / MS Office. The
  résumé covers every one: entertainment partnerships and sponsorships, 70+ videos for ESPN, press
  releases with 100+ media hits, end-to-end event delivery, Google Workspace and Excel. The one real
  caveat is eligibility: graduating May 2027 rules out the January and March cohorts.

WHAT THE ENGINE ACTUALLY SAW: three requirement units, all tools. `excel` came from the verb
  "You excel at" (DEF-024); `powerpoint` and `word` came from the "MS Office" suite expansion.
  No function units at all. Profile matched excel, but tool matches produced no WHY, so why_codes = [].
  - Prod raw 82 came from the training-program bonus + 65 floor (scoring.ts:913-926). That bonus fired
    only because profile targetFamilies ["Other"] (no roles stated) "matched" jobFamily "Other", which
    is a vacuous match. On dev, 4653a52e makes "no stated roles" read as [], so the bonus does not apply
    and raw is 58. Same final result either way.
  - decision.ts:153 rule 1 (zero WHYs) then forced Pass and clamped to 55.

COUNTERFACTUALS (dev engine):
  - "Communication" -> "Communications" and "brand strategies" -> "brand strategy": Review/65, WHYs
    brand_messaging (adjacent 87) + communications_writing (adjacent 80), jobFamily Marketing. Proves
    the section reaches extraction and the miss is purely phrase inflection (DEF-021).
  - Known phrases injected into a Looking For line: Review/63. Same conclusion.
  - Even with DEF-021 fixed, the result stops at Review. The JD's real substance (brand partnerships,
    client service, entertainment/talent) has no capability key (DEF-016 shape), so Apply needs coverage
    work as well.

DEFECTS:
  - DEF-021 (new, S1): phrase lists are inflection-blind.
  - DEF-022 (new, S1): rule 1 turns "could not read the JD" into "Pass. Do not apply."
  - DEF-016 (hit 2): training-program / graduate JD vocabulary is invisible to CAPABILITY_RULES; here it is
    brand partnerships, client service, entertainment, events (see also the §5 "events" question).
  - DEF-023 (new, S2): the renderer invented a specific "no talent representation / no entertainment
    partnerships" gap that the résumé contradicts.
  - DEF-024 (new, S3): bare "excel" verb becomes a tool unit.
  - DEF-025 (new, S3): "Expected May 2027" reads as has_degree / gradYear null.

NOT BUGS: no gate; isTrainingProgram correctly true; no years requirement; the rule-1 guardrail did
  what its code says.

LAYER: extraction-jd (DEF-021, DEF-016, DEF-024) + decision (DEF-022) + renderer (DEF-023) +
  extraction-resume (DEF-025).
KNOWN-BUG? no. DEF-021 and DEF-024 are instances of architectural debt #1 (phrase matching).
```

### CASE C009 — D.R. → West Monroe, 2027 Platforms & Customer Strategy Consultant

```
CASE ID:        C009
DATE:           2026-10-26
RUN ID:         54236134-f85f-4ebf-8e51-e8cc8d6f9efe
RÉSUMÉ:         D.R. (persona "Strategy Resume"; same person as C008, revised bullets). Michigan Org Studies
                + Ross minor, Expected May 2027, 3.94. Two music-org presidencies (events, partnerships,
                $75K sponsorship goal), five media/content/comms internships. No consulting, requirements,
                process, CRM-platform or AI-tool evidence. 36 stated target roles incl. "Customer Strategy
                Consultant" -> targets Consulting/Operations/Marketing/Government.
JD:             West Monroe entry-level Consultant, Customer Strategy & Platforms (TechEx). Duties: requirements
                gathering, process/journey redesign, business cases, Salesforce/ServiceNow/NetSuite
                configuration, test scripts, AI-assisted analysis. Required: degree Dec 2026–Aug 2027, GPA 3.0,
                work authorization, 50-mile residence, 50% travel, **experience integrating AI tools such as
                ChatGPT into day-to-day workflows**. Preferred majors: business/analytics/econ/finance/IS/marketing.
SHIPPED RESULT: Apply / 93  (raw 93, penalty -4, gate none; DEF-017 rule 6 held it off Priority Apply)
resume_source:  MISSING (not exported, see §5)
isSeniorRole:   false   isTrainingProgram: true ("you will learn how to translate", extract.ts:5122)
gate_triggered: none
detector fires: RISK_MISSING_TOOLS salesforce (medium, -4); RISK_MISSING_PROOF salesforce (high, 0),
                financial analysis (high, 0), customer service (medium, 0)
WHYs:           drafting_documentation direct/104 (press releases <-> solution design documentation);
                communications_writing adjacent/87; analysis_reporting adjacent/79 (coursework)
case files:     evals/jobfit/cases/C009/ (gitignored, contains PII)
pull:           tests/jobfit-regression/pull-prod-case.ts --run 54236134-f85f-4ebf-8e51-e8cc8d6f9efe --case C009
repro:          tests/jobfit-regression/_daniel-westmonroe.local.ts (worktree engine reproduces Apply/93 exactly)

REPORTED AS:    "scoring does not seem right" (user).

VERDICT CHECK:  BUG, wrong-verdict (over), S1. Expected Review (~74). He meets every eligibility line
  (grad window, GPA) and has real leadership and communication evidence, but the one REQUIRED experience
  item (AI tools in daily workflow) is absent, and none of the core consulting work (requirements,
  process redesign, platform configuration, business cases) has direct evidence. Apply rests entirely
  on one false direct WHY.

WHAT THE ENGINE ACTUALLY SAW:
  - 7 JD units only: customer_service (false, DEF-033), crm_usage + salesforce, analysis_reporting,
    communications_writing (from the test-scripts/training-materials line), drafting_documentation,
    financial_analysis. Requirements gathering, process design, workshops, business cases and the AI
    requirement produce nothing (DEF-016 shape).
  - The AI requirement IS detected: job_signals.internship.mentionsAITools = true (extract.ts:3385).
    Wiring finding: nothing consumes it. WHY_AI_TOOLS_MATCH exists only as policy text (policy.ts:289);
    no unit, gate or risk is built from it, so a required qualification the résumé lacks is silent.
  - Raw score saturates on intent alone: base 56 + family +10 + title "Customer Strategy Consultant"
    +18 (scoring.ts:876-880) + training bonus up to +20 (scoring.ts:921-929) + match counts. With no
    target roles the same evidence scores Review/69. The verdict is decided by the guardrail, not the score.
  - The press-release direct WHY (weight 104) is the only quality direct WHY (decision.ts:109), so it
    alone escapes the no-quality-direct Review cap (decision.ts:252).

COUNTERFACTUALS (worktree engine, _daniel-westmonroe.local.ts):
  A. as prod                                          Apply/93 (raw 93)
  B. drop "solution design documentation" clause      Review/74 (raw 93; guardrail cap)
  C. title without a target-role token                Apply/93 (title bonus not decisive)
  D. B + C                                            Review/74 (raw 90)
  E. no target roles                                  Review/69 (raw 69)

DEFECTS:
  - DEF-032 (new, S1): drafting_documentation conflates PR writing with technical/solution documentation;
    same key = direct, which clears the Review cap.
  - DEF-016 (hit 3): consulting JD vocabulary still invisible; plus the AI-tools requirement is detected
    (mentionsAITools) but never consumed.
  - DEF-033 (new, S3): "customer service functions" (client functions) read as a candidate duty.

NOT BUGS: no gate is correct (no years, credential or tool requirement; degree window and GPA are met).
  Salesforce RISK_MISSING_TOOLS at medium/-4 is fair for an entry-level config duty. Financial-analysis
  MISSING_PROOF is fair (coursework only). isTrainingProgram = true is defensible for a campus cohort.
  DEF-017 rule 6 correctly held it at Apply instead of Priority Apply.

LAYER: extraction-jd (DEF-032 job side, DEF-016, DEF-033) + extraction-resume (DEF-032 profile side)
  -> decision guardrail behaved as coded.
KNOWN-BUG? no. DEF-032 is architectural debt #3 (key granularity / semantic nonsense matches).

AFTER FIX (branch jobfit-documentation-match): Review/74. drafting_documentation now adjacent/78.
```

### CASE C010 — C.B. → Loews Coral Gables, Front Office Agent (overnight)

```
CASE ID:        C010
DATE:           2026-10-27
RUN ID:         bbe50bbe-4b60-40a1-a7f6-bf2c112708c7
RÉSUMÉ:         C.B. Penn State Hospitality Management, Dec 2026. Front Desk Associate at a 36-room five-star
                property (all reservations, check-ins/outs, payments in HMS, Manager on Duty, concierge), front
                desk at Wyndham Deerfield Beach, Hilton management internship, student-restaurant on-duty manager.
                Target roles: Hospitality Front Desk, Guest Services, Sales, Food and Beverage, Sales.
JD:             Loews Coral Gables Front Office Agent, overnight. Check-in/out, payments, guest inquiries,
                upselling, knowledge of events / group bookings / banquet orders. No years, credential or tool gate.
SHIPPED RESULT: Review / 69  (raw 69, penalty 0, gate none)
resume_source:  MISSING (not exported, see §5)
isSeniorRole:   false   isTrainingProgram: false   jobFamily: Operations (tag inference)
gate_triggered: none
detector fires: RISK_FAMILY_MISMATCH medium -12 ("Your stated target field is Sales")
WHYs:           event_coordination direct/103 (club networking events <-> "upcoming events, group bookings");
                customer_service_guest_experience direct/95 (summary aspiration "Pursuing a Front Desk Agent…")
case files:     evals/jobfit/cases/C010/ (gitignored, contains PII)
pull:           tests/jobfit-regression/pull-prod-case.ts --run bbe50bbe-4b60-40a1-a7f6-bf2c112708c7 --case C010
repro:          tests/jobfit-regression/_cole-frontdesk.local.ts (worktree engine reproduces Review/69 exactly)

REPORTED AS:    "Loews says his target role is different" (Peri). He targets front desk / guest services.

VERDICT CHECK:  BUG, wrong-verdict (under), S1. Expected Apply (~90). A hospitality senior with front-desk,
  reservations, payment and Manager-on-Duty experience applying to a front-desk role is the target role.

WHAT THE ENGINE ACTUALLY SAW:
  - targetFamilies ["Sales"]: no family rule knows front desk, guest services or food and beverage
    (lib/jobfit-family-inference.ts:185-205 Operations list; :60-77 Sales takes the bare "sales" token).
  - jobFamily Operations, so computeBaseScore takes -12 instead of +10 (scoring.ts:873-881).
  - The real front-desk bullets build no profile unit (DEF-036); the customer-service direct match rests on
    the summary's aspiration sentence. The event_coordination direct match (club events <-> banquet / group
    bookings knowledge) is generous but harmless.

COUNTERFACTUALS (worktree engine, _cole-frontdesk.local.ts):
  A. as prod                                   Review/69
  B. targets + "Operations"                    Apply/91, no risks
  C. B, aspiration sentence removed             Apply/91 (concierge bullet carries the direct match)

DEFECTS:  DEF-034 (new, S1, decisive). DEF-036 (new, S2). Known RISK_FAMILY_MISMATCH class (vocabulary gap
  already listed in §5).
NOT BUGS: no gate is correct. "Overnight shift" is not modelled and should not be.
LAYER:    extraction-resume (profile family inference) -> scoring family term behaved as coded.
KNOWN-BUG? yes, family-mismatch class; the specific fix (hospitality vocabulary) is DEF-034.

AFTER FIX (branch jobfit-hospitality-family): Apply/91, no risks.
```

### CASE C011 — C.B. → Hyatt Dream South Beach, Front Office Associate / Front Desk Agent

```
CASE ID:        C011
DATE:           2026-10-27
RUN ID:         b18bfd3e-f631-4571-a637-a673a0e42b9b
RÉSUMÉ:         Same as C010.
JD:             Hyatt Dream South Beach Front Office Associate. 1,286 chars: guest registration, communication of
                hotel services and promotions, payments, guest inquiries; qualifications are traits (desire to
                serve, communication skills, standing, overnight shifts). "If you have worked at other Hotels as
                a front desk clerk… we'd love to hear from you."
SHIPPED RESULT: Review / 62  (raw 62, penalty 0, gate none)
resume_source:  MISSING
isSeniorRole:   false   isTrainingProgram: false   jobFamily: Operations
gate_triggered: none
detector fires: RISK_LIMITED_MATCH_EVIDENCE medium 0 (the only risk shown)
WHYs:           customer_service_guest_experience direct/95 (summary aspiration sentence)
case files:     evals/jobfit/cases/C011/
repro:          _cole-frontdesk.local.ts (reproduces Review/62 exactly)

REPORTED AS:    "Hyatt said review but gave no risks" (Peri).

VERDICT CHECK:  BUG, wrong-verdict (under), S1. Expected Apply. The posting asks for prior hotel front-desk
  work, which is exactly his history.

WHAT THE ENGINE ACTUALLY SAW:
  - Same -12 family penalty as C010 (DEF-034), but the RISK_FAMILY_MISMATCH that explains it is suppressed:
    "Front Office Agent" vs target "hospitality front desk" shares "front", "agent" is a noise token
    (scoring.ts:784), overlap 1/2 = strongTitleMatch, and scoring.ts:1728 skips the risk while
    scoring.ts:880-881 still subtracts 12. Hence "Review with no risks" (DEF-035).
  - One JD unit only; registration, payments, inquiries and service communication read nothing (DEF-036).

COUNTERFACTUALS:
  A. as prod                                   Review/62
  B. targets + "Operations"                    Apply/84 (limited-match risk remains, one WHY)
  C. B, aspiration sentence removed             Apply/84

DEFECTS:  DEF-034 (decisive), DEF-035 (new, S2: penalty without its risk), DEF-036.
LAYER:    extraction-resume (family) + scoring/display inconsistency (DEF-035) + extraction-jd coverage.
KNOWN-BUG? DEF-034 is the family-mismatch class; DEF-035 is new.

AFTER FIX (branch jobfit-hospitality-family): Apply/84, targets Sales + Operations. DEF-035 still open (it no
  longer fires here because the family now matches).
```

### CASE C012 — C.B. → JW Marriott (TB Isle Resort), Front Desk Agent (control)

```
CASE ID:        C012
DATE:           2026-10-27
RUN ID:         94a9c740-f28f-4570-a76d-0eceed8ccd9b
SHIPPED RESULT: Apply / 93  (raw 93, penalty -4)
jobFamily:      Sales (tag inference: post_sale_support "Build rapport with VIPs… follow up calls" -> sales_bd)
VERDICT CHECK:  CORRECT band, wrong reason. Apply is right, but it rests on the posting being misread as Sales,
  which happens to match the bare "Sales" target (+10). Without that luck the same candidate lands Review
  like C010/C011. The post_sale_support RISK_MISSING_PROOF (high, -3.6) is a false fire: guest follow-up on
  a front desk is not post-sale account support.
DEFECTS:  DEF-034 (JD title rule half); RISK_MISSING_PROOF false fire counted in the tally.
```

## 5. OPEN QUESTIONS / PAYLOAD GAPS

Things to resolve or capture better while testing:

- [ ] **Base-score components are not in the payload (found on C005).** `score_breakdown.components` lists only decision labels and `penalty_sum`, so a 66 with zero penalties gives no hint that 22 points went to a family miss. The terms in `computeBaseScore` (`scoring.ts:843-928`: family match ±, title-match bonus, direct/adjacent/tool counts, coverage, training bonus, floors) should each be a component. Until then every under-score needs a local repro to attribute.
- [ ] **`jobfit_runs.job_title` / `company_name` are null on run 000c3c78** even though the title reached the engine (`job_signals.jobTitle`). Find which write path leaves them empty; title-based triage queries miss these rows.
- [ ] **🔴 BLOCKING — the true state of `JOBFIT_DETECTORS_PAID` in prod is contradictory.** My session notes and Claude's read of the evidence disagree, and **every ownership conclusion depends on which is right.** Resolve before running any further ownership case.
  - *Evidence that PAID detectors were ON for C002:* `RISK_SCOPE_INVERSION` fired, and that code exists **only** at `riskDetectors.ts:168`, which is unreachable unless `applyRiskDetectors` is set — and the only thing that sets it is `detectorFlagsForPath` (`jobfitEvaluator.ts:90-95`), which requires a `JOBFIT_DETECTORS*` flag.
  - *Evidence pointing the other way:* my own notes record the flags as off/unflipped around that window, and all three were explicitly turned **off** immediately after C002.
  - *Third possibility not yet ruled out:* Vercel env changes do not reach already-running deployments. If the flip happened without a redeploy, C002 may have run on a build that predates it — which would contradict the scope_inversion evidence and means one of the two observations is mis-dated.
  - **How to settle it:** (1) `vercel env ls` for the current values in the prod target; (2) pull the function log for run `c72475ed` and look for `[jobfitEvaluator] DETECTORS ON —` (`jobfitEvaluator.ts:379`) — present means detectors ran, absent means they did not, and the line also prints `resume_source`; (3) compare the prod deployment's build timestamp against when the vars were changed.
- [x] **`resume_source` not in the exported payload — CAUSE FOUND, still not exported.** It exists (`llmResumeExtractor.ts:300`), is set to `'llm'` at `:313` and `'regex'` at `:321` (fail-open), and is held as `resumeEv.source` in the evaluator — but its **only** consumer is a `console.log` at `jobfitEvaluator.ts:380`. It is never placed on `baseOut` (`:388-411`) or the return (`:415-443`), and `EvalOutput` has no such field. The paid path would strip it again anyway: `runJobFitForProfile.ts:411-440` returns an explicit field whitelist. **Two drop points to fix, or read it from the log line meanwhile.**
- [x] **`gate_ledger` not in the exported payload — CAUSE FOUND.** The ledger *is* computed when detectors are on (`jobfitEvaluator.ts:348-354`) and is set on `baseOut.gate_ledger`, but `runJobFitForProfile`'s return whitelist (`:411-440`) does not include the key. Not evidence the ledger is off. Interim read: a ledger blocker unconditionally prepends `"Blocked on unmet required gate(s): …"` to `next_step` (`jobfitEvaluator.ts:362-364`), so the absence of that prefix means zero blockers.
- [ ] **`detector_risk_codes` vs `risk_codes`** — the handoff doc names the former, the payload contains the latter. They are **not** the same: `detector_risk_codes` is a filtered view that exists only inside the log line at `jobfitEvaluator.ts:378-383` (regex-matched against `DOMAIN_GAP|OWNERSHIP_VERB|PEOPLE_MGMT|…`); `risk_codes` is the full set on the payload. Capture both.
- [x] **Is ownership detection wired into this code path at all? — ANSWERED: yes, but gated.** `detectOwnershipVerbMismatch` is defined at `verbMismatch.ts:106`; its only production call site is `jobfitEvaluator.ts:294`, inside `if (args.applyVerbMismatchRisk)`. That flag is set only by `detectorFlagsForPath` (`:92`). If it fires, it does reach output (`riskCodes` → `baseOut.risk_codes` at `:397`) and caps Apply→Review at `decision.ts:35-40`. **So C001's "did not fire" is fully explained by "was never called" — see DEF-002, now UNVERIFIED.**
- [x] **Does the engine extract "events" as a requirement at all?** *Answered by DEF-027: it did not; `event_coordination` now covers planning/coordination/bookings.* C002's JD is fundamentally an events role (~20-25 sponsorships, receptions, internal events) yet no `requirement_unit` covers events — the block was bucketed into brand_messaging / communications_writing / consumer_research / product_positioning / operations_execution. Only the V5 renderer noticed ("EVENT MARKETING EXPERIENCE ABSENT"), with no engine risk code behind it. **This is why the post-DEF-005 result (Apply / 89) may be too generous:** fixing segmentation restored the WHY set but the JD's core function is still invisible to CAPABILITY_RULES. Probe whether an `events_management` capability key exists; if not, that is a coverage gap, not a scoring bug.
- [ ] **Renderer vs engine.** C001's inversion ("TABLEAU DASHBOARD LEADERSHIP") came from the Haiku renderer, not the deterministic engine. Track whether a wrong output is an *engine* defect or a *renderer* defect — they have different owners and different fixes.
- [ ] **Which engine SHA is live in prod?** C003's payload has no `jobfit_logic_version`, and prod ships via `vercel promote` of a dev preview, so `origin/main` is not the answer. Needed to say whether the DEF-005/DEF-003 fixes were live for C003 (the dev repro matches prod exactly, so C003's conclusions hold either way). Add the logic-version stamp to `result_json`.
- [x] **82 of 175 prod profiles (47%) resolved to `targetFamilies: ["Other"]` — ROOT CAUSE FOUND, FIXED.** Not a vocabulary gap: **69 of the 82 stated no target roles at all**. `inferTargetFamilies` ended `: ["Other"]` unconditionally, so "said nothing" and "said something unmappable" collapsed into one value that `constraints.ts:45`, `scoring.ts:840` and `scoring.ts:1661` all read as an asserted non-technical target. Fixed in `lib/jobfit-family-inference.ts`: `["Other"]` only when roles were stated and matched nothing (preserves 0410q — psychology grad vs Meta SWE stays Pass), `[]` when nothing was stated. Only 13 profiles state genuinely unmapped roles (recruiter, property manager, sports management, fractional CFO, IP/trademark associate, non-profit coordinator); vocabulary for those is still open below. A/B over the 107 corpus cases frozen at `["Other"]`: 43 decisions move, 42 up, 1 down (`86d81044` Leasing Coordinator Apply/79→Review/69 — its JD's family is also `Other`, so profile-Other↔job-Other was collecting the +10 family-match bonus; matching unknown to unknown should not earn it). 3 `GATE_FIELD_MISMATCH` force-passes clear (2× Energy and Sustainability Intern, Public Realm Designer, Staff Engineer). **The regression suite cannot see this change** — the prod corpus freezes `profileOverrides.targetFamilies`, so it reports 0 drift; the guard is `lib/jobfit-family-inference.test.ts` plus the A/B above.
- [ ] **Blurb anchoring, software_engineering edition (found auditing C004's candidate, 2026-09-22).** Bessemer Venture Partners "Summer Analyst 2027" scores Pass/22 with jobFamily IT_Software and GATE_FIELD_MISMATCH. It survives the DEF-009 anchor fix *correctly*: the line is the firm describing its portfolio — "from consumer internet and e-commerce, to mobile and cloud computing, to business software, healthcare and cleantech" — so "cloud" does sit next to "software" and the rule fires by its own logic. The defect is one level up: a company/portfolio blurb is being read as a requirement line, exactly like [finance_corp blurb anchoring]. `filterJobTextToRequirements` does not drop it. Candidate fix: treat investment/portfolio blurb vocabulary (invest, portfolio companies, founders, Series A-C, our portfolio, we back) as a non-requirement section, rather than adding negativeContext per rule. Same audit found 6 other Pass rows on that profile with NO gate — those are evidence-based and not this bug.
- [ ] **Vocabulary for the 13 profiles that state unmapped roles.** recruiter / recruiting coordinator (no HR mapping), property manager / lease administrator / Yardi, sports management / guest services / fan engagement, fractional CFO, IP-trademark-copyright associate, non-profit coordinator, bare "project manager", bare "data". These still take the mismatch penalty and the hard-tech gate. Add per family with the diff audited each time — a blanket `Other`=unknown rule was tried and rejected (DEF-010).
- [ ] **The payload does not say which extractor produced `job_signals` (regex vs the LLM job-signals adapter, `llmJobSignalsAdapter.ts`).** C006 could be attributed only by matching `credentialDetail` to the regex's fixed string (`extract.ts:4691`). Export a `job_signals_source` (regex / llm / merged) so credential and gate findings can be attributed without string-matching.
- [ ] **C008: why did matching tool units produce no WHY?** The job had `excel` / `powerpoint` / `word` units and the profile had `excel` + Google Workspace, yet `why_codes` is empty, and the payload carries no match list to show whether tool matches were made and then dropped (`NON_DIFFERENTIATING_JOB_TOOLS`, `extract.ts:2254`?) or never made. Export the evidence-match list, or at least a dropped-match count, so a zero-WHY Pass can be attributed without a local repro.
- [ ] **Is 4653a52e (no stated roles -> targetFamilies [] instead of ["Other"]) in prod?** C008's prod payload still shows `["Other"]` for a profile with no target roles. Check the live deployment's SHA before counting the Other↔Other training bonus as a prod behavior.
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
