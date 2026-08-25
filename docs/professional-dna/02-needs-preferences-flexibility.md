# 02 · Needs, strong preferences and flexibility

**Status:** DRAFT
**Methodology version:** v0.8
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23

---

## Why this framework exists

A Professional DNA score says *how much* something matters. It does not say whether the
person can live without it. Two clients can both score high on Freedom and mean completely
different things: one will decline an offer over it, the other would prefer it and will
trade it for something else.

Downstream, four separate systems need that distinction and cannot derive it themselves:

| Consumer | Needs the tier to |
|---|---|
| **R2 Career Trajectory** | Decide which paths are viable at all versus merely imperfect |
| **R5 Lanes** | Decide which criteria are filters and which are preferences |
| **R6 DNA Watchpoints** | Decide what a client must investigate before wanting a job |
| **R9 Offer Decision** | Separate a conflict that ends the conversation from a tradeoff |

Per **P2**, a need is never silently traded away to make a path work.

---

## The three tiers

**OPEN.** Peri has named three tiers — *need*, *strong preference*, *flexibility* — and has
not yet defined them. The definitions below are placeholders and are deliberately empty.

### Tier 1 — Need
**Definition:** OPEN
**Test a coach can apply:** OPEN — but one *pathway* now exists. [11-tradeoff-model.md §6](11-tradeoff-model.md#6--connection-to-needs--preferences--flexibility) gives six conditions that must ALL hold before tradeoff evidence can qualify a factor as a Need. That is the tradeoff pathway only; it is not the definition, and non-tradeoff pathways remain OPEN.
**Behaviour downstream:** OPEN

> **Need criterion 6 — *confidence is sufficient* — now has a model behind it.**
> [04](04-evidence-and-confidence.md) defines four internal states C0–C3; only **C3** permits a
> Need classification, and even then only if the other five Need criteria hold separately.
> **Confidence does not determine classification** — see
> [04 §Confidence is not classification](04-evidence-and-confidence.md#confidence-is-not-classification).
> The threshold for C3 itself is [D-EC-12](OPEN-DECISIONS.md#d-ec-12), still open.

### Tier 2 — Strong preference
**Definition:** OPEN
**Test a coach can apply:** OPEN
**Behaviour downstream:** OPEN

### Tier 3 — Flexibility
**Definition:** OPEN
**Test a coach can apply:** OPEN — tradeoff pathway in [11 §6](11-tradeoff-model.md#6--connection-to-needs--preferences--flexibility): choices vary by context, or the factor repeatedly loses without evidence of material consequence.
**Behaviour downstream:** OPEN

> ###  New requirement from the 2026-08-23 construct lock
>
> [DL-009](DECISION-LOG.md#dl-009) locked that **preference versus necessity is a
> classification, not a construct.** The distinction between *wanting* developmental support
> and *requiring* it was deliberately kept out of
> [1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support)
> and assigned to **this layer** instead, rather than splitting the construct in two.
>
> This layer must therefore be able to carry preference-versus-necessity for a
> **contextual / conditional** construct — where the answer may legitimately differ by
> condition. A tier design that assumes one answer per construct cannot express it.
> Recorded on [D-NPF-01](OPEN-DECISIONS.md#d-npf-01).
>
> ### ⚠️ Update 2026-08-23 — the boundary this layer owns is now contested
>
> [DL-010](DECISION-LOG.md#dl-010) revised 1.1's canonical definition to read *"benefits from
> **and prefers** access to active developmental input."* **The construct now names preference
> itself.** The premise of the paragraph above — that preference was *"deliberately kept out
> of"* the construct — no longer holds as stated.
>
> **The lock stands.** Peri did not retract it, and this layer still owns
> preference-versus-necessity. But the split is now:
>
> | Layer | Question it answers |
> |---|---|
> | [1.1](01-construct-registry.md#11--guidance--development-support) | **How much** developmental input helps and is wanted |
> | **This layer** | **How tradeable** it is — need / strong preference / flexible |
>
> That reading is **not yet Peri's decision** — it is the working reading recorded in the
> registry so the documents stay consistent. Confirming or replacing it is
> [D-CR-14](OPEN-DECISIONS.md#d-cr-14), and it must be settled before tier-placement items are
> authored, because a coach cannot apply a boundary that is only implied.

### ⚠️ A fourth state, and a naming mismatch

[11-tradeoff-model.md](11-tradeoff-model.md) introduces **UNRESOLVED** — evidence sparse, conflicting, or dependent on a variable not yet understood — and calls tier 3 **Flexible / Range** rather than Flexibility.

Whether UNRESOLVED is a fourth tier or the absence of a classification, and which naming stands, is [D-NPF-08](OPEN-DECISIONS.md#d-npf-08). It is not decided here, because it changes the shape of this framework rather than the tradeoff model.

---

## Open decisions

| ID | Question |
|---|---|
| [D-NPF-01](OPEN-DECISIONS.md#d-npf-01) | What are the three tier definitions, and what is the test that places an item in one? |
| [D-NPF-02](OPEN-DECISIONS.md#d-npf-02) | Is the tier **derived** from a construct score, **asked directly**, or **both**? A high score is not the same as a need. |
| [D-NPF-03](OPEN-DECISIONS.md#d-npf-03) | Does every construct get a tier, or only a named subset? 44 tiering questions will not fit a 15–20 minute assessment. |
| [D-NPF-04](OPEN-DECISIONS.md#d-npf-04) | Can a person hold more than N needs? If everything is a need, nothing is. Is there a cap, and is it enforced or advisory? |
| [D-NPF-05](OPEN-DECISIONS.md#d-npf-05) | Who may revise a tier — client, coach, both — and does a revision create a new DNA artifact version or sit alongside the frozen one? Per **P11** the artifact is immutable, which implies tiers may need to live outside it. |
| [D-NPF-06](OPEN-DECISIONS.md#d-npf-06) | Are tiers part of the **frozen DNA artifact** (Stage 1) or are they Stage 2 context? A need like "must stay in Boston" is a practical constraint, not a discovered trait — and Stage 1 may not know it. |
| [D-NPF-07](OPEN-DECISIONS.md#d-npf-07) | How does this relate to the existing `ProfileConstraints` booleans — supersede, wrap, or coexist? See below. |
| [D-NPF-08](OPEN-DECISIONS.md#d-npf-08) | Is `UNRESOLVED` a fourth tier or the absence of a classification, and is tier 3 called Flexibility or Flexible / Range? Raised by [11](11-tradeoff-model.md). |

---

## Conflict with existing SIGNAL code

SIGNAL **already has** a needs-and-preferences representation, and it does not match this
framework.

`ProfileConstraints` in `app/api/jobfit/signals.ts:105` carries nine booleans:

```
hardNoHourlyPay · prefFullTime · hardNoContract · hardNoSales · hardNoGovernment
hardNoFullyRemote · preferNotAnalyticsHeavy · hardNoContentOnly · hardNoPartTime
```

They are populated by regex over two free-text intake fields (`hard_nos`, `constraints`) in
`app/api/profile-intake/route.ts:545-557`, and they feed the deterministic JobFit gate
evaluation in `app/api/jobfit/constraints.ts`.

Three mismatches:

1. **Binary, not tiered.** A constraint is a hard-no or it is absent. There is no strong
   preference and no flexibility — `prefFullTime` and `preferNotAnalyticsHeavy` are the only
   two soft ones and they are still booleans.
2. **Fixed vocabulary.** Nine named constraints, not a tier applied to an arbitrary
   construct.
3. **Regex-derived from prose**, not asked. The client never states a tier; a pattern match
   over free text decides.

**This is a live dependency, not legacy.** These booleans gate real JobFit decisions today.
Any decision here that changes them touches the deterministic scoring path, which is
protected by the 26-case regression suite and by `CNL R6 — JobFit score isolation guarantee`.

Resolving [D-NPF-07](OPEN-DECISIONS.md#d-npf-07) is therefore not a documentation choice —
it decides whether R1 introduces a second, competing preferences model into a product that
already has one.

---

## Status of this document

**DRAFT.** The framework is named and its consumers are identified. Every definition is
`OPEN`. Nothing here is implementable.

Tracked in SIGNAL PM as `CNL R0 — Needs vs strong preferences vs flexibility framework`,
which blocks R1, R2, R5 and R9.
