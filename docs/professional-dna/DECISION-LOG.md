# DECISION LOG — Professional DNA methodology

**Status:** LIVE — append-only
**Methodology version:** v0.8
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23

Every methodology decision Peri has explicitly made, one entry each, newest last. The point
of this file is that a decision can be traced **without reading git history** — what was
decided, when, why, and what it closed.

---

## Rules

1. **Append only.** A superseded decision is not deleted or edited; a later entry supersedes
   it and says so. The record of having changed your mind is part of the record.
2. **One entry per decision**, not per document edit. Editing a file is not a decision.
3. **Only explicit approvals.** "Claude proposed it and nobody objected" is not a decision.
   "It has been in the doc for weeks" is not a decision. An entry requires Peri to have
   actually decided.
4. **Every entry closes something or changes something.** If it closes an
   [OPEN-DECISIONS](OPEN-DECISIONS.md) entry, name the id. If it changes a locked document,
   name the version bump.
5. **A `LOCKED` document must point at the entries that locked it.** No entry, no lock — see
   the five-part test in the [README](README.md#what-locked-means).

---

## Entry format

```
### DL-NNN — YYYY-MM-DD — <short title>

**Decided by:** Peri Ginsberg
**Decision:**   what was decided, in one or two sentences
**Reason:**     why
**Closes:**     OPEN-DECISIONS ids, or "none"
**Documents:**  which canonical documents change, and their new status
**SIGNAL PM:**  which records were updated
**Version:**    methodology version after this decision
**Rescoring:**  REQUIRED / NOT REQUIRED / NOT APPLICABLE — only meaningful after v1.0
```

---

## Decisions

<a name="dl-001"></a>
### DL-001 — 2026-08-22 — Responsibility + People "Ownership" renamed to Outcome Ownership

**Decided by:** Peri Ginsberg
**Decision:** Construct 3.1, in family 3 (Responsibility + People), is renamed from
`Ownership` to **`Outcome Ownership`**. Working intent: *preference for having something
clearly theirs to own, be accountable for, and carry responsibility for.*

Family 4's construct 4.11 `Ownership` is **deliberately not renamed**. It is instead marked
OPEN: determine whether it is a distinct motivator, or should be derived from Outcome
Ownership / Achievement / Freedom.

**Reason:** Two constructs shared the name `Ownership`, which made
[DI-02](06-decoded-insights.md#di-02) unspecifiable and blocked any code keying on a
construct name. Renaming 3.1 removes the collision. Renaming 4.11 as well would have implied
it is a distinct construct that merely needed a better label — and that is the open question,
not the answer.

**Closes:** nothing. [D-CR-01](OPEN-DECISIONS.md#d-cr-01) is **restated and narrowed**, not
closed — the collision half is settled, the survival half is not.

**Documents:** [01-construct-registry.md](01-construct-registry.md) §3.1 renamed, §4.11
marked OPEN with the three live outcomes, registry-wide question table and counts updated ·
[06-decoded-insights.md](06-decoded-insights.md) DI-02 inputs disambiguated ·
[OPEN-DECISIONS.md](OPEN-DECISIONS.md) D-CR-01 restated · this log. **All statuses unchanged
— 01 stays `REVIEW`, 06 stays `DRAFT`.**

**SIGNAL PM:** `CNL R0 — Professional DNA construct model (final)` — rename recorded on the
record. No status change, no acceptance criterion marked satisfied.

**Version:** v0.2
**Rescoring:** NOT APPLICABLE — no client artifact has ever been produced.

**Scope note — what this decision is NOT.** A name. Construct 3.1's `Definition`,
`Measures`, `Does NOT measure`, `Continuum`, `Evidence sources`, `Scoring approach` and
`Confidence requirement` all remain `OPEN`. Nothing is LOCKED. The working intent above is
the *reason for the name*, not an approved definition.

---

<a name="dl-002"></a>
### DL-002 — 2026-08-22 — "Influence" renamed in both families

**Decided by:** Peri Ginsberg
**Decision:** The two constructs named `Influence` are different things and are renamed:

| Was | Now | Working intent |
|---|---|---|
| 2.8, family 2 (What You Like Doing) | **`Persuasion / Influence Work`** | Enjoyment of changing minds, persuading, advocating, selling, or shaping behaviour through communication. |
| 3.3, family 3 (Responsibility + People) | **`Decision Influence`** | Desire to shape consequential decisions and outcomes without requiring formal authority or people management. |

**Reason:** Same collision as DL-001. Here both halves are answerable — one is a work
*activity* the person is pulled toward, the other is a *standing* they want in how decisions
get made. Two constructs, two names.

**Closes:** [D-CR-02](OPEN-DECISIONS.md#d-cr-02). ✅

**Raises:** [D-DI-08](OPEN-DECISIONS.md#d-di-08) — Decision Influence is now defined as
operating *without requiring formal authority*, which makes low Formal Leadership close to
implied, so DI-02's third input may be redundant.

**Documents:** [01-construct-registry.md](01-construct-registry.md) §2.8 and §3.3 renamed,
question table and counts updated · [06-decoded-insights.md](06-decoded-insights.md) DI-02
inputs disambiguated · [OPEN-DECISIONS.md](OPEN-DECISIONS.md) D-CR-02 closed, D-DI-08 and
D-DI-09 raised · this log. **All statuses unchanged.**

**SIGNAL PM:** `CNL R0 — Professional DNA construct model (final)` — renames recorded on the
record. No status change.

**Version:** v0.2
**Rescoring:** NOT APPLICABLE.

**Scope note — what this decision is NOT.** Names only. Both constructs stay `REVIEW`, both
definitions stay `OPEN`, and the boundary *between* them is undefined — it lives in their
does-not-measure fields, which are open. A unique name lets the conversation proceed; it is
not what lets code key on a construct.

---

<a name="dl-003"></a>
### DL-003 — 2026-08-22 — Missing Maleri worked-example evidence supplied

**Decided by:** Peri Ginsberg
**Decision:** Supplied the assessment evidence that
[11 §7](11-tradeoff-model.md#7--worked-example--maleri) had been left incomplete for:

- **Q47** (Certainty vs Upside) — chose *"you know exactly what you'll earn for several
  years."* Previously recorded as a tested pair with an **unrecorded result**; now an edge,
  `Certainty > Upside`.
- **Q61–Q72** — twelve later motivator and tradeoff answers.
- **Q82** — future projection: *"live close to friends, financially comfortable enough to get
  the little things that I enjoy."*

**Reason:** The worked example carried two acknowledged gaps — an unrecorded Q47 result and a
"later motivator / future evidence: NOT SUPPLIED" section. Both were left as stated gaps
rather than constructed, because inventing evidence inside a worked example *about evidence*
would defeat it. Peri supplied the real material.

**Closes:** [D-TM-12](OPEN-DECISIONS.md#d-tm-12). ✅ **Nothing else.**

**Scope — read this before citing DL-003.** This entry closes a **missing-evidence** gap. It
is **not** a methodology decision:

- No methodology rule, threshold or definition changed.
- No factor was classified as a Need. The example walks Life Protection through the six
  conditions and **stops at three unmet or contested**, which is the correct outcome.
- No trait label was derived. Q47 and Q65 are explicitly *not* read as "risk-averse."
- The worked example remains a **worked example**, not a locked canonical interpretation.
- Every other `D-TM` entry remains open; several are now **better evidenced but not
  resolved** — notably [D-TM-05](OPEN-DECISIONS.md#d-tm-05), which the risk/certainty cluster
  turns into a full-scale instance.

**What the evidence changed in the example:** the original reading was strengthened, not
redirected. Meaning gained Q61/Q62/Q69; Life Protection gained an edge over Career Centrality
plus absence-consequence evidence (Q72); the low-external-standing side gained Q67/Q71.
Genuinely new: a four-axis risk/certainty cluster held as **potentially conditional** rather
than averaged, and a **money meaning** reading of enjoyment/comfort rather than scoreboard.

**Also raised, not decided:** Q63 and Q67 are *invariance probes* — they test whether a factor
survives the removal of something else. That is not among the candidate item types in
[03](03-assessment-architecture.md). Recorded as an observation for
[D-AA-02](OPEN-DECISIONS.md#d-aa-02); not added to the list.

**Documents:** [11](11-tradeoff-model.md) §7 rebuilt (Tables A/B/C, money meaning, risk
cluster, Need-pathway walkthrough) · [OPEN-DECISIONS.md](OPEN-DECISIONS.md) D-TM-12 closed and
counts re-derived · [10-version-history.md](10-version-history.md) v0.4 · this log. **All
statuses unchanged — 11 stays `REVIEW`, nothing LOCKED.**

**SIGNAL PM:** `CNL R0 — Tradeoff model` — evidence-supply note appended; still `backlog`,
still not satisfied. GO / NO-GO gate register counts refreshed.

**Version:** v0.4
**Rescoring:** NOT APPLICABLE — no client artifact has ever been produced.

---

<a name="dl-004"></a>
### DL-004 — 2026-08-23 — Confidence is separate from classification

**Decided by:** Peri Ginsberg
**Decision:** Confidence and classification answer different questions and are never merged.
**Confidence** answers *how sure are we about the interpretation?* **Classification** answers
*how important / protected / flexible is the condition?* A confidence level does **not**
determine a classification automatically.

Stated canonically as
[Rule B](04-evidence-and-confidence.md#b--confidence-is-about-the-interpretation-only):
confidence measures confidence in the interpretation — not desirability, importance,
capability, career fit, or strength.

**Reason:** [D-EC-10](OPEN-DECISIONS.md#d-ec-10) asked for exactly this confirmation — *"a
person can be confidently measured as moderate; certainty and strength must not share a
number."* Supplying Rule B and the confidence-is-not-classification section answers it.

**Closes:** [D-EC-10](OPEN-DECISIONS.md#d-ec-10). ✅ **Nothing else.**

**Scope — read this before citing DL-004.** This closes **one** entry. The confidence
methodology delivered on the same day is far larger and is **not** approved: document
[04](04-evidence-and-confidence.md) is `REVIEW`, not `LOCKED`, and **every threshold in it is
`OPEN`**. In particular:

- The C0–C3 states are defined by what they *permit*, not by what they *require*
  ([D-EC-12](OPEN-DECISIONS.md#d-ec-12)).
- How the five dimensions combine into one state is undefined
  ([D-EC-04](OPEN-DECISIONS.md#d-ec-04)).
- Eight new entries were raised the same day, not closed.

The closure covers the **methodology separation** only. Whether confidence and magnitude are
separate *fields in the frozen artifact* remains a schema question in
[07](07-result-schema.md) ([D-RS-01](OPEN-DECISIONS.md#d-rs-01),
[D-RS-03](OPEN-DECISIONS.md#d-rs-03)).

**Documents:** [04](04-evidence-and-confidence.md) rewritten, status `DRAFT` → **`REVIEW`** ·
[OPEN-DECISIONS.md](OPEN-DECISIONS.md) D-EC-10 closed, D-EC-02/04/05/11 restated, D-EC-12…19
added, counts re-derived · cross-links updated in
[02](02-needs-preferences-flexibility.md), [03](03-assessment-architecture.md),
[05](05-adaptive-clarifiers.md), [06](06-decoded-insights.md), [07](07-result-schema.md),
[08](08-validation-framework.md), [11](11-tradeoff-model.md), [README](README.md) ·
[10-version-history.md](10-version-history.md) v0.5 · this log.
**No other status changed. Nothing LOCKED.**

**SIGNAL PM:** `CNL R0 — Confidence methodology` — canonical path recorded, summary appended,
still `backlog`, acceptance criteria **not** marked satisfied. GO / NO-GO gate register counts
re-derived.

**Version:** v0.5
**Rescoring:** NOT APPLICABLE — no client artifact has ever been produced.

---

> ## 🔒 DL-005 – DL-009 — the first construct-definition LOCK
>
> **2026-08-23.** Peri explicitly approved five construct definitions. These are the first
> `LOCKED` definitions in the registry.
>
> **What this does NOT do:** the registry document stays `REVIEW`, 39 of 44 constructs remain
> unlocked, no construct has passed **Gate B** (measurement sufficiency), and R1 remains
> blocked. A locked definition says what a construct *means* — not that it can be scored,
> classified, or shown to a client. See the
> [Definition Review Standard](01-construct-registry.md#definition-review-standard).

<a name="dl-005"></a>
### DL-005 — 2026-08-23 — Decision Influence: definition, shape, and independence from Formal Leadership

**Approval source:** Peri, explicit approval.
**Construct:** [3.3 Decision Influence](01-construct-registry.md#33--decision-influence).

**Approved definition** — *canonical:*
> The degree to which a person wants to shape consequential decisions and outcomes.

**Approved shape:** **independent intensity.**

**Boundary decisions resolved**
- **Removed** *"without requiring formal authority or people management"* from the canonical
  definition. That clause described the **relationship** between Decision Influence and
  [3.2 Formal Leadership](01-construct-registry.md#32--formal-leadership); it was never a
  property of this construct. A definition that describes a neighbour is not a definition.
- **The two constructs are independent.** A person may be high on both, high on one and low on
  the other, or low on both. **Decision Influence is not the opposite of Formal Leadership**
  and must never be rendered as the individual-contributor pole of a management axis.
- **Preserved as exclusions:** Formal Leadership · Persuasion / Influence Work · Outcome
  Ownership · Recognition.

**Decisions intentionally left open**
- [D-DI-08](OPEN-DECISIONS.md#d-di-08) — **narrowed, not closed.** Its premise is gone, but the
  DECODED question remains: is 3.2 a *necessary* input to
  [DI-02](06-decoded-insights.md#di-02)? ⚠️ With the entanglement removed, low Formal
  Leadership is now a **genuine independent claim** rather than near-tautological, which
  strengthens the case for keeping it. **Do not silently remove it as an input.**
- **Gate B** — no mapped v1 evidence ([D-CR-11](OPEN-DECISIONS.md#d-cr-11)). Cannot be scored.
- Whether items can separate *standing* from *activity* in practice.

**Downstream methodology potentially affected:** [DI-02](06-decoded-insights.md#di-02) inputs ·
[06](06-decoded-insights.md) · [D-CR-06](OPEN-DECISIONS.md#d-cr-06) shape evidence ·
[D-RS-01](OPEN-DECISIONS.md#d-rs-01) score shape.

**Version:** v0.7 · **Rescoring:** NOT APPLICABLE — no client artifact has ever been produced.

---

<a name="dl-006"></a>
### DL-006 — 2026-08-23 — Life Protection: definition, shape, and separation from Career Centrality

**Approval source:** Peri, explicit approval.
**Construct:** [5.1 Life Protection](01-construct-registry.md#51--life-protection).

**Approved definition** — *canonical, unchanged from the proposal:*
> How firmly a person defends time, energy and attention outside work — the boundary they hold
> between the job and the rest of their life. It measures the strength of the boundary, not the
> size of the ambition inside it.

**Approved shape:** **directional spectrum.**

**Boundary decisions resolved**
- **Life Protection and [5.2 Career Centrality](01-construct-registry.md#52--career-centrality)
  are separate constructs.** The "may be one axis, one is redundant" reading is **retired**.
  They answer different questions: *what work is allowed to consume* versus *how much
  work/career becomes part of self-definition*.
- **Both cross-cases must remain expressible:** deep career identity **with** firm life
  boundaries; low career centrality **with** very permeable boundaries.
- **P4 protection locked.** High Life Protection does **not** mean laziness, low ambition, low
  achievement orientation, or low work capacity. Text that renders the boundary as a
  limitation is a **validation failure**, not a style preference.

**Decisions intentionally left open**
- ⚠️ **Maleri's Life Protection is NOT classified as a Need**, and this lock does not change
  that. Need classification is governed by the separate evidence and confidence methodology;
  the six-criterion walkthrough in [11](11-tradeoff-model.md#applying-the-need-pathway--and-stopping-short)
  still stops at three unmet or contested.
- [D-TM-03](OPEN-DECISIONS.md#d-tm-03) — **remains OPEN.** Opponent diversity is a
  *tradeoff-evidence* question, not a construct-definition question, and is untouched.
- Whether the boundary is fixed or negotiable under conditions.

**Downstream methodology potentially affected:**
[02](02-needs-preferences-flexibility.md) · [DI-05](06-decoded-insights.md#di-05) ·
[04's worked example](04-evidence-and-confidence.md#life-protection--strong-evidence-still-not-a-need) ·
Career Trajectory lifestyle fit · Lanes research criteria · Offer Decision.

**Version:** v0.7 · **Rescoring:** NOT APPLICABLE.

---

<a name="dl-007"></a>
### DL-007 — 2026-08-23 — Outcome Ownership: definition and shape

**Approval source:** Peri, explicit approval.
**Construct:** [3.1 Outcome Ownership](01-construct-registry.md#31--outcome-ownership).

**Approved definition** — *canonical, unchanged from the proposal:*
> Preference for having something clearly theirs to own, be accountable for, and carry
> responsibility for. It measures the desire to be the person answerable for a result —
> independent of any title, any authority over people, and any financial stake in the outcome.

**Approved shape:** **directional spectrum.**
**Poles:** *clear individual accountability* ↔ *shared / collective accountability*.
**Neither pole is superior** — preferring shared accountability is a working style, not an
avoidance (**P4**).

**Boundary decisions resolved**
- Distinctions preserved from: [3.2 Formal Leadership](01-construct-registry.md#32--formal-leadership) ·
  [3.3 Decision Influence](01-construct-registry.md#33--decision-influence) ·
  [4.11 Motivator Ownership](01-construct-registry.md#411--ownership) · the résumé
  `verbClass: "ownership"` classification.

**Decisions intentionally left open**
- ⚠️ **The `resumeExtraction.ts` terminology collision remains an engineering / data-model
  issue and is NOT closed by this lock.** `app/api/jobfit/resumeExtraction.ts:14` calls its
  evidence classification `ownership`. Locking the *semantic* definition of the construct does
  not resolve a shared name in the codebase and must not be read as having done so.
- [D-CR-01](OPEN-DECISIONS.md#d-cr-01) — **remains OPEN.** Peri has **not** decided whether
  Motivator Ownership survives as a separate construct. If it is found to be *derived*,
  whether its stake-reading folds into this construct is still undecided.
- **Gate B** — one unnumbered signal only; Sparse coverage, provisionally C1.

**Downstream methodology potentially affected:** [DI-02](06-decoded-insights.md#di-02) ·
family-4 membership via D-CR-01 · Path Positioning · DNA Watchpoints · Offer Decision ·
**and the JobFit résumé-extraction code path, which is not a methodology surface.**

**Version:** v0.7 · **Rescoring:** NOT APPLICABLE.

---

<a name="dl-008"></a>
### DL-008 — 2026-08-23 — Create: definition, shape, and separation from Build

**Approval source:** Peri, explicit approval.
**Construct:** [2.4 Create](01-construct-registry.md#24--create).

**Approved definition** — *canonical, unchanged from the proposal:*
> Pull toward originating something that did not exist — generating the idea, the concept or
> the piece of work itself. It measures the draw toward the act of origination, not skill at
> it, and not the making-it-work that follows.

**Approved shape:** **independent intensity.**

**Boundary decisions resolved**
- **Create and [2.5 Build](01-construct-registry.md#25--build) are separate constructs.** The
  "one construct with two phases" reading is retired.
- **Rationale:** someone may strongly enjoy origination while disliking implementation; someone
  else may strongly enjoy making ideas functional with little interest in originating them;
  **and both pulls can be high.** A merged construct could express none of the three.
- Distinctions preserved from: Build · Solve · Experimentation · creative capability (**P5**).

**Decisions intentionally left open**
- [D-CR-10](OPEN-DECISIONS.md#d-cr-10) — **narrowed, not closed.** This approval establishes
  only that *Create* is an independent intensity and that Create/Build are separate. Whether
  the **whole Work Pull family** is ten independent intensities or a ranked set is still open,
  and the two designs need different assessment items.
- ⚠️ **Build itself still carries only a gloss.** The boundary is locked from one side.
- **Gate B** — no itemised v1 evidence.

**Downstream methodology potentially affected:** [DI-01](06-decoded-insights.md#di-01) ·
[DI-03](06-decoded-insights.md#di-03) · family-2 architecture · Path Positioning ·
Decoder personalized overlay.

**Version:** v0.7 · **Rescoring:** NOT APPLICABLE.

---

<a name="dl-009"></a>
### DL-009 — 2026-08-23 — Guidance / Development Support: revised definition, shape, and five methodological locks

> ### ⛔ THE DEFINITION IN THIS ENTRY IS SUPERSEDED
>
> **[DL-010](#dl-010) replaced the canonical definition on 2026-08-23.** Do not cite the
> definition below as current. **The five locks in this entry still stand** — DL-010 refined
> lock 5 and put lock 2 under strain, but retracted neither.
>
> *(Pointer added when DL-010 was written. Per rule 1 nothing in this entry has been edited or
> deleted — the banner sits above the record, it does not alter it.)*

**Approval source:** Peri, explicit approval **with revision**.
**Construct:** [1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support).

**Approved definition** — *canonical, **revised on approval**:*
> The degree to which active developmental input — teaching, coaching, correction and access
> to a more experienced person — improves a person's ability to become effective and confident
> in unfamiliar work.

⚠️ **This is a reframing, not a wording change.** The proposal measured **desire** ("the degree
to which a person *wants* active developmental input"); the approved definition measures
**effect** (how much it *improves* their ability to become effective and confident). The "What
it measures" list in the registry was rewritten to match. Anything written against the
desire-framing before 2026-08-23 should be re-read.

**Approved shape:** **contextual / conditional.**

**Boundary decisions resolved — five locks**
1. **One construct, not two.** No separate *support wanted* / *support required* constructs.
2. **Preference versus necessity is a classification, not a construct** — it belongs to
   [02 Needs / Strong Preferences / Flexibility](02-needs-preferences-flexibility.md).
3. **Orthogonal to autonomy**, not the opposite end of an autonomy spectrum.
   [4.8 Freedom](01-construct-registry.md#48--freedom) is a separate axis. Now locked, not inferred.
4. **A person can want substantial developmental support and substantial autonomy at once.**
   That combination must remain expressible — it is the whole of
   [DI-01](06-decoded-insights.md#di-01).
5. **Conditionality is legitimate.** Example form: *higher developmental support while
   unfamiliar → less support required after competence develops.*
- Distinctions preserved from: autonomy / Freedom · capability · Feedback Rhythm · interaction volume.

**Decisions intentionally left open**
- ⚠️ **The conditioning variable is deliberately NOT locked.** Competence/familiarity is a
  strong candidate from the worked example, but the methodology must admit other legitimate
  conditions until validated. How a conditioning variable is **detected and represented** is
  the new [D-CR-13](OPEN-DECISIONS.md#d-cr-13).
- **Gate B** — one unnumbered signal, direction unresolved.
- ⚠️ **The effect-framing moves the definition closer to capability.** **P5** still holds — this
  is not a capability measure — but items must not accidentally measure one. Boundary needs
  re-testing.

**Downstream methodology potentially affected:** [DI-01](06-decoded-insights.md#di-01) ·
[DI-06](06-decoded-insights.md#di-06) ·
[04 §Rule F](04-evidence-and-confidence.md#f--a-conditional-pattern-can-be-highly-supported)
(its worked case is now backed by a locked orthogonality) ·
[02](02-needs-preferences-flexibility.md) (new requirement: the tier layer must carry
preference-vs-necessity for a conditional construct) ·
[11's Support-vs-Autonomy conditional](11-tradeoff-model.md#conditional-candidate--support-vs-autonomy) ·
[05](05-adaptive-clarifiers.md) (clarifiers are the likely detection instrument).

**Version:** v0.7 · **Rescoring:** NOT APPLICABLE.

<a name="dl-010"></a>
### DL-010 — 2026-08-23 — Guidance / Development Support: definition revised again — benefit **and** preference, condition softened to "especially"

**Approval source:** Peri, explicit — the revised definition was supplied verbatim.
**Construct:** [1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support).
**Supersedes:** the canonical definition in [DL-009](#dl-009). **Does not** supersede DL-009's five locks.

**New canonical definition:**
> The degree to which a person benefits from and prefers access to active developmental
> input — teaching, coaching, correction and a more experienced person — especially while
> becoming grounded in unfamiliar work.

**What changed, in three moves**

| | DL-009 | DL-010 | Consequence |
|---|---|---|---|
| Framing | effect only — *improves a person's ability* | **effect + preference** — *benefits from **and** prefers* | The construct measures both halves as one quantity |
| Condition | *in unfamiliar work* — a scope | *especially while becoming grounded in unfamiliar work* — an intensifier | The construct has a general level that unfamiliarity **raises**, not a boundary it lives inside |
| Outcome | *become effective and confident* | *becoming grounded* | Broader — finding footing, not a competence-plus-confidence endpoint |

**Why this matters, and why it is an improvement.** DL-009 was recorded with an explicit
warning that its pure effect-framing had drifted toward **capability** — how much a person
improves with help is uncomfortably close to a statement about their ability, and **P5**
forbids that. Restoring *prefers* pulls the construct back toward orientation. The warning is
**reduced, not withdrawn**: *benefits from* remains half the definition and remains effect
language, so assessment items must still not measure competence.

**Status of DL-009's five locks**
1. **One construct, not two** — **stands, and is reinforced.** Benefit and preference now sit
   inside a single construct rather than implying two.
2. **Preference versus necessity is a classification, not a construct** — **stands, but is
   under strain and has NOT been re-decided.** *Prefers* now appears in the construct while
   the tier layer also deals in preference. The working reading — the construct measures **how
   much**, the tier layer classifies **how tradeable** — is Claude's reading, not Peri's
   decision. Raised as [D-CR-14](OPEN-DECISIONS.md#d-cr-14).
3. **Orthogonal to autonomy** — **stands, unaffected.**
4. **Support and autonomy can both be high** — **stands**, and reads more naturally now that
   the construct explicitly contains wanting.
5. **Conditionality is legitimate** — **stands, refined.** The condition is now named in the
   canonical text, and the operative word is **especially**, not *only*. Unfamiliarity is
   established as *the canonical condition*, not as *the only admissible one*.

**Approved shape:** **contextual / conditional** — **unchanged.** Peri supplied a definition
only; the shape was not reopened.

**Decisions intentionally left open**
- [D-CR-13](OPEN-DECISIONS.md#d-cr-13) — the conditioning variable stays unlocked. Naming
  unfamiliarity in the definition does **not** close it; "especially" was chosen over "only".
- [D-CR-14](OPEN-DECISIONS.md#d-cr-14) — **NEW.** (a) Where the construct's *prefers* ends and
  the tier layer's preference-vs-necessity begins; (b) what the methodology says when benefit
  and preference **diverge** in one person.
- **Gate B** — unchanged and still unmet. One unnumbered signal, direction unresolved. The
  definition moved; the measurement did not.

**Downstream methodology potentially affected:**
[DI-01](06-decoded-insights.md#di-01) (reads more directly now — it is about *wanting* support
alongside freedom) · [DI-06](06-decoded-insights.md#di-06) ·
[04 §Rule F](04-evidence-and-confidence.md#f--a-conditional-pattern-can-be-highly-supported)
(the "support while learning, autonomy after competence" case aligns more closely with
"especially while becoming grounded") · [02](02-needs-preferences-flexibility.md) (the
boundary this layer must hold is now sharper — [D-CR-14](OPEN-DECISIONS.md#d-cr-14)) ·
[11's Support-vs-Autonomy conditional](11-tradeoff-model.md#conditional-candidate--support-vs-autonomy) ·
[05](05-adaptive-clarifiers.md).

**Version:** v0.8 · **Rescoring:** NOT APPLICABLE — no client has been scored on this construct.

---

---

## First entries to expect next

Not a plan and not a recommendation — just what the current dependency graph implies, so the
shape of the log is clear before it has more content.

| Likely id | Closes | Why it comes early |
|---|---|---|
| DL-003 | [D-PRIN-01](OPEN-DECISIONS.md#d-prin-01) | Every other document inherits the principles. |
| DL-004 | [D-CR-06](OPEN-DECISIONS.md#d-cr-06) | Score shape ([D-RS-01](OPEN-DECISIONS.md#d-rs-01)) is blocked on whether all constructs are continua. |
| DL-005 | [D-AC-03](OPEN-DECISIONS.md#d-ac-03) | Fixed clarifier bank vs constrained generation blocks R1 engineering, and the two need different infrastructure. |
| DL-006 | [D-NPF-01](OPEN-DECISIONS.md#d-npf-01) | The tier framework blocks R1, R2, R5 and R9 per SIGNAL PM. |
| DL-007 | [D-CR-01](OPEN-DECISIONS.md#d-cr-01) *(remainder)* | Whether Motivator Ownership survives. Determines the final registry count. |
