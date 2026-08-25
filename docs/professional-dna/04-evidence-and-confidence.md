# 04 · Evidence and confidence

**Status:** REVIEW
**Methodology version:** v0.8
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23

What counts as evidence for a construct, and how SIGNAL decides whether it knows enough to
say anything.

---

## Governing principle

> **Strength of conclusion cannot exceed strength of evidence.**

Everything in this document is a mechanism for holding that line. It is the operative form of
**P12** — every generated statement is traceable to its evidence, and a statement that cannot
be traced is **dropped, not softened**
([00-methodology-principles.md](00-methodology-principles.md)).

---

## Confidence is multidimensional, not a percentage

**Confidence is not a single number.** A percentage collapses five independent questions into
one, and every collapse loses the thing a reader needs.

A construct can be:

- richly evidenced but internally contradictory,
- thinly evidenced but perfectly consistent,
- consistent across five items that are all the *same* item reworded,
- well-measured with no evidence that it matters to anything,
- or contradictory in a way that has been *resolved into a condition* rather than left open.

Those are five different situations. A single "72%" describes none of them, and it cannot be
argued with — which is why it is attractive and why it is wrong.

---

## The five dimensions

Every construct interpretation is read along all five. **No dimension has numeric thresholds
yet; every state below is a working category.**

### 1 · Coverage
*Do we have enough meaningful evidence about the construct?*

| State | Working sense |
|---|---|
| **Sparse** | One signal, or several that barely touch the construct |
| **Adequate** | Enough to say something without straining |
| **Rich** | Multiple substantial signals |

> **⚠️ Multiple near-duplicate questions do not automatically create Rich coverage.** Five
> rewordings of one question are close to one signal repeated. Coverage counts *meaningful*
> evidence, and meaningfulness is not volume. This is the coverage-side twin of the
> [Independence](#3--independence) rule, and of the tradeoff model's consistency rule that
> beating the same opponent twice is one signal, not two
> ([11 §4](11-tradeoff-model.md#4--consistency)).

### 2 · Consistency
*Does the evidence generally point in the same direction?*

| State | Working sense |
|---|---|
| **Consistent** | Everything points the same way |
| **Mostly consistent** | One outlier against a clear direction |
| **Mixed** | Real signal in more than one direction |
| **Contradictory** | Directly opposed evidence, unreconciled |

> **⚠️ Mixed evidence must NOT automatically become a midpoint score.** "Some evidence each
> way, therefore moderate" is the **P9** failure — a value nobody holds, produced by
> arithmetic. Mixed evidence routes to [Resolution](#5--resolution), not to an average.

### 3 · Independence
*Does the conclusion draw from meaningfully different evidence types?*

Candidate evidence types:

| Type | Yields |
|---|---|
| **baseline preference** | A stated position |
| **behavioral scenario** | What they would do in a described situation |
| **tradeoff** | What they protect when forced to choose — [11](11-tradeoff-model.md) |
| **real-life self-report** | Something they say they have done or want |
| **invariance probe** | Whether a factor survives the removal of another — [11 Table C](11-tradeoff-model.md#table-c--invariance-probes) |
| **adaptive clarifier** | A targeted follow-up — [05](05-adaptive-clarifiers.md) |

> **⚠️ Repeated versions of the same question should not count as fully independent
> evidence.** Three tradeoff items and one baseline item is stronger than four tradeoff items,
> which is stronger than one item asked four ways.

> **Cross-document note.** These **evidence types** are not the same list as the candidate
> **item types** in [03 · Assessment architecture](03-assessment-architecture.md#item-types) —
> an item type is *how a question is asked*, an evidence type is *what the response yields*.
> They overlap heavily and may turn out to be one taxonomy under two names. That is part of
> [D-AA-02](OPEN-DECISIONS.md#d-aa-02). Note that **invariance probe** appears here as a
> canonical evidence type while it is still only an observation against D-AA-02 on the item
> side.

### 4 · Consequence
*Is there evidence that the presence or absence of this factor materially affects fit,
satisfaction, sustainability, motivation, or behaviour?*

Consequential evidence may include:

- materially difficult tradeoffs
- Drained / negative-fit responses
- feared outcomes
- sacrifices
- repeated protection

**Exact thresholds are not defined.** This is the dimension that separates *"we measured
this accurately"* from *"this matters."* A construct can be richly and consistently measured
and still have no evidence that anything follows from it — and per
[Rule B](#b--confidence-is-about-the-interpretation-only), that is a low-consequence
construct, not a low-confidence one.

Consequence is also the dimension that feeds Need criterion 3 (*absence appears
consequential*) in [02](02-needs-preferences-flexibility.md) and
[11 §6](11-tradeoff-model.md#6--connection-to-needs--preferences--flexibility).

### 5 · Resolution
*Have material contradictions been dealt with?*

| Outcome | Meaning |
|---|---|
| **No meaningful contradiction** | Nothing to resolve |
| **Resolved toward one interpretation** | The contradiction was apparent; one reading survived |
| **Resolved into a conditional pattern** | Both readings are true, under different conditions |
| **Unresolved** | Still open |

> **⚠️ A contradiction that resolves into a condition should not reduce the final
> interpretation to a midpoint.**
>
> *Support while learning + autonomy after competence* is a **conditional pattern**, not
> "moderate autonomy." Collapsing it produces a description of a person who does not exist.
> See [Rule F](#f--a-conditional-pattern-can-be-highly-supported) and
> [11 §5](11-tradeoff-model.md#5--conditionality).

---

## Internal confidence states

Four working states. **These are internal.** Whether any of them is ever shown to a client is
[D-EC-08](OPEN-DECISIONS.md#d-ec-08).

### C0 — INSUFFICIENT
Evidence is too sparse or unreliable for a meaningful conclusion.

| ✅ Allowed | ❌ Not allowed |
|---|---|
| Omit | Strong report statement |
| Ask a clarifier if high-value | Classification as Need / Strong Preference / Range |
| | DECODED input |

### C1 — EMERGING
A plausible directional signal exists, but evidence is not sufficient for prominent
interpretation.

| ✅ Allowed | ❌ Not allowed |
|---|---|
| Background hypothesis | Need classification |
| Potential clarifier trigger | Major DECODED claim |

### C2 — SUPPORTED
Multiple meaningful signals support the interpretation, ideally across more than one evidence
form.

| ✅ Allowed |
|---|
| Strong Preference |
| Flexible / Range |
| Normal client-facing interpretation |
| Career Trajectory contextual use, **with appropriate caution** |

### C3 — HIGHLY SUPPORTED
Rich, independent evidence exists, consequential evidence is present where required, and no
material contradiction remains unresolved.

| ✅ Allowed |
|---|
| **Potential** Need classification — *provided the Need criteria are separately satisfied* |
| High-confidence DECODED input |
| Strong client-facing interpretation |

> ### ⚠️ C3 does NOT mean "100% certain."
>
> It means the evidence is strong enough to carry a strong statement. It is a floor on
> evidence, not a ceiling on doubt. A C3 construct can still be wrong, and the client
> reaction workflow ([08](08-validation-framework.md)) exists partly because it will
> sometimes be.

---

## Confidence is not classification

These answer different questions and must never be merged.

| | Question it answers |
|---|---|
| **Confidence** | *How sure are we about the interpretation?* |
| **Classification** | *How important / protected / flexible is the condition?* |

> **Confidence level does not determine classification automatically.** A C3 construct is not
> thereby a Need. A Flexible construct is not thereby low-confidence — we can be highly
> confident that someone is genuinely flexible about something.

**Worked separations:**

| Construct | Confidence | Classification |
|---|---|---|
| **Create** | C3 | **Strong Preference** |
| **Life Protection** | C3 | **May qualify as Need — only if the Need criteria are also satisfied** |
| **Stimulation** | C2 | **Flexible / Range** |

The Need criteria live in [02](02-needs-preferences-flexibility.md) and
[11 §6](11-tradeoff-model.md#6--connection-to-needs--preferences--flexibility). Confidence is
criterion 6 of six. Satisfying one criterion is not satisfying the set.

---

## Three levels of confidence

### 1 · Construct Confidence
Confidence in one underlying construct interpretation. The five dimensions above produce it.

### 2 · Derived / DECODED Confidence
Confidence in an intersection insight.

> **Rule: a DECODED insight cannot exceed the confidence of its weakest essential input.**
>
> If one required construct is C1, the derived insight **cannot** be C3.

This follows from **P10** — a decoded insight has no evidence of its own; it inherits its
inputs' evidence ([06](06-decoded-insights.md)). The weakest input is therefore a ceiling,
not an average. Note "essential": which inputs are essential versus contributing is part of
each insight's trigger condition, all of which are `OPEN`.

### 3 · Assessment Sufficiency
Whether the assessment **as a whole** knows enough to stop.

> **This is NOT "all constructs must reach C3."** A perfectly good assessment ends with some
> constructs at C1 and some omitted entirely. Demanding C3 everywhere is how a 20-minute
> assessment becomes a 90-minute one that measures compliance.

It asks whether:

1. Required construct-family coverage is adequate.
2. Material unresolved contradictions have been addressed.
3. Enough evidence exists to produce a useful result.
4. Another question is unlikely to materially change the result.

Whether sufficiency uses **family-specific minimums** — different bars for different construct
families — is [D-EC-18](OPEN-DECISIONS.md#d-ec-18).

---

## Stopping rule

**SIGNAL should stop when all three are true.** Working rule; exact numeric thresholds are not
finalised.

| # | Condition | Note |
|---|---|---|
| **1** | **Core coverage is sufficient** | The major construct families have adequate evidence |
| **2** | **No result-changing contradiction remains unresolved** | Minor inconsistencies do **not** justify endless questioning |
| **3** | **Marginal information value is low** | See the test below |

### The marginal-information-value test

Before asking another clarifier:

> *Could the answer materially change a **classification**, a **DECODED insight**, a **Growth
> Edge**, a **Career Trajectory implication**, or another prominent result?*
>
> **If no, do not ask.**

This is the operational form of **P8** — length is earned by uncertainty, and only by
uncertainty that *matters*. A question that would refine a number nobody reads is not earned.

How marginal information value is actually computed is
[D-EC-19](OPEN-DECISIONS.md#d-ec-19). The stopping-rule states themselves live in
[03 · Stopping rules](03-assessment-architecture.md#stopping-rules).

---

## Clarifier priority

When multiple ambiguities remain, prioritise. Full clarifier methodology is in
[05-adaptive-clarifiers.md](05-adaptive-clarifiers.md); this is the ordering it should use.

| Tier | Name | Test |
|---|---|---|
| **1** | **Result-changing** | Could change a Need, a major DECODED insight, a Growth Edge, or a primary operating conclusion |
| **2** | **Career-relevant** | Could materially change environment or path interpretation |
| **3** | **Nice-to-know** | Would make the report more interesting but not meaningfully better |

> **Tier 3 should normally be skipped.** An interesting question that changes nothing costs
> the same as a useful one, and the budget is the same either way.

---

## Methodology rules

### A · Missing evidence is not neutral evidence
If we do not know, **do not assign a midpoint.** Absence of evidence is `C0`, not "moderate."
A midpoint asserts a measurement that was never taken, and it is indistinguishable in the
output from a real moderate reading.

### B · Confidence is about the interpretation only
Confidence measures **confidence in the interpretation** — not desirability, not importance,
not capability, not career fit, not strength.

A person can be **confidently measured as moderate**. Certainty and magnitude are different
axes and must never share a number. Per **P5**, capability is not preference, and neither is
confidence.

### C · A DECODED statement cannot increase confidence in its own source constructs
A beautiful decoded sentence is not evidence for the constructs beneath it. Evidence direction
is **one-way**:

```
responses → evidence → construct interpretation → classification → DECODED
```

Never `DECODED → evidence`. The circularity would be invisible in the output — it would read
as corroboration. See [06](06-decoded-insights.md) and
[11 §9](11-tradeoff-model.md#9--decoded-boundary).

### D · Stage 2 context cannot retroactively inflate Stage 1 confidence
Contextual resume and coach evidence introduced **after** the DNA freeze cannot retroactively
inflate Stage 1 construct confidence — **unless** the methodology explicitly defines a Stage 2
validation confidence layer.

**No such layer is defined here.** Whether one is needed is
[D-EC-11](OPEN-DECISIONS.md#d-ec-11), which stays open. Until it is decided, Stage 2 evidence
may *test, explain, contradict or corroborate* a frozen reading — it may not raise its
confidence number. See [09 · Context boundary](09-context-boundary.md).

### E · Repeated identical evidence is not independent confirmation
The same question asked five ways is close to one signal. This binds
[Coverage](#1--coverage) and [Independence](#3--independence) together, and it is the same
rule the tradeoff model applies to opponents
([11 §4](11-tradeoff-model.md#4--consistency)).

### F · A conditional pattern can be highly supported
**Conditional does not mean low confidence.**

> *"Needs developmental support while learning; prefers autonomy after competence."*

That can be a **C3** statement. It is more specific than either pole, not less. What would be
low-confidence is *not knowing which* — an unresolved contradiction, not a resolved
conditional. See [Resolution](#5--resolution).

>  **The worked case is now a locked construct shape.** [DL-009](DECISION-LOG.md#dl-009)
> locked [1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support)
> as **contextual / conditional**, and locked that it is **orthogonal to autonomy**. Rule F is
> no longer illustrated by a hypothetical — it is illustrated by an approved construct.
> **The conditioning variable remains deliberately unlocked** ([D-CR-13](OPEN-DECISIONS.md#d-cr-13)),
> so a conditional pattern can be C3 on its *existence* while the *condition* is still C0.
>
> **Sharpened 2026-08-23 by [DL-010](DECISION-LOG.md#dl-010).** 1.1's definition now reads
> *"**especially** while becoming grounded in unfamiliar work"* — an intensifier, not a scope.
> Rule F's worked case ("support while learning, autonomy after competence") is therefore not a
> switch between two states but a **level that unfamiliarity raises**. The distinction matters
> here: the C0 question is *how much* the condition moves the level, not *whether the construct
> applies at all* outside the condition. It always applies.

---

## Contradiction detection

**OPEN.** **P9** requires that a contradiction triggers clarification. What *counts* as a
contradiction is undefined.

- **Within one construct:** two responses at opposite poles.
- **Across constructs:** a pattern that cannot both be true — e.g. high Life Protection with
  high Career Centrality (5.1 and 5.2, near-inverses).
- **Between families:** **OPEN** whether cross-family contradiction is detected at all.
- **In the tradeoff graph:** a cycle (`A > B`, `B > C`, `C > A`) — see
  [11 · Tradeoff graph](11-tradeoff-model.md#tradeoff-graph). Not a data error, not resolvable
  by arithmetic; it signals edges measured under different scenarios and routes to a clarifier.

Detection rules are [D-EC-09](OPEN-DECISIONS.md#d-ec-09). What fires in response is
[05](05-adaptive-clarifiers.md). Where a contradiction *resolves*, it lands in
[Resolution](#5--resolution).

---

## Worked examples — Maleri

> ### ILLUSTRATIVE ONLY — not locked client conclusions.
>
> These demonstrate how the five dimensions and the C-states are applied. They are not an
> approved reading of this person and classify nothing.
>
> **Provenance varies and is stated per example.** Life Protection and Guidance / Autonomy
> draw on evidence Peri supplied on 2026-08-22 (see
> [11 §7](11-tradeoff-model.md#7--worked-example--maleri)). **Create** and **Pressure
> Response** describe evidence shapes whose underlying items are **not in this repository** —
> they illustrate the mechanism, not this client.

### Life Protection — strong evidence, still not a Need

*Evidence supplied.* Two tradeoff edges (over Accelerated Advancement; over Career Centrality,
Q64) · absence-consequence (Q72 — "accomplished but consumed by work" is what she most
hates) · future projection (Q82).

| Dimension | Read |
|---|---|
| Coverage | Adequate → Rich |
| Consistency | Consistent |
| Independence | 3 types — tradeoff, construct-level, real-life self-report |
| Consequence | **Present** — Q72 is explicit absence-consequence |
| Resolution | No meaningful contradiction |

**Provisional read: C3.** And it still **cannot be called a Need**, for two separate reasons:

1. **The C3 threshold itself is unset.** The minimum evidence required for each state is
   [D-EC-12](OPEN-DECISIONS.md#d-ec-12). "C3" here is a shape, not a verdict.
2. **Confidence is one of six Need criteria.** Criterion 4 — *real-life evidence supports the
   interpretation* — is **unmet**: Q82 is an aspiration produced inside the assessment, not
   Stage 2 corroboration. And per [Rule D](#d--stage-2-context-cannot-retroactively-inflate-stage-1-confidence),
   Stage 2 material could not raise the confidence number anyway.

**This is the point of separating confidence from classification.** High confidence in *what
we measured* is not permission to classify. See the full six-criterion walkthrough in
[11 §7](11-tradeoff-model.md#applying-the-need-pathway--and-stopping-short).

### Create — high confidence, Strong Preference not Need

*⚠️ Underlying items not in this repository.* Illustrative shape.

Multiple structured signals plus a creative-writing self-report can support **high confidence
in the preference** — Coverage Rich, Consistency Consistent, Independence across structured
and self-report forms.

Classification nonetheless lands at **Strong Preference**, because Strong Preference is
defined as *clearly preferred and meaningful, but tradeable for higher-priority outcomes*
([02](02-needs-preferences-flexibility.md)). Nothing in high confidence argues against being
tradeable. **C3 + Strong Preference is a perfectly ordinary pairing, not a contradiction.**

### Guidance / Autonomy — mixed evidence resolving to a conditional

*Evidence partly supplied.* The Support-vs-Autonomy result is recorded in
[11](11-tradeoff-model.md#conditional-candidate--support-vs-autonomy) as a **candidate
conditional** with the conditioning variable unknown. Q63 establishes that Freedom survives
financial comfort — so any support-leaning result is not a Freedom-is-weak result.

The naive path: mixed evidence → average → **"moderate autonomy."** That is
[Rule A](#a--missing-evidence-is-not-neutral-evidence) and **P9** failing together.

The correct path: mixed evidence → [Resolution](#5--resolution) → **resolved into a
conditional pattern** →

> *"Needs developmental support while learning; prefers autonomy after competence."*

Per [Rule F](#f--a-conditional-pattern-can-be-highly-supported) that can be **C3**. It is
*more* specific than either pole.

**Not yet, though.** For Maleri the conditioning variable is **not known** — `competence` and
`familiarity` are inferences, not evidence. Until a clarifier establishes it, Resolution is
**unresolved**, not *resolved into a conditional*, and the read is **C1/C2**, not C3. The
difference between a resolved conditional and an unresolved contradiction is exactly one
clarifier, and it is a Tier 1 clarifier — it could change a classification.

### Pressure Response — one signal, stays C1

*⚠️ No such item is in this repository.* Illustrative.

One isolated response with little corroboration:

| Dimension | Read |
|---|---|
| Coverage | **Sparse** |
| Consistency | n/a — nothing to be consistent with |
| Independence | One type |
| Consequence | None established |
| Resolution | n/a |

**C1 — Emerging.** Allowed as a background hypothesis and as a potential clarifier trigger.
**Not** allowed into a Need classification or a major DECODED claim.

**Likely omitted from the report entirely**, unless later evidence makes it consequential.
Per [Rule A](#a--missing-evidence-is-not-neutral-evidence), omission is the correct handling —
not a hedged sentence. And per the [marginal-value test](#the-marginal-information-value-test),
a clarifier here is only worth asking if the answer could change something prominent; if not,
it is a Tier 3 question and is skipped.

> **Node note.** "Pressure Response" is **not a construct in the registry**. The closest is
> [6.4 Failure Response](01-construct-registry.md#64--failure-response). This is another
> instance of the node-vocabulary gap, [D-TM-09](OPEN-DECISIONS.md#d-tm-09).

---

## Open decisions

| ID | Question |
|---|---|
| [D-EC-01](OPEN-DECISIONS.md#d-ec-01) | What is an evidence unit? |
| [D-EC-02](OPEN-DECISIONS.md#d-ec-02) | Do evidence types carry **formal weights**? |
| [D-EC-03](OPEN-DECISIONS.md#d-ec-03) | Can one response feed multiple constructs? |
| [D-EC-04](OPEN-DECISIONS.md#d-ec-04) | **How do the five dimensions combine** into a single C-state? |
| [D-EC-05](OPEN-DECISIONS.md#d-ec-05) | Is there a **numeric substrate** beneath the C0–C3 categories? |
| [D-EC-06](OPEN-DECISIONS.md#d-ec-06) | Uniform or per-construct thresholds? |
| [D-EC-07](OPEN-DECISIONS.md#d-ec-07) | Overall artifact confidence — derived, or measured separately? |
| [D-EC-08](OPEN-DECISIONS.md#d-ec-08) | Is confidence ever shown **directly to clients**? |
| [D-EC-09](OPEN-DECISIONS.md#d-ec-09) | Contradiction detection rules |
| ~~[D-EC-10](OPEN-DECISIONS.md#d-ec-10)~~ | ✅ **CLOSED** — confidence and classification are separate. [Rule B](#b--confidence-is-about-the-interpretation-only). |
| [D-EC-11](OPEN-DECISIONS.md#d-ec-11) | Does **Stage 2** validation create a separate confidence layer? — [Rule D](#d--stage-2-context-cannot-retroactively-inflate-stage-1-confidence) |
| [D-EC-12](OPEN-DECISIONS.md#d-ec-12) | **Exact minimum evidence required for C1 / C2 / C3** |
| [D-EC-13](OPEN-DECISIONS.md#d-ec-13) | Exact clarifier trigger threshold |
| [D-EC-14](OPEN-DECISIONS.md#d-ec-14) | Do specific constructs **require** specific evidence types? |
| [D-EC-15](OPEN-DECISIONS.md#d-ec-15) | Can one open-ended response provide **multiple independent** signals? |
| [D-EC-16](OPEN-DECISIONS.md#d-ec-16) | How does **client disagreement** affect construct confidence? |
| [D-EC-17](OPEN-DECISIONS.md#d-ec-17) | How do **coach edits / review** affect confidence? |
| [D-EC-18](OPEN-DECISIONS.md#d-ec-18) | Does Assessment Sufficiency use **family-specific minimums**? |
| [D-EC-19](OPEN-DECISIONS.md#d-ec-19) | How is **Marginal Information Value** operationalised? |

---

## Status of this document

**REVIEW.** The governing principle, the five dimensions and their states, the C0–C3 states
with their allowed and disallowed uses, the confidence/classification separation, the three
levels, the stopping rule, the clarifier tiers and rules A–F are all as Peri specified them on
2026-08-23.

Added from reading this against the existing directory, and flagged as such in place: the
evidence-type versus item-type overlap ([D-AA-02](OPEN-DECISIONS.md#d-aa-02)), the
Life-Protection consistency check against
[11 §7](11-tradeoff-model.md#applying-the-need-pathway--and-stopping-short), and the note that
"Pressure Response" is not a registry construct.

**Nothing is LOCKED.** Every threshold in this document is `OPEN` — the states are
categories without boundaries, which is deliberate at this stage and is exactly what
[D-EC-12](OPEN-DECISIONS.md#d-ec-12) has to close before any of it is implementable.

Tracked in SIGNAL PM as `CNL R0 — Confidence methodology`, which blocks
`CNL R1 — Assessment confidence state and completion / stopping logic`.
