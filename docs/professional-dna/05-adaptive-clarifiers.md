# 05 · Adaptive clarifiers

**Status:** DRAFT
**Methodology version:** v0.8
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23

A clarifier is a follow-up the assessment asks when it does not yet know something it needs
to know. Clarifiers are what let the core question set shrink without losing resolution
(**P8**).

---

## What is settled

**1 · A clarifier fires on a measured condition, not a model judgement.**
The trigger is deterministic. The assessment does not ask a model whether it would like to
follow up.

**2 · Contradictions trigger clarification, never averaging (P9).**
This is the primary reason clarifiers exist.

**3 · There is a ceiling.**
A hard per-session cap, counted inside the length budget in
[03](03-assessment-architecture.md). Without it, adaptive clarification is an unbounded
assessment.

**4 · A clarifier may never introduce contextual data (P1).**
No clarifier may reference or draw on the resume, coach notes, profile, education, stated
goals or job history. A clarifier that says "your resume shows…" breaks the blind
calculation and invalidates the artifact. See [09](09-context-boundary.md).

---

## Trigger conditions

**OPEN.** The conditions are deterministic by principle; which conditions they are is not
decided.

Candidate triggers, **not decided**:

| Candidate | Notes |
|---|---|
| Construct below its confidence threshold after all core items | The main coverage case |
| Contradiction detected within a construct | The **P9** case |
| Contradiction detected across constructs | Depends on [D-EC-09](OPEN-DECISIONS.md#d-ec-09) |
| Response at an extreme pole with thin supporting evidence | An extreme reading deserves a check |
| Long-form response that does not resolve the item it answered | e.g. meaning-of-money on construct 4.6 |
| **A conditional construct's conditioning variable is unknown** |  New 2026-08-23. [1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support) is locked as **contextual / conditional** with the conditioning variable **deliberately unlocked**. A clarifier is the obvious instrument for establishing which variable applies to a given person — but the trigger and the question are unspecified. [D-CR-13](OPEN-DECISIONS.md#d-cr-13). |
| **Tradeoff result is surprising, contradicts an earlier edge, or looks conditional** | Required by [11 §8 rule 7](11-tradeoff-model.md#8--assessment-design-rules). Three sub-cases: a graph **cycle**; a result that contradicts real-life evidence; and a suspected **conditional** where the conditioning variable is unknown — the Support-vs-Autonomy case in the [worked example](11-tradeoff-model.md#conditional-candidate--support-vs-autonomy) is exactly this. |
| Construct is an input to a candidate decoded insight and is short of the bar | Would let insight generation pull the assessment longer — see the warning below |

Open: [D-AC-01](OPEN-DECISIONS.md#d-ac-01).

> **Warning on the last candidate.** Letting a decoded insight pull for more evidence
> inverts **P10** — insights would start driving the assessment rather than resulting from
> it. Recorded as a trigger candidate because it is tempting, and flagged because it is
> probably wrong. This is [D-AC-02](OPEN-DECISIONS.md#d-ac-02).

---

## What a clarifier may ask

**OPEN, and this is the load-bearing decision in this document.**

Two mutually exclusive designs, both viable, with different consequences:

| | **Fixed bank** | **Constrained generation** |
|---|---|---|
| What it is | A pre-written clarifier per trigger condition, authored and reviewed | A model writes the clarifier at runtime under explicit constraints |
| Auditable | Yes — every possible question is known in advance | No — the exact wording is not knowable before it is asked |
| Adapts to the specific response | Poorly | Well |
| Cost | Zero marginal | One model call per clarifier |
| Failure mode | A clarifier that does not quite fit the contradiction it fired on | A clarifier that leaks context, leads the client, or asks something the methodology does not measure |
| Reviewability by Peri | Complete, up front | Only by sampling live output |
| Determinism | Full | Partial — same inputs may produce different wording |

This is [D-AC-03](OPEN-DECISIONS.md#d-ac-03), and it is already recorded in SIGNAL PM as an
open decision on `CNL R0 — Adaptive clarification rules`. **It must be decided before R1
engineering**, because the two designs need different infrastructure: a bank needs authored
content and a lookup; generation needs a prompt, a version pin, a validation layer and a
containment guard against **P1** leakage.

A third option — a fixed bank with model-selected *slotting* — is noted but not recommended
in either direction here, because recommending is Peri's call.

---

## Clarifier priority

When several ambiguities remain, the ordering is defined in
[04 §Clarifier priority](04-evidence-and-confidence.md#clarifier-priority) and is not restated
here:

| Tier | Ask it when |
|---|---|
| **1 — Result-changing** | It could change a Need, a major DECODED insight, a Growth Edge, or a primary operating conclusion |
| **2 — Career-relevant** | It could materially change environment or path interpretation |
| **3 — Nice-to-know** | It would make the report more interesting but not meaningfully better — **normally skipped** |

Before asking anything, apply the
[marginal-information-value test](04-evidence-and-confidence.md#the-marginal-information-value-test):
*could the answer materially change a prominent result?* If no, do not ask. That test is the
operational form of **P8**, and how it is computed is
[D-EC-19](OPEN-DECISIONS.md#d-ec-19). The trigger threshold itself is
[D-EC-13](OPEN-DECISIONS.md#d-ec-13).

---

## Ceiling and budget

| Question | State |
|---|---|
| Maximum clarifiers per session | OPEN — [D-AC-04](OPEN-DECISIONS.md#d-ac-04) |
| Maximum clarifiers per construct | OPEN |
| Do clarifiers count against the item budget or sit outside it? | OPEN |
| What happens when the ceiling is hit with a contradiction unresolved | **P9 implies:** report low confidence with the contradiction visible. Confirm as [D-AC-05](OPEN-DECISIONS.md#d-ac-05). |

---

## Recording

Every clarifier asked must be recorded — which construct, which trigger, what was asked,
what came back. Two reasons:

1. **Provenance (P12).** A construct score partly derived from a clarifier answer must trace
   to it.
2. **Validation.** Clarifier frequency is one of the methodology-validation metrics in
   [08](08-validation-framework.md), and it is an R1 instrumentation acceptance criterion in
   SIGNAL PM.

Whether the clarifier *text* is stored with the response — required if generation is chosen,
optional if a bank is — falls out of [D-AC-03](OPEN-DECISIONS.md#d-ac-03).

---

## Open decisions

| ID | Question |
|---|---|
| [D-AC-01](OPEN-DECISIONS.md#d-ac-01) | Which deterministic conditions trigger a clarifier? |
| [D-AC-02](OPEN-DECISIONS.md#d-ac-02) | May a decoded insight's evidence shortfall trigger a clarifier? (Probably no — inverts P10.) |
| [D-AC-03](OPEN-DECISIONS.md#d-ac-03) | **Fixed bank or constrained generation?** Blocks R1 engineering. |
| [D-AC-04](OPEN-DECISIONS.md#d-ac-04) | What is the per-session ceiling, and is there a per-construct one? |
| [D-AC-05](OPEN-DECISIONS.md#d-ac-05) | Confirm: ceiling reached with a contradiction unresolved → low confidence, contradiction visible. |

---

## Status of this document

**DRAFT.** Four things settled at principle level. The central design choice
([D-AC-03](OPEN-DECISIONS.md#d-ac-03)) is open and blocks R1. Tracked in SIGNAL PM as
`CNL R0 — Adaptive clarification rules`.
