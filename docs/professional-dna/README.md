# Professional DNA — canonical methodology

**Methodology version:** v0.8
**Status:** DRAFT
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23
**Initiative:** SIGNAL Career Navigation Loop (CNL) — Release 0
**SIGNAL PM release:** `CNL R0 — Professional DNA Methodology Freeze`

---

## What this directory is

This directory is the **canonical source of truth for the Professional DNA methodology**.
It defines what Professional DNA measures, how it is measured, what may and may not
influence it, and what a client receives.

There are two canonical records for this initiative and they are not interchangeable:

| Record | Canonical for | Where |
|---|---|---|
| **This directory** | The methodology itself — constructs, rules, boundaries, schema | `docs/professional-dna/` |
| **SIGNAL PM** | The work, the decisions, the gates, the release status | Supabase project `rovsxackywtojkwiurpp` |

They must reference and stay consistent with one another. A methodology decision is not
real until it is written here **and** reflected in the corresponding SIGNAL PM record.

**Nothing in this directory is implementable yet.** No SIGNAL application code may be
written against any of it until the relevant document reaches `LOCKED` and the
`CNL R0 — GO / NO-GO: Professional DNA methodology frozen` gate in SIGNAL PM is approved.

---

## Documents

| # | Document | Status | Covers |
|---|---|---|---|
| — | [README.md](README.md) | DRAFT | This index, status, change control |
| 00 | [00-methodology-principles.md](00-methodology-principles.md) | REVIEW | The governing principles all other documents inherit |
| 01 | [01-construct-registry.md](01-construct-registry.md) | **REVIEW** | 6 families, 44 entries. **5 definitions  LOCKED**, 7 proposed, 32 glosses. Includes the two-gate Definition Review Standard. |
| 02 | [02-needs-preferences-flexibility.md](02-needs-preferences-flexibility.md) | DRAFT | The three-tier framework separating needs, strong preferences and flexibility |
| 03 | [03-assessment-architecture.md](03-assessment-architecture.md) | DRAFT | Item types, sequencing, length budget, stopping rules |
| 04 | [04-evidence-and-confidence.md](04-evidence-and-confidence.md) | **REVIEW** | Five confidence dimensions, states C0–C3, the stopping rule and clarifier priority |
| 05 | [05-adaptive-clarifiers.md](05-adaptive-clarifiers.md) | DRAFT | When a follow-up fires, what it may ask, and the ceiling |
| 06 | [06-decoded-insights.md](06-decoded-insights.md) | DRAFT | Primary constructs vs derived/decoded insights, and the candidate intersections |
| 07 | [07-result-schema.md](07-result-schema.md) | DRAFT | The machine-readable shape of a frozen DNA artifact |
| 08 | [08-validation-framework.md](08-validation-framework.md) | DRAFT | How we find out whether the methodology is actually right |
| 09 | [09-context-boundary.md](09-context-boundary.md) | REVIEW | The three stages, and what may enter at each |
| 10 | [10-version-history.md](10-version-history.md) | DRAFT | Methodology versioning and the change record |
| 11 | [11-tradeoff-model.md](11-tradeoff-model.md) | **REVIEW** | How forced tradeoffs become directional evidence, and how that evidence qualifies a Need |
| — | [OPEN-DECISIONS.md](OPEN-DECISIONS.md) | LIVE | Every unresolved methodology question, with an id |
| — | [DECISION-LOG.md](DECISION-LOG.md) | LIVE | Every decision Peri has made, traceable without reading git history |

---

## Document status vocabulary

Every document in this directory carries one of four statuses in its header.

| Status | Meaning |
|---|---|
| **DRAFT** | Being written. Content may be incomplete, wrong, or a placeholder. Do not build from it, do not cite it as settled. |
| **REVIEW** | Complete enough for Peri to review as a whole. Still not approved. Content may change materially. Do not build from it. |
| **LOCKED** | Approved. This is the methodology. Downstream implementation may rely on it. Changing it requires the change-control procedure below. |
| **SUPERSEDED** | Replaced by a later document or version. Kept as history. Carries a banner at the top naming its replacement. |

### What LOCKED means

A document is `LOCKED` only when **all five** of these are true:

1. **Peri explicitly approved the decision.** Not "Claude proposed it and nobody objected."
   Not "it has been in the doc for a while." An explicit approval, recorded in
   [DECISION-LOG.md](DECISION-LOG.md) with a date.
2. **This canonical document reflects that decision** — the approved wording is here, not
   in a chat log, a PM note, or someone's memory.
3. **The relevant entries in [OPEN-DECISIONS.md](OPEN-DECISIONS.md) are closed**, each with
   a pointer to the decision-log entry that closed it.
4. **The corresponding SIGNAL PM R0 feature or decision gate is updated** — status moved,
   acceptance criteria marked as satisfied, `frd_path` pointing at the document here.
5. **Downstream implementation may now rely on it.** Anything that could not be built
   before is now buildable.

If any one of the five is not true, the document is not LOCKED. There is no partial lock.

> **As of 2026-08-22, no document in this directory is LOCKED.** Nothing here has been
> approved by Peri. Everything is a proposal or a placeholder.

---

## Change control

**Before a document is LOCKED**, edit it freely. Record anything Peri actually decided in
[DECISION-LOG.md](DECISION-LOG.md) as you go, so the eventual lock has evidence behind it.

**After a document is LOCKED**, the procedure is:

1. Open an entry in [OPEN-DECISIONS.md](OPEN-DECISIONS.md) describing the proposed change
   and why the locked version is wrong or insufficient. Do not edit the locked document.
2. Peri decides.
3. If approved: bump the methodology version per [10-version-history.md](10-version-history.md),
   edit the document, and record the change in the version history with **date, decision,
   reason, affected constructs or rules, downstream product impact, and whether existing
   clients require rescoring**.
4. Add a decision-log entry.
5. Update the affected SIGNAL PM records.
6. If the change invalidates a previously frozen client artifact, say so explicitly — a
   frozen Professional DNA artifact is immutable, so a methodology change produces a new
   artifact version, never an edit to an existing one.

**A locked document is never silently edited.** If you find yourself changing a LOCKED file
without a decision-log entry, stop.

> ### Worked precedent — the procedure has been exercised once
>
> **v0.8, 2026-08-23** — Peri revised the canonical definition of
> [1.1 Guidance / Development Support](01-construct-registry.md#11--guidance--development-support)
> one version after locking it. What that ran like in practice:
>
> - Steps 1–2 collapsed. Peri supplied the revised text directly, so there was no proposal to
>   file and decide — the proposal *was* the decision. **This is the normal case when Peri is
>   the one changing their mind.** Step 1 exists for everyone else.
> - The superseded text was **not deleted anywhere.** [DL-009](DECISION-LOG.md#dl-009) keeps
>   its original wording with a supersession banner above it;
>   [DL-010](DECISION-LOG.md#dl-010) carries the change; the construct entry shows all three
>   framings in a history table.
> - The revision **raised** an open decision ([D-CR-14](OPEN-DECISIONS.md#d-cr-14)) rather
>   than closing one, and nothing downstream was unblocked. That is a normal outcome, not a
>   failure — see [v0.8 in the version history](10-version-history.md).
>
> The lesson worth keeping: a definition can be locked and still be wrong. The point of the
> procedure is that changing it leaves a trail, not that it is hard.

---

## Naming and structure conventions followed

This directory follows the existing SIGNAL documentation conventions rather than inventing
new ones:

- **A multi-file doc set lives in a kebab-case subdirectory of `docs/`.** Precedent:
  `docs/network-tracker/` (15 files).
- **The set carries an index / state-of-play file.** Precedent:
  `docs/network-tracker/network-tracker-cc-brief.md`, described in its own text as the
  cold-start index covering "the decisions that are locked and *why*, what's still open."
  This README is that file.
- **Bold-label status headers.** Precedent: `**Status:** Draft — awaiting Peri approval`,
  used in 16 documents under `docs/Features/`.
- **A blockquote banner at the very top for superseded documents.** Precedent:
  `docs/Features/positioning-foundation-frd.md`.
- **"Locked" is already the repo's word** for an approved decision — see
  `docs/network-tracker/COLOR-SYSTEM.md` ("rules locked and applied the same day"). This
  directory formalises what it means rather than introducing a competing term.

**Deviation:** files here are numbered (`00-`, `01-`, …) rather than prefixed with the
directory name as `docs/network-tracker/` does. The methodology is read in order and the
numbering carries that; the network-tracker set is not sequential. Noted so the difference
is a choice rather than drift.
