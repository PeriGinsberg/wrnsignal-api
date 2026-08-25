# 07 · Result schema

**Status:** DRAFT
**Methodology version:** v0.8
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23

The machine-readable shape of a **frozen** Professional DNA artifact. This is what every
downstream release from R2 to R10 reads.

---

## What is settled

Four requirements follow from the principles and from the SIGNAL PM acceptance criteria
already recorded on `CNL R0 — Structured Professional DNA result schema`.

**1 · Versioned from day one.**
A schema change produces a new version. It never mutates an existing shape. A reader must
be able to tell which version it is holding.

**2 · Provenance on every generated element (P12).**
Every construct score, decoded insight and growth-edge statement carries a reference back to
the responses that produced it. An element without provenance is dropped, not stored.

**3 · Sufficient for R2 without re-reading raw responses (P11).**
Career Trajectory reads the artifact. It must never need to reach past it into the
assessment. If R2 has to re-read responses, the artifact is under-specified and the freeze
boundary leaks.

**4 · Contextual fields are structurally excluded (P1).**
The schema contains **no** field for resume text, personas, coach notes, target roles,
target locations, education, candidate targeting or any other `client_profiles` data. Not
"left null" — absent. This is what makes the blind-calculation guarantee enforceable by
inspection rather than by intention.

---

## Field groups

**Every field below is OPEN.** The grouping is a proposal for how the schema is organised,
not a schema.

| Group | Holds | Depends on |
|---|---|---|
| **Identity + version** | artifact id, client, schema version, methodology version, prompt version, model id, frozen-at timestamp | [10](10-version-history.md) |
| **Construct scores** | one entry per assessed construct: value, confidence, provenance | [01](01-construct-registry.md), [04](04-evidence-and-confidence.md) |
| **Tiers** | need / strong preference / flexibility, where applicable | [02](02-needs-preferences-flexibility.md) — and [D-NPF-06](OPEN-DECISIONS.md#d-npf-06) asks whether tiers belong in the artifact at all |
| **Decoded insights** | which fired, with the input constructs and their confidences | [06](06-decoded-insights.md) |
| **Growth edge** | the statement, the strength it is paired with, provenance | **OPEN** — no growth-edge methodology document exists yet; see below |
| **Tradeoffs** | stated as pairs | Methodology now exists: [11-tradeoff-model.md](11-tradeoff-model.md). Schema shape still **OPEN** — [D-TM-11](OPEN-DECISIONS.md#d-tm-11) (do individual tradeoff records persist, or only the classification they produced?), [D-TM-06](OPEN-DECISIONS.md#d-tm-06) (weighted edges?), [D-TM-05](OPEN-DECISIONS.md#d-tm-05) (conditionals). **Caveat:** 11 covers tradeoff-as-EVIDENCE; this row was written for tradeoff-as-OUTPUT. See [D-TM-10](OPEN-DECISIONS.md#d-tm-10). |
| **Confidence** | overall, and per construct | [04](04-evidence-and-confidence.md) — now a **multidimensional** model, not a percentage: five dimensions plus an internal state C0–C3. Whether the artifact carries the dimensions, the state, both, or a numeric substrate is [D-EC-05](OPEN-DECISIONS.md#d-ec-05) + [D-RS-01](OPEN-DECISIONS.md#d-rs-01). Assessment-level sufficiency is [D-EC-07](OPEN-DECISIONS.md#d-ec-07). |
| **Contradictions** | unresolved contradictions surfaced rather than smoothed (P9) | [04](04-evidence-and-confidence.md) |
| **Session metadata** | items asked, clarifiers asked, completion time, stop condition | [03](03-assessment-architecture.md), [08](08-validation-framework.md) |

---

## Two methodology documents this schema needs and does not have

The SIGNAL PM R0 release contains two specification items whose output the schema must carry,
and which have **no document in this directory yet**:

| Missing document | SIGNAL PM item | Schema group blocked |
|---|---|---|
| Growth Edge methodology | `CNL R0 — Growth Edge methodology` | Growth edge |
| ~~Tradeoff model~~ | `CNL R0 — Tradeoff model` | **Written 2026-08-22** — [11-tradeoff-model.md](11-tradeoff-model.md), status REVIEW. Covers the evidence sense only; the output sense is still missing ([D-TM-10](OPEN-DECISIONS.md#d-tm-10)). |

They were not created in this pass because the user-specified initial file structure does
not include them, and inventing their content would breach the instruction not to make
methodology decisions on Peri's behalf. They are recorded here and as
[D-RS-05](OPEN-DECISIONS.md#d-rs-05) so the gap is visible rather than discovered later.

The same applies to the **motivator model** and the two **dimension models** (Operating
System, work-content / professional-pull), which SIGNAL PM tracks as separate R0 items and
which are currently represented only as construct families in
[01](01-construct-registry.md).

---

## Open decisions

| ID | Question |
|---|---|
| [D-RS-01](OPEN-DECISIONS.md#d-rs-01) | Is a construct score a scalar, a band, a pole-plus-intensity, or something per-construct? **Sharpened 2026-08-23:** the five locked constructs cover **three distinct shapes** — directional spectrum, independent intensity, and contextual / conditional. The schema must represent at least three, and the conditional one needs somewhere to put its condition ([D-CR-13](OPEN-DECISIONS.md#d-cr-13)). [D-CR-06](OPEN-DECISIONS.md#d-cr-06) is narrowed, not landed. |
| [D-RS-02](OPEN-DECISIONS.md#d-rs-02) | What shape is provenance — response ids, item ids, verbatim spans, or a mix? Verbatim spans are the strongest and the most privacy-sensitive. |
| [D-RS-03](OPEN-DECISIONS.md#d-rs-03) | Does the artifact carry **all** assessed constructs, or only those that reached confidence? |
| [D-RS-04](OPEN-DECISIONS.md#d-rs-04) | Does the artifact carry the client-facing **prose**, or only structure that the reveal renders? Prose in the artifact makes it immutable and reviewable; prose at render time makes it re-styleable. |
| [D-RS-05](OPEN-DECISIONS.md#d-rs-05) | Growth-edge structure — still blocked on a missing methodology document. **Tradeoff half partly unblocked 2026-08-22** by [11](11-tradeoff-model.md), which now specifies what a tradeoff record conceptually contains; the schema shape remains open via D-TM-05, D-TM-06, D-TM-10 and D-TM-11. |
| [D-RS-06](OPEN-DECISIONS.md#d-rs-06) | Where do client reactions and disputes live? Per **P11** they cannot mutate the artifact, so they need their own home. |
| [D-RS-07](OPEN-DECISIONS.md#d-rs-07) | Where do coach edits live? Same constraint — the R0 coach-review item requires the original generated text to stay readable alongside the edit. |
| [D-RS-08](OPEN-DECISIONS.md#d-rs-08) | Does a Stage 2 validation pass write a second confidence reading into a separate structure? See [D-EC-11](OPEN-DECISIONS.md#d-ec-11). |

---

## Naming conventions to follow

Not a methodology decision — an engineering convention already established in SIGNAL, noted
so the schema does not drift from the codebase it will live in:

- Tables prefixed by domain, `snake_case` identifiers, enums as `TEXT` + `CHECK`, PKs
  `uuid DEFAULT gen_random_uuid()` — per `docs/network-tracker/network-tracker-data-model.md`.
- Owner key is `client_profile_id` → `client_profiles(id)`.
- Additive migrations only; every new column nullable or defaulted.
- A migration ends with `NOTIFY pgrst, 'reload schema';` — PostgREST caches the schema and
  rejects new columns without it.
- Applied to dev **and** carrying an explicit prod-promotion line. The lanes tables are the
  cautionary precedent: they exist on dev and are absent from prod entirely.

---

## Status of this document

**DRAFT.** Four requirements settled at principle level; every field is `OPEN`, and two
field groups are blocked on methodology documents that do not exist yet.

Tracked in SIGNAL PM as `CNL R0 — Structured Professional DNA result schema`, which blocks
`CNL R1 — Freeze DNA result (immutable artifact)` and all of R2.
