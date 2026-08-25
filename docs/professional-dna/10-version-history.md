# 10 · Version history

**Status:** DRAFT
**Methodology version:** v0.8
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23

---

## Versioning scheme

Semantic, applied to the methodology rather than to code.

| Version | Meaning |
|---|---|
| **v0.x** | Methodology under development. Nothing is frozen. No client artifact may be produced. Breaking changes are expected and are not recorded as breaking. |
| **v1.0** | **The first formally frozen Professional DNA methodology.** Every document in this directory is `LOCKED` and the `CNL R0 — GO / NO-GO` gate is approved. The first client artifact may be produced. |
| **v1.x** | Additive or clarifying change after v1.0. Existing frozen artifacts remain valid and comparable. |
| **v2.0+** | Breaking change. Existing frozen artifacts are **not** comparable to new ones. Requires an explicit rescoring decision. |

### What makes a change breaking

A change is **major** (v2.0+) if any of these is true:

- A construct is added, removed, renamed, or moved between families.
- A scoring approach changes such that the same responses would produce a different value.
- A confidence computation changes such that the same responses would produce a different
  confidence.
- The result schema changes shape in a way an existing reader cannot parse.
- The context boundary moves — anything that was disallowed at Stage 1 becomes allowed, or
  vice versa.

Everything else is **minor** (v1.x): wording, added examples, tightened definitions that do
not move a score, new decoded insights that do not change existing ones.

### Relationship to the artifact

The methodology version is stamped on every frozen artifact ([07](07-result-schema.md)).
Per **P11** an artifact is immutable — so a methodology change never edits an existing
artifact. It determines whether existing artifacts remain **comparable**, and whether
rescoring is offered.

---

## Change record

Every entry after v1.0 must record all six fields. No exceptions — an entry missing the
rescoring field is incomplete, because that is the field that decides what happens to real
clients.

```
### vX.Y — YYYY-MM-DD

**Decision:**          what changed
**Reason:**            why the previous version was wrong or insufficient
**Affected:**          which constructs, rules, or documents
**Downstream impact:** which CNL releases / SIGNAL surfaces are affected
**Rescoring:**         REQUIRED / NOT REQUIRED / OPTIONAL — and what happens to
                       existing frozen artifacts
**Decision log:**      link to the DECISION-LOG.md entry
```

---

## History

### v0.8 — 2026-08-23 · **1.1 canonical definition revised — first post-lock change**

**Decision:** Peri supplied a revised canonical definition for
[1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support),
superseding the text approved one version earlier — [DL-010](DECISION-LOG.md#dl-010).

> The degree to which a person benefits from and prefers access to active developmental
> input — teaching, coaching, correction and a more experienced person — especially while
> becoming grounded in unfamiliar work.

**This is the first time the change-control procedure has been exercised on a 🔒 LOCKED
construct.** It ran as designed: the definition was not edited silently — the version bumped,
[DL-009](DECISION-LOG.md#dl-009) was left intact with a supersession pointer above it, and a
new decision-log entry carries the change.

**What changed**

| | v0.7 (DL-009) | v0.8 (DL-010) |
|---|---|---|
| Framing | effect only — *improves a person's ability* | **effect + preference** — *benefits from **and** prefers* |
| Condition | *in unfamiliar work* — a scope the construct lives inside | *especially while becoming grounded* — an intensifier on a general level |
| Outcome word | *become effective and confident* | *becoming grounded* |
| Shape | contextual / conditional | **unchanged** |

**Reason:** v0.7 was recorded with an explicit warning against itself — its pure effect-framing
had drifted toward **capability**, which **P5** forbids. "How much does support improve this
person" is close to a statement about their ability. Restoring *prefers* pulls the construct
back toward orientation and makes P5 materially easier to hold. The warning is **reduced, not
withdrawn**: *benefits from* is still effect language and still half the definition.

The second change is independent of the first. v0.7 read as though the construct existed only
inside unfamiliar work. v0.8 says unfamiliarity **raises** a level that exists generally — a
person can prefer developmental input in work they already know well, and the residual level in
familiar work is **not** assumed to be zero.

**Affected:** [01](01-construct-registry.md) — the 1.1 entry only: canonical definition, the
revision-history callout (now a three-row table), "What it measures" (rewritten a second time,
into paired benefit / preference halves), the capability line in "What it does NOT measure",
DL-009 locks 2 and 5, and "Still open". [DECISION-LOG](DECISION-LOG.md) — DL-010 added, DL-009
banner. [OPEN-DECISIONS](OPEN-DECISIONS.md) — D-CR-14 added, D-CR-13 annotated.
**No other construct is touched. The other four locked definitions are unchanged.**

**⚠️ Two things this version did NOT do.** It did not reopen the **shape** — Peri supplied a
definition, not a shape, and contextual / conditional stands. And it did not retract
**[DL-009 lock 2](DECISION-LOG.md#dl-009)** (preference-versus-necessity is a classification),
even though the revised definition puts it under strain by naming *prefers* inside the
construct. That tension is [D-CR-14](OPEN-DECISIONS.md#d-cr-14) and awaits Peri.

**Downstream impact:** **None unblocked.** The GO / NO-GO gate remains closed, all 14 CNL R1
items remain blocked, `CNL R0 — Professional DNA construct model (final)` is **not** satisfied
and did not change status. Registry still `REVIEW`; still 5 of 44 definitions locked; still
**zero constructs past Gate B**. Open decisions moved **91 → 92** (95 entries, 3 closed) —
this revision opened more than it settled, which is the correct direction for a construct whose
measurement is still unmapped.

**Rescoring:** NOT REQUIRED — **no client has been scored on this construct.** Had one been, this
change would have required it: the definition's meaning moved, not its wording. Any *analysis*
written against the v0.7 effect-framing — including anything in the Maleri worked examples that
leans on "improves ability" — should be re-read against the dual framing.

**Decision log:** [DL-010](DECISION-LOG.md#dl-010).

---

### v0.7 — 2026-08-23 · **FIRST CONSTRUCT-DEFINITION LOCK**

**Decision:** Peri explicitly approved **five construct definitions**, which are now marked
🔒 **LOCKED** inside [01-construct-registry.md](01-construct-registry.md) —
[DL-005](DECISION-LOG.md#dl-005) through [DL-009](DECISION-LOG.md#dl-009).

| Construct | Shape | Note |
|---|---|---|
| [3.3 Decision Influence](01-construct-registry.md#33--decision-influence) | independent intensity | **definition revised** — "without requiring formal authority" removed |
| [5.1 Life Protection](01-construct-registry.md#51--life-protection) | directional spectrum | separated from Career Centrality |
| [3.1 Outcome Ownership](01-construct-registry.md#31--outcome-ownership) | directional spectrum | poles named |
| [2.4 Create](01-construct-registry.md#24--create) | independent intensity | separated from Build |
| [1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support) | contextual / conditional | **definition revised** — desire-framing → effect-framing. ⛔ **This definition was itself superseded at v0.8** ([DL-010](DECISION-LOG.md#dl-010)). |

**The Definition Review Standard was split into two gates.** Gate A (semantic — what the
construct means, five criteria) and Gate B (measurement sufficiency — whether we can measure
it, two criteria). Evidence mapping moved from A to B. **A construct can now be semantically
LOCKED while its measurement mapping remains OPEN**, which was impossible before and was
blocking constructs whose only problem was incomplete question mapping. **Gate B is not
weakened** — it still hard-blocks scoring, classification, DECODED entry and any client-facing
appearance, and must be satisfied before R1.

**Reason:** the registry had held 44 names and no approved definitions since v0.1. Locking the
five highest-blast-radius definitions settles the boundaries that every other document has been
reasoning around — most importantly the Decision Influence / Formal Leadership entanglement and
the Life Protection / Career Centrality identity question.

**Affected:** [01](01-construct-registry.md) — five entries locked, header rewritten, Definition
Review Standard replaced. Cross-links updated in [02](02-needs-preferences-flexibility.md),
[04](04-evidence-and-confidence.md), [05](05-adaptive-clarifiers.md),
[06](06-decoded-insights.md), [07](07-result-schema.md), [11](11-tradeoff-model.md),
[README](README.md). [OPEN-DECISIONS](OPEN-DECISIONS.md) and
[DECISION-LOG](DECISION-LOG.md) updated.

**⚠️ The registry document remains `REVIEW`.** Five definitions are locked; the construct model
is **not frozen**. 39 of 44 have no approved definition, registry membership is still open
([D-CR-01](OPEN-DECISIONS.md#d-cr-01) can still remove one), and **no construct has passed
Gate B**.

**Downstream impact:** None unblocked. The GO / NO-GO gate remains closed and all 14 CNL R1
items remain blocked. `CNL R0 — Professional DNA construct model (final)` is **not** satisfied.
**Zero registry-level decisions closed**; one raised
([D-CR-13](OPEN-DECISIONS.md#d-cr-13)); four narrowed; one annotated. Eight *per-construct*
open questions closed inside the registry.

**Rescoring:** NOT APPLICABLE — no client artifact has ever been produced.

**Why this is a version bump.** The most substantive change since v0.1. Two definitions changed
text, five constructs changed status, and the gating standard was restructured. Under the
post-v1.0 rules this would be **major**: a construct's meaning changing such that the same
responses produce a different reading is exactly what the breaking-change list covers, and
Decision Influence and Guidance both changed meaning, not just wording.

**Decision log:** [DL-005](DECISION-LOG.md#dl-005) · [DL-006](DECISION-LOG.md#dl-006) ·
[DL-007](DECISION-LOG.md#dl-007) · [DL-008](DECISION-LOG.md#dl-008) ·
[DL-009](DECISION-LOG.md#dl-009) — recorded separately, per the log's one-entry-per-decision
rule.

---

### v0.6 — 2026-08-23

**Decision:** First-pass construct-definition review. The **twelve highest-leverage
constructs** in [01-construct-registry.md](01-construct-registry.md) now carry structured
**🟡 PROPOSED** definitions in place of one-line working glosses. A **Definition Review
Standard** was added to the registry. Status stays `REVIEW`; **nothing is LOCKED**.

**Reason:** The registry has held 44 names with no definitions since v0.1, and every
downstream document has been reasoning about constructs whose boundaries were undefined. A
controlled first pass on twelve — rather than all 44 — tests whether the definition format
works and whether the boundaries survive contact before the effort is spent forty-four times.

**Affected:** [1.1](01-construct-registry.md#11--guidance--development-support) ·
[1.2](01-construct-registry.md#12--outcome-clarity) ·
[1.3](01-construct-registry.md#13--predictability--change) ·
[1.7](01-construct-registry.md#17--experimentation) ·
[2.2](01-construct-registry.md#22--analyze) · [2.4](01-construct-registry.md#24--create) ·
[3.1](01-construct-registry.md#31--outcome-ownership) ·
[3.2](01-construct-registry.md#32--formal-leadership) ·
[3.3](01-construct-registry.md#33--decision-influence) ·
[4.1](01-construct-registry.md#41--meaning) · [4.4](01-construct-registry.md#44--mastery) ·
[5.1](01-construct-registry.md#51--life-protection).

Each carries: proposed definition · what it measures · what it does **not** measure · common
confusion risks · construct shape · evidence sources (**no weights**) · known Assessment v1
evidence · downstream consumers (**deliberately not uniform**) · open questions.

**The other 32 constructs are untouched** and still carry glosses only. Scoring approach and
confidence requirement remain `OPEN` for all 44, including the twelve — a definition says what
a construct *is*, not how it is scored.

**Downstream impact:** None. The gate remains closed and all 14 CNL R1 items remain blocked.
`CNL R0 — Professional DNA construct model (final)` is **not** satisfied. Three decisions
raised ([D-CR-10](OPEN-DECISIONS.md#d-cr-10), [D-CR-11](OPEN-DECISIONS.md#d-cr-11),
[D-CR-12](OPEN-DECISIONS.md#d-cr-12)), **none closed**.

**Rescoring:** NOT APPLICABLE — no client artifact has ever been produced.

**Why this is a version bump.** The registry changed state: twelve entries moved from
`Definition: OPEN` to `Definition: PROPOSED`, and a new gating standard was added. Under the
post-v1.0 rules this would be **minor** — proposals do not move a score, and nothing was
locked — but the state change is what the change record exists to capture.

**Decision log:** **No entry.** Nothing was closed. Per the log's own rule, writing a draft is
not a decision, and the Definition Review Standard requires Peri's explicit approval as its
sixth criterion.

---

### v0.5 — 2026-08-23

**Decision:** Confidence methodology supplied.
[04-evidence-and-confidence.md](04-evidence-and-confidence.md) rewritten and moved
`DRAFT` → **`REVIEW`**.

**Reason:** Confidence was one of the R0 specification items, it gates the R1 runtime
(`CNL R1 — Assessment confidence state and completion / stopping logic`), and it was the last
piece the Need pathway needed to be readable end to end — criterion 6 of six is *confidence is
sufficient*, and until now there was nothing to be sufficient against.

**Affected:** [04](04-evidence-and-confidence.md) now carries the governing principle
(*strength of conclusion cannot exceed strength of evidence*), five confidence dimensions
(Coverage · Consistency · Independence · Consequence · Resolution) with working states, the
four internal states C0–C3 with allowed and disallowed uses, the confidence-vs-classification
separation, three levels of confidence (construct · DECODED · assessment sufficiency), the
three-part stopping rule with the marginal-information-value test, three clarifier priority
tiers, six methodology rules A–F, and four illustrative Maleri worked examples.

Cross-links updated in [README](README.md), [02](02-needs-preferences-flexibility.md),
[03](03-assessment-architecture.md), [05](05-adaptive-clarifiers.md),
[06](06-decoded-insights.md), [07](07-result-schema.md), [08](08-validation-framework.md) and
[11](11-tradeoff-model.md). **No other document changed status. Nothing LOCKED.**

**Downstream impact:** None. The GO / NO-GO gate remains closed and all 14 CNL R1 items remain
blocked. `CNL R0 — Confidence methodology` is **not** satisfied — every threshold in the
document is `OPEN`, so no C-state can actually be assigned. One decision closed
([D-EC-10](OPEN-DECISIONS.md#d-ec-10)), eight raised, four restated. R1's blocking set **grew
by one**: [D-EC-12](OPEN-DECISIONS.md#d-ec-12) joins D-AC-03, D-CR-01, D-AA-01, D-EC-04 and
D-RS-01.

**Rescoring:** NOT APPLICABLE — no client artifact has ever been produced.

**Why this is a version bump.** Unambiguous, unlike v0.4. A document moved from `DRAFT` to
`REVIEW` on new canonical content that every other document now references, and a decision
closed. Under the post-v1.0 rules this would be **major** — a confidence computation changing
such that the same responses produce a different confidence is listed as breaking above, and
this supplies that computation's entire shape where none existed.

**Decision log:** [DL-004](DECISION-LOG.md#dl-004).

---

### v0.4 — 2026-08-22

**Decision:** Peri supplied the assessment evidence the Maleri worked example had been left
incomplete for — Q47, Q61–Q72 and the Q82 future projection. Worked example rebuilt on it.
[D-TM-12](OPEN-DECISIONS.md#d-tm-12) closed.

**Reason:** The example carried two acknowledged gaps: an unrecorded Q47 result, and a
"later motivator / future evidence: NOT SUPPLIED" section. Both were left as stated gaps
rather than constructed.

**Affected:** [11 §7](11-tradeoff-model.md#7--worked-example--maleri) rebuilt — evidence split
into **Table A** (directional edges, both participants known), **Table B** (construct-level
evidence where the losing options were not supplied, so *not* graph edges), **Table C**
(invariance probes), plus a money-meaning reading, a four-axis risk/certainty cluster, and a
walkthrough of the Need pathway that stops short. [OPEN-DECISIONS](OPEN-DECISIONS.md) and
[DECISION-LOG](DECISION-LOG.md) updated. **No status changed. Nothing LOCKED.**

**Downstream impact:** None. Gate closed, R1 blocked, 80 decisions open.
`CNL R0 — Tradeoff model` still **not** satisfied — [D-TM-10](OPEN-DECISIONS.md#d-tm-10) is
untouched by this.

**Rescoring:** NOT APPLICABLE — no client artifact has ever been produced.

**Why this is a version bump — and the argument against it.** No methodology rule, threshold
or definition changed. Under the rules above this is squarely a **minor** change: "added
examples." It is recorded as a version because an open decision was **closed**, and the
open-decision count is the figure the GO / NO-GO gate's acceptance criterion 5 is measured
against — so a change to it needs a dated record. If the convention should be that
example-only changes do not move the version, revert this to an amendment under v0.3; the
substance is unaffected either way.

**Decision log:** [DL-003](DECISION-LOG.md#dl-003).

---

### v0.3 — 2026-08-22

**Decision:** Added [11-tradeoff-model.md](11-tradeoff-model.md) as a new canonical methodology document, at status REVIEW.

**Reason:** The tradeoff model was one of the R0 specification items with no document, and one of two field groups blocking the result schema ([D-RS-05](OPEN-DECISIONS.md#d-rs-05)). It also supplies the first concrete qualification pathway into the Needs / Strong Preferences / Flexibility framework, which had been entirely OPEN.

**Affected:** New document 11. Cross-references updated in [README](README.md), [02](02-needs-preferences-flexibility.md) (Need and Flexibility tiers gain a tradeoff pathway; fourth-state mismatch flagged), [03](03-assessment-architecture.md) (forced-choice item type), [04](04-evidence-and-confidence.md) (tradeoff weighting; graph cycles as a contradiction class), [05](05-adaptive-clarifiers.md) (new trigger candidate), [06](06-decoded-insights.md) (one-way evidence direction), [07](07-result-schema.md) (Tradeoffs field group partly unblocked). **No status changed** — 11 is REVIEW, 01 remains REVIEW, everything else remains DRAFT. **Nothing LOCKED.**

**Downstream impact:** None. The GO / NO-GO gate remains closed and all 14 CNL R1 items remain blocked. **Thirteen** new open decisions were raised (`D-TM-01`…`D-TM-12` and `D-NPF-08`), none closed, and [D-NPF-01](OPEN-DECISIONS.md#d-npf-01) was narrowed. `CNL R0 — Tradeoff model` is **not** satisfied — the document covers tradeoff-as-evidence, while that PM item’s acceptance criteria describe tradeoff-as-output ([D-TM-10](OPEN-DECISIONS.md#d-tm-10)).

**Also corrected in this version:** the open-decision register's own header count, which had been wrong since v0.1 (it read 56 when the true figure was 67). The register now derives its count rather than incrementing it by hand, and the corrected figure was pushed to the GO / NO-GO gate in SIGNAL PM.

**Rescoring:** NOT APPLICABLE — no client artifact has ever been produced.

**Why this is a version bump.** The v0.x convention treats methodology change as expected and unrecorded-as-breaking, but a new canonical document plus the first substantive content in the classification framework is a methodology change, not an editorial one. After v1.0 the same addition would be **minor** (v1.x) if it added a pathway without moving a score, and **major** if it changed how an existing factor classifies.

**Decision log:** no new entry — no methodology decision was closed. See [DECISION-LOG.md](DECISION-LOG.md).

---

### v0.2 — 2026-08-22

**Decision:** Resolved both construct naming collisions. Family 3 `Ownership` →
**Outcome Ownership** ([DL-001](DECISION-LOG.md#dl-001)). Family 2 `Influence` →
**Persuasion / Influence Work** and family 3 `Influence` → **Decision Influence**
([DL-002](DECISION-LOG.md#dl-002)). Family 4 `Ownership` deliberately **not** renamed and
marked OPEN pending a decision on whether it survives as a distinct motivator.

**Reason:** Two names each referred to two different constructs, which made
[DI-02](06-decoded-insights.md#di-02) unspecifiable and blocked any code keying on a
construct name.

**Affected:** Constructs 2.8, 3.1, 3.3 renamed; 4.11 annotated. Documents
[01](01-construct-registry.md), [06](06-decoded-insights.md),
[OPEN-DECISIONS](OPEN-DECISIONS.md), [DECISION-LOG](DECISION-LOG.md), this file. **No status
changed** — 01 remains `REVIEW`, everything else remains `DRAFT`. **No definition, scoring
rule, continuum or confidence requirement was decided.** All 44 definitions remain `OPEN`.

**Downstream impact:** None yet — nothing is `LOCKED`, so nothing is unblocked. The
`CNL R0 — GO / NO-GO` gate remains closed and all 14 CNL R1 items remain blocked. What
changed is that DI-02's inputs are now unambiguous and the registry can be reviewed without
a reader having to guess which construct a name refers to.

**Rescoring:** NOT APPLICABLE — no client artifact has ever been produced. Under a v0.x
version this would not be recorded as breaking; it is recorded because a construct rename is
precisely what this file exists to track, and after v1.0 the same change would be a **major**
version bump (a construct renamed is listed as a breaking change above).

**Decision log:** [DL-001](DECISION-LOG.md#dl-001), [DL-002](DECISION-LOG.md#dl-002) — the
first two entries in the log.

---

### v0.1 — 2026-08-22

**Decision:** Established `docs/professional-dna/` as the canonical methodology directory
and created the initial document set: README, principles, construct registry, needs /
preferences / flexibility, assessment architecture, evidence and confidence, adaptive
clarifiers, decoded insights, result schema, validation framework, context boundary, this
version history, open decisions and decision log.

**Reason:** CNL Release 0 requires the methodology to be frozen before any implementation
begins. Freezing requires a canonical, reviewable, version-controlled place for it to be
frozen *in*. Before this, the methodology existed only in conversation.

**Affected:** All documents — created. No methodology decisions were made.

**Downstream impact:** None yet. Nothing is `LOCKED`, so nothing downstream is unblocked.
The `CNL R0 — GO / NO-GO: Professional DNA methodology frozen` gate remains closed and all
14 CNL R1 items remain blocked.

**Rescoring:** NOT APPLICABLE — no client artifact has ever been produced.

**Content status:** Construct names and families, the three-stage context boundary, the six
candidate decoded intersections, the two-part Money measurement and the self-serve
completion target come from Peri. Everything else is either derived from the initiative
principles already recorded in SIGNAL PM, or marked `OPEN`. Every construct definition is
`OPEN`. Working glosses in the registry are explicitly marked as **not decisions**.

**Decision log:** [DECISION-LOG.md](DECISION-LOG.md) — no decisions recorded. The log is
established empty because nothing has been explicitly approved.

---

## Path to v1.0

v1.0 is reached when **all** of these hold:

1. Every document in this directory is `LOCKED` per the five-part test in the
   [README](README.md#what-locked-means).
2. Every entry in [OPEN-DECISIONS.md](OPEN-DECISIONS.md) is closed, with a decision-log
   entry for each.
3. The two missing methodology documents exist and are locked — **Growth Edge methodology**
   and **Tradeoff model** (see [07](07-result-schema.md)), plus the motivator model and the
   two dimension models, all four of which SIGNAL PM tracks as separate R0 items.
4. ~~The registry naming collisions are resolved.~~ **Done 2026-08-22** — see
   [DL-001](DECISION-LOG.md#dl-001) and [DL-002](DECISION-LOG.md#dl-002). All 44 constructs
   now carry unique names. What replaces this criterion: the **final registry membership**
   must be settled, which means [D-CR-01](OPEN-DECISIONS.md#d-cr-01) resolved — whether
   Motivator `Ownership` survives as a distinct construct decides whether the registry holds
   44 entries or 43.
5. `CNL R0 — GO / NO-GO: Professional DNA methodology frozen` is approved in SIGNAL PM.

Reaching v1.0 is what unblocks all 14 CNL R1 items. Nothing partial unblocks anything.
