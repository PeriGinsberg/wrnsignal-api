# Design — Per-requirement Gate Ledger (defect #1, knockout gate)

Status: DESIGN ONLY. No engine edits. **Rev 3** — folds the E1–E5 / C1–C2 /
header-variant edits validated against 6 real postings into §2; adds a Future
section documenting the deferred (but designed-in) LLM classification path.
Rev history: Rev 1 (initial), Rev 2 (no-header fallback, ownership removed,
credential allowlist), Rev 3 (real-corpus edits + LLM-deferral seam).

## 0. Scope / non-goals
- **In:** parse the posting's *required* requirements into a per-requirement
  ledger of `{gate_id, status: MET|UNMET|UNKNOWN, evidence}`, surface it on
  `EvalOutput`, and cap the verdict below APPLY when any *required* gate is not
  satisfied.
- **Gate only three kinds — all binary and checkable today:** `experience`,
  `credential`, `tool`. **No ownership/roadmap gate** (§1a).
- **Out (separate tasks):** ALL ownership judgment (defect #2 verb classifier),
  the verb-class RISK downgrade (defect #6), the 7 missing risk ids, score
  re-tuning. The ledger decides gate status + cap only; it emits no risk codes.
- **Shared primitive:** MET/UNMET for `tool` gates needs an evidence-locus
  check (tool used in an EXPERIENCE bullet, not merely in the SKILLS blob).
  Consumed here, not surfaced.

### 1a. Why ownership is removed
"Ownership of a measurement function" is graded/inferential, not binary — it is
defect #2's verb-classifier judgment. Building it in the ledger too means two
detectors that can disagree, and leaving it `UNKNOWN` until #2 lands would cap
**Reyna (07) to PASS** — the over-correction the set forbids. The ledger gates
none of `ownership_of_measurement_function`, `full_model_lifecycle_ownership`,
roadmap/product-line ownership. The 01-vs-07 discriminator survives on the
**experience** gate alone: Jordan 0 yrs B2B SaaS → `b2b_saas_3yr` UNMET → PASS;
Reyna 5 yrs → MET → APPLY.

> **Golden-set edit needed (human side):** removing ownership gates means case
> **07** (`ownership_of_measurement_function: MET`) and case **08**
> (`full_model_lifecycle_ownership: MET`) reference gates the ledger no longer
> emits — both gate lists need the edit or the assertion reads `None`.
> `experimentation_ab_testing` stays (hands-on *experience* gate, not ownership).

## 1. Where it lives + how it surfaces
New step in `runJobFit` after extraction, alongside `evaluateGates`:
```
const gateLedger = buildGateLedger(gateCandidates, profileSignals, { resumeText })
// gateCandidates = the classified requirement lines (see §2 / §6 for the
// producer: regex today, optionally LLM later — same shape either way).
```
**New types (signals.ts):**
```
type GateStatus = "MET" | "UNMET" | "UNKNOWN"
type GateKind   = "experience" | "credential" | "tool"     // NO "ownership"
type GateCandidate  = { text: string; kind: GateKind; required: boolean; trigger_span: string }
type GateLedgerEntry = {
  gate_id: string; kind: GateKind; required: boolean;
  status: GateStatus; requirement: string; evidence: string | null
}
```
Add `gate_ledger: GateLedgerEntry[]` to `EvalOutput`. `_engine_bridge.ts` adds
`gate_ledger`; `score_resume()` sets
`gates = {e.gate_id: e.status for e in gate_ledger if e.required}`.

---

## 2. Requirement-phrase parser (regex classifier — Rev 3)
Produces `GateCandidate[]`; the deterministic ledger (§3) consumes them. Every
rule below is validated against the 8 synthetic cases **and** 6 real postings
(Tessera intern, Bridgewater IA, JPM finance intern, Macy's TA, e.l.f. CM →
0 gates each; Merrill CA → 1 credential gate).

### 2a. Required vs preferred — SECTION-driven when headers exist
| Header (regex, case-insensitive) | required |
|---|---|
| `requirements?( \((non-negotiable\|must-have)\))?` · `must show hands-on` · `what we're looking for` · `required qualifications(,? capabilities,? and skills)?` · `skills you('ll\| will) need` · `who you are` · `what you'll bring` · `qualifications` | **true** |
| `nice[- ]to[- ]have` · `preferred qualifications?` · `desired qualifications?` · `preferred( \(nice-to-have\))?` | **false** |

("Who You Are" / "Skills You Will Need" are safe as *required* headers — Guard 2
plus the degree edits below stop their soft content from gating.)

### 2b. Which required lines become gates — trigger phrases + real-corpus edits
Three kinds only. Each candidate must also emit its verbatim `trigger_span`.

**experience (quantified):**
- `N+ years` · `at least N years` · `minimum (of )?N years` → base experience gate.
- `N+ years … with at least M in <domain>` → domain-qualified gate (01/07 `b2b_saas_3yr`).
- `managing managers` · `managers (not just ICs)` · `manager of managers` → org gate (03 `manager_of_managers_5yr`).
- `recent, hands-on <skill> (vNN+) … within your last two roles` / `"recent" means …` → recency gate (04 `recent_angular_v14_3yr`).
- `hands-on <named practice> experience` (A/B testing / experimentation) → experience gate (08 `experimentation_ab_testing`).
- **E4 — bind to years-OF-EXPERIENCE.** Require `\d+\+?\s*years?` **and** an
  in-clause experience anchor (`of experience` · `in <field/role>` · `<skill>
  experience` · `managing` · `building`). **Reject** when the number is
  company-age / duration / comp / academic context: preceded by `for` ("For 50
  years"), or adjacent to `-week|-month|-day` · `$` · `GPA` · `graduation` · a
  bare 4-digit year. (Bridgewater "50 years"/"$71,000"/"8-week"; JPM "December
  2027"/"GPA 3.2".)

**credential (allowlisted only — §3a):**
- `active <X> (security )?clearance( required)?` → clearance gate.
- professional license — `CPA` · `bar` · `RN` · `PE` · `Series NN` · `CDL` ·
  `teaching license` → license gate.
- `bachelor'?s degree …` → degree gate, **but only** per E1/E2 below.
- `must be a US citizen` / `US citizenship required` → citizenship gate **only
  when co-located with a clearance requirement** (§3a).
- **E1 — enrollment ≠ degree.** A degree/credential line preceded by
  `currently pursuing` · `pursuing (a\|an)` · `working toward` · `enrolled in` ·
  `expected graduation` · `candidate for` · `rising (junior\|senior)` is an
  *enrollment* line → **never** a degree-held gate. (Tessera, JPM.)
- **E2 — soft-degree suppression (replaces Rev 2's over-eager "resume shows
  neither" clause).** A degree line gates **only** when hard-required
  (`required` · `must (have\|hold)` · `non-negotiable`) **and** its escape is a
  *specific documented waiver* (e.g. "DoD-accepted … waiver on file"). A **soft
  marker** (`encouraged to apply` · `preferred` · `a plus` · `ideally`) **or** a
  *generic experience escape* (`or equivalent (work )?experience`) → **no
  gate**. Keeps case 02 (non-negotiable + specific waiver → UNMET); drops Macy's
  "Bachelor's or equivalent work experience … encouraged to apply".
- **E5 — compound + substitute credential.** Parse a license line as a
  conjunction (`X, Y, and Z`) with substitute capture
  (`A (and\|/) B (accepted )?in lieu of Z` · `or equivalent`). Emit **one**
  credential gate; MET iff **every** conjunct is satisfied, each by its named
  license **or** a listed substitute. (Merrill: SIE ∧ Series 7 ∧ (Series 66 ∨
  (Series 63 ∧ Series 65)).)

**tool (named, hands-on, specialized):**
- `hands-on … experience with <tool>` · enumerated `must show hands-on … all
  four` → one gate per named tool (05 `snowflake_handson` … `spark_handson`).
- `experience with <tool> <work-artifact>` → gate (07 `crm_pipeline` =
  "Experience with Salesforce or HubSpot **pipeline data**"). `<A> or <B>` →
  one **OR** gate.
- **E3a — demonstrated-usage of a *specialized* tool only.** Gate only when a
  specialized tool is the object of a usage phrase (`hands-on` · `experience
  with` · `built` · `operated` · `authored`). **Never** gate ubiquitous office
  software (`Excel` · `PowerPoint` · `Word` · `Outlook` · `Google Docs`), and
  `proficiency (in\|with)` · `knowledge of` · `familiarity with` alone do **not**
  gate. (JPM "proficiency in Excel and PowerPoint" → no gate; keeps 05/07.)
- **E3b — examples aren't gates.** Tools introduced by `e.g.` · `ex.` · `such
  as` · `etc.`, or parenthetical after a generic noun ("tools/platforms (…)"),
  are illustrative → no gate. (e.l.f. "(ex. Hootsuite, Sprout…)".)

**Never gated:** subjective/non-discriminating lines — "comfort operating with
ambiguity", "strong communication", bare "strong RxJS/Python"; and (per §1a)
anything ownership-shaped.

### 2c. NO-HEADER FALLBACK (requirements in prose) + marker rules
When the segmenter finds **neither** a required- nor preferred-class header (or
a requirement-shaped line sits outside every recognized section), switch to
per-line/clause phrase detection over the full requirements-scoped text, using
the §2b triggers. required-vs-preferred is then decided by an inline marker:

- **Intrinsic-required (always gate, even headerless):** quantified experience
  (`N+ years` · `at least N` · `minimum N`) and allowlisted credentials whose
  own phrasing carries the demand (`clearance required` · `must be a US citizen`
  · `<license> required`).
- **Marker-gated:** a tool/other gate-shaped line gates only with a strong
  inline marker — `required` · `must (have\|show\|possess)` · `must be able to`
  · `non-negotiable` · `mandatory` · `requires`. Weak hedges ("you'll need",
  "ideally", "we'd love") do **not** count.
- **Ambiguous default → PREFERRED (non-gating).** A gate-shaped line with a §2b
  phrase but no marker defaults to `required=false`.
- **C1 — a marker promotes required-ness, it does NOT create a gate.** A line
  emits a gate only if it *also* matches a §2b gateable kind. Marker on an
  unmeasurable object ("Must have a strong interest in social media marketing")
  → no gate. (e.l.f.)
- **C2 — exclusion beats marker (ordering).** The §3a work-auth/EEO exclusion is
  applied **before** marker logic, so "you **must** be authorized to work in the
  U.S." never gates. (JPM.)

**Bias, and why:** when a line is ambiguous we default to *not* gating. A false
`UNMET` silently floors a good candidate to PASS — invisible, and it punishes
the honest applicant the set protects. A *missed* gate merely fails to cap —
visible as a too-high verdict the RISK layer can still catch. Not "emit zero
gates": intrinsic-required phrasings still fire without a header.

**Worked example — headerless case-01** (requirements as prose):

| Clause | §2b hit | marker? | outcome |
|---|---|---|---|
| "5+ years … at least 3 in B2B SaaS" | experience (quantified) | intrinsic | **gate `b2b_saas_3yr`** |
| "you'll need … dbt or equivalent" | tool | weak ("you'll need") | preferred → no gate |
| "Experience with Salesforce or HubSpot … is important" | tool | none | preferred → no gate |
| "comfortable operating with ambiguity" | — | — | nothing |

→ one gate `b2b_saas_3yr = UNMET` → PASS for Jordan; Reyna MET → APPLY.

### 2d. Status derivation + the UNKNOWN path
- **MET** — evidence found (experience: years-in-scope ≥ threshold; tool: named
  tool in an EXPERIENCE bullet; credential: explicitly held, incl. E5 substitutes).
- **UNMET** — contradicted or affirmatively absent where it would be stated if
  held. Explicit "No degree" → UNMET. Clearance silent → UNMET (a cleared
  candidate headlines it). Tool only in SKILLS blob, never EXPERIENCE → UNMET.
- **UNKNOWN** — requirement present, résumé genuinely silent on an
  often-unstated attribute (citizenship). For a *required* gate **UNKNOWN caps
  exactly like UNMET, never assumed MET** — the split is reporting only.

---

## 3. Cap rule
```
requiredUnsatisfied = gateLedger.filter(e => e.required && e.status !== "MET")
if requiredUnsatisfied.length > 0:  decision = floor(decision, "Pass")
```
Any one required gate not MET (UNMET **or** UNKNOWN) → verdict floored to PASS
regardless of score. `required=false` entries are filtered out first, so 08's
PyTorch caps nothing.

### 3a. Credential allowlist + exclusion rule
A credential line may create a gate **only** if it is one of:

| Allowed credential gate | Notes |
|---|---|
| Active security clearance | `TS/SCI`, `Secret`, `active … clearance` |
| Professional license | CPA, bar, RN, PE, Series 7/63/65/66, CDL, teaching |
| Degree-required with **no** waiver path | per E1/E2: hard-required + specific-waiver-or-none only |
| US citizenship | **only when co-located with a clearance requirement** |

**Exclusion rule (never a gate, applied before marker logic — C2):** generic
work-authorization / EEO / boilerplate — "authorized to work in the US", "must
be eligible to work", "no sponsorship", "equal-opportunity employer",
"background check required". Citizenship outside a cleared context falls here.

---

## 4. Over-fire guards (must not lower 07 or 08)
- **Guard 1 — MET-is-inert (primary).** A gate caps only when `status ∈
  {UNMET, UNKNOWN}`; a MET gate never lowers a verdict. 07's three and 08's two
  required gates are all MET → zero cap pressure.
- **Guard 2 — checkable-only gating.** Only the three §2b kinds gate; soft lines
  never enter the ledger, so they can't read UNKNOWN and sink 07/08. Also the
  floor for C1 (marker on soft object) and the real-corpus false-fires.
- **Guard 3 — preferred exclusion.** `required=false` (header or §2c default)
  entries are dropped before the cap. Protects 08's PyTorch.
- **Guard 4 — symmetric evidence detection.** The detector that marks Tyler
  UNMET (SKILLS-only) must credit Reyna's dbt / Omar's A-B testing as MET from
  EXPERIENCE. A false-UNMET on 07/08 is a build failure; the `07 > 08 > 01` /
  `07 > 06` invariants are the tripwire.

---

## 5. Per-case target ledger (unchanged from Rev 2 — already ownership-free)
`required` unless noted.

| Case | gate_id | kind | status | basis |
|---|---|---|---|---|
| 01 Jordan | b2b_saas_3yr | experience | UNMET | 0 yrs B2B SaaS (CPG/consumer) |
| 02 Priya | ts_sci_clearance | credential | UNMET | silent → treated as not held |
| 02 | us_citizenship | credential | UNKNOWN | silent; gates only b/c co-located w/ clearance |
| 02 | degree_or_waiver | credential | UNMET | "No degree"; no DoD waiver on file |
| 03 Marcus | yoe_10 | experience | UNMET | ~2 yrs |
| 03 | manager_of_managers_5yr | experience | UNMET | mentored 1 intern; no mgr-of-mgrs |
| 04 Dana | recent_angular_v14_3yr | experience | UNMET | Angular v2–5, 2016–2019 (stale + wrong version) |
| 05 Tyler | snowflake/dbt/airflow/spark _handson | tool | UNMET ×4 | in SKILLS blob only, absent from EXPERIENCE |
| 06 Sofia | — | — | (no gates) | roadmap ownership → defect #2/#6, not a gate |
| 07 Reyna | b2b_saas_3yr | experience | MET | 5 yrs B2B SaaS |
| 07 | dbt_handson | tool | MET | built dbt models (EXPERIENCE) |
| 07 | crm_pipeline | tool (OR) | MET | HubSpot + Salesforce in EXPERIENCE |
| 08 Omar | ml_in_prod_5yr | experience | MET | 6 yrs ML in prod |
| 08 | experimentation_ab_testing | experience | MET | "own the A/B testing platform end to end" |
| 08 | ~~pytorch~~ | (preferred) | excluded | Nice-to-have → `required=false` |

Real-corpus expectation (validated at design level, Rev 3 rules): Tessera /
Bridgewater / JPM / Macy's / e.l.f. → **0 gates**; Merrill → **1** credential
gate (`finra_sie_series7_series66`, compound + substitute).

Expected verdicts once built: 01→PASS, 02→PASS, 03→PASS, 04→PASS/REVIEW,
05→PASS, 07 stays APPLY, 08 stays REVIEW. 06 unchanged (its miss is the
verb-class RISK).

---

## 5a. Production gap (known limitation — bounds what the golden set proves)
The resume→`ProfileEvidence` extractor's **domain-year attribution** is
keyword-fitted to the golden résumés: `b2b_saas` is credited by "SaaS"
co-occurring with a role's date span, `ml_in_prod` by "models in production".
This is the same domain-blind-years debt the engine already carries — it is
correct on the 8 synthetic résumés but is **not validated on real résumé prose**
and will need real-corpus hardening (or the LLM extractor path, the resume-side
analogue of §6) before production breadth. What the golden set proves is that
the fix is **correct on the golden set**, not that the résumé-reader is
prod-ready. The **conservative default is the safe floor**: no domain evidence →
0 years in that domain → UNMET, never assumed MET — so the failure mode is a
missed-MET (a strong candidate under-credited, visible/appealable), never a
false-MET (an unqualified candidate waved through). Tool evidence-locus,
credential/degree/clearance, recency, and E5 licenses are literal-match and not
subject to this gap.

**Prod-hardening list (before the ledger flips ON in prod):**
- **Domain-year attribution** — keyword-fitted; needs real-résumé validation or
  the LLM extractor path (§6).
- **Dash normalization (real parser bug, not just harness).** The experience /
  recency regexes key on literal en/em-dashes (e.g. `2022–Present`). Real
  résumés use hyphen / en-dash / em-dash interchangeably, and a mismatched dash
  makes a date range unparseable → domain years read 0 → **false UNMET** (the
  exact false-rejection this fix must avoid). Surfaced during step 5 as a
  cp1252-mangling harness bug, but the underlying regex fragility is real. Fix:
  normalize all dash variants (`‐-‒–—―` → `-`) in both the classifier and the
  extractor before parsing. Not fixed now — logged.

## 3b. Gated-candidate score display — DECIDED (one authority, ceiling)
**Decision (locked, option A):** there is **ONE score authority for every
gate-blocked verdict** — coarse `force_pass` AND ledger required-gate UNMET
alike. The score is `capScoreForDecision(score, "Pass") = **min(rawScore, 55)**`.
The old coarse-only **≤25 tier is RETIRED**; there is no longer a separate
"crushing" number.

| Knockout source | Decision | Score shown |
|---|---|---|
| Coarse `force_pass` (constraints.ts) | Pass | `min(raw, 55)` |
| Ledger required-gate UNMET (defect #1) | Pass | `min(raw, 55)` |
| (both co-fire, e.g. Tyler) | Pass | `min(raw, 55)` — never 25 |

- **Ceiling, not a floor.** A gated candidate's number stays honest to fit: a
  strong-but-walled candidate is capped at 55 (Jordan 55); a weak-AND-gated one
  shows their true low fit (Tyler 26, not lifted to 55). Severity does not live
  in the number.
- **The reason carries the block.** Because a gated score can sit near the Apply
  band, the candidate MUST see WHICH gate blocked them. `jobfitEvaluator`
  prepends **"Blocked on unmet required gate(s): `<requirement>` [UNMET|UNKNOWN]…"**
  to `next_step` whenever the ledger has an unsatisfied required gate.
  (`gateScore = capScoreForDecision(scoreAfterBoost, decisionFinal)`, no
  force_pass special-case.)
- **Where it renders:** `next_step` → `runJobFitForProfile.ts:413` →
  `framer/prod/maincomponent.txt:1921` (`nextStep`) → result screen's next-step
  / "your move" block (~line 2663), beside the score/PASS.
- **Prod impact (measured on the 696-case baseline):** retiring the 25 tier is
  **display-only** — **32 cases moved** (all `force_pass` with raw > 25, now
  `min(raw, 55)`, Δ +8 to +30), **zero HARD changes** (no decision / gate /
  WHY / RISK moved). Verified: golden 05 (Tyler) 25→26 still PASS/green, 01/02/03
  at 55, control 07 untouched.

## 6. Future: LLM classification via the `gateCandidates` seam (DEFERRED)
Rev 3 ships the regex classifier (§2). LLM classification is **deferred but
designed-in**, to be added only when prod shows unseen phrasings slipping past
regex — not before (keeps the no-LLM paid path LLM-free until evidence demands
otherwise).

**The seam contract (the one line that matters):** `GateCandidate[]` is the
**only** interface between the classifier and the deterministic ledger. The
ledger (§3: E5 assembly, MET/UNMET evidence check, cap) consumes `GateCandidate[]`
and knows nothing about who produced it. So **regex-now and LLM-later are
drop-in swaps with zero ledger rework** — only the producer of `gateCandidates`
changes.

**Split of responsibility (unchanged by which producer runs):** the classifier
labels JD lines only (`{text, kind, required, trigger_span}`); it never sees the
résumé, never decides MET/UNMET, never caps. All résumé-touching and
verdict-touching logic stays deterministic.

**Where it would run:** extend `extractJobSignalsLLM`'s schema to emit
`gateCandidates` on the existing single JD-extraction pass (no second call,
reuses `ExtractionCache` + fail-open). `llmJobExtractionToSignals` carries them
onto `jobSignals`.

**Determinism (the blocker — solved, mirrors the shipped semantic layer):**
- Classification is **JD-only / candidate-independent**, so it caches on
  `hash(requirementsText)` — one stable entry per unique posting (smaller/easier
  than the semantic layer's match-pair cache).
- **Frozen, JD-keyed cache + `allowLive:false`** in the harness (mirror of
  `frozenSemanticOption()`); prod uses `allowLive:true` + runtime cache.
- **Regex fail-open on cache miss** — a miss or any LLM error falls back to the
  §2 regex classifier, which is itself deterministic. The harness never makes a
  live call and never hard-fails.
- **Freeze script** `freeze-gate-classifications.ts` (clone of
  `freeze-semantic-verdicts.ts`) runs the 8+6 once live and commits the fixture;
  the harness replays it → identical gates every run.
- temp-0 is necessary but **not** sufficient (backend nondeterminism); the
  frozen cache is what guarantees reproducibility.

**Over-fire control (LLM drifts toward "yes"):**
- **Exclusion-framed prompt** — default is *not a gate*; a line must
  affirmatively qualify (hard knockout ∧ checkable kind ∧ crisp `trigger_span`).
- **Few-shot negatives = these 6 real postings** (enrollment≠degree,
  work-auth/EEO, soft-degree, ubiquitous/example/proficiency tools,
  marker-on-soft-object).
- **Deterministic VETO-ONLY post-filter (the safety floor):** after the LLM
  proposes, the §3a denylists (work-auth/EEO, ubiquitous office tools,
  enrollment markers) run as a filter that can **only remove** gates, never add.
  The LLM cannot manufacture a gate the denylist forbids — LLM drift can't
  breach the floor.
- **Committed classification eval:** freeze on all 14 (8 synthetic + 6 real) and
  assert gate counts (5 real → 0, Merrill → 1, plus the 8). A model update that
  drifts trips the eval.

**Revisit trigger:** prod evidence that real postings' phrasings are escaping
the regex classifier (missed gates or false fires the denylist can't catch).
Until then, regex is sufficient and the seam keeps the swap cheap.
