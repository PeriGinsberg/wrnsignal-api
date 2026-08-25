# 09 · Context boundary

**Status:** REVIEW
**Methodology version:** v0.8
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23

**This is the critical document.** It is the operative form of **P1** — discover first,
contextualize second, recommend third — and it is the one boundary that, if it leaks, makes
every Professional DNA result worthless.

Three stages. Each has a hard entry condition and a defined set of permitted inputs.

---

## Why the boundary exists

If the resume is visible while the DNA is being calculated, the DNA becomes a description of
the resume. The client is told what they already did, dressed as who they are, and the
result confirms rather than discovers. It will feel accurate — that is what makes it
dangerous.

The whole value of a blind calculation is that it can **disagree with the resume**. That
disagreement is the product (**P2**).

---

# STAGE 1 — BLIND DNA CALCULATION

**Entry:** assessment starts.
**Exit:** the DNA artifact is **frozen**. Freezing is the stage boundary.

### Allowed inputs

- Assessment answers.
- Adaptive clarifier answers.
- Direct experiential evidence **requested inside the assessment** — that is, an experience
  the client describes *in response to an assessment item*.

That is the complete list.

### Not allowed inputs

| Not allowed | Why it is tempting |
|---|---|
| Resume | It is already loaded on every other SIGNAL surface |
| LinkedIn | Same |
| Coach notes | The coach already knows the client and the notes are rich |
| SIGNAL profile (`client_profiles.profile_text`, `profile_structured`) | It is the single input every other SIGNAL route uses |
| Known career goals / stated target roles | Already captured at intake |
| Existing job titles / work history | On the resume |
| Education assumptions | On the resume and in `client_profiles` |
| Previously recommended paths | From an earlier trajectory run |
| Personas | Resume variants — same objection as resume |
| `candidate_targeting` | The client's stated lane and career stage |
| Resume-derived reads — `lib/coherence/` lane concentration, `inferProfileOverridesFromResume()` | **Already built.** That is exactly why they need naming here. |

### The distinction that matters

Stage 1 permits **direct experiential evidence requested inside the assessment**. It does
not permit the resume.

These sound similar and are not. If an assessment item asks "describe a time you had to
decide without enough information," the answer is Stage 1 evidence — the client produced it,
in the assessment, in response to a measured item. The same fact read off their resume is
Stage 2 context. **The channel is what makes it admissible, not the fact.**

### How this is enforced

Not by intention. By construction — recorded in SIGNAL PM as
`CNL R1 — Blind-calculation isolation guarantee`:

1. The DNA interpretation call receives assessment responses **only**.
2. Enforced by the function signature and by what the caller assembles — **not** by a prompt
   instruction. A prompt that says "ignore the resume" while the resume is in context is not
   an isolation guarantee.
3. An automated check fails the build if the DNA calculation module imports a profile or
   persona reader.
4. A reviewer can verify it by reading one module, without tracing the whole call graph.

**Concrete mechanism.** Every SIGNAL route today loads a person through
`getAuthedProfileText()` (`app/api/_lib/authProfile.ts:178`), which returns `profileText`
**and** persona-resolved `resumeText` in one call. It returns contextual data by
construction. **The DNA calculation path cannot use it.** That is the single most likely way
this boundary gets breached, because it is the path of least resistance in this codebase.

**Clarifiers are inside the boundary.** A clarifier may never reference the resume, notes or
profile. A follow-up that says "your resume shows you led a team — did you enjoy that?"
breaks Stage 1 and invalidates the artifact. See [05](05-adaptive-clarifiers.md).

---

# STAGE 2 — DNA INTERPRETATION / VALIDATION

**Entry:** the blind DNA result is frozen. **Not before.**
**Exit:** interpretation complete; the artifact is unchanged.

Once the result is frozen, contextual evidence may be introduced — carefully, and for five
specific purposes.

### Permitted purposes

1. **Test** whether real-life evidence supports the result.
2. **Explain** the result — ground an abstract finding in something the client recognises.
3. **Identify contradictions** between what DNA says, what the client says, and what their
   evidence shows.
4. **Improve confidence** — as a *second, separate* reading. Whether Stage 2 produces its own
   confidence value is [D-EC-11](OPEN-DECISIONS.md#d-ec-11).
5. **Distinguish preference from demonstrated capability** (**P5**). This is the purpose only
   Stage 2 can serve: Stage 1 measures what the person is drawn to; the resume shows what
   they have actually done. Both are needed and they are not the same measurement.

### The prohibition

> **Stage 2 must NOT retroactively rewrite inconvenient DNA findings simply to match the
> resume.**

A DNA finding that the resume does not support is **not an error**. It is one of:

- A preference the client has never had the chance to act on — which is the most valuable
  thing this product can find;
- A capability–preference gap (**P5**);
- A genuine mismeasurement.

Stage 2 may **surface** the discrepancy and may **flag it for the coach**. It may not
resolve it by quietly adopting the resume's version. Per **P11** the frozen artifact is
immutable, so this is enforced by the artifact, not only by discipline.

### Available contextual evidence at Stage 2

Resume and personas · coach notes · `client_profiles.profile_text` and `profile_structured`
(including the existing "Strong skills", "Biggest concern" and "Openness to non-obvious entry
points" intake answers) · education · `candidate_targeting` · job and application history ·
`lib/coherence/` lane concentration · resume-derived targeting inference.

Everything excluded at Stage 1 becomes admissible here. That is the whole design.

---

# STAGE 3 — CAREER NAVIGATION

**Entry:** DNA frozen, interpretation complete.

DNA plus contextual evidence together drive:

| Consumer | SIGNAL PM release |
|---|---|
| Career Trajectory | CNL R2 |
| Job Decoder | CNL R3 |
| Path Positioning | CNL R4 |
| Lanes | CNL R5 |
| JobFit career context | CNL R6 |
| Evidence gaps | CNL R7 |
| Resume strategy | CNL R8 |
| Networking strategy | existing `/api/networking`, extended |
| Interview strategy | existing interview prep, extended |
| Opportunity / offer decisions | CNL R9 |

**Two guarantees already recorded in SIGNAL PM constrain Stage 3:**

- `CNL R2 — Trajectory-reads-frozen-DNA guarantee` — Career Trajectory consumes the frozen
  artifact and has no access to raw assessment responses. It cannot re-interpret the
  assessment after seeing the resume, which would be a Stage 1 breach committed at Stage 3.
- `CNL R6 — JobFit score isolation guarantee` — the deterministic qualification score
  receives no DNA input at all. DNA sits *beside* JobFit as context, never inside it.

---

## Stage summary

| | Stage 1 | Stage 2 | Stage 3 |
|---|---|---|---|
| **Purpose** | Discover | Contextualize | Recommend |
| **Assessment responses** | ✅ the only input | ✅ | ✅ via artifact |
| **Resume / LinkedIn / notes / profile** | ❌ | ✅ | ✅ |
| **May change the DNA artifact** | writes it once, then frozen | ❌ never | ❌ never |
| **Entry condition** | assessment starts | artifact frozen | interpretation complete |

---

## Open decisions

| ID | Question |
|---|---|
| [D-CB-01](OPEN-DECISIONS.md#d-cb-01) | Is Stage 2 a **distinct step with its own artifact**, or a property of how Stage 3 reads context? Today it is described as a stage but has no output of its own. |
| [D-CB-02](OPEN-DECISIONS.md#d-cb-02) | Does Stage 2 produce a second confidence reading? See [D-EC-11](OPEN-DECISIONS.md#d-ec-11). |
| [D-CB-03](OPEN-DECISIONS.md#d-cb-03) | May a coach see the client's resume while reviewing the DNA result (`CNL R1 — Coach review`)? Review happens after the freeze, so it is Stage 2 — but a coach who reads them side by side may edit toward the resume, which is the prohibition in human form. |
| [D-CB-04](OPEN-DECISIONS.md#d-cb-04) | What happens on **retake**? A second assessment is Stage 1 again — but the client has now seen their first result and their Stage 3 paths. Is a retake blind in any meaningful sense? Is there a cooling period? |
| [D-CB-05](OPEN-DECISIONS.md#d-cb-05) | May Stage 2 findings feed a **future** Stage 1 retake? P1 says no. Confirm. |

---

## Status of this document

**REVIEW.** The three stages, their allowed and disallowed inputs, and the Stage 2
prohibition are as Peri specified them. The enforcement mechanism and the named
existing-code hazards are added from the 2026-08-22 current-state audit. Five decisions are
`OPEN`, of which [D-CB-03](OPEN-DECISIONS.md#d-cb-03) and
[D-CB-04](OPEN-DECISIONS.md#d-cb-04) are the ones that could breach the boundary in practice.

Tracked in SIGNAL PM as `CNL R1 — Blind-calculation isolation guarantee` and
`CNL R2 — Trajectory-reads-frozen-DNA guarantee`.
