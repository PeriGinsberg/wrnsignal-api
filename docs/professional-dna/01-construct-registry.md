# 01 · Construct registry

**Status:** REVIEW
**Methodology version:** v0.8
**Owner:** Peri Ginsberg
**Last updated:** 2026-08-23

---

## Read this before reading the registry

**This registry is not final.** It is being documented so it can be reviewed and then
frozen deliberately — writing it down is not the same as declaring it settled. Status is
`REVIEW`, not `LOCKED`.

**Three kinds of entry live in this registry.** As of 2026-08-23, five construct definitions
are **🔒 LOCKED**, seven more carry **🟡 PROPOSED** definitions under review, and 32 still
carry a one-line **working gloss** only.

| | 🔒 The five | 🟡 The seven | The other 32 |
|---|---|---|---|
| Definition | **LOCKED — canonical, approved by Peri** | 🟡 PROPOSED, not approved | **OPEN** |
| Construct shape | **LOCKED** | 🟡 PROPOSED, or *still OPEN* | **OPEN** |
| Measures / does-not-measure | **LOCKED** | 🟡 PROPOSED | **OPEN** |
| Confusion risks | Populated | Populated | Partial |
| Evidence sources | Populated, **no weights** | Populated, **no weights** | **OPEN** |
| Known Assessment v1 evidence | **Still OPEN — Gate B** | Mapped, or *none in the reviewed subset* | Not attempted |
| Scoring approach · confidence requirement | **Still OPEN for all 44** | **OPEN** | **OPEN** |
| Downstream consumers | Populated, **deliberately not uniform** | Populated, not uniform | Partial |

**🔒 LOCKED (5):** [1.1 Guidance / Development Support](#11--guidance--development-support) ·
[2.4 Create](#24--create) · [3.1 Outcome Ownership](#31--outcome-ownership) ·
[3.3 Decision Influence](#33--decision-influence) ·
[5.1 Life Protection](#51--life-protection).

**🟡 PROPOSED (7):** [1.2](#12--outcome-clarity) · [1.3](#13--predictability--change) ·
[1.7](#17--experimentation) · [2.2](#22--analyze) · [3.2](#32--formal-leadership) ·
[4.1](#41--meaning) · [4.4](#44--mastery).

> ### ⚠️ The registry document itself is **REVIEW**, not LOCKED
>
> Five individual definitions are locked. **The construct model is not frozen.** 39 of 44
> constructs have no approved definition, the registry's own membership is still open
> ([D-CR-01](OPEN-DECISIONS.md#d-cr-01) can still remove one), and **no construct has passed
> Gate B** — see the [Definition Review Standard](#definition-review-standard).
>
> A locked definition means *this is what the construct means*. It does not mean the construct
> can be scored, classified, or shown to a client.

**The working glosses on the other 32 are not definitions.** A gloss is a plain-language
reading written to make the document navigable. **It is not a methodology decision, it has
not been approved, and it must not be cited as a definition.**

**Scoring approach and confidence requirement remain `OPEN` for all 44** — including the
twelve. A definition says what a construct *is*; it does not say how it is scored or how much
evidence it needs. Those are [D-EC-04](OPEN-DECISIONS.md#d-ec-04) and
[D-EC-12](OPEN-DECISIONS.md#d-ec-12).

**Status is `REVIEW` for all 44. Nothing is LOCKED.**

---

## Definition Review Standard

**Revised 2026-08-23.** Two gates, not one. A construct has to pass **both** before it is
implementable, but they are **satisfied separately and can be satisfied at different times**.

### Gate A — Semantic lock *(what the construct means)*

A construct definition is ready to be marked **🔒 LOCKED** when **all five** hold:

| # | Criterion |
|---|---|
| **A1** | Its **included territory** is clear — a reader can say what falls inside it. |
| **A2** | Its **exclusions** are clear — a reader can say what falls outside it and where that belongs instead. |
| **A3** | It is **distinguishable from neighbouring constructs** — the boundary survives someone actively trying to blur it. |
| **A4** | **Downstream uses do not require a different meaning** — Career Trajectory, Lanes, Path Positioning and Offer Decision can all read the same definition. |
| **A5** | **Peri explicitly approves it.** |

### Gate B — Measurement sufficiency *(whether we can measure it)*

| # | Criterion |
|---|---|
| **B1** | **Known assessment evidence maps to it without obvious contradiction.** |
| **B2** | The evidence clears the confidence requirements in [04](04-evidence-and-confidence.md) — [D-EC-12](OPEN-DECISIONS.md#d-ec-12). |

> ### Why these were split
>
> They were one list until 2026-08-23, with evidence mapping as criterion 4. That made
> **semantic locking impossible whenever the only problem was incomplete question mapping** —
> a construct could be perfectly well defined and still unlockable because nobody had yet
> reviewed which items measure it. Five of the twelve priority constructs sat in exactly that
> position ([D-CR-11](OPEN-DECISIONS.md#d-cr-11)).
>
> **A construct definition can be semantically LOCKED while its measurement mapping remains
> OPEN.** What a construct *means* is a methodology decision Peri can make; what *measures*
> it is a fact about the instrument that has to be established.

> ### ⚠️ Gate B is not weakened, deferred, or optional
>
> **Measurement sufficiency must be satisfied before R1 implementation.** A semantically
> locked construct with no mapped evidence **cannot be scored, cannot be classified, cannot
> enter a DECODED insight, and cannot appear in a client-facing artifact.** It is a settled
> definition awaiting an instrument, nothing more.
>
> Gate B failing is still a hard block on the assessment architecture being frozen. Splitting
> the gates records *which* problem a construct has; it does not remove either problem.

### Current state

| | Count | Constructs |
|---|---|---|
| **Gate A passed — 🔒 LOCKED** | 5 | [1.1](#11--guidance--development-support) · [2.4](#24--create) · [3.1](#31--outcome-ownership) · [3.3](#33--decision-influence) · [5.1](#51--life-protection) |
| **Gate A pending — 🟡 PROPOSED** | 7 | [1.2](#12--outcome-clarity) · [1.3](#13--predictability--change) · [1.7](#17--experimentation) · [2.2](#22--analyze) · [3.2](#32--formal-leadership) · [4.1](#41--meaning) · [4.4](#44--mastery) |
| **No definition — gloss only** | 32 | the rest |
| **Gate B passed** | **0** | none — [D-EC-12](OPEN-DECISIONS.md#d-ec-12) sets no threshold yet, so B2 is unevaluable for every construct |

---

## Registry-wide open questions

These affect the registry as a whole and are tracked in
[OPEN-DECISIONS.md](OPEN-DECISIONS.md). They are listed here because a reviewer reading the
registry will hit them immediately.

| ID | Question |
|---|---|
| [D-CR-01](OPEN-DECISIONS.md#d-cr-01) | **PARTIALLY RESOLVED 2026-08-22.** The name collision is gone — family 3's `Ownership` is now [Outcome Ownership](#31--outcome-ownership) ([DL-001](DECISION-LOG.md#dl-001)). **Still open:** whether [4.11 Ownership](#411--ownership) is a distinct motivator at all, or should be derived from Outcome Ownership × Achievement × Freedom. Deliberately not renamed, because renaming would presume it survives. |
| [D-CR-02](OPEN-DECISIONS.md#d-cr-02) | **CLOSED 2026-08-22** ([DL-002](DECISION-LOG.md#dl-002)). Family 2's `Influence` → [Persuasion / Influence Work](#28--persuasion--influence-work); family 3's `Influence` → [Decision Influence](#33--decision-influence). Names only — every definition remains `OPEN`. |
| [D-CR-03](OPEN-DECISIONS.md#d-cr-03) | **`Mastery` (family 4) vs `Mastery vs Breadth` (family 6)** — one is a motivator, one is a growth orientation. Are they independent, or is one derived from the other? |
| [D-CR-04](OPEN-DECISIONS.md#d-cr-04) | **`Impact` and `Impact Proximity` (family 4)** — is proximity a modifier of Impact or a construct in its own right that can be measured when Impact is low? |
| [D-CR-05](OPEN-DECISIONS.md#d-cr-05) | **`Growth Need` (family 5) vs family 6 as a whole** — family 6 is four growth constructs; family 5 contains a fifth. Where does Growth Need belong? |
| [D-CR-06](OPEN-DECISIONS.md#d-cr-06) | **Are all constructs continua, or are some unipolar?** The field template assumes an opposite pole exists. Several (Money, Meaning, Prestige) may be intensity-only. |
| [D-CR-07](OPEN-DECISIONS.md#d-cr-07) | **Is 44 constructs the right number** for a 15–20 minute self-serve assessment, or is the registry a superset from which an assessed subset is drawn? |
| [D-CR-08](OPEN-DECISIONS.md#d-cr-08) | **Family 2 (What You Like Doing) is a sixth work-type vocabulary in SIGNAL.** See the conflicts section at the foot of this document. |
| [D-CR-10](OPEN-DECISIONS.md#d-cr-10) | **Is family 2 a set of independent intensities, or a ranked set?** Raised by the 2026-08-23 definition pass — [2.2](#22--analyze) and [2.4](#24--create) both propose *independent intensity*, which is a family-level claim, not a per-construct one. |
| [D-CR-11](OPEN-DECISIONS.md#d-cr-11) | ⚠️ **Five of the twelve highest-leverage constructs have no evidence in the reviewed assessment subset.** Review gap, or instrument gap? |
| [D-CR-12](OPEN-DECISIONS.md#d-cr-12) | **Six tradeoff outcomes carry no item numbers**, so they cannot be traced to Assessment v1 questions. |

**Counts.** 44 entries, **44 distinct names** as of 2026-08-22 — the two name collisions are
resolved. Family sizes: 7 · 10 · 7 · 11 · 5 · 4.

Family 4 drops to 10 and the registry to 43 **if** [4.11 Ownership](#411--ownership) turns
out to be derived rather than distinct. That is still [D-CR-01](OPEN-DECISIONS.md#d-cr-01)
and is not decided.

---

## Field template

Every construct carries these fields. Where a field is not shown on an entry, it is `OPEN`.

```
Canonical name        the name Peri uses; the one downstream code will key on
Construct family      one of the six families
Definition            what this construct IS                              [OPEN]
What it measures      the observable thing a score reflects                [OPEN]
What it does NOT      the adjacent thing it is routinely confused with     [OPEN]
Opposite / continuum  poles, or a statement that it is unipolar            [OPEN]
Evidence sources      which assessment item types can score it             [OPEN]
Scoring approach      how responses become a value                         [OPEN]
Confidence requirement  what has to be true before the score is usable     [OPEN]
Downstream consumers  which CNL release reads this construct
Status                DRAFT / REVIEW / LOCKED / SUPERSEDED
Notes                 collisions, overlaps, existing-code conflicts
```

---

# Family 1 — HOW YOU WORK

*Seven constructs. Concerns the conditions under which a person does their best work.*

### 1.1 · Guidance / Development Support
**Family:** 1 — How You Work · **Status:** 🔒 **LOCKED** · **Definition:** CANONICAL — approved by Peri 2026-08-23 ([DL-009](DECISION-LOG.md#dl-009)), **revised 2026-08-23** ([DL-010](DECISION-LOG.md#dl-010))

> **CANONICAL DEFINITION** *(current — supersedes the DL-009 text)*
>
> **The degree to which a person benefits from and prefers access to active developmental
> input — teaching, coaching, correction and a more experienced person — especially while
> becoming grounded in unfamiliar work.**

**Construct shape: 🔒 contextual / conditional.** Unchanged by the revision.

> ### ⚠️ This definition has been revised twice. Read the history before citing older text.
>
> | Version | Framing | Text |
> |---|---|---|
> | First-pass proposal | **desire** | *"the degree to which a person **wants** active developmental input…"* |
> | DL-009 (superseded) | **effect** | *"…**improves** a person's ability to become effective and confident in unfamiliar work."* |
> | **DL-010 (current)** | **benefit AND preference** | *"…a person **benefits from and prefers** access to… **especially while becoming grounded** in unfamiliar work."* |
>
> **What the revision changed, and why it matters:**
>
> 1. **Preference is restored, alongside benefit.** DL-009's pure effect-framing had drifted
>    toward measuring *capability* — how much someone improves with help is close to a
>    statement about their ability. The current definition measures **both** whether support
>    helps them *and* whether they want it. **P5** is easier to hold with both halves present
>    than with effect alone.
> 2. **The condition is now named in the definition, and softened to "especially."** DL-009
>    read as though the construct were *about* unfamiliar work. The current text says
>    unfamiliarity **intensifies** it — the construct has a general level that unfamiliarity
>    modulates. See lock 5 below.
> 3. **"Becoming grounded" replaces "become effective and confident."** Broader: finding
>    footing in the work, not a specific competence-plus-confidence outcome.
>
> The "What it measures" list below was rewritten a second time to match. **Anything written
> against either earlier framing should be re-read.**

> ### 🔒 LOCKED — five methodological decisions
>
> **1 · One construct, not two.** There are not separate *support wanted* and *support
> required* constructs. The earlier "is this one construct or two?" question is **closed**.
>
> **2 · Preference versus necessity is a classification, not a construct.** Whether a person
> *prefers* developmental input or *requires* it belongs to the
> [Needs / Strong Preferences / Flexibility](02-needs-preferences-flexibility.md) layer.
> Splitting the construct to carry that distinction would duplicate a job that layer already
> has.
>
> ⚠️ **DL-010 puts this lock under strain and it has NOT been re-decided.** The current
> definition names *prefers* inside the construct, so "preference" now appears on both sides
> of the boundary. The reading this document runs on — **not yet confirmed by Peri** — is that
> the construct measures **how much** (benefit and preference together, as one blended
> quantity) and the tier layer classifies **how tradeable** it is (need / strong preference /
> flexible). That is a coherent split, but it is now a stated boundary rather than a
> structural one. See [D-CR-14](OPEN-DECISIONS.md#d-cr-14). Lock 2 stands until Peri says
> otherwise; DL-010 did not retract it.
>
> **3 · Orthogonal to autonomy — not the opposite end of an autonomy spectrum.**
> [4.8 Freedom](#48--freedom) is a separate axis. This is now **locked**, not inferred.
>
> **4 · A person can want substantial developmental support and substantial autonomy at the
> same time.** That combination is legitimate and must remain expressible. It is the whole of
> [DI-01](06-decoded-insights.md#di-01).
>
> **5 · Conditionality is legitimate.** Example form:
> *higher developmental support while unfamiliar → less support required after competence
> develops.*
>
> **DL-010 refined this.** The condition is now written into the canonical definition —
> *"especially while becoming grounded in unfamiliar work"* — and the word is **especially**,
> not *only*. The construct therefore has a **general level that unfamiliarity intensifies**,
> rather than existing solely within unfamiliar work. A person can prefer developmental input
> in work they already know; unfamiliarity raises it, it does not create it.
>
> ⚠️ **The conditioning variable is still NOT locked.** Naming unfamiliarity in the definition
> establishes it as *the canonical condition*, not as *the only admissible one* — "especially"
> was chosen over "only" and that choice carries weight. How a conditioning variable is
> detected and represented, and whether the vocabulary is closed at unfamiliarity,
> is [D-CR-13](OPEN-DECISIONS.md#d-cr-13) and stays open.

**What it measures** *(rewritten a second time 2026-08-23 to match the DL-010 dual framing — see [DL-010](DECISION-LOG.md#dl-010))*

The construct has **two halves that move together and are scored as one quantity**:

*Benefit — does support help?*
- How much the work goes better when teaching, coaching and correction are available
- The size of the difference between a supported ramp and an unsupported one

*Preference — do they want it?*
- The pull toward having a more experienced person within reach
- Whether developmental input is sought out or merely tolerated when offered

*And across both:*
- How far unfamiliarity **raises** the level — the conditional axis. Unfamiliarity intensifies
  the construct; it does not define its boundary
- The residual level in familiar work, which may be substantial and is **not** assumed to be zero

⚠️ **Benefit and preference are not separately reported.** They are two readings on one
construct, and the methodology does not currently define what a high-benefit / low-preference
person looks like in the output. That gap is [D-CR-14](OPEN-DECISIONS.md#d-cr-14).

**What it does NOT measure**
- **Autonomy** — [4.8 Freedom](#48--freedom). Support and freedom are **orthogonal**, not opposite ends of one axis. Wanting backing while you work is compatible with wanting latitude over *what* you work on. This is the whole of [DI-01](06-decoded-insights.md#di-01).
- **Capability or competence** — per **P5**, wanting support says nothing about ability, and *benefiting* from support says nothing about how much ability the person started with. Everyone benefits from good teaching; the construct measures how much, and how much it is wanted — never how much was lacking.
- **Feedback cadence** — [6.3 Feedback Rhythm](#63--feedback-rhythm) is how often performance signal arrives; this is whether developmental input is available at all.
- **Interaction volume** — [3.4 Interaction Density](#34--interaction-density).

**Common confusion risks:** [4.8 Freedom](#48--freedom) · [6.3 Feedback Rhythm](#63--feedback-rhythm) · [1.2 Outcome Clarity](#12--outcome-clarity) · [3.4 Interaction Density](#34--interaction-density).
⚠️ **Boundary to hold: high guidance need ≠ low autonomy ≠ low capability.** All three readings are wrong and all three are the natural ones. **P4** applies — neither pole may be written as the mature one.

**Evidence sources:** baseline preference · behavioral scenario · tradeoff · invariance probe · adaptive clarifier. Real-life self-report plausible. *(No weights assigned — [D-EC-02](OPEN-DECISIONS.md#d-ec-02).)*

**Known Assessment v1 evidence**

| Item | Evidence | Note |
|---|---|---|
| *Support vs Autonomy* | Candidate conditional, direction not resolved | ⚠️ **Item number not supplied.** Recorded in [11](11-tradeoff-model.md#conditional-candidate--support-vs-autonomy) as a candidate conditional with the **conditioning variable unknown** — `competence` and `familiarity` are inferences, not evidence. |
| Q63 | *Adjacent, not mapped here* | Q63 establishes that **Freedom** survives financial comfort. It bears on the boundary — a support-leaning result is not a Freedom-is-weak result — but it is evidence for [4.8](#48--freedom), not for this construct. |

**Downstream consumers:** Professional DNA report · Needs / Preferences / Flexibility · DECODED ([DI-01](06-decoded-insights.md#di-01), [DI-06](06-decoded-insights.md#di-06)) · Career Trajectory (environment fit) · Lanes (research criterion "mentorship" — **not determinable from a posting**, so it enters as *Needs Investigation* per [11 §5 / R5](11-tradeoff-model.md#5--conditionality)) · JobFit career context (DNA Watchpoints) · Offer Decision.
**Not** Path Positioning — this is an environment need, not an element of a professional story.

**Closed by this lock** *(2026-08-23)*
- ~~Is this one construct or two — *support wanted* versus *support required to perform*?~~ → **one construct.** Preference versus necessity is a classification, not a second construct.
- ~~Shape~~ → **contextual / conditional.**
- ~~Is it orthogonal to autonomy or the opposite end of one axis?~~ → **orthogonal.** Locked, not inferred.

**Still open**
- [D-CR-13](OPEN-DECISIONS.md#d-cr-13) — **how is the conditioning variable detected and represented?** Competence/familiarity is a strong candidate, deliberately **not** locked. See also [D-TM-05](OPEN-DECISIONS.md#d-tm-05) for the tradeoff-side version of the same problem.
- **Gate B — one unnumbered signal, direction unresolved.** The definition is locked; the measurement is not.
- Can the does-not-measure boundary against [6.3](#63--feedback-rhythm) actually be held by assessment items, or do they collapse in practice?
- [D-CR-14](OPEN-DECISIONS.md#d-cr-14) — **NEW (DL-010).** The definition now names both *benefits from* and *prefers*. Two questions follow, neither decided: (a) where exactly does the construct's *prefers* end and the [tier layer's](02-needs-preferences-flexibility.md) preference-versus-necessity classification begin — [DL-009 lock 2](#11--guidance--development-support) is under strain; (b) what does the methodology say about a person whose benefit and preference **diverge** — high benefit, low preference, or the reverse?
- ⚠️ **Capability boundary — improved by DL-010, not closed.** DL-009's pure effect-framing sat close to ability. Restoring *prefers* pulls the construct back toward orientation and makes **P5** materially easier to hold. But *benefits from* is still a half of the definition and is still effect language, so items must not accidentally measure competence. **Reduced risk, same rule.**

### 1.2 · Outcome Clarity
**Family:** 1 — How You Work · **Status:** REVIEW · **Definition:** 🟡 PROPOSED — first pass, not approved

**Proposed definition.** How clearly defined a person needs the **target** to be before they can work effectively — what *done* and *good* look like. It is about the destination, not the route to it.

**What it measures**
- Need for explicit success criteria before starting
- Tolerance for a goal that is stated loosely or not at all
- Whether an undefined endpoint is energising or paralysing

**What it does NOT measure**
- **Process structure** — how the work gets organised and sequenced is [1.4 Planning Style](#14--planning-style). ⚠️ This is the boundary this construct most often loses.
- **Day-to-day variability** — [1.3 Predictability / Change](#13--predictability--change) is the texture of the work; this is the clarity of its target.
- **Developmental support** — [1.1](#11--guidance--development-support).
- **Capability to operate in ambiguity.** Per **P5**, needing clarity is not an inability to work without it.

**Common confusion risks:** [1.4 Planning Style](#14--planning-style) (primary) · [1.1 Guidance / Development Support](#11--guidance--development-support) · [1.3 Predictability / Change](#13--predictability--change).
⚠️ **Boundary to hold: Outcome Clarity ≠ process structure.** A person can want a razor-sharp target and total freedom over how to reach it — that combination is common and a merged construct cannot express it.

**Construct shape:** **directional spectrum** *(proposed, with a caveat)*. The two poles — *wants the target defined* ↔ *wants to define the target* — are a genuine opposition, not a convenience. **Caveat:** the far pole may not belong to this construct at all. Wanting to *define* the target looks like [3.1 Outcome Ownership](#31--outcome-ownership) territory, in which case this is an **independent intensity** (how much definition is needed) rather than a spectrum. Unresolved; see open questions.

**Evidence sources:** baseline preference · behavioral scenario · invariance probe · adaptive clarifier. Tradeoff plausible. *(No weights assigned.)*

**Known Assessment v1 evidence**

> **None in the reviewed subset.** The reviewed items are Q47, Q61–Q72 and Q82 — fourteen of an instrument that runs to at least Q82. Nothing in them bears on Outcome Clarity.
>
> This is a **gap in what has been reviewed**, not proof that Assessment v1 fails to measure the construct. Q1–Q46, Q48–Q60 and Q73–Q81 have not been examined. See [D-CR-11](OPEN-DECISIONS.md#d-cr-11).

**Downstream consumers:** Professional DNA report · Needs / Preferences / Flexibility · Career Trajectory · JobFit career context (DNA Watchpoints) · Offer Decision.
**Not** DECODED — no candidate insight currently uses it. **Not** Path Positioning · **Not** Lanes — a posting cannot establish it.

**Open questions**
- Spectrum or intensity? Turns on whether *wants to define the target* is this construct's far pole or is [3.1](#31--outcome-ownership).
- Can items separate destination-clarity from route-structure, or do respondents hear one question?
- Does need for clarity vary by domain familiarity — i.e. is this conditional too?

### 1.3 · Predictability / Change
**Family:** 1 — How You Work · **Status:** REVIEW · **Definition:** 🟡 PROPOSED — first pass, not approved

**Proposed definition.** How much variability a person wants in the **shape of their working days** — the same rhythms, people and problems, versus a changing set. It concerns the texture of the work, not the intellectual novelty of the problems inside it and not risk to the person.

**What it measures**
- Preference for repeatable rhythms versus shifting conditions
- Tolerance for disruption to an established routine
- Appetite for changing context, teams or settings

**What it does NOT measure**
- **Novelty of intellectual work.** ⚠️ Wanting hard *new problems* is [1.6 Stimulation](#16--stimulation), and possibly [6.1 Mastery vs Breadth](#61--mastery-vs-breadth). A person can want the same desk, the same colleagues and the same hours, and a genuinely new problem every week.
- **Risk to the person** — [5.3 Stability](#53--stability) and [5.4 Upside / Risk](#54--upside--risk). Those are about consequence; this is about texture.
- **Financial certainty.** The `Certainty` node evidenced by Q47 and Q65 is a **different axis** and an unmapped node ([D-TM-09](OPEN-DECISIONS.md#d-tm-09)). Reading those items as evidence here would be precisely the four-axis collapse [11](11-tradeoff-model.md#the-risk--certainty-cluster--four-axes-not-one) warns against.

**Common confusion risks:** [1.6 Stimulation](#16--stimulation) · [5.3 Stability](#53--stability) · [4.7 Security](#47--security) · the unmapped `Certainty` node.
⚠️ **Boundary to hold: Predictability / Change ≠ novelty of intellectual work.**
⚠️ **Standing problem:** Predictability, Stability and Security are **three constructs in three families circling one idea**. This definition claims the *texture* territory; whether that claim survives contact with 5.3 and 4.7 is unresolved.

**Construct shape:** **directional spectrum** *(proposed)* — *wants repeatable* ↔ *wants changing*. Both poles are positively describable, which is what makes a spectrum honest here rather than convenient.

**Evidence sources:** baseline preference · behavioral scenario · tradeoff · invariance probe. *(No weights assigned.)*

**Known Assessment v1 evidence**

| Item | Evidence | Note |
|---|---|---|
| Table A row 4 | *Mastery > Constant Novelty* — **possible, unresolved** | ⚠️ Item number not supplied. `Novelty` is an unmapped node whose candidates are **this construct or [1.6 Stimulation](#16--stimulation)** ([D-TM-09](OPEN-DECISIONS.md#d-tm-09)). Until that resolves, this cannot be claimed as evidence here. |
| Q47, Q65 | ❌ **Explicitly not evidence for this construct** | Financial certainty, not work texture. Recorded here only to prevent the mis-mapping. |

**Downstream consumers:** Professional DNA report · Needs / Preferences / Flexibility · DECODED (weakly — adjacent to [DI-04](06-decoded-insights.md#di-04) via Stability) · Career Trajectory · Decoder personalized overlay · Lanes (research criterion "pace / environment") · JobFit career context (DNA Watchpoints) · Offer Decision.
**Not** Path Positioning.

**Open questions**
- Does `Novelty` map here or to [1.6](#16--stimulation)? Blocks the only candidate evidence.
- Does the texture-versus-consequence split against 5.3 and 4.7 hold when items are written?
- Is repeatability wanted for its own sake, or as a means to something else (recovery, focus, life boundary)? If the latter, this may be partly derived.

### 1.4 · Planning Style
**Family:** 1 — How You Work · **Status:** REVIEW
> *Working gloss — NOT a decision:* how much the person plans ahead versus works emergently.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** OPEN
**Notes:** See 1.2.

### 1.5 · Focus Rhythm
**Family:** 1 — How You Work · **Status:** REVIEW
> *Working gloss — NOT a decision:* whether the person works best in long uninterrupted blocks or in short switching cycles.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R5 Lanes (research criterion "pace/environment") · R6 DNA Watchpoints
**Notes:** Overlaps Interaction Density (3.4) — a high-interaction role tends to preclude long blocks. OPEN whether these are independent or one constrains the other.

### 1.6 · Stimulation
**Family:** 1 — How You Work · **Status:** REVIEW
> *Working gloss — NOT a decision:* how much novelty, intensity or pace the person needs to stay engaged.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R5 Lanes (research criterion "pace/environment")
**Notes:** Overlaps 1.3 Predictability/Change. OPEN whether stimulation is the *need* and predictability the *tolerance*.

### 1.7 · Experimentation
**Family:** 1 — How You Work · **Status:** REVIEW · **Definition:** 🟡 PROPOSED — first pass, not approved

**Proposed definition.** Appetite for trying approaches whose outcome is genuinely unknown — running the test rather than taking the known method. It measures willingness to work without a guaranteed result, independent of whether the person generates original ideas and independent of what happens if it fails.

**What it measures**
- Willingness to try an untested approach
- Comfort proceeding when the method may not work
- Preference for iterating toward an answer over executing a known path

**What it does NOT measure**
- **Creativity.** ⚠️ Originating something that did not exist is [2.4 Create](#24--create). Experimentation is about *method under uncertainty*; Create is about *origination*. A person can run rigorous experiments on entirely conventional ideas, and can originate constantly while never testing anything.
- **Risk appetite in the consequence sense** — [5.4 Upside / Risk](#54--upside--risk). The registry already draws this line at [5.4](#54--upside--risk): **consequence versus curiosity**.
- **Tolerance for unstable circumstances** — [5.3 Stability](#53--stability).
- **Variability of the working day** — [1.3](#13--predictability--change).

**Common confusion risks:** [2.4 Create](#24--create) · [5.4 Upside / Risk](#54--upside--risk) · [1.3 Predictability / Change](#13--predictability--change) · [1.6 Stimulation](#16--stimulation).
⚠️ **Boundary to hold: Experimentation ≠ creativity.**

**Construct shape:** **still OPEN.** Two readings are live and neither is obviously right:
- **Independent intensity** — how much appetite for the untested, where low is simply less appetite.
- **Directional spectrum** — *prefers proven methods* ↔ *prefers to test*, where the low pole is a positive preference for the reliable rather than an absence.

Per the registry's own rule, a spectrum is **not** asserted here merely because it would be convenient. See [D-CR-06](OPEN-DECISIONS.md#d-cr-06).

**Evidence sources:** baseline preference · behavioral scenario · tradeoff · real-life self-report. *(No weights assigned.)*

**Known Assessment v1 evidence**

> **None in the reviewed subset.**
>
> ⚠️ **Q68 is the trap.** *"I played it too safe would feel worse"* is risk-shaped and reads like experimentation evidence. [11](11-tradeoff-model.md#the-risk--certainty-cluster--four-axes-not-one) assigns it to [5.4 Upside / Risk](#54--upside--risk) and demonstrates at length that four risk-shaped items belong to four different axes. Mapping Q68 here would repeat exactly the collapse that section exists to prevent.
>
> Gap in the reviewed subset, not proof of an instrument gap — [D-CR-11](OPEN-DECISIONS.md#d-cr-11).

**Downstream consumers:** Professional DNA report · Needs / Preferences / Flexibility · DECODED ([DI-04](06-decoded-insights.md#di-04)) · Career Trajectory (next-best experiments) · Offer Decision.
**Not** Path Positioning · **Not** Lanes.

**Open questions**
- Shape — intensity or spectrum? See above.
- Does the curiosity-versus-consequence split against [5.4](#54--upside--risk) survive item writing, or do respondents hear one question about risk?
- Is experimentation domain-specific — willing to test methods at work, unwilling to test career moves?

---

# Family 2 — WHAT YOU LIKE DOING

*Ten constructs. Concerns the kind of work the person is drawn toward.*

> **Family-level note.** Per **P5**, this family measures **preference, not capability**.
> A person may score high on Analyze and have no analytical evidence, or low on Advise and
> be excellent at it. The evidence sources and scoring approach for this family must make
> that separation structural, not advisory. This is the family most at risk of being read
> as a skills inventory.
>
> This family is also SIGNAL's **sixth** work-type vocabulary — see the conflicts section.

### 2.1 · Discover
**Family:** 2 — What You Like Doing · **Status:** REVIEW
> *Working gloss — NOT a decision:* pull toward finding out what is true — research, investigation, learning.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 Career Trajectory · R3 Decoder overlay · R4 Path Positioning

### 2.2 · Analyze
**Family:** 2 — What You Like Doing · **Status:** REVIEW · **Definition:** 🟡 PROPOSED — first pass, not approved

**Proposed definition.** Pull toward making sense of material that already exists — finding the pattern, the structure or the interpretation in it. It measures the draw toward *interpretation*, distinct from gathering the material in the first place and from telling anyone what to do about it.

**What it measures**
- Draw toward pattern-finding and interpretation
- Satisfaction from making a mess of information legible
- Preference for the sense-making phase over the collecting or the recommending phase

**What it does NOT measure**
- **Research / Discover** — [2.1 Discover](#21--discover) is finding out *what is true*: investigating, gathering, learning. Analysis operates on what discovery returns. ⚠️ These two are routinely fused into "research," which is why the boundary is stated explicitly.
- **Advise** — [2.7 Advise](#27--advise) is being the person others bring a problem to. Interpreting and recommending are different acts, and a person can strongly prefer one and avoid the other.
- **Solve** — [2.3 Solve](#23--solve) is diagnosing and fixing something with a resolution.
- **Analytical capability.** Per **P5**, this is preference only.
- **The existing `RoleArchetype = "analytical"`** in `app/api/jobfit/signals.ts:103` — an *inferred job classification* derived from stated target roles, not a measured preference.
- **`preferNotAnalyticsHeavy`** in `ProfileConstraints` — a regex-derived constraint boolean over intake prose.

**Common confusion risks:** [2.1 Discover](#21--discover) · [2.7 Advise](#27--advise) · [2.3 Solve](#23--solve) — and, uniquely in this family, **two pieces of live SIGNAL code that already use the word "analytical" for different things.**
⚠️ **Boundary to hold: Analyze ≠ Research / Discover ≠ Advise.**

**Construct shape:** **independent intensity** *(proposed — see the family-level note below)*. The opposite of *drawn toward analysis* is *not drawn toward it*, not a positive opposing activity. Family 2 as a whole probably works this way; that is [D-CR-10](OPEN-DECISIONS.md#d-cr-10).

**Evidence sources:** baseline preference · behavioral scenario · tradeoff · real-life self-report. *(No weights assigned.)*

**Known Assessment v1 evidence**

> **None in the reviewed subset.** Nothing in Q47, Q61–Q72 or Q82 bears on it. Gap in what has been reviewed, not proof of an instrument gap — [D-CR-11](OPEN-DECISIONS.md#d-cr-11).

**Downstream consumers:** Professional DNA report · Needs / Preferences / Flexibility · Career Trajectory · Path Positioning (a work-pull is a story element) · Decoder personalized overlay.
**Not** DECODED — no candidate insight currently uses it. **Not** Lanes · **Not** Offer Decision directly.

**Open questions**
- Boundary against [2.1](#21--discover) and [2.3](#23--solve) — can items separate interpreting from gathering and from fixing?
- What happens when the DNA construct and the existing `RoleArchetype` disagree about the same person? Nothing currently reconciles them — [D-CR-08](OPEN-DECISIONS.md#d-cr-08).
- Family-level: intensity, or ranked within the family? [D-CR-10](OPEN-DECISIONS.md#d-cr-10).

### 2.3 · Solve
**Family:** 2 — What You Like Doing · **Status:** REVIEW
> *Working gloss — NOT a decision:* pull toward problems with a resolution — diagnosing and fixing.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R3 · R4
**Notes:** Boundary against Analyze (2.2) is not obvious and needs the does-not-measure field to do real work.

### 2.4 · Create
**Family:** 2 — What You Like Doing · **Status:** 🔒 **LOCKED** · **Definition:** CANONICAL — approved by Peri 2026-08-23 ([DL-008](DECISION-LOG.md#dl-008))

> **CANONICAL DEFINITION**
>
> **Pull toward originating something that did not exist — generating the idea, the concept
> or the piece of work itself. It measures the draw toward the act of origination, not skill
> at it, and not the making-it-work that follows.**

**Construct shape: 🔒 independent intensity.**

> ### 🔒 LOCKED — Create and Build are **separate constructs**
>
> The "one construct with two phases" reading is **retired**.
>
> **Rationale:** someone may strongly enjoy origination while disliking implementation.
> Someone else may strongly enjoy making ideas functional while having little interest in
> originating them. **These pulls can also both be high** — the constructs are independent, not
> opposed, and a single merged construct could express none of the three cases.
>
> **Scope of this lock:** it establishes that *Create* is an independent intensity and that
> Create and [2.5 Build](#25--build) are separate. It does **not** decide the shape of family 2
> as a whole — [D-CR-10](OPEN-DECISIONS.md#d-cr-10) stays open. Build's own definition is
> still a gloss.

**What it measures**
- Draw toward generating original material
- Satisfaction from the blank page rather than the inherited brief
- Preference for the conceiving phase over the realising phase

**What it does NOT measure**
- **Build** — [2.5 Build](#25--build) is making a thing work and stand up: construction and assembly, not origination. ⚠️ The registry already flags this boundary as OPEN and it remains the weakest line in the family.
- **Solve** — [2.3 Solve](#23--solve) is diagnosing and fixing a problem that has a resolution. Creation has no defect to remove.
- **Experimentation** — [1.7](#17--experimentation) is method under uncertainty, not origination.
- **Creative capability, or creative output to date.** Per **P5**.

**Common confusion risks:** [2.5 Build](#25--build) · [2.3 Solve](#23--solve) · [1.7 Experimentation](#17--experimentation).
⚠️ **Boundary to hold: Create ≠ Build ≠ Solve.** Three acts, three different satisfactions: bringing something into being · making it stand up · making it right again.

**Evidence sources:** baseline preference · behavioral scenario · tradeoff · real-life self-report · adaptive clarifier. *(No weights assigned.)*

**Known Assessment v1 evidence**

> **None itemised.**
>
> ⚠️ [04's worked example](04-evidence-and-confidence.md#create--high-confidence-strong-preference-not-need) discusses Create at high confidence on *"multiple structured signals plus a creative-writing self-report"* — but that example is explicitly marked **illustrative, with underlying items not in this repository.** It demonstrates that C3 + Strong Preference is an ordinary pairing; it is **not** mapped evidence and must not be cited as such.
>
> Mapping anything here would require inventing responses. [D-CR-11](OPEN-DECISIONS.md#d-cr-11).

**Downstream consumers:** Professional DNA report · Needs / Preferences / Flexibility · DECODED ([DI-01](06-decoded-insights.md#di-01), [DI-03](06-decoded-insights.md#di-03)) · Career Trajectory · Path Positioning · Decoder personalized overlay.
**Not** Lanes · **Not** Offer Decision directly.

**Closed by this lock** *(2026-08-23)*
- ~~The Create / Build boundary — one construct with two phases, or two constructs?~~ → **two separate constructs.**
- ~~Shape~~ → **independent intensity.**

**Still open**
- [D-CR-10](OPEN-DECISIONS.md#d-cr-10) — **narrowed, not closed.** Create is settled; whether the *whole* Work Pull family is ten independent intensities or a ranked set is still open, and the two designs need different items.
- **Gate B — no itemised evidence.** Nothing in the reviewed subset maps here ([D-CR-11](OPEN-DECISIONS.md#d-cr-11)). Locked definition, unmeasured construct.
- ⚠️ [2.5 Build](#25--build) is now formally a separate construct **but still carries only a gloss.** The boundary is locked from one side only.
- Does Create require an audience to count? [DI-03](06-decoded-insights.md#di-03) assumes not, pairing it with low Recognition.
- Domain-specificity: is creative pull transferable across domains, or is it always *creating a particular kind of thing*?

### 2.5 · Build
**Family:** 2 — What You Like Doing · **Status:** REVIEW
> *Working gloss — NOT a decision:* pull toward making a thing work and stand up — construction and assembly rather than origination.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R3 · R4
**Notes:** See 2.4.

### 2.6 · Orchestrate
**Family:** 2 — What You Like Doing · **Status:** REVIEW
> *Working gloss — NOT a decision:* pull toward coordinating moving parts and people toward a result.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R3 · R4
**Notes:** Must be separable from Formal Leadership (3.2) and [Outcome Ownership (3.1)](#31--outcome-ownership) — orchestration is a *preference for the activity*, not a claim on authority.

### 2.7 · Advise
**Family:** 2 — What You Like Doing · **Status:** REVIEW
> *Working gloss — NOT a decision:* pull toward being the person others bring a problem to.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R3 · R4

### 2.8 · Persuasion / Influence Work
**Family:** 2 — What You Like Doing · **Status:** REVIEW
> *Working intent — a NAME decision, not a definition:* enjoyment of changing minds, persuading, advocating, selling, or shaping behaviour through communication.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R3 · R4
**Notes:** Renamed from `Influence` on 2026-08-22 to resolve the collision with 3.3 — see [DL-002](DECISION-LOG.md#dl-002), which closed [D-CR-02](OPEN-DECISIONS.md#d-cr-02). Pairs with [3.3 Decision Influence](#33--decision-influence): this is the *activity* (a work pull), 3.3 is the *standing* (shaping consequential decisions). The boundary between them is `OPEN` and is what the does-not-measure fields must establish.

### 2.9 · Help
**Family:** 2 — What You Like Doing · **Status:** REVIEW
> *Working gloss — NOT a decision:* pull toward direct usefulness to a specific person.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R3 · R4
**Notes:** Overlaps Impact Proximity (4.3) — one may be the preference and the other the reward. OPEN.

### 2.10 · Operate
**Family:** 2 — What You Like Doing · **Status:** REVIEW
> *Working gloss — NOT a decision:* pull toward running something reliably and well on an ongoing basis.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R3 · R4
**Notes:** Per **P4**, must not be written as the least ambitious option in the family.

---

# Family 3 — RESPONSIBILITY + PEOPLE

*Seven constructs. Concerns what the person wants to be answerable for, and how much human contact the work carries.*

### 3.1 · Outcome Ownership
**Family:** 3 — Responsibility + People · **Status:** 🔒 **LOCKED** · **Definition:** CANONICAL — approved by Peri 2026-08-23 ([DL-007](DECISION-LOG.md#dl-007))

> **CANONICAL DEFINITION**
>
> **Preference for having something clearly theirs to own, be accountable for, and carry
> responsibility for. It measures the desire to be the person answerable for a result —
> independent of any title, any authority over people, and any financial stake in the
> outcome.**

**Construct shape: 🔒 directional spectrum.**
**Poles:** *clear individual accountability* ↔ *shared / collective accountability*.
**Neither pole is superior.** Preferring shared accountability is a working style, not an
avoidance — **P4**.

**What it measures**
- Appetite for being the one answerable when it succeeds or fails
- Desire for a defined scope that is identifiably theirs
- Willingness to carry the consequences of an outcome

**What it does NOT measure**
- **Motivator Ownership** — [4.11 Ownership](#411--ownership) is a *stake*: equity, or a thing that is yours as a **reward**. This construct is about accountability, not entitlement. Whether 4.11 survives as a distinct construct at all is [D-CR-01](OPEN-DECISIONS.md#d-cr-01).
- **Resume `verbClass: "ownership"`** — `app/api/jobfit/resumeExtraction.ts:14` classifies every extracted résumé bullet as `ownership` or `contribution`. That is an **evidence** classification of what a person *did*. This is a **preference** for what they *want*. Per **P5** they must never be conflated, and a person who has only contribution-verb evidence may score high here.
- **Formal Leadership** — [3.2](#32--formal-leadership). Accountability needs no title.
- **Decision Influence** — [3.3](#33--decision-influence). Being answerable is not the same as shaping what gets decided.

**Common confusion risks:** [4.11 Ownership](#411--ownership) · the résumé `verbClass` · [3.2 Formal Leadership](#32--formal-leadership) · [3.3 Decision Influence](#33--decision-influence).
⚠️ **Boundary to hold: Outcome Ownership ≠ Motivator Ownership ≠ résumé verbClass ownership.** Three different things currently sharing one word, one of which is live production code.

**Evidence sources:** baseline preference · behavioral scenario · tradeoff · real-life self-report · adaptive clarifier. *(No weights assigned.)*

**Known Assessment v1 evidence**

| Item | Evidence | Note |
|---|---|---|
| Table A row 5 | **Outcome Ownership > Recognition** | ⚠️ Item number not supplied ([D-CR-12](OPEN-DECISIONS.md#d-cr-12)). Both nodes map cleanly to the registry — the cleanest edge in the set. Stakes and isolation OPEN. |

One mapped signal. Under [04](04-evidence-and-confidence.md#1--coverage) that is **Sparse** coverage and a single evidence type — provisionally **C1**, not more.

**Downstream consumers:** Professional DNA report · Needs / Preferences / Flexibility · DECODED ([DI-02](06-decoded-insights.md#di-02)) · Career Trajectory · Path Positioning · JobFit career context (DNA Watchpoints) · Offer Decision.
**Not** Lanes as a filter — a posting rarely establishes it, so it would enter as *Needs Investigation*.

**Closed by this lock** *(2026-08-23)*
- ~~Spectrum or intensity?~~ → **directional spectrum**, poles named, neither superior.

**Still open — none of these is closed by the lock**
- [D-CR-01](OPEN-DECISIONS.md#d-cr-01) — **remains OPEN.** Peri has *not* decided whether [4.11 Motivator Ownership](#411--ownership) survives as a separate construct. If it turns out to be **derived**, whether its stake-reading folds into this construct or disappears is still undecided.
- ⚠️ **Engineering / data-model collision — remains OPEN.** `app/api/jobfit/resumeExtraction.ts:14` calls its evidence classification `ownership`. Locking the *semantic* definition of this construct does **not** resolve the shared name in the codebase, and must not be read as having done so. A shared name in one codebase is a defect waiting to happen.
- **Gate B — one unnumbered signal only.** Sparse coverage, one evidence type, provisionally C1. The definition is locked; the measurement is not.
- Does ownership appetite scale with scope, or is it scope-independent?

### 3.2 · Formal Leadership
**Family:** 3 — Responsibility + People · **Status:** REVIEW · **Definition:** 🟡 PROPOSED — first pass, not approved

**Proposed definition.** Desire for a titled position of authority over people — managing, directing, and being formally responsible for others' work. It measures the wish for the **role**, not the ability to do it and not the wish to shape what gets decided.

**What it measures**
- Desire for a management title and the track that leads to it
- Appetite for people-management responsibilities: hiring, developing, appraising, deciding for others
- Wanting positional authority as such

**What it does NOT measure**
- **Decision Influence** — [3.3](#33--decision-influence) is shaping consequential decisions **without requiring formal authority**. A person can want enormous influence and no direct reports.
- **Outcome Ownership** — [3.1](#31--outcome-ownership). Being answerable for a result needs no title.
- **Ambition or advancement generally.** ⚠️ The unmapped `Advancement` node is not this construct; nor is [4.5 Achievement](#45--achievement).
- **Orchestrate** — [2.6](#26--orchestrate) is a work-pull toward coordinating moving parts, not a claim on authority.
- **Leadership capability.** Per **P5**.

**Common confusion risks:** [3.3 Decision Influence](#33--decision-influence) · [3.1 Outcome Ownership](#31--outcome-ownership) · [2.6 Orchestrate](#26--orchestrate) · [4.10 Prestige](#410--prestige) · the unmapped `Advancement` node.
⚠️ **Boundary to hold: Formal Leadership ≠ Decision Influence ≠ Outcome Ownership.** Three distinct wants: *authority over people* · *effect on decisions* · *accountability for a result*.

> ### ⚠️ Highest P4 exposure in family 3
> **Low formal-leadership need is not low ambition, and must never be written as such.** The
> low pole is an **input to a positive insight** in [DI-02](06-decoded-insights.md#di-02)
> ("Influence Without Dominance") — that treatment is correct and must be preserved wherever
> this construct is rendered.

**Construct shape:** **directional spectrum** *(proposed)* — *wants the management track* ↔ *wants the individual-contributor track*. Both poles are positively describable and both are real career architectures, which is what makes the spectrum honest here.

**Evidence sources:** baseline preference · behavioral scenario · tradeoff · real-life self-report · invariance probe. *(No weights assigned.)*

**Known Assessment v1 evidence**

| Item | Evidence | Note |
|---|---|---|
| Table A row 2 | **Expertise > Management / Authority** | ⚠️ Item number not supplied ([D-CR-12](OPEN-DECISIONS.md#d-cr-12)). The *opponent* maps here; the winning node `Expertise` is **unmapped** ([D-TM-09](OPEN-DECISIONS.md#d-tm-09)), so this is a clean loss for Formal Leadership against an unclear victor. |
| Q67 | *Adjacent, not mapped here* | *Success matters even if nobody knows the **title**, employer, salary or accomplishments.* Q67 is an invariance probe primarily about [4.9 Recognition](#49--recognition) and [4.10 Prestige](#410--prestige). Reading "title" as Formal Leadership evidence would overreach — a title is a standing marker in Q67's framing, not an authority structure. |

**Downstream consumers:** Professional DNA report · Needs / Preferences / Flexibility · DECODED ([DI-02](06-decoded-insights.md#di-02)) · Career Trajectory · Path Positioning (it shapes the target level of the story) · Lanes (seniority criteria — **partly determinable** from a posting, unusually for a family-3 construct) · Offer Decision (advancement).

**Open questions**
- [D-DI-08](OPEN-DECISIONS.md#d-di-08) — is this a genuine third input to DI-02, or redundant given that 3.3's definition already says *without requiring formal authority*?
- Does the unmapped `Advancement` node map here, to [4.5](#45--achievement), or to [5.5 Growth Need](#55--growth-need)? [D-TM-09](OPEN-DECISIONS.md#d-tm-09).
- Is *wanting to manage people* separable from *wanting the seniority that usually comes with it*? If not, this construct is confounded by design.

### 3.3 · Decision Influence
**Family:** 3 — Responsibility + People · **Status:** 🔒 **LOCKED** · **Definition:** CANONICAL — approved by Peri 2026-08-23 ([DL-005](DECISION-LOG.md#dl-005))

> **CANONICAL DEFINITION**
>
> **The degree to which a person wants to shape consequential decisions and outcomes.**

**Construct shape: 🔒 independent intensity.** How much the person wants their view to count.
Low is less of that want — **not** a positive preference for executing someone else's
direction, and **not** the low end of an authority axis.

> ### ⚠️ What was removed, and why
>
> The earlier working intent read *"…without requiring formal authority or people
> management."* **That clause is removed from the canonical definition.** It described the
> *relationship* between Decision Influence and [3.2 Formal Leadership](#32--formal-leadership) —
> it was never a property of this construct. A definition that describes a neighbour is not a
> definition.
>
> **The two constructs are independent.** A person can be:
> - **high on both** — wants authority *and* wants decisions to go their way;
> - **high on Decision Influence, low on Formal Leadership** — wants their view to count, does not want direct reports;
> - **low on Decision Influence, high on Formal Leadership** — wants to run a team, indifferent to setting direction;
> - **low on both.**
>
> **Decision Influence is NOT the opposite of Formal Leadership**, is not the
> individual-contributor pole of a management axis, and must never be rendered as either.

**What it measures**
- Desire to affect decisions that carry real consequence
- Wanting to be consulted before a direction is set
- How much it matters to the person that the outcome reflects their view

**What it does NOT measure** *(all four locked)*
- **Formal Leadership** — [3.2](#32--formal-leadership). Authority over people is a separate want, on a separate axis. See the independence statement above.
- **Persuasion / Influence Work** — [2.8](#28--persuasion--influence-work) is the *enjoyment of the activity* of changing minds: persuading, advocating, selling. ⚠️ **The central boundary; the two constructs shared a name until 2026-08-22.** A person can want their view to carry weight and actively dislike having to sell it. Another can love the persuading and not care what gets decided.
- **Outcome Ownership** — [3.1](#31--outcome-ownership). Affecting a decision is not being answerable for the result.
- **Recognition** — [4.9](#49--recognition). Influence can be entirely invisible.

**Common confusion risks:** [2.8 Persuasion / Influence Work](#28--persuasion--influence-work) (primary) · [3.2 Formal Leadership](#32--formal-leadership) · [3.1 Outcome Ownership](#31--outcome-ownership).
⚠️ **Boundary to hold: Decision Influence ≠ Persuasion / Influence Work.** The distinction is **standing versus activity** — being consequential, versus enjoying the act of moving people.

**Evidence sources:** baseline preference · behavioral scenario · tradeoff · adaptive clarifier. *(No weights assigned.)*

**Known Assessment v1 evidence**

> **None in the reviewed subset.** [DI-02](06-decoded-insights.md#di-02) takes it as an input, but a decoded candidate is not evidence — per **P10** and [04 §Rule C](04-evidence-and-confidence.md#c--a-decoded-statement-cannot-increase-confidence-in-its-own-source-constructs), evidence direction is one-way and a DECODED insight can never support its own inputs.
>
> Gap in what has been reviewed — [D-CR-11](OPEN-DECISIONS.md#d-cr-11).

**Downstream consumers:** Professional DNA report · Needs / Preferences / Flexibility · DECODED ([DI-02](06-decoded-insights.md#di-02)) · Career Trajectory · Path Positioning · Offer Decision.
**Not** Lanes — not determinable from a posting; would enter as *Needs Investigation*.

**Closed by this lock** *(2026-08-23)*
- ~~Shape — intensity, spectrum, or entangled with 3.2?~~ → **independent intensity**, and not entangled.
- ~~Is "without requiring formal authority" a property of the construct or a statement about its relationship to 3.2?~~ → **a statement about the relationship. Removed from the definition.**

**Still open**
- **Gate B — no mapped evidence.** Nothing in the reviewed subset measures this construct ([D-CR-11](OPEN-DECISIONS.md#d-cr-11)). The definition is locked; the measurement is not. It cannot be scored.
- Can items separate *standing* from *activity* in practice, or do respondents hear one question about influence?
- [D-DI-08](OPEN-DECISIONS.md#d-di-08) — **narrowed, not closed.** Its premise (that 3.3 was defined as operating without authority) is gone, so 3.2 is conceptually independent again. What remains is the DECODED question: is 3.2 a *necessary* input to [DI-02](06-decoded-insights.md#di-02)? Removing it requires its own approved DECODED decision.

### 3.4 · Interaction Density
**Family:** 3 — Responsibility + People · **Status:** REVIEW
> *Working gloss — NOT a decision:* how much of the working day the person wants to spend in contact with other people.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R5 Lanes (research criterion "team structure") · R6 DNA Watchpoints · R9 Offer Decision
**Notes:** Must not be written as introversion/extroversion — **P4**. See 1.5.

### 3.5 · Team Configuration
**Family:** 3 — Responsibility + People · **Status:** REVIEW
> *Working gloss — NOT a decision:* the shape of the working unit the person does best in — solo, pair, small team, large org.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R5 Lanes (research criterion "team structure") · R9 Offer Decision
**Notes:** Likely **not a continuum** — configuration may be categorical. See [D-CR-06](OPEN-DECISIONS.md#d-cr-06).

### 3.6 · Relationship Depth
**Family:** 3 — Responsibility + People · **Status:** REVIEW
> *Working gloss — NOT a decision:* preference for few deep working relationships versus many lighter ones.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R9 Offer Decision
**Notes:** Distinct from Interaction Density (3.4) — volume versus depth. The does-not-measure field must hold that line.

### 3.7 · Processing Through Others
**Family:** 3 — Responsibility + People · **Status:** REVIEW
> *Working gloss — NOT a decision:* whether the person thinks by talking it through or by working it out alone first.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R6 DNA Watchpoints · R9 Offer Decision
**Notes:** A cognitive-style construct sitting in a people family. OPEN whether it belongs in family 1.

---

# Family 4 — WHAT MAKES IT WORTH IT

*Eleven constructs. Concerns what the person is actually working for.*

> **Family-level note.** This is the family most exposed to **P4**. Money, Prestige and
> Recognition must be written with exactly the same neutrality as Meaning and Mastery. A
> methodology that treats wanting money as less mature than wanting meaning is broken.

### 4.1 · Meaning
**Family:** 4 — What Makes It Worth It · **Status:** REVIEW · **Definition:** 🟡 PROPOSED — first pass, not approved

**Proposed definition.** Need for the work itself to matter to the person — for what they spend their days on to be worth doing on its own terms. It measures the requirement that the work be **significant to them**, not that it produce measurable change in the world and not that they be close to whoever it affects.

**What it measures**
- Need for the work to feel worth doing
- How intolerable meaninglessness is, as distinct from how pleasant meaning is
- Whether purpose is a **requirement** or a bonus

**What it does NOT measure**
- **Impact** — [4.2](#42--impact) is measurable change in the world. ⚠️ A person can need meaning without needing measurable impact: craft, contribution to a small group, or work that matters to them and to no one else. And a person can want impact without needing personal meaning.
- **Impact Proximity** — [4.3](#43--impact-proximity) is how close to the affected person the work must be.
- **Altruism.** Meaning is not restricted to helping people.
- **Achievement** — [4.5](#45--achievement) is clearing defined targets.

**Common confusion risks:** [4.2 Impact](#42--impact) and [4.3 Impact Proximity](#43--impact-proximity) above all — see [D-CR-04](OPEN-DECISIONS.md#d-cr-04).
⚠️ **Boundary to hold: Meaning ≠ Impact ≠ Impact Proximity.** Three separable questions: *does the work matter to me* · *does it change anything* · *do I have to see who it changes*.

**Construct shape:** **independent intensity** *(proposed)*. The opposite of *needs meaning* is *does not require it*, not a positive opposing pole — there is no coherent "wants meaningless work." Per **P4**, low meaning-need is not cynicism; it can be a clean separation of work from identity, which is [5.2 Career Centrality](#52--career-centrality) territory.

**Evidence sources:** all six are plausible — baseline preference · behavioral scenario · tradeoff · real-life self-report · invariance probe · adaptive clarifier. *(No weights assigned.)*

**Known Assessment v1 evidence** — the richest of the twelve, alongside [5.1](#51--life-protection)

| Item | Evidence | Note |
|---|---|---|
| **Q61 = D** | Meaningful difference | Presence framing |
| **Q62 = D** | Meaningless work would bother her most | ⭐ **Absence framing** — evidence that the absence is *consequential*, which is [Need criterion 3](11-tradeoff-model.md#6--connection-to-needs--preferences--flexibility) and the [Consequence dimension](04-evidence-and-confidence.md#4--consequence). Rare and valuable; most items measure presence. |
| Table A row 3 | *Impact / Meaning > Money* | ⚠️ **Confounded** — two constructs on one side, so this is lower-confidence per the isolation rule and cannot be claimed cleanly for Meaning. Item number not supplied. |
| Q69 = A | *Adjacent, not mapped here* | Direct visible human impact — primarily [4.3 Impact Proximity](#43--impact-proximity). |

Two clean signals plus one confounded edge, across two evidence types. Enough to be worth reading; **not** enough to assert a classification.

**Downstream consumers:** Professional DNA report · Needs / Preferences / Flexibility · DECODED ([DI-05](06-decoded-insights.md#di-05)) · Career Trajectory · Decoder personalized overlay · Path Positioning · Offer Decision.
**Not** Lanes as a filter — a posting cannot establish whether work will feel meaningful to a particular person; it becomes *Needs Investigation*.

**Open questions**
- Boundary against [4.2](#42--impact) / [4.3](#43--impact-proximity) — related to [D-CR-04](OPEN-DECISIONS.md#d-cr-04), which asks the same question one level down.
- Does the confounded Table A row 3 count as Meaning evidence at all, or only as Impact-or-Meaning evidence? [D-TM-04](OPEN-DECISIONS.md#d-tm-04).
- Is meaning **domain-bound** — meaning found in a particular kind of work — or a general requirement? The two have very different Career Trajectory consequences.

### 4.2 · Impact
**Family:** 4 — What Makes It Worth It · **Status:** REVIEW
> *Working gloss — NOT a decision:* need for the work to change something measurable in the world.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R9
**Notes:** See [D-CR-04](OPEN-DECISIONS.md#d-cr-04). Boundary against Meaning (4.1) is OPEN.

### 4.3 · Impact Proximity
**Family:** 4 — What Makes It Worth It · **Status:** REVIEW
> *Working gloss — NOT a decision:* how close to the affected person or outcome the work needs to be for the impact to register.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R5 Lanes (research criterion "human impact") · R9
**Notes:** See [D-CR-04](OPEN-DECISIONS.md#d-cr-04) — modifier or independent construct. Overlaps Help (2.9).

### 4.4 · Mastery
**Family:** 4 — What Makes It Worth It · **Status:** REVIEW · **Definition:** 🟡 PROPOSED — first pass, not approved

**Proposed definition.** Satisfaction from becoming genuinely good at something — the pull toward depth, competence and craft for their own sake. It measures the reward a person gets from **getting better**, independent of whether anyone notices and independent of whether it advances them.

**What it measures**
- Satisfaction from skill growth as an end in itself
- Pull toward depth over sufficiency
- Willingness to invest time in getting good with no external return attached

**What it does NOT measure**
- **Prestige** — [4.10](#410--prestige) is the standing of the employer, field or title. ⚠️ Mastery can be pursued in a field nobody rates.
- **Formal advancement** — promotion and seniority. The unmapped `Advancement` node is not this, and neither is [3.2 Formal Leadership](#32--formal-leadership). Getting better and getting promoted are different rewards and frequently diverge.
- **Recognition** — [4.9](#49--recognition). [DI-03](06-decoded-insights.md#di-03) pairs high Mastery with *low* Recognition precisely because the two separate.
- **Mastery vs Breadth** — [6.1](#61--mastery-vs-breadth) is a **growth orientation** (depth versus width). Whether that is independent of this motivator is [D-CR-03](OPEN-DECISIONS.md#d-cr-03).
- **Current capability.** Per **P5**.

**Common confusion risks:** [6.1 Mastery vs Breadth](#61--mastery-vs-breadth) (primary — same word) · [4.10 Prestige](#410--prestige) · [4.9 Recognition](#49--recognition) · [4.5 Achievement](#45--achievement) · the unmapped `Expertise` node.
⚠️ **Boundary to hold: Mastery ≠ Prestige ≠ formal advancement.**

**Construct shape:** **independent intensity** *(proposed)*.

> **A candidate reading for [D-CR-03](OPEN-DECISIONS.md#d-cr-03), not a decision.** If
> [6.1](#61--mastery-vs-breadth) is the **spectrum** (depth ↔ breadth), this may be the
> **intensity** (how much getting-good matters at all). That would let both survive without
> redundancy. It is one of several possible resolutions and is recorded here so the option is
> visible when D-CR-03 is decided — it is **not** a proposal to adopt it.

**Evidence sources:** baseline preference · behavioral scenario · tradeoff · real-life self-report · invariance probe. *(No weights assigned.)*

**Known Assessment v1 evidence**

| Item | Evidence | Note |
|---|---|---|
| Table A row 4 | **Mastery > Constant Novelty** | ⚠️ Item number not supplied. The *winner* maps here; `Novelty` is unmapped ([D-TM-09](OPEN-DECISIONS.md#d-tm-09)). |
| Table A row 2 | *Expertise > Management / Authority* — **possible, unresolved** | If `Expertise` maps to this construct, this is a second edge. `Expertise` is unmapped, with [6.1](#61--mastery-vs-breadth) as the other candidate — so this cannot be claimed until [D-TM-09](OPEN-DECISIONS.md#d-tm-09) resolves. |
| Q67 = A | *Supporting, secondary* | Success matters even if nobody knows title, employer, salary or accomplishments. An invariance probe consistent with mastery-over-recognition — but Q67 is primarily a [4.9](#49--recognition) / [4.10](#410--prestige) probe, so it supports the *boundary* more than the construct. |

**Downstream consumers:** Professional DNA report · Needs / Preferences / Flexibility · DECODED ([DI-03](06-decoded-insights.md#di-03), [DI-06](06-decoded-insights.md#di-06)) · Career Trajectory · Path Positioning · Offer Decision.
**Not** Lanes.

**Open questions**
- [D-CR-03](OPEN-DECISIONS.md#d-cr-03) — independent of [6.1](#61--mastery-vs-breadth), or is one derived from the other?
- Does `Expertise` map here? [D-TM-09](OPEN-DECISIONS.md#d-tm-09). It would double this construct's evidence.
- Is mastery **domain-bound** or general? A person may want depth in one thing and sufficiency everywhere else — that is a different construct from wanting depth as such.

### 4.5 · Achievement
**Family:** 4 — What Makes It Worth It · **Status:** REVIEW
> *Working gloss — NOT a decision:* need to hit and clear defined targets.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R9
**Notes:** Boundary against Mastery (4.4) — clearing a bar versus deepening a craft.

### 4.6 · Money
**Family:** 4 — What Makes It Worth It · **Status:** REVIEW
> *Working gloss — NOT a decision:* how much compensation matters relative to everything else.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 Compensation requirements · R5 Lanes (compensation criterion) · R9 Offer Decision

**Two-part measurement — REQUIRED.** Peri has specified that SIGNAL must eventually capture
both parts. The *meaning* is not optional colour; two clients with identical Money
importance and different meanings need different paths, and the offer-decision comparison
in R9 cannot work without it.

| Part | Captures |
|---|---|
| **Money importance** | How much it matters relative to the other ten constructs in this family |
| **Meaning of money** | What it is *for* — one or more of: **scoreboard · safety · freedom · enjoyment · providing for others** |

**OPEN on the meaning axis:** whether it is single-select or multi-select; whether it is
ranked; whether the five listed meanings are exhaustive; whether meaning is asked at all
when importance is low. See [D-CR-09](OPEN-DECISIONS.md#d-cr-09).

**Notes:** ⚠️ SIGNAL stores **no compensation data about a person today** — verified
2026-08-22. Salary exists only on the job side (`lane_results.salary_min/max/currency/
frequency/transparent`). The client-side store is net-new work, tracked as
`CNL R2 — Compensation requirements and preferences` in SIGNAL PM. Note the distinction:
that PM item is about a *floor and target*; this construct is about *importance and
meaning*. They are different measurements and both are needed.

### 4.7 · Security
**Family:** 4 — What Makes It Worth It · **Status:** REVIEW
> *Working gloss — NOT a decision:* need for the arrangement to be dependable.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R9
**Notes:** Overlaps Stability (5.3) and the "safety" meaning of Money (4.6). OPEN whether Security is a motivator or a protection — it currently sits in family 4 while Stability sits in family 5.

### 4.8 · Freedom
**Family:** 4 — What Makes It Worth It · **Status:** REVIEW
> *Working gloss — NOT a decision:* value placed on being able to decide how, when and on what one works.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R5 Lanes (research criterion "autonomy") · R6 DNA Watchpoints · R9
**Notes:** Underlies [DI-01](06-decoded-insights.md#di-01) — the insight there turns on Freedom being separable from *freedom from support*, which is exactly what the does-not-measure field has to establish. Also overlaps the "freedom" meaning of Money (4.6).

### 4.9 · Recognition
**Family:** 4 — What Makes It Worth It · **Status:** REVIEW
> *Working gloss — NOT a decision:* need for contribution to be seen and acknowledged.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R4 Path Positioning
**Notes:** Underlies [DI-03](06-decoded-insights.md#di-03). **P4** — low recognition need is not humility and high is not vanity.

### 4.10 · Prestige
**Family:** 4 — What Makes It Worth It · **Status:** REVIEW
> *Working gloss — NOT a decision:* value placed on the standing of the employer, field or title.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R5 Lanes (employer type) · R9
**Notes:** Boundary against Recognition (4.9) — external standing versus being seen for one's own work.

### 4.11 · Ownership
**Family:** 4 — What Makes It Worth It · **Status:** REVIEW · **Name:** ⚠️ NOT RENAMED — deliberately
> *Working gloss — NOT a decision:* value placed on having a stake — equity, or a thing that is identifiably yours.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R9

> ### ⚠️ OPEN — does this construct survive?
>
> **Determine whether this is a distinct motivator, or should be derived from
> [Outcome Ownership (3.1)](#31--outcome-ownership), [Achievement (4.5)](#45--achievement) and
> [Freedom (4.8)](#48--freedom).**
>
> This entry was deliberately **not** renamed on 2026-08-22 when 3.1 became Outcome
> Ownership. Renaming it would have implied it is a distinct thing that merely needed a
> better label, and that is the question — not the answer. See
> [D-CR-01](OPEN-DECISIONS.md#d-cr-01), which stays **open** for exactly this.
>
> Three outcomes are live and none is favoured here:
> 1. **Distinct motivator** — keep it, and give it a name that does not share a word with 3.1.
> 2. **Derived** — remove it from the registry; it becomes a decoded insight per
>    [06](06-decoded-insights.md), computed from 3.1 × 4.5 × 4.8, subject to **P10**.
> 3. **Split** — the equity/financial-stake reading separates from the this-is-mine reading,
>    and they are two different constructs.
>
> Until this is decided, family 4 has **11 entries** and the registry has **44**. Outcome 2
> would make them 10 and 43.

**Notes:** The name collision with 3.1 is resolved on 3.1's side only. Do not treat the
gloss above as the answer to the survival question — it is a reading of one of the three
outcomes, not a decision between them.

---

# Family 5 — WHAT YOU PROTECT

*Five constructs. Concerns what must not be traded away.*

### 5.1 · Life Protection
**Family:** 5 — What You Protect · **Status:** 🔒 **LOCKED** · **Definition:** CANONICAL — approved by Peri 2026-08-23 ([DL-006](DECISION-LOG.md#dl-006))

> **CANONICAL DEFINITION**
>
> **How firmly a person defends time, energy and attention outside work — the boundary they
> hold between the job and the rest of their life. It measures the strength of the boundary,
> not the size of the ambition inside it.**

**Construct shape: 🔒 directional spectrum** — *holds a firm boundary* ↔ *lets work expand into life*.

> ### 🔒 LOCKED — Life Protection and Career Centrality are **separate constructs**
>
> They answer **different questions**:
>
> | | Question it answers |
> |---|---|
> | **5.1 Life Protection** | **What work is allowed to consume.** |
> | **[5.2 Career Centrality](#52--career-centrality)** | **How much work / career becomes part of self-definition.** |
>
> They are **not** one axis read from two ends. The earlier "may be one axis, in which case
> one is redundant" reading is **retired**.
>
> **Both cross-cases are legitimate and must remain expressible:**
> - A person may **care deeply about career identity while maintaining firm life boundaries** —
>   high Career Centrality, high Life Protection.
> - A person may have **low career centrality while tolerating very permeable work/life
>   boundaries** — low Career Centrality, low Life Protection.
>
> A model that cannot represent both of those has collapsed two constructs into one.

**What it measures**
- Firmness of boundaries around non-work time and capacity
- Willingness to trade career progress for life outside work when the two collide
- What the person refuses to give up, and at what cost

**What it does NOT measure**
- ⚠️ **Laziness, low ambition, or low achievement orientation.** All three are wrong, all three are the reflexive reading, and **P4** forbids all three. A person can hold a hard boundary and be relentlessly ambitious inside it — Q64 says exactly this: *wants both, life wins if forced.*
- **Career Centrality** — [5.2](#52--career-centrality) is how central work is to *identity*. Near-inverse, but a different question: one is about boundaries, the other about self-definition.
- **Work capacity or stamina.** Per **P5**.
- **Achievement** — [4.5](#45--achievement).

**Common confusion risks:** [5.2 Career Centrality](#52--career-centrality) · [4.5 Achievement](#45--achievement) · the unmapped `Advancement` node.

> ### 🔒 LOCKED — P4 protection
>
> **High Life Protection does NOT mean laziness, low ambition, low achievement orientation,
> or low work capacity.** All four readings are wrong; all four are the reflexive ones.
>
> Every naive phrasing of this construct's high pole reads as an accusation. Any generated
> text that renders the boundary as a limitation is a **validation failure**, not a style
> preference. See [04 §Rule B](04-evidence-and-confidence.md#b--confidence-is-about-the-interpretation-only):
> confidence is not desirability, and neither is a construct score.

**Evidence sources:** all six plausible. Tradeoff and real-life self-report are the strongest in the reviewed set. *(No weights assigned.)*

**Known Assessment v1 evidence** — the richest of the twelve, alongside [4.1](#41--meaning)

| Item | Evidence | Note |
|---|---|---|
| Table A row 6 | **Life Protection > Accelerated Career Advancement** | ⚠️ Item number not supplied. `Advancement` unmapped. |
| **Q64 = C** | **Life Protection > Career Centrality** | Wants both; life outside work wins *if forced*. Both nodes map cleanly — a clean edge, and the one that shows high boundary ≠ low ambition. |
| **Q72 = D** | Most hates becoming accomplished but consumed by work | ⭐ **Absence framing**, and it names a specific failure state — accomplishment *purchased with* life. Supplies the [Consequence dimension](04-evidence-and-confidence.md#4--consequence) and [Need criterion 3](11-tradeoff-model.md#6--connection-to-needs--preferences--flexibility). |
| **Q82** | *"Live close to friends, financially comfortable enough to get the little things that I enjoy"* | ⚠️ **Aspiration, not corroboration.** Stage 1 admissible by channel, but it describes a projected future, not lived experience — so it does **not** satisfy Need criterion 4. See [04](04-evidence-and-confidence.md#life-protection--strong-evidence-still-not-a-need). |

> **Two opponents, but are they *materially different*?** Accelerated Advancement and Career
> Centrality are both career-progression-flavoured. Under
> [11 §4 Consistency](11-tradeoff-model.md#4--consistency), repeated protection counts most
> when the opponents differ — and whether these two do is
> [D-TM-03](OPEN-DECISIONS.md#d-tm-03). This is the single most consequential open question
> attached to any construct in the twelve, because it decides whether the strongest Need
> candidate in the set clears criterion 2.

**Downstream consumers:** Professional DNA report · Needs / Preferences / Flexibility (**strongest Need candidate in the registry** — see the six-criterion walkthrough in [11](11-tradeoff-model.md#applying-the-need-pathway--and-stopping-short), which stops at three unmet or contested) · DECODED ([DI-05](06-decoded-insights.md#di-05)) · Career Trajectory (lifestyle fit) · Lanes (research criteria "hours / boundaries", "travel" — *Needs Investigation*, not scored) · JobFit career context (DNA Watchpoints) · Offer Decision.
**Not** Path Positioning — a constraint on the environment, not an element of the professional story.

**Closed by this lock** *(2026-08-23)*
- ~~One axis with [5.2](#52--career-centrality), or two constructs?~~ → **two separate constructs**, answering different questions. See the locked block above.
- ~~Shape~~ → **directional spectrum**.

**Still open**
- ⚠️ **Maleri's Life Protection is NOT classified as a Need**, and locking this definition does not change that. Need classification is governed by the separate evidence and confidence methodology — the six-criterion walkthrough in [11](11-tradeoff-model.md#applying-the-need-pathway--and-stopping-short) still stops at three unmet or contested. **A locked definition says what the construct means; it says nothing about any individual's classification.**
- [D-TM-03](OPEN-DECISIONS.md#d-tm-03) — **remains OPEN.** Are its two opponents materially different? This is a **tradeoff-evidence** question, not a construct-definition question, and is untouched by this lock.
- Does Q82 count as evidence, and of what kind? Recorded as aspiration, not corroboration.
- Is the boundary **fixed** or **negotiable under conditions** — for a period, for a specific goal? Recorded as an open refinement; the locked shape is a spectrum, and a later conditional reading would be a change requiring the change-control procedure.

### 5.2 · Career Centrality
**Family:** 5 — What You Protect · **Status:** REVIEW
> *Working gloss — NOT a decision:* how central work is to the person's identity and life structure.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R9
**Notes:** Near-inverse of Life Protection (5.1). OPEN whether they are two constructs or two readings of one. **P4** — low centrality is not low commitment.

### 5.3 · Stability
**Family:** 5 — What You Protect · **Status:** REVIEW
> *Working gloss — NOT a decision:* need for the ground under the person to stay still.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R9
**Notes:** Overlaps Security (4.7) and Predictability/Change (1.3). Three constructs in three families circling the same territory — a boundary decision is needed. Underlies [DI-04](06-decoded-insights.md#di-04).

### 5.4 · Upside / Risk
**Family:** 5 — What You Protect · **Status:** REVIEW
> *Working gloss — NOT a decision:* willingness to accept downside for the chance of a larger outcome.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R5 Lanes (employer type) · R9
**Notes:** Distinguish from Experimentation (1.7) — consequence versus curiosity.

### 5.5 · Growth Need
**Family:** 5 — What You Protect · **Status:** REVIEW
> *Working gloss — NOT a decision:* how much forward movement the person requires to stay engaged.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R7 Recurring Evidence Gaps · R9
**Notes:** See [D-CR-05](OPEN-DECISIONS.md#d-cr-05) — sits in family 5 while family 6 is four growth constructs. Underlies [DI-04](06-decoded-insights.md#di-04).

---

# Family 6 — HOW YOU GROW

*Four constructs. Concerns the shape of development the person responds to.*

### 6.1 · Mastery vs Breadth
**Family:** 6 — How You Grow · **Status:** REVIEW
> *Working gloss — NOT a decision:* whether the person grows by going deeper into one thing or wider across several.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 Career Trajectory · R4 Path Positioning · R7 Recurring Evidence Gaps
**Notes:** See [D-CR-03](OPEN-DECISIONS.md#d-cr-03) versus Mastery (4.4). Named as an explicit continuum where most constructs are not — see [D-CR-06](OPEN-DECISIONS.md#d-cr-06).

### 6.2 · Stretch Comfort
**Family:** 6 — How You Grow · **Status:** REVIEW
> *Working gloss — NOT a decision:* tolerance for operating beyond current competence.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R7
**Notes:** Underlies [DI-06](06-decoded-insights.md#di-06). Central to the Growth Edge methodology; **P4** — low stretch comfort must not read as a deficiency, which is precisely the failure mode a growth edge invites.

### 6.3 · Feedback Rhythm
**Family:** 6 — How You Grow · **Status:** REVIEW
> *Working gloss — NOT a decision:* how often and how directly the person needs to know how they are doing.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R5 Lanes (research criterion "mentorship") · R6 DNA Watchpoints · R9
**Notes:** Overlaps Guidance / Development Support (1.1) and Recognition (4.9). Three-way boundary is OPEN.

### 6.4 · Failure Response
**Family:** 6 — How You Grow · **Status:** REVIEW
> *Working gloss — NOT a decision:* what happens to the person's engagement after something goes badly.

**OPEN:** definition · measures · does-not-measure · continuum · evidence sources · scoring · confidence requirement
**Downstream consumers:** R2 · R7 · R9
**Notes:** The construct most likely to be read as a judgement. **P4** and the growth-edge language rules apply hardest here. Almost certainly **not a continuum** — likely categorical. See [D-CR-06](OPEN-DECISIONS.md#d-cr-06).

---

## Conflicts with existing SIGNAL code and documentation

Verified against the working tree on 2026-08-22. These are **not** methodology problems —
they are collision risks between this registry and things that already exist and already
run. Each needs a decision before any code keys on a construct name.

| # | Existing thing | Where | Collision |
|---|---|---|---|
| 1 | `RoleArchetype = "analytical" \| "strategic" \| "execution" \| "mixed" \| "unclear"` | `app/api/jobfit/signals.ts:103` | An existing per-person classification of *kind of work*, inferred from stated target roles. Overlaps Family 2 and shares the word "analytical" with 2.2 Analyze. Two vocabularies describing the same axis of the same person. |
| 2 | `ProfileConstraints` — 9 booleans (`hardNoSales`, `prefFullTime`, `hardNoContract`, `hardNoHourlyPay`, `hardNoGovernment`, `hardNoFullyRemote`, `preferNotAnalyticsHeavy`, `hardNoContentOnly`, `hardNoPartTime`) | `app/api/jobfit/signals.ts:105`, populated by regex over two free-text intake fields | SIGNAL already has a needs/preferences representation, and it is **binary** — hard-no or nothing. It has no flexibility tier and no strength gradation. It directly precedes the three-tier framework in [02](02-needs-preferences-flexibility.md), which must decide whether to supersede, wrap, or coexist with it. |
| 3 | Five role vocabularies: `lib/laneTaxonomy.ts` (11 lanes + Other, 49 sub-lanes) · `JobFamily` (18) · `FunctionTag` (21) · `app/api/_v4/taxonomy.ts` (20 capability clusters, dormant) · the six-value role-angle list inside the Positioning prompt | across `app/api/jobfit/` and `lib/` | Family 2 would be the **sixth**. Only lanes↔JobFamily map to each other. Already tracked as `CNL R3 — Taxonomy reconciliation decision` in SIGNAL PM; flagged here because the registry is where the sixth gets created. |
| 4 | `verbClass: "ownership" \| "contribution"` on every extracted resume bullet | `app/api/jobfit/resumeExtraction.ts:14` | The word "ownership" already means an **evidence** classification — did this person own the work or contribute to it. Construct 3.1 **Outcome Ownership** uses the same word for **preference**. Per **P5** these must never be conflated. The 2026-08-22 rename narrows the collision from an exact name clash to a shared word, which is better but not resolved. |
| 5 | `candidate_targeting` — `primary_lane`, `secondary_lane_1/2`, `career_stage`, `status_premed/prelaw/pregrad`, `source ∈ intake/migration/manual_update` | `supabase/migrations/20260512_candidate_targeting.sql` | An existing per-client record of *what the client says they want*. Under **P2** this is a distinct thing from what DNA suggests and must stay distinct — but nothing currently marks it as the "says" channel. |
| 6 | No compensation field about a person exists anywhere | verified 2026-08-22 | Construct 4.6 Money is entirely net-new on both axes. |
| 7 | `lib/coherence/` — classifies each resume role-block into a lane and returns a scattered/focused concentration read | `lib/coherence/index.ts`, dormant behind `COHERENCE_TRIAL_ENABLED` | A **resume-derived** read of professional direction. Under **P1** it must never feed Stage 1. Flagged so nobody wires it into DNA on the grounds that it is already built. Legitimate for Stage 2 and Stage 3. |
| 8 | `getAuthedProfileText()` returns `profileText` + persona-resolved `resumeText` in one call | `app/api/_lib/authProfile.ts:178` | The single entry point every SIGNAL route uses to load a person. It returns contextual data by construction. Under **P1**, the DNA calculation path **cannot use it**. This is the concrete mechanism behind `CNL R1 — Blind-calculation isolation guarantee`. |
| 9 | Intake already asks "Strong skills", "Biggest concern", "Openness to non-obvious entry points" | `app/api/profile-intake/route.ts:497-499` | Overlapping questions already answered by the client, stored as prose inside `client_profiles.profile_text`. Under **P1** they cannot enter Stage 1 — but they are legitimate Stage 2 validation evidence. |
| 10 | "Growth edge" vs existing gap vocabularies: JobFit `RISK` codes, evidence gaps, and planned R7 recurring gaps | `app/api/jobfit/signals.ts`, CNL R7 | Three gap-shaped vocabularies about the same person. The R0 growth-edge item already requires the distinction; recorded here because the registry is where Stretch Comfort (6.2) makes it concrete. |

---

## Status of this document

**REVIEW.** The construct names and families come from Peri. Everything else is `OPEN` or a
clearly-marked non-binding gloss. **Nothing here is LOCKED.**

**Name collisions resolved 2026-08-22.** [D-CR-02](OPEN-DECISIONS.md#d-cr-02) is closed and
[D-CR-01](OPEN-DECISIONS.md#d-cr-01) is half-closed. Every construct now carries a unique
name — but whether [4.11 Ownership](#411--ownership) survives as a distinct motivator is
still open, and that answer can still change the registry's size.

The renames settled **names only**. No definition, scoring rule, continuum or confidence
requirement was decided, and no construct moved out of `REVIEW`. A unique name is what lets
the *conversation* proceed; it is not what lets *code* key on a construct. That still
requires a definition, and all 44 are `OPEN`.
