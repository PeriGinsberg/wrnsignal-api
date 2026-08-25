# OPEN DECISIONS — Professional DNA methodology

**Status:** LIVE — this file is never "finished"
**Methodology version:** v0.8
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23

Every unresolved methodology question, with a stable id. **Nothing here is resolved by this
document.** An entry is closed only when Peri decides, the decision is recorded in
[DECISION-LOG.md](DECISION-LOG.md), and the canonical document is updated.

**Count: 92 open. 3 closed. 95 entries.**

Derived from the file, not counted by hand:
`d-prin 1 · d-cr 13 · d-npf 8 · d-aa 7 · d-ec 19 · d-ac 5 · d-di 9 · d-rs 8 · d-vf 6 · d-vw 1 · d-cb 5 · d-tm 12`

> **⚠️ Count correction, 2026-08-22.** This header previously read "56 open / 0 closed" and
> then "57 / 1". **Both were wrong** — a hand-count made when the file was created and carried
> forward. The true figure on the day the register was created was **67**, not 56. Nothing was
> lost or removed; only the header was mistaken.
>
> This matters because acceptance criterion 5 on
> `CNL R0 — GO / NO-GO: Professional DNA methodology frozen` is measured against this number.
> The corrected figure has been pushed to that PM record. **Derive this count, do not
> increment it by hand.**

**Change on 2026-08-22 (tradeoff model):** thirteen entries added — `D-TM-01` … `D-TM-12`
and [D-NPF-08](#d-npf-08). One entry narrowed: [D-NPF-01](#d-npf-01). None closed.

**Change on 2026-08-22 (Maleri evidence supplied):** [D-TM-12](#d-tm-12) **closed** —
[DL-003](DECISION-LOG.md#dl-003). It existed solely because worked-example evidence was
missing; Peri supplied it. Nothing else closed.

**Change on 2026-08-23 (confidence methodology):** eight entries added — `D-EC-12` … `D-EC-19`.
Four restated or narrowed: [D-EC-02](#d-ec-02), [D-EC-04](#d-ec-04), [D-EC-05](#d-ec-05),
[D-EC-11](#d-ec-11). One **closed**: [D-EC-10](#d-ec-10) — [DL-004](DECISION-LOG.md#dl-004).

**Change on 2026-08-23 (first-pass construct definitions):** three entries added —
[D-CR-10](#d-cr-10), [D-CR-11](#d-cr-11), [D-CR-12](#d-cr-12). **None closed** — writing draft
definitions closes nothing; see the Definition Review Standard in
[01](01-construct-registry.md#definition-review-standard).

**Change on 2026-08-23 (FIRST CONSTRUCT-DEFINITION LOCK):** ✅ Peri approved five construct
definitions — [DL-005](DECISION-LOG.md#dl-005) through [DL-009](DECISION-LOG.md#dl-009). One entry
added: [D-CR-13](#d-cr-13). **Zero entries closed.** Four narrowed: [D-CR-06](#d-cr-06),
[D-CR-10](#d-cr-10), [D-CR-11](#d-cr-11), [D-DI-08](#d-di-08). One annotated with a new
requirement: [D-NPF-01](#d-npf-01).

> The approvals closed **eight per-construct open questions recorded inside
> [01](01-construct-registry.md)** — but no registry-level entry here, because these entries
> were written at a broader scope than any single construct. Explicitly preserved per Peri:
> [D-CR-01](#d-cr-01), [D-TM-03](#d-tm-03), the résumé `verbClass` engineering collision (inside
> [D-CR-01](#d-cr-01) and the [3.1 entry](01-construct-registry.md#31--outcome-ownership)),
> [D-CR-13](#d-cr-13), [D-CR-10](#d-cr-10) and [D-DI-08](#d-di-08).

**Change on 2026-08-23 (1.1 definition revised — [DL-010](DECISION-LOG.md#dl-010)):** Peri
supplied a revised canonical definition for
[1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support),
superseding the DL-009 text. One entry added: [D-CR-14](#d-cr-14). **Zero entries closed** —
this revision opens more than it settles. One annotated: [D-CR-13](#d-cr-13) (the definition now
names unfamiliarity as the canonical condition, but "especially" ≠ "only", and detection and
representation are untouched).

> ⚠️ **[DL-009 lock 2](DECISION-LOG.md#dl-009) — preference-versus-necessity is a
> classification, not a construct — is now under strain.** The revised definition names
> *prefers* inside the construct. The lock **stands**; Peri did not retract it. But the
> boundary against the [tier layer](02-needs-preferences-flexibility.md) is now held by stated
> convention rather than by structure, and that is [D-CR-14](#d-cr-14).

| Prefix | Area | Document |
|---|---|---|
| `D-PRIN` | Principles | [00](00-methodology-principles.md) |
| `D-CR` | Construct registry | [01](01-construct-registry.md) |
| `D-NPF` | Needs / preferences / flexibility | [02](02-needs-preferences-flexibility.md) |
| `D-AA` | Assessment architecture | [03](03-assessment-architecture.md) |
| `D-EC` | Evidence and confidence | [04](04-evidence-and-confidence.md) |
| `D-AC` | Adaptive clarifiers | [05](05-adaptive-clarifiers.md) |
| `D-DI` | Decoded insights | [06](06-decoded-insights.md) |
| `D-RS` | Result schema | [07](07-result-schema.md) |
| `D-VF` | Validation framework | [08](08-validation-framework.md) |
| `D-VW` | Validation workflow (client reaction) | [08](08-validation-framework.md) |
| `D-CB` | Context boundary | [09](09-context-boundary.md) |
| `D-TM` | Tradeoff model | [11](11-tradeoff-model.md) |

**Blocking R1 engineering:** D-AC-03 · D-CR-01 · D-AA-01 · D-EC-04 · D-EC-12 · D-RS-01
*(D-CR-02 removed 2026-08-22 — closed.)*
**Blocking the tradeoff graph:** D-TM-09 · D-TM-10
**Blocking the result schema Tradeoffs group:** D-TM-05 · D-TM-06 · D-TM-11
**Already recorded in SIGNAL PM:** D-AC-03 · D-AA-01 · D-VW-01 · D-VF-01 (and D-CR-08 via
`CNL R3 — Taxonomy reconciliation decision`)

---

## Principles

<a name="d-prin-01"></a>
### D-PRIN-01 — Approve the methodology principles
Do P8–P12 stand as written? P1–P7 mirror the SIGNAL PM initiative charter; P8–P12 are stated
for the first time in [00](00-methodology-principles.md) and have not been approved.
**Blocks:** the whole directory — every other document inherits these.

---

## Construct registry

<a name="d-cr-01"></a>
### D-CR-01 — Does Motivator `Ownership` survive as a distinct construct? ⚠️ OPEN
**Restated 2026-08-22. Partially resolved, deliberately not closed.**

*Originally:* "`Ownership` appears in two families — 3 (Responsibility + People) and 4 (What
Makes It Worth It). One construct measured twice, two constructs sharing a name, or an error?"

**What was decided** ([DL-001](DECISION-LOG.md#dl-001)): family 3's `Ownership` is renamed
**[Outcome Ownership](01-construct-registry.md#31--outcome-ownership)**, with the working
intent *"preference for having something clearly theirs to own, be accountable for, and carry
responsibility for."* The name collision is gone.

**What remains open — the substantive half:** is
**[4.11 Ownership](01-construct-registry.md#411--ownership)** a distinct motivator, or should
it be **derived** from Outcome Ownership × [Achievement](01-construct-registry.md#45--achievement)
× [Freedom](01-construct-registry.md#48--freedom)?

Three live outcomes, none favoured:
1. **Distinct** — keep it, give it a name that does not share a word with 3.1.
2. **Derived** — remove it from the registry; it becomes a decoded insight per
   [06](06-decoded-insights.md), subject to **P10**. Registry drops to 43, family 4 to 10.
3. **Split** — the equity/financial-stake reading and the this-is-mine reading are two
   different constructs.

4.11 was deliberately **not renamed**, because renaming it would presume outcome 1.

**Blocks:** any code keying on a family-4 construct set. Blocks the final registry count.
**No longer blocks:** DI-02 — its inputs are now unambiguous.

<a name="d-cr-02"></a>
### D-CR-02 — `Influence` appears in two families — ✅ CLOSED 2026-08-22
Family 2 (What You Like Doing) and family 3 (Responsibility + People).

**Decided** ([DL-002](DECISION-LOG.md#dl-002)): they are two different constructs and are
renamed accordingly.

| Was | Now | Working intent |
|---|---|---|
| 2.8 `Influence` | **[Persuasion / Influence Work](01-construct-registry.md#28--persuasion--influence-work)** | Enjoyment of changing minds, persuading, advocating, selling, or shaping behaviour through communication. |
| 3.3 `Influence` | **[Decision Influence](01-construct-registry.md#33--decision-influence)** | Desire to shape consequential decisions and outcomes without requiring formal authority or people management. |

**Scope of the closure:** names only. No scoring decision was made.

> ⚠️ **The 3.3 working intent quoted above is historical.** It was superseded on 2026-08-23:
> [DL-005](DECISION-LOG.md#dl-005) removed *"without requiring formal authority or people
> management"* from the canonical definition. The row above records what was decided on
> 2026-08-22 and is left unedited as history; for the current definition see
> [3.3](01-construct-registry.md#33--decision-influence), now **LOCKED**.

<a name="d-cr-03"></a>
### D-CR-03 — `Mastery` (4.4) vs `Mastery vs Breadth` (6.1)
One is a motivator, one a growth orientation. Independent, or is one derived from the other?
**Blocks:** DI-03, DI-06.

<a name="d-cr-04"></a>
### D-CR-04 — `Impact` (4.2) vs `Impact Proximity` (4.3)
Is proximity a modifier of Impact, or a construct in its own right that can be measured when
Impact is low?

<a name="d-cr-05"></a>
### D-CR-05 — `Growth Need` (5.5) placement
It sits in family 5 (What You Protect) while family 6 is four growth constructs. Where does
it belong?

<a name="d-cr-06"></a>
### D-CR-06 — Which shape does each construct take? — **narrowed 2026-08-23**
*Originally:* "Are all constructs continua, or are some unipolar?"

**Answered in part: they are NOT all continua, and that is now settled by evidence rather than
suspicion.** The five locked definitions ([DL-005](DECISION-LOG.md#dl-005)—[DL-009](DECISION-LOG.md#dl-009))
cover **three distinct shapes**:

| Shape | Locked examples |
|---|---|
| directional spectrum | [3.1 Outcome Ownership](01-construct-registry.md#31--outcome-ownership) · [5.1 Life Protection](01-construct-registry.md#51--life-protection) |
| independent intensity | [2.4 Create](01-construct-registry.md#24--create) · [3.3 Decision Influence](01-construct-registry.md#33--decision-influence) |
| contextual / conditional | [1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support) |

**Still open:** the shape of the other 39, and whether any construct is **categorical** —
Team Configuration (3.5) and Failure Response (6.4) remain the likeliest candidates and no
locked construct has that shape yet.
**Blocks:** [D-RS-01](#d-rs-01) — the schema must now represent **at least three** shapes, which
is more than it was designed against.

<a name="d-cr-07"></a>
### D-CR-07 — Is 44 the assessed set, or a superset?
44 constructs against a 15–20 minute self-serve target. Is the registry the assessed set, or
a catalogue from which a subset is drawn?
**Related:** D-AA-06.

<a name="d-cr-08"></a>
### D-CR-08 — Family 2 is SIGNAL's sixth work-type vocabulary
`lib/laneTaxonomy.ts` (11 lanes + Other, 49 sub-lanes) · `JobFamily` (18) · `FunctionTag`
(21) · `app/api/_v4/taxonomy.ts` (20 clusters, dormant) · the Positioning prompt's six role
angles — and now family 2's ten. Only lanes↔JobFamily map to each other.
**Recorded in SIGNAL PM** as `CNL R3 — Taxonomy reconciliation decision`. Raised here because
the registry is where the sixth vocabulary gets created.

<a name="d-cr-10"></a>
### D-CR-10 — Is family 2 a set of independent intensities, or a ranked set?
**Raised 2026-08-23 by the first-pass definition review.** Both
[2.2 Analyze](01-construct-registry.md#22--analyze) and
[2.4 Create](01-construct-registry.md#24--create) propose **independent intensity** — the
opposite of *drawn toward* being *not drawn toward*, rather than a positive opposing activity.

That is a **family-level** claim, not a per-construct one. If family 2 is ten independent
intensities, a person can be high on all ten or none. If it is a **ranked set**, they cannot,
and the assessment has to elicit an ordering rather than ten levels. The two designs need
different items and produce different results.
**Narrowed 2026-08-23.** [DL-008](DECISION-LOG.md#dl-008) locked **Create** as an independent
intensity and locked Create and Build as **separate constructs**. That settles one member and
one boundary — it does **not** settle the family. Eight of the ten Work Pull constructs still
carry glosses only, and the ranked-versus-intensity question is a property of the *set*, not of
any member.
**Still open:** is the whole Work Pull family ten independent intensities, or a ranked set?
**Related:** [D-CR-06](#d-cr-06) (per-construct shapes), [D-AA-02](#d-aa-02) (item types).

<a name="d-cr-11"></a>
### D-CR-11 — Five of the twelve priority constructs have no mapped evidence ⚠️
**Raised 2026-08-23.** The first-pass definition review mapped known Assessment v1 evidence to
each of the twelve highest-leverage constructs. **Five came back empty:**

| Construct | Evidence in the reviewed subset |
|---|---|
| [1.2 Outcome Clarity](01-construct-registry.md#12--outcome-clarity) | none |
| [1.7 Experimentation](01-construct-registry.md#17--experimentation) | none — Q68 is [5.4](01-construct-registry.md#54--upside--risk), not this |
| [2.2 Analyze](01-construct-registry.md#22--analyze) | none |
| [2.4 Create](01-construct-registry.md#24--create) | none itemised — [04](04-evidence-and-confidence.md#create--high-confidence-strong-preference-not-need)'s example is explicitly illustrative |
| [3.3 Decision Influence](01-construct-registry.md#33--decision-influence) | none |

Three more are thin: [1.1](01-construct-registry.md#11--guidance--development-support) (one
unnumbered conditional), [1.3](01-construct-registry.md#13--predictability--change) (one
unresolved node), [3.1](01-construct-registry.md#31--outcome-ownership) (one edge).

**This is not proof that Assessment v1 fails to measure them.** The reviewed subset is
**fourteen items** — Q47, Q61–Q72, Q82 — out of an instrument running to at least Q82.
Q1–Q46, Q48–Q60 and Q73–Q81 have not been examined.

**The question:** is this a *review* gap (the evidence exists, we have not looked) or an
*instrument* gap (v1 does not measure these constructs)? The answer changes what
`CNL R0 — Core-question reduction from the current prototype` is actually doing — reduction
assumes the instrument over-covers, and on five of the twelve highest-leverage constructs it
may under-cover instead.

**Narrowed 2026-08-23.** It no longer blocks *semantic* locking. The Definition Review
Standard was split into Gate A (meaning) and Gate B (measurement), and three of the five
constructs named above — Create, Decision Influence, and Guidance / Development Support —
were **locked at Gate A with no mapped evidence**. That is now an explicitly legitimate state.

**What it still blocks — Gate B, and Gate B is not optional.** A semantically locked construct
with no mapped evidence cannot be scored, classified, entered into a DECODED insight, or shown
to a client. This entry now gates the **assessment architecture**, not the definitions.

<a name="d-cr-12"></a>
### D-CR-12 — Six tradeoff outcomes carry no item numbers
**Raised 2026-08-23.** Rows 1–6 of
[11 Table A](11-tradeoff-model.md#table-a--directional-edges-both-participants-known) —
Fit > Prestige · Expertise > Management/Authority · Impact/Meaning > Money · Mastery >
Constant Novelty · Outcome Ownership > Recognition · Life Protection > Accelerated Advancement
— were supplied as outcomes without item numbers, unlike Q47 and Q64–Q66.

They therefore cannot be traced to Assessment v1 questions, which means their **stakes**,
**isolation** and item wording are unrecoverable, and they cannot be re-examined if a
definition changes. Are they from the same instrument? Recoverable? Or do they need re-asking?

<a name="d-cr-13"></a>
### D-CR-13 — How is a conditional construct's conditioning variable detected and represented?
**Raised 2026-08-23 by [DL-009](DECISION-LOG.md#dl-009).**
[1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support)
is the first construct locked as **contextual / conditional**. Its conditionality is approved;
its **conditioning variable is deliberately NOT locked**.

Competence and familiarity are a **strong candidate** — the worked-example form is *higher
developmental support while unfamiliar → less support required after competence develops* —
but the methodology must admit other legitimate conditions (stakes, trust, domain, life stage)
until validated. Locking the variable on one worked example would make every other client's
conditionality invisible.

**Three sub-questions, none decided:**
1. **Detection** — how does the assessment establish *which* variable conditions a person's
   construct? A clarifier is the obvious instrument ([05](05-adaptive-clarifiers.md)), but
   nothing specifies the trigger or the question.
2. **Representation** — how is a conditional construct carried in the frozen artifact? One
   value plus a condition, two values, or a structure? Relates to
   [D-RS-01](#d-rs-01) and [D-TM-05](#d-tm-05), which asks the same question on the tradeoff
   side.
3. **Vocabulary** — is there a closed set of legitimate conditioning variables, or is it open?

**Update 2026-08-23 ([DL-010](DECISION-LOG.md#dl-010)) — still open, now sharper.** The revised
canonical definition writes the condition into the construct itself: *"**especially** while
becoming grounded in unfamiliar work."* The operative word is **especially**, not *only*.

That settles less than it looks like it settles:
- Unfamiliarity is now **the canonical condition** for 1.1 — named in approved text.
- It is **not** established as the only admissible condition, for 1.1 or for any other
  conditional construct. Sub-question 3 is untouched.
- Sub-questions 1 (detection) and 2 (representation) are **entirely untouched**. Naming a
  condition in prose does not specify how it is measured or carried in the artifact.

**Related:** [D-TM-05](#d-tm-05) (conditional *tradeoffs*) · [D-RS-01](#d-rs-01) (score shape)
· [D-AC-01](#d-ac-01) (clarifier triggers).

<a name="d-cr-14"></a>
### D-CR-14 — Benefit versus preference inside Guidance / Development Support
**Raised 2026-08-23 by [DL-010](DECISION-LOG.md#dl-010).**
The revised canonical definition of
[1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support)
names **two things**: a person *"benefits from **and** prefers"* developmental input. DL-009's
definition named only the first. Two questions follow and **neither is decided.**

**(a) Where does the construct's *prefers* end and the tier layer's classification begin?**
[DL-009 lock 2](DECISION-LOG.md#dl-009) put preference-versus-necessity in the
[Needs / Strong Preferences / Flexibility](02-needs-preferences-flexibility.md) layer, on the
grounds that the construct did not carry preference at all. It now does. The working reading —
**stated in the registry, but Claude's reading rather than Peri's decision** — is:

| Layer | Measures |
|---|---|
| The construct | **How much** — benefit and preference together, as one quantity |
| The tier layer | **How tradeable** — need / strong preference / flexible |

That split is coherent, but it is now a boundary held by convention rather than by structure,
and it must be written down somewhere binding before items are authored against it. **Lock 2
stands until Peri says otherwise** — DL-010 did not retract it.

**(b) What happens when benefit and preference diverge?**
The methodology currently has no answer for a person who **benefits substantially but does not
want it** (help lands well; they would rather work it out alone), or the reverse — **wants it
but does not visibly benefit**. Both are ordinary. Three unresolved consequences:
1. **Scoring** — one blended value, or two readings? Relates to [D-RS-01](#d-rs-01).
2. **Assessment** — do items address the halves separately, or is divergence only ever
   inferred? Relates to [D-AC-01](#d-ac-01).
3. **Output** — a divergent person is arguably the most useful thing this construct could
   surface for a coach, and the report has no place to put it.

⚠️ **Interacts with P5.** *Benefits from* is effect language. Items probing the benefit half
must not become competence measures — see the capability boundary note on the construct.

**Related:** [D-NPF-01](#d-npf-01) (tier definitions) · [D-CR-13](#d-cr-13) (the conditional
axis of the same construct) · [D-RS-01](#d-rs-01) · [D-AC-01](#d-ac-01).

<a name="d-cr-09"></a>
### D-CR-09 — Money: the meaning axis
Single-select or multi-select? Ranked? Are `scoreboard · safety · freedom · enjoyment ·
providing for others` exhaustive? Is meaning asked at all when importance is low?

---

## Needs, preferences, flexibility

<a name="d-npf-01"></a>
### D-NPF-01 — Define the three tiers — **narrowed 2026-08-22, still open**
Definitions, and the test a coach applies to place an item in one.

**Progress:** [11 §6](11-tradeoff-model.md#6--connection-to-needs--preferences--flexibility)
supplies the first concrete **pathway** — six conditions that must all hold before *tradeoff
evidence* can qualify a factor as a Need, plus working senses for Strong Preference and
Flexible / Range.

**New requirement, 2026-08-23.** [DL-009](DECISION-LOG.md#dl-009) locked that **preference
versus necessity is a classification, not a construct** — the distinction between *wanting*
developmental support and *requiring* it was deliberately kept out of
[1.1](01-construct-registry.md#11--guidance--development-support) and assigned to this layer
instead. This layer must therefore be able to carry that distinction **for a conditional
construct**, where the answer may differ by condition. That is a constraint on the tier design,
not a definition of it.

**Still open:** the tier **definitions** themselves (the pathway is a test, not a
definition); the numeric thresholds inside the pathway ([D-TM-02](#d-tm-02),
[D-TM-03](#d-tm-03), [D-TM-07](#d-tm-07)); and every **non-tradeoff pathway** — a factor may
reach Need status on evidence that never went through a forced choice.
**Blocks:** R1, R2, R5, R9 per SIGNAL PM.
**Related:** [D-NPF-08](#d-npf-08) — the framework may have four states, not three.

<a name="d-npf-02"></a>
### D-NPF-02 — Derived, asked, or both?
Is a tier derived from a construct score, asked directly, or both? A high score is not the
same as a need.

<a name="d-npf-03"></a>
### D-NPF-03 — Does every construct get a tier?
44 tiering questions will not fit the length budget.

<a name="d-npf-04"></a>
### D-NPF-04 — Is there a cap on needs?
If everything is a need, nothing is. Cap enforced, advisory, or absent?

<a name="d-npf-05"></a>
### D-NPF-05 — Who may revise a tier, and what does revision produce?
Client, coach, or both. Does a revision create a new artifact version or sit alongside the
frozen one?

<a name="d-npf-06"></a>
### D-NPF-06 — Are tiers inside the frozen artifact?
A need like "must stay in Boston" is a practical constraint, not a discovered trait — and
Stage 1 may not know it. Stage 1 output or Stage 2 context?
**Blocks:** D-RS-01 field groups.

<a name="d-npf-07"></a>
### D-NPF-07 — Relationship to the existing `ProfileConstraints` ⚠️
SIGNAL already has nine binary constraint booleans, regex-derived from intake prose, gating
live JobFit decisions. Supersede, wrap, or coexist? Touching them touches the deterministic
scoring path.


<a name="d-npf-08"></a>
### D-NPF-08 — Is UNRESOLVED a fourth tier, and what is tier 3 called?
**Raised 2026-08-22 by [11](11-tradeoff-model.md).** The tradeoff model classifies into
**Need / Strong Preference / Flexible-Range / UNRESOLVED**. This framework defines **three**
tiers and calls the third Flexibility.

Is UNRESOLVED a fourth tier, or the absence of a classification? And which naming stands —
Flexibility, or Flexible / Range? The answer changes the shape of this framework, and every
downstream consumer named in [02](02-needs-preferences-flexibility.md) reads it.

---

## Assessment architecture

<a name="d-aa-01"></a>
### D-AA-01 — Coached-session completion target
Self-serve is fixed at ~15–20 min typical / 25 max. The coached-session target is unset.
**Recorded in SIGNAL PM** on `CNL R0 — Completion-time targets`.

<a name="d-aa-02"></a>
### D-AA-02 — The fixed set of item types
Scoring, confidence and clarifiers all depend on it.

<a name="d-aa-03"></a>
### D-AA-03 — Sequencing
Fixed family order? Do early responses reorder later items? Long-form front-loaded or held
back?

<a name="d-aa-04"></a>
### D-AA-04 — Confirm: below-threshold cannot freeze
Follows from P8 and the confidence methodology. Stated for confirmation, not assumed.

<a name="d-aa-05"></a>
### D-AA-05 — Session expiry on resume
Is a session resumed after a long gap still the same session?

<a name="d-aa-06"></a>
### D-AA-06 — Assessed subset
See D-CR-07.

<a name="d-aa-07"></a>
### D-AA-07 — Coached vs self-serve difference
Different **content**, or only different **length and support**?

---

## Evidence and confidence

<a name="d-ec-01"></a>
### D-EC-01 — What is an evidence unit?
One response, one item, or one construct-scoped signal?

<a name="d-ec-02"></a>
### D-EC-02 — Do evidence types carry formal weights? — **restated 2026-08-23**
*Originally:* "Do item types carry different evidential weight? A forced choice and a Likert
are not equal."

[04 §Independence](04-evidence-and-confidence.md#3--independence) now names six **evidence
types** — baseline preference · behavioral scenario · tradeoff · real-life self-report ·
invariance probe · adaptive clarifier — and establishes that repeated versions of the same
question are not fully independent. It does **not** say whether the types carry *formal
weights* or are merely counted for diversity.
**Related:** [D-AA-02](#d-aa-02) — evidence types and item types may be one taxonomy under two
names.

<a name="d-ec-03"></a>
### D-EC-03 — Can one response feed multiple constructs?
And is long-form verbatim evidence, or only colour?
**Distinct from** [D-EC-15](#d-ec-15), which asks whether one response can supply multiple
*independent* signals for the Independence dimension. This one is about breadth across
constructs; that one is about independence within one.

<a name="d-ec-04"></a>
### D-EC-04 — How do the five dimensions combine into a C-state? — **restated 2026-08-23**
*Originally:* "The confidence computation — how coverage and consistency combine."

Superseded in scope: [04](04-evidence-and-confidence.md) now specifies **five** dimensions
(Coverage, Consistency, Independence, Consequence, Resolution), not two. The combination
function is still undefined — is it conjunctive (all must clear a bar), weighted, lexical, or
a lookup table?
**Distinct from** [D-EC-12](#d-ec-12), which asks for the per-state *thresholds*; this asks
for the *function*. Both are needed.
**Blocks R1** — the runtime cannot be built without it.

<a name="d-ec-05"></a>
### D-EC-05 — Is there a numeric substrate beneath the C-states? — **narrowed 2026-08-23**
*Originally:* "Continuous or banded?"

**Banded is decided** — [04](04-evidence-and-confidence.md) defines four internal states
C0–C3, and states plainly that confidence is *not* a single percentage. What remains open is
whether a numeric value is computed *underneath* those bands (for ordering, for thresholds,
for tie-breaks) or whether the categories are the whole representation.

<a name="d-ec-06"></a>
### D-EC-06 — Uniform or per-construct thresholds?
Does every construct clear the same bar for C2 / C3, or do some require more?
**Related:** [D-EC-14](#d-ec-14) (required evidence *types* per construct) and
[D-EC-18](#d-ec-18) (family-specific sufficiency minimums).

<a name="d-ec-07"></a>
### D-EC-07 — Overall artifact confidence
Derived from per-construct, or measured separately?
**Now framed by** [04 §Assessment Sufficiency](04-evidence-and-confidence.md#3--assessment-sufficiency),
which is explicitly *not* "all constructs reach C3." Whether sufficiency and artifact
confidence are the same object is part of this entry.

<a name="d-ec-08"></a>
### D-EC-08 — Is confidence ever shown directly to the client?
Or to the coach only? [04](04-evidence-and-confidence.md) states the C0–C3 states are
**internal**; whether any of them surfaces is undecided.

<a name="d-ec-09"></a>
### D-EC-09 — Contradiction detection rules
Within a construct, across constructs, across families, and tradeoff-graph cycles — which are
detected? See [04 §Contradiction detection](04-evidence-and-confidence.md#contradiction-detection).

<a name="d-ec-10"></a>
### D-EC-10 — Confidence vs intensity — ✅ CLOSED 2026-08-23
*Originally:* "A person can be confidently measured as moderate. Certainty and strength must
not share a number. Confirm they are separate fields."

**Confirmed** ([DL-004](DECISION-LOG.md#dl-004)) by
[Rule B](04-evidence-and-confidence.md#b--confidence-is-about-the-interpretation-only) —
*confidence measures confidence in the interpretation, not desirability, importance,
capability, career fit, or strength* — and by the
[confidence-is-not-classification](04-evidence-and-confidence.md#confidence-is-not-classification)
section, which states that confidence level does **not** determine classification
automatically.

**Scope of the closure:** the methodology separation only. Whether they are separate *fields*
in the frozen artifact is a schema question and stays with
[D-RS-01](#d-rs-01) / [D-RS-03](#d-rs-03) in [07](07-result-schema.md).

<a name="d-ec-11"></a>
### D-EC-11 — Does Stage 2 validation create a separate confidence layer?
It may not overwrite the frozen one (**P11**). Separate structure, or nothing?

**Now load-bearing.**
[Rule D](04-evidence-and-confidence.md#d--stage-2-context-cannot-retroactively-inflate-stage-1-confidence)
states that contextual resume and coach evidence introduced after the freeze **cannot
retroactively inflate Stage 1 construct confidence** unless such a layer is explicitly
defined — and none is. Until this closes, Stage 2 evidence may test, explain, contradict or
corroborate a frozen reading, but may not raise its confidence number.
**Related:** [D-CB-02](#d-cb-02).

<a name="d-ec-12"></a>
### D-EC-12 — Exact minimum evidence required for C1 / C2 / C3 ⚠️
**Raised 2026-08-23.** The four states are defined by what they *permit*, not by what they
*require*. How much Coverage, which Independence spread, and whether Consequence is mandatory
for C3 are all unset.
**Blocks:** any assignment of a C-state, and therefore every downstream permission that keys
on one. The worked examples in [04](04-evidence-and-confidence.md#worked-examples--maleri)
label reads "provisional" for exactly this reason.

<a name="d-ec-13"></a>
### D-EC-13 — Exact clarifier trigger threshold
At what point does an ambiguity become worth a clarifier? The
[marginal-value test](04-evidence-and-confidence.md#the-marginal-information-value-test) gives
the *question*; the threshold is unset.
**Related:** [D-AC-01](#d-ac-01) (which conditions fire a clarifier),
[D-AC-04](#d-ac-04) (the ceiling), [D-EC-19](#d-ec-19) (how marginal value is computed).

<a name="d-ec-14"></a>
### D-EC-14 — Do specific constructs require specific evidence types?
Some constructs may be unmeasurable from baseline preference alone — a motivator's *meaning*
axis may need long-form, a conditional may need an invariance probe. Is that a formal
requirement per construct, or a design guideline?
**Related:** [D-EC-06](#d-ec-06), [D-CR-09](#d-cr-09).

<a name="d-ec-15"></a>
### D-EC-15 — Can one open-ended response provide multiple independent signals?
A long-form answer may touch several constructs and several evidence types at once. Does that
count as independent evidence, or as one signal with breadth? Counting it as several would
let a single articulate paragraph manufacture Independence.
**Distinct from** [D-EC-03](#d-ec-03).

<a name="d-ec-16"></a>
### D-EC-16 — How does client disagreement affect construct confidence?
A client rating an insight "Missed" is information (**P2**) and cannot mutate the frozen
artifact (**P11**). Does it lower the construct's confidence, sit beside it, or neither?
**Related:** [D-VW-01](#d-vw-01) — whether a disputed insight affects downstream trajectory.

<a name="d-ec-17"></a>
### D-EC-17 — How do coach edits and review affect confidence?
A coach editing a generated interpretation is a validation signal
([08](08-validation-framework.md)). Is it also a confidence signal — and in which direction?
An edit could mean the interpretation was wrong (lower) or that it is now better grounded
(higher). Both readings are live.

<a name="d-ec-18"></a>
### D-EC-18 — Does Assessment Sufficiency use family-specific minimums?
Sufficiency asks whether "required construct-family coverage is adequate." Do the six families
carry different bars — and is any family mandatory?

<a name="d-ec-19"></a>
### D-EC-19 — How is Marginal Information Value operationalised?
The [test](04-evidence-and-confidence.md#the-marginal-information-value-test) asks whether an
answer *could materially change* a prominent result. Computing that before asking requires
knowing what the answer might be. Is it estimated, bounded, heuristic, or approximated by the
C-state of the affected construct?
**Blocks:** stopping-rule condition 3.

---

## Adaptive clarifiers

<a name="d-ac-01"></a>
### D-AC-01 — Which deterministic conditions trigger a clarifier?

<a name="d-ac-02"></a>
### D-AC-02 — May a decoded insight's evidence shortfall trigger a clarifier?
Probably no — it inverts P10 by letting insights drive the assessment. Recorded because it
is tempting.

<a name="d-ac-03"></a>
### D-AC-03 — Fixed bank or constrained generation? ⚠️
The load-bearing clarifier decision. A bank is auditable and free; generation adapts better
and risks leading the client or leaking context. The two need different infrastructure.
**Blocks R1 engineering.** **Recorded in SIGNAL PM** on
`CNL R0 — Adaptive clarification rules`.

<a name="d-ac-04"></a>
### D-AC-04 — The ceiling
Per session, and per construct.

<a name="d-ac-05"></a>
### D-AC-05 — Confirm: ceiling reached with contradiction unresolved
P9 implies low confidence with the contradiction visible. Confirm.

---

## Decoded insights

<a name="d-di-01"></a>
### D-DI-01 — Fixed registry or runtime generation?
Same auditability tradeoff as D-AC-03.

<a name="d-di-02"></a>
### D-DI-02 — Does the coach see near-miss insights?

<a name="d-di-03"></a>
### D-DI-03 — DI-06: what does "autonomy/support evidence" resolve to?
Construct 1.1, 4.8, or both.

<a name="d-di-04"></a>
### D-DI-04 — Minimum and maximum insights per artifact
Zero must be a valid outcome. Is it?

<a name="d-di-05"></a>
### D-DI-05 — Are the six candidates the complete set?

<a name="d-di-06"></a>
### D-DI-06 — May two insights share an input, and may they contradict?

<a name="d-di-07"></a>
### D-DI-07 — Do decoded insights feed Stage 2 and 3, or are they presentation-only?
Career Trajectory reading a decoded insight would make it a de-facto trait, which P10
forbids.

<a name="d-di-08"></a>
### D-DI-08 — DI-02: is Formal Leadership a genuine third input? — **narrowed 2026-08-23**
*Originally (2026-08-22):* 3.3 Decision Influence was defined as shaping consequential
decisions *without requiring formal authority*, which made low 3.2 close to implied by high
3.3 — and therefore possibly a redundant input rather than a third one.

**The premise is gone.** [DL-005](DECISION-LOG.md#dl-005) removed *"without requiring formal
authority or people management"* from the canonical definition of
[3.3](01-construct-registry.md#33--decision-influence). That clause described the
*relationship* between two constructs, not a property of one. The two are now formally
**independent**: a person can be high on both, high on one, or low on both.

**What remains open — the DECODED-input question only:** is
[3.2 Formal Leadership](01-construct-registry.md#32--formal-leadership) a **necessary**
input to [DI-02](06-decoded-insights.md#di-02), or does the insight hold on Outcome Ownership
× Decision Influence alone?

⚠️ With the entanglement removed, low Formal Leadership is now a **genuine independent claim**
about the person rather than a near-tautology — which makes the case for keeping it *stronger*
than when this entry was raised. **It must not be silently dropped as an input.** Removing it
requires its own approved DECODED decision.

<a name="d-di-09"></a>
### D-DI-09 — If Motivator Ownership is derived, does it become a decoded insight?
**Raised 2026-08-22.** Outcome 2 of [D-CR-01](#d-cr-01) makes 4.11 a derived reading of
Outcome Ownership × Achievement × Freedom. That is the definition of a decoded insight. Does
it move into [06](06-decoded-insights.md) as DI-07, and does it need a headline phrasing?
**Blocked on:** [D-CR-01](#d-cr-01).

---

## Result schema

<a name="d-rs-01"></a>
### D-RS-01 — Score shape
Scalar, band, pole-plus-intensity, or per-construct? **Blocked on D-CR-06.**

<a name="d-rs-02"></a>
### D-RS-02 — Provenance shape
Response ids, item ids, verbatim spans, or a mix. Verbatim spans are strongest and most
privacy-sensitive.

<a name="d-rs-03"></a>
### D-RS-03 — All assessed constructs, or only those that reached confidence?

<a name="d-rs-04"></a>
### D-RS-04 — Does the artifact carry client-facing prose, or only structure?
Prose in the artifact is immutable and reviewable; prose at render time is re-styleable.

<a name="d-rs-05"></a>
### D-RS-05 — Growth-edge and tradeoff structures ⚠️
**Blocked on two methodology documents that do not exist yet** — Growth Edge methodology and
Tradeoff model. Both are separate R0 items in SIGNAL PM. The motivator model and the two
dimension models are in the same position.

<a name="d-rs-06"></a>
### D-RS-06 — Where do client reactions and disputes live?
P11 forbids mutating the artifact, so they need their own home.

<a name="d-rs-07"></a>
### D-RS-07 — Where do coach edits live?
Same constraint; the original generated text must stay readable.

<a name="d-rs-08"></a>
### D-RS-08 — Does Stage 2 validation write a second structure?
See D-EC-11.

---

## Validation

<a name="d-vf-01"></a>
### D-VF-01 — Accuracy bar and sample size for the pre-R2 gate
Both unset. **Recorded in SIGNAL PM** on
`CNL R2 — Methodology validation review (pre-R2 gate)`.

<a name="d-vf-02"></a>
### D-VF-02 — How is Barnum-effect risk tested?
Without a specificity check, high client agreement proves nothing.

<a name="d-vf-03"></a>
### D-VF-03 — How is coach accuracy reaction captured?
Approve / regenerate / edit is a workflow action, not a rating.

<a name="d-vf-04"></a>
### D-VF-04 — Is third-party recognition captured in R1, or aspirational?

<a name="d-vf-05"></a>
### D-VF-05 — Test–retest expectation
If the same client retook in three months, how much should the result move — and is movement
failure or life?

<a name="d-vf-06"></a>
### D-VF-06 — What is the falsification condition?
What result would tell us the methodology is **wrong**, rather than needing tuning? A
validation framework without one validates nothing.

<a name="d-vw-01"></a>
### D-VW-01 — Does a disputed insight affect downstream trajectory?
A "Missed" reaction on an insight: suppress it from R2 inputs, flag it, or do nothing? This
is where validation and P2 are in real tension. **Recorded in SIGNAL PM** on
`CNL R0 — Client validation and reaction workflow`.

---

## Context boundary

<a name="d-cb-01"></a>
### D-CB-01 — Is Stage 2 a distinct step with its own artifact?
Or a property of how Stage 3 reads context? Today it is described as a stage with no output
of its own.

<a name="d-cb-02"></a>
### D-CB-02 — Does Stage 2 produce a second confidence reading?
See D-EC-11.

<a name="d-cb-03"></a>
### D-CB-03 — May a coach see the resume while reviewing the DNA result? ⚠️
Review is post-freeze, so it is Stage 2 — but a coach reading them side by side may edit
toward the resume. That is the Stage 2 prohibition committed by a human rather than by code.

<a name="d-cb-04"></a>
### D-CB-04 — What happens on retake? ⚠️
A second assessment is Stage 1 again — but the client has seen their first result and their
paths. Is a retake blind in any meaningful sense? Cooling period?

<a name="d-cb-05"></a>
### D-CB-05 — May Stage 2 findings feed a future Stage 1 retake?
P1 says no. Confirm.

---

## Tradeoff model

<a name="d-tm-01"></a>
### D-TM-01 — What qualifies as low / moderate / high stakes?
Stakes is a property of the scenario, not the participants. Working senses are in
[11 §3](11-tradeoff-model.md#3--stakes); the boundaries are unset.

<a name="d-tm-02"></a>
### D-TM-02 — How many independent tradeoff wins contribute to Need-level evidence?
"Repeatedly protected across materially different tradeoffs" needs a number, or an explicit
statement that it is a judgement rather than a count.

<a name="d-tm-03"></a>
### D-TM-03 — Should opponent diversity matter formally?
Three wins over three opponents is stronger evidence than three over one
([11 §4](11-tradeoff-model.md#4--consistency)). Is that a formal requirement or a weighting?

<a name="d-tm-04"></a>
### D-TM-04 — How should confounded tradeoffs be weighted?
A bundled side ("Impact / Meaning vs Money") tells you the bundle won, not which half. Not
discarded — weighted lower. How much lower?

<a name="d-tm-05"></a>
### D-TM-05 — How should conditional tradeoffs be represented?
One record with a condition, two records, or something else. Averaging is forbidden
([11 §5](11-tradeoff-model.md#5--conditionality), **P9**).
**Blocks:** the Tradeoffs field group in [07](07-result-schema.md).

<a name="d-tm-06"></a>
### D-TM-06 — Numeric edge weights, or evidence categories only?
A weight invites the tally the model forbids; a category may be too coarse to combine.
**Blocks:** the Tradeoffs field group in [07](07-result-schema.md).

<a name="d-tm-07"></a>
### D-TM-07 — Can one very high-stakes tradeoff outweigh several low-stakes wins?
If yes, the graph is not countable at all. If no, stakes is only a tie-breaker.

<a name="d-tm-08"></a>
### D-TM-08 — Maximum tradeoff questions in Assessment v2 before fatigue?
Repeated forced choices create fatigue **and artificial certainty** — a person pressed for
the twentieth time answers a pattern, not a question. The cap sits inside the length budget
in [03](03-assessment-architecture.md).

<a name="d-tm-09"></a>
### D-TM-09 — Node vocabulary: are non-construct outcomes legitimate graph nodes? ⚠️
**Raised 2026-08-22 while writing [11](11-tradeoff-model.md).** The example tradeoffs use
`Fit`, `Advancement`, `Novelty`, `Expertise`, `Certainty` and `Compensation upside` — none of
which is a construct in the [registry](01-construct-registry.md). `Compensation upside` is
itself a bundled node (Money × Upside/Risk), so the isolation rule applies to nodes and not
only to sides.

Either non-construct outcomes are legitimate nodes with a defined relationship to the
registry, or every tradeoff must be expressed in registry constructs. Both are viable; a
graph that is half one and half the other is not.
**Blocks:** any formal reading of the graph. See the mapping table in
[11 §2](11-tradeoff-model.md#node-vocabulary--an-unresolved-gap).

<a name="d-tm-10"></a>
### D-TM-10 — Two senses of "tradeoff": one document or two? ⚠️
**Raised 2026-08-22.** The R0 item `CNL R0 — Tradeoff model` was written around
**tradeoff-as-output** — "your strength X carries cost Y", stated as a pair, never as a
deficiency (**P4**), reusable by R2 and R9. [11](11-tradeoff-model.md) specifies
**tradeoff-as-evidence** — a forced choice reveals what is protected.

Both are real and they are not the same thing. 11 covers the second fully and the first not
at all.
**Consequence:** `CNL R0 — Tradeoff model` is **not satisfied** by document 11.

<a name="d-tm-11"></a>
### D-TM-11 — Do individual tradeoff records persist into the frozen artifact?
Or only the classification they produced? Persisting them makes provenance inspectable
(**P12**) and makes the artifact much larger. Relates to
[D-RS-02](#d-rs-02) (provenance shape).

<a name="d-tm-12"></a>
### D-TM-12 — Maleri worked example: later motivator / future evidence — ✅ CLOSED 2026-08-22
*Originally:* requested for the worked example; not supplied, and not present in this
repository. Left as a stated gap rather than constructed.

**Closed** ([DL-003](DECISION-LOG.md#dl-003)): Peri supplied the missing evidence on
2026-08-22 — Q47 (Certainty vs Upside, previously an unrecorded result), Q61–Q72, and the Q82
future projection. The worked example in
[11 §7](11-tradeoff-model.md#7--worked-example--maleri) is rebuilt on it.

**Scope of the closure: the missing-evidence gap only.** This entry existed solely because
evidence was absent. Supplying it closes nothing else — no methodology rule changed, no
threshold was set, and the worked example remains a worked example rather than a locked
canonical interpretation. Every other `D-TM` entry stays open.

**Still open and now better evidenced, not resolved:** [D-TM-01](#d-tm-01) (every `Stakes`
cell in the example is still OPEN because the scenarios were not supplied) ·
[D-TM-03](#d-tm-03) (Life Protection's two opponents may not be *materially different*) ·
[D-TM-05](#d-tm-05) (the risk/certainty cluster is now a full-scale instance) ·
[D-TM-09](#d-tm-09) (Certainty, Portable employability and Job security join the unmapped
nodes).

---

## Out of scope for this directory

These are open in SIGNAL PM but are **not** Professional DNA methodology decisions. Listed so
nobody looks for them here:

| SIGNAL PM open decision | Where it lives |
|---|---|
| Whether a single-path trajectory is valid | `CNL R2 — Research: how many paths` |
| Whether the two-persona limit survives four paths | `CNL R4 — Path-specific persona creation` |
| Recurring-gap frequency and sample thresholds | `CNL R7 — Research: what counts as recurring` |
| Whether R8 ships a rendered document format | `CNL R8 — Resume as a rendering of evidence` |
| D2C coached-usage readiness threshold | `CNL D2C — Readiness gate` |
