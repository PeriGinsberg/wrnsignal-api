# 03 · Assessment architecture

**Status:** DRAFT
**Methodology version:** v0.8
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23

How the assessment is built: what an item is, how items are sequenced, how long it may run,
and when it stops.

---

## What is settled

Only three things. Everything else in this document is `OPEN`.

**1 · Length is earned by uncertainty (P8).**
A question is asked because the answer is not yet determined and the construct it serves has
not reached its confidence requirement — never because the question exists.

**2 · Adaptive stopping is part of the methodology.**
It is not an optimisation layered on afterwards. A fixed-length assessment is not this
methodology with a cap; it is a different methodology.

**3 · The self-serve completion target is fixed.**
Approximately **15–20 minutes typical, 25 minutes maximum for most users.** Stated by Peri.
Every architectural decision here is measured against it.

---

## Length budget

| Target | Value | Source |
|---|---|---|
| Self-serve, typical | ~15–20 minutes | Stated by Peri |
| Self-serve, maximum for most users | 25 minutes | Stated by Peri |
| **Coached-session target** | **OPEN** — [D-AA-01](OPEN-DECISIONS.md#d-aa-01) | not yet set |
| Core item count | **OPEN** | |
| Clarifier ceiling per session | **OPEN** — see [05](05-adaptive-clarifiers.md) | |
| Budget expressed in items as well as minutes | **OPEN** | engineering has to design against a count, not a duration |

The current prototype is longer than this budget. Reducing it is tracked as
`CNL R0 — Core-question reduction from the current prototype`, which is a research task
against real prototype responses, not an editorial pass.

---

## Item types

**OPEN.** The methodology needs a fixed set of item types before scoring, confidence or
clarifiers can be specified, because each type produces a different kind of evidence.

Candidate types, **not decided**, listed only to give the decision a shape:

- Forced-choice between two constructs (produces relative weight) — **the tradeoff item.**
  Its methodology is defined in [11-tradeoff-model.md](11-tradeoff-model.md); its design
  constraints are [§8 Assessment design rules](11-tradeoff-model.md#8--assessment-design-rules),
  and its ceiling is [D-TM-08](OPEN-DECISIONS.md#d-tm-08) — repeated forced choices create
  fatigue and artificial certainty, so the length budget below has to hold a cap on them
- Ranked set (produces ordering within a family)
- Likert / intensity (produces a level)
- Scenario response (produces behaviour under a described condition)
- Long-form verbatim (produces meaning, e.g. the meaning-of-money axis on construct 4.6)
- Direct experiential recall requested *inside* the assessment — permitted under Stage 1,
  see [09](09-context-boundary.md)

Open: [D-AA-02](OPEN-DECISIONS.md#d-aa-02).

---

## Sequencing

**OPEN.** Unresolved: whether families are asked in a fixed order; whether early responses
reorder later items; whether the assessment opens with the least or most abstract family;
whether long-form items are front-loaded (better answers, higher abandonment risk) or held
back. See [D-AA-03](OPEN-DECISIONS.md#d-aa-03).

---

## Stopping rules

Every stop condition must produce a **defined session state**. The states themselves are
`OPEN`.

| Condition | State produced | Can it freeze a DNA artifact? |
|---|---|---|
| Confidence threshold reached on all required constructs | OPEN | OPEN |
| Item budget exhausted, confidence reached | OPEN | OPEN |
| Item budget exhausted, confidence **not** reached | OPEN | **No** — see below |
| Clarifier ceiling reached with a contradiction unresolved | OPEN | OPEN |
| Client abandons mid-session | OPEN | **No** |

**One rule is settled by inference from P8 and the confidence methodology, and is recorded
here for confirmation rather than as an approved decision:** a session that ends below the
confidence threshold **cannot** produce a frozen artifact. Confirming it is
[D-AA-04](OPEN-DECISIONS.md#d-aa-04).

### The stopping rule itself lives in 04

[04 §Stopping rule](04-evidence-and-confidence.md#stopping-rule) defines **when** to stop;
this document defines **what state** stopping produces. Not restated here:

> Stop when all three hold — **core coverage is sufficient**, **no result-changing
> contradiction remains unresolved**, and **marginal information value is low**.

Crucially, stopping is governed by **Assessment Sufficiency**, which is explicitly *not*
"every construct reaches C3." A good assessment ends with some constructs at C1 and some
omitted. Whether sufficiency uses family-specific minimums is
[D-EC-18](OPEN-DECISIONS.md#d-ec-18); how marginal value is computed is
[D-EC-19](OPEN-DECISIONS.md#d-ec-19).

**Resumability.** A stopped session must be resumable, and resuming must not restart scoring
from zero. This is an R1 acceptance criterion in SIGNAL PM
(`CNL R1 — Client-facing assessment experience`). The methodology question underneath it —
whether a session resumed after a long gap is still the same session — is
[D-AA-05](OPEN-DECISIONS.md#d-aa-05).

---

## Open decisions

| ID | Question |
|---|---|
| [D-AA-01](OPEN-DECISIONS.md#d-aa-01) | What is the coached-session completion target? |
| [D-AA-02](OPEN-DECISIONS.md#d-aa-02) | What is the fixed set of item types? |
| [D-AA-03](OPEN-DECISIONS.md#d-aa-03) | How are items sequenced, and does response reorder later items? |
| [D-AA-04](OPEN-DECISIONS.md#d-aa-04) | Confirm: a below-threshold session cannot freeze an artifact. |
| [D-AA-05](OPEN-DECISIONS.md#d-aa-05) | Is a session resumed after a long gap still the same session? Is there an expiry? |
| [D-AA-06](OPEN-DECISIONS.md#d-aa-06) | Is every one of the 44 registry constructs assessed, or is the assessed set a subset? See [D-CR-07](OPEN-DECISIONS.md#d-cr-07). |
| [D-AA-07](OPEN-DECISIONS.md#d-aa-07) | Does the coached session differ from self-serve in **content**, or only in **length and support**? |

---

## Status of this document

**DRAFT.** Three things settled, everything else `OPEN`. Tracked in SIGNAL PM as
`CNL R0 — Assessment stopping rules`, `CNL R0 — Core-question reduction from the current
prototype` and `CNL R0 — Completion-time targets (coached session and self-serve)`.
