# 06 · Decoded insights

**Status:** DRAFT
**Methodology version:** v0.8
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23

---

## Primary constructs vs derived / decoded insights

These are two different kinds of object and the methodology must never blur them.

| | **Primary construct** | **Decoded insight** |
|---|---|---|
| What it is | A thing SIGNAL measures | A reading of how two or more measured things combine |
| Source | Assessment responses | Other constructs — never responses directly |
| Registered in | [01-construct-registry.md](01-construct-registry.md) | This document |
| Has its own score | Yes | **No** |
| Has its own evidence | Yes — assessment items | **No** — it inherits the evidence of its inputs |
| Can be independently true | Yes | **No** |
| Appears always | Where confidence permits | Only when **every** input construct meets its bar |
| Confidence ceiling | Its own | **The weakest essential input** — see below |

**A decoded insight is not an independent trait.** It has no separate existence, no separate
measurement and no separate confidence of its own. It is a sentence that becomes sayable
when a particular combination of measured constructs holds.

If a decoded insight is ever given its own score, its own item, or its own place in the
registry, the distinction has collapsed and the methodology is broken.

### A DECODED insight cannot exceed its weakest essential input

Derived confidence is **capped**, not averaged. If one required construct sits at `C1`, the
insight **cannot** be `C3` — regardless of how strong the other inputs are.

This follows directly from **P10**: a decoded insight has no evidence of its own, so its
inputs are a ceiling. Which inputs are *essential* versus merely contributing is part of each
insight's trigger condition, and all of those are `OPEN`.

Full statement in
[04 §Derived / DECODED Confidence](04-evidence-and-confidence.md#2--derived--decoded-confidence).

### Evidence direction is one-way

Tradeoff patterns **may contribute to** a decoded insight. Decoded language **may never
become evidence** for the tradeoff model, for a construct, or for a classification.

**Permitted, and the only permitted direction:**

```
responses → tradeoff evidence → construct interpretation → classification → DECODED
```

**Never:** `DECODED → tradeoff evidence`

A decoded insight has no evidence of its own — it inherits its inputs' evidence. Feeding it
back would let a reading become its own support, and the circularity would be invisible in
the output: it would look like corroboration. Full statement in
[11 §9](11-tradeoff-model.md#9--decoded-boundary).

---

## The generation rule (P10)

A decoded insight appears **only** when sufficient evidence exists across **every** one of
its underlying constructs.

Three consequences, stated explicitly because each is a failure this rule exists to prevent:

1. **Never generated because the language sounds compelling.** "Competence Creates Safety"
   is a good sentence. That is not a reason to say it about someone. Eloquence is not
   evidence (**P10**, **P12**).
2. **One weak input suppresses the whole insight.** An insight drawing on three constructs
   where two are strong and one is thin does **not** appear in a softened form. It does not
   appear. Per **P12**, a statement that cannot be traced is dropped, not hedged.
3. **Suppression is silent to the client and visible to the coach.** A client should not be
   told which insights they narrowly missed. Whether the coach sees near-misses is
   [D-DI-02](OPEN-DECISIONS.md#d-di-02).

**These are candidate intersections, not personality types.** SIGNAL does not assign types.
There is no fixed set of profiles a person is sorted into, and the list below must never
become one.

---

## Candidate intersections

**These are examples of the form, offered for review. They are not approved, not exhaustive,
and not hard-coded types.** Each carries the constructs it draws on so the evidence
requirement is inspectable.

The headline phrasing below is Peri's. The *reading* line under each is a working gloss —
**not a decision, for review only** — and the trigger conditions are `OPEN` in every case.

---

### DI-01
**Guidance × Creation → "Freedom to Create, Not Freedom From Support"**

**Input constructs:** [1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support) · [2.4 Create](01-construct-registry.md#24--create)
*Working reading — NOT a decision:* wanting latitude over the work is not the same as wanting to be left alone; the person wants creative room and still wants backing.
**Trigger condition:** OPEN
**Confidence requirement:** OPEN
**Notes:**  **Partly unblocked 2026-08-23.** [DL-009](DECISION-LOG.md#dl-009) locked that [1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support) is **orthogonal to autonomy, not the opposite end of an autonomy spectrum**, and that a person can want substantial developmental support *and* substantial autonomy at once. That is precisely the claim this insight rests on, and it is now settled from 1.1's side rather than inferred.
⚠️ **Still blocked from the other side:** [4.8 Freedom](01-construct-registry.md#48--freedom) is **not** one of the five locked constructs and still carries only a gloss. The separation of *freedom* from *freedom from support* has to be established in 4.8's own does-not-measure field before this insight can be specified. Consider whether 4.8 is a third input.
Note also that 1.1 is now **contextual / conditional**, so this insight may itself be conditional — see [D-CR-13](OPEN-DECISIONS.md#d-cr-13).

**Strengthened 2026-08-23 by [DL-010](DECISION-LOG.md#dl-010).** 1.1's definition now explicitly contains *prefers*, so this insight — *freedom to create, not freedom from support* — reads directly off the construct rather than through an effect-framing that never named wanting. And because the condition is now an intensifier (*"especially while becoming grounded"*) rather than a scope, the insight is **not confined to unfamiliar work**: a person can want developmental backing and creative latitude at once in work they know well. That is the more useful reading for a coach, and it was not available under the v0.7 text.

### DI-02
**Outcome Ownership × Decision Influence × Low Formal Leadership Need → "Influence Without Dominance"**

**Input constructs:** [3.1 Outcome Ownership](01-construct-registry.md#31--outcome-ownership) · [3.3 Decision Influence](01-construct-registry.md#33--decision-influence) · [3.2 Formal Leadership](01-construct-registry.md#32--formal-leadership) *(low pole)*
*Working reading — NOT a decision:* wants something clearly theirs to be accountable for, and wants to shape consequential decisions, without wanting a title or authority over people.
**Trigger condition:** OPEN
**Confidence requirement:** OPEN
**Notes:** **Inputs disambiguated 2026-08-22.** Both were previously ambiguous — `Ownership` and `Influence` each appeared twice in the registry. The renames ([DL-001](DECISION-LOG.md#dl-001), [DL-002](DECISION-LOG.md#dl-002)) fix which construct each input refers to: family 3 in both cases, not family 4's Ownership and not family 2's Persuasion / Influence Work. This insight can now be *specified*; it still cannot be *built*, because all three input definitions are `OPEN`.
 **Premise retired 2026-08-23.** [DL-005](DECISION-LOG.md#dl-005) **removed** *"without requiring formal authority or people management"* from the canonical definition of [3.3 Decision Influence](01-construct-registry.md#33--decision-influence) — that clause described a relationship between constructs, not a property of one. The two are now formally **independent**: a person can be high on both, high on one, or low on both.
⚠️ **Consequence for this insight:** low Formal Leadership is now a **genuine independent claim** about the person rather than near-tautological, which makes the case for keeping it as a third input *stronger* than when the concern was raised. [D-DI-08](OPEN-DECISIONS.md#d-di-08) is **narrowed** to the remaining DECODED question — is 3.2 *necessary* here? — and **3.2 must not be silently removed as an input**; doing so requires its own approved DECODED decision.
Strong **P4** exposure remains: the low pole of Formal Leadership is an *input to a positive insight here*, which is the right treatment and must be preserved.

### DI-03
**Creation × Mastery × Low Recognition → "Your Success Doesn't Need an Audience"**

**Input constructs:** [2.4 Create](01-construct-registry.md#24--create) · [4.4 Mastery](01-construct-registry.md#44--mastery) · [4.9 Recognition](01-construct-registry.md#49--recognition)
*Working reading — NOT a decision:* the satisfaction is in the making and the getting-good, not in being seen doing it.
**Trigger condition:** OPEN
**Confidence requirement:** OPEN
**Notes:** Depends on [D-CR-03](OPEN-DECISIONS.md#d-cr-03) — whether Mastery (4.4) or Mastery vs Breadth (6.1) is the input.

### DI-04
**Stability × Experimentation × Growth → "Stable Base. Room to Evolve."**

**Input constructs:** [5.3 Stability](01-construct-registry.md#53--stability) · [1.7 Experimentation](01-construct-registry.md#17--experimentation) · [5.5 Growth Need](01-construct-registry.md#55--growth-need)
*Working reading — NOT a decision:* a secure footing is what makes trying things possible, rather than being the opposite of it.
**Trigger condition:** OPEN
**Confidence requirement:** OPEN
**Notes:** The cleanest example of why decoded insights matter — Stability and Experimentation read as opposed until they are put together. Depends on the Stability / Security / Predictability boundary being resolved (three constructs across three families circling one idea).

### DI-05
**Life Protection × Meaning → "Work Should Matter Without Becoming Your Whole Life."**

**Input constructs:** [5.1 Life Protection](01-construct-registry.md#51--life-protection) · [4.1 Meaning](01-construct-registry.md#41--meaning)
*Working reading — NOT a decision:* high meaning need does not imply willingness to be consumed by the work.
**Trigger condition:** OPEN
**Confidence requirement:** OPEN
**Notes:** Consider whether [5.2 Career Centrality](01-construct-registry.md#52--career-centrality) is a third input, given it is the near-inverse of 5.1.

### DI-06
**Mastery × Stretch Discomfort × autonomy/support evidence → "Competence Creates Safety"**

**Input constructs:** [4.4 Mastery](01-construct-registry.md#44--mastery) · [6.2 Stretch Comfort](01-construct-registry.md#62--stretch-comfort) *(low pole)* · [1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support) and/or [4.8 Freedom](01-construct-registry.md#48--freedom)
*Working reading — NOT a decision:* the person needs to feel competent before they feel safe, so stretch is uncomfortable until mastery is established.
**Trigger condition:** OPEN
**Confidence requirement:** OPEN
**Notes:** ⚠️ **Two problems to resolve before this can be specified.** First, "autonomy/support evidence" is not a named construct — it must resolve to 1.1, 4.8, or both ([D-DI-03](OPEN-DECISIONS.md#d-di-03)). Second, this is the insight with the **highest P4 risk in the set**: it is built on the low pole of Stretch Comfort and could easily read as "you are risk-averse." The approved wording must make competence-seeking a strength, not a limitation.

---

## Open decisions

| ID | Question |
|---|---|
| [D-DI-01](OPEN-DECISIONS.md#d-di-01) | Is the decoded-insight set **fixed and authored** (a registry like the constructs) or **generated** under constraints at runtime? This is the equivalent of [D-AC-03](OPEN-DECISIONS.md#d-ac-03) and has the same auditability tradeoff. |
| [D-DI-02](OPEN-DECISIONS.md#d-di-02) | Does the coach see near-miss insights the client did not qualify for? |
| [D-DI-03](OPEN-DECISIONS.md#d-di-03) | DI-06 — what does "autonomy/support evidence" resolve to? |
| [D-DI-04](OPEN-DECISIONS.md#d-di-04) | Minimum and maximum decoded insights per artifact. Zero must be a valid outcome; is it? |
| [D-DI-05](OPEN-DECISIONS.md#d-di-05) | Are the six above the complete candidate set, or a sample of a longer list? |
| [D-DI-06](OPEN-DECISIONS.md#d-di-06) | May two decoded insights share an input construct, and may they contradict each other? |
| [D-DI-07](OPEN-DECISIONS.md#d-di-07) | Do decoded insights carry into Stage 2 and Stage 3 as inputs, or are they presentation-only? Career Trajectory reading a decoded insight would make it a de-facto trait. |
| [D-DI-08](OPEN-DECISIONS.md#d-di-08) | DI-02 — is [3.2 Formal Leadership](01-construct-registry.md#32--formal-leadership) a genuine third input, or redundant given that 3.3 Decision Influence is already defined as operating without formal authority? Raised by the 2026-08-22 rename. |
| [D-DI-09](OPEN-DECISIONS.md#d-di-09) | If [4.11 Ownership](01-construct-registry.md#411--ownership) is found to be **derived** rather than distinct ([D-CR-01](OPEN-DECISIONS.md#d-cr-01)), it becomes a decoded insight computed from Outcome Ownership × Achievement × Freedom. Does it then belong in this document as DI-07, and does it need a headline phrasing? |

---

## Status of this document

**DRAFT.** The primary-vs-derived distinction and the generation rule follow from **P10**
and **P12** and are stated here for approval. All six intersections are candidates with
`OPEN` trigger conditions. Two (DI-02, DI-06) cannot be specified at all until registry
naming collisions are resolved.

Tracked in SIGNAL PM as `CNL R0 — DECODED / intersection insight methodology`.
