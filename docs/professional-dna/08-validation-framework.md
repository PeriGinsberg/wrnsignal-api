# 08 · Validation framework

**Status:** DRAFT
**Methodology version:** v0.8
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23

How SIGNAL finds out whether the methodology is actually right, rather than merely
internally consistent.

---

## What is settled

**1 · Instrumentation ships with the thing it measures.**
Never as a follow-up. Recorded on `CNL Epic E — Methodology Validation` in SIGNAL PM.

**2 · A validation review happens before R2 build begins**, against real coached-client R1
data. Recorded as the decision gate
`CNL R2 — Methodology validation review (pre-R2 gate)`, which blocks the Career Trajectory
engine.

**3 · Metrics are queryable without a manual export.**

**4 · A coach edit preserves the original generated text.**
Required by the R0 coach-review item — the original stays readable alongside the edit,
because edit frequency and edit *content* are both validation signals. If the edit
overwrites, the signal is destroyed.

---

## The metric set

The nine signals below are the ones named on `CNL Epic E` and the
`CNL R1 — R1 instrumentation` acceptance criteria. **What each metric means is populated.
What good looks like is OPEN in every case** — no threshold has been set.

| # | Metric | Captured where | Target |
|---|---|---|---|
| 1 | **Client accuracy reaction** — Nails It / Mostly / Partly / Missed | Client reaction capture, R1 | **OPEN** |
| 2 | **Coach accuracy reaction** | Coach review, R1 | **OPEN** — mechanism not yet designed; the R0 coach-review workflow captures approve/regenerate/edit, not an accuracy rating |
| 3 | **Third-party recognition** — does someone who knows the client recognise them in the result | **OPEN** — no capture mechanism designed | **OPEN** |
| 4 | **Completion time** | Session metadata, R1 | Measured against the R0 target: ~15–20 min typical / 25 max self-serve; coached target still OPEN |
| 5 | **Abandoned assessments** — with the item the client stopped on | Session state, R1 | **OPEN** |
| 6 | **Clarifier frequency** — per session and per construct | Clarifier records, R1 | **OPEN** |
| 7 | **Interpretation edits** — how often a coach edits, and which fields | Coach review records, R1 | **OPEN** — and whether an edit should also move construct *confidence* is [D-EC-17](OPEN-DECISIONS.md#d-ec-17) |
| 8 | **Rejected insights** — per-insight client disputes | Reaction capture, R1 | **OPEN** — whether a dispute lowers construct confidence is [D-EC-16](OPEN-DECISIONS.md#d-ec-16) |
| 9 | **Path acceptance** — the distribution of Pursue / Test / Keep Open / No | Path decision state, R2 | **OPEN** |

---

## How each metric fails

Recorded so a number is read correctly rather than optimistically.

| Metric | What a bad reading means |
|---|---|
| Client accuracy low | The methodology or the interpretation layer is wrong. Not the client. |
| **Client accuracy very high** | Possibly the Barnum problem — statements general enough that anyone would agree. High agreement is **not** self-evidently good and needs a specificity check. See [D-VF-02](OPEN-DECISIONS.md#d-vf-02). |
| Coach edits frequent | The interpretation layer is wrong, not the coach. Recorded on the R2 gate. |
| Completion time over target | Either the core set is too long or clarifiers are over-firing. The two have different fixes and the metric alone does not distinguish them. |
| Abandonment clustered on one item | That item is the problem, not the length. Which is why the stop item is captured, not just the fact of stopping. |
| Clarifier frequency high | Either the core items are not resolving constructs, or contradiction detection is over-sensitive. |
| Path acceptance all Pursue | Possibly agreeable clients rather than good paths. All No is a clearer signal than all Pursue. |

---

## What validation cannot do

**It cannot rewrite a frozen artifact (P11).** A client rating an insight "Missed" is
recorded against the artifact and surfaced to the coach. It does not edit the artifact, and
it does not silently retrain anything.

**It cannot resolve a contradiction in the client's favour (P2).** A client disagreeing with
a DNA finding is information, not a correction. The disagreement and the finding both stand.

Whether a disputed insight is suppressed from R2 trajectory inputs is a genuinely open
question, recorded as [D-VW-01](OPEN-DECISIONS.md#d-vw-01) — and it is the point where
validation and **P2** are in real tension.

---

## Open decisions

| ID | Question |
|---|---|
| [D-VF-01](OPEN-DECISIONS.md#d-vf-01) | What is the accuracy bar, and what sample size, for the pre-R2 gate? Both currently unset in SIGNAL PM. |
| [D-VF-02](OPEN-DECISIONS.md#d-vf-02) | How is Barnum-effect risk tested? Without a specificity check, high agreement proves nothing. |
| [D-VF-03](OPEN-DECISIONS.md#d-vf-03) | How is coach accuracy reaction captured? Approve/regenerate/edit is a workflow action, not a rating. |
| [D-VF-04](OPEN-DECISIONS.md#d-vf-04) | Is third-party recognition captured at all in R1, or is it aspirational? |
| [D-VF-05](OPEN-DECISIONS.md#d-vf-05) | Is there a test–retest expectation? If the same client retook the assessment in three months, how much should the result move — and is movement failure or life? |
| [D-VF-06](OPEN-DECISIONS.md#d-vf-06) | What is the falsification condition? What result would tell us the methodology is wrong rather than needing tuning? |

---

## Status of this document

**DRAFT.** The metric set is populated from what SIGNAL PM already records. Every threshold
is `OPEN`. [D-VF-06](OPEN-DECISIONS.md#d-vf-06) is the one worth answering first — a
validation framework with no falsification condition validates nothing.

Tracked in SIGNAL PM as `CNL Epic E — Methodology Validation`,
`CNL R1 — R1 instrumentation` and `CNL R2 — Methodology validation review (pre-R2 gate)`.
