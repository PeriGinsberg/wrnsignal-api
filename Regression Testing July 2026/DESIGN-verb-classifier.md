# Design — Evidence-Verb Classifier (defect #2)

Status: DESIGN ONLY. No engine code. Grounded on 01 Jordan / 06 Sofia (fire) and
07 Reyna (must not fire). Same discipline as defect #1.

## The defect
Contribution verbs (partnered, supported, assisted, contributed, helped,
collaborated, participated) must NOT substantiate an OWNERSHIP requirement
(owned, built, led, architected, drove, hired, defined). Today the engine
credits Jordan's *"Partnered with the media agency to develop dashboards"* as
*"demonstrated ownership of a measurement function."* The fix fires a **RISK**
(`ownership_via_contribution_verbs`), it **does NOT gate** (this is why ownership
was pulled OUT of the gate ledger — see DESIGN-gate-ledger §1a — and lands here).

The output is a Review-cap risk (downgrades APPLY, never force_pass).

---

## 1. Verb taxonomy
Classification is on the bullet's **leading action verb** (the candidate's own
verb), NOT on modifiers or later verbs — see §2 for why.

**OWNERSHIP** (substantiates an ownership requirement):
`owned · built · led · architected · drove/drive · hired · defined · established
· founded · created · launched · spearheaded · headed · ran · set (up) · scaled
· initiated · championed`

**CONTRIBUTION** (participation/support — does NOT substantiate ownership):
`partnered · supported · assisted · contributed · helped · collaborated ·
participated · worked (on/with) · gathered · aided · joined · engaged`

**NEUTRAL** (task execution, ownership-ambiguous):
`analyzed · maintained · reported · tracked · monitored · produced · prepared ·
executed · implemented · delivered · conducted · performed · updated · managed
(unscoped)`

**Default for an unlisted verb → NEUTRAL.** Rationale: a neutral verb neither
substantiates ownership (won't clear a faker) nor marks contribution (won't fire
on an honest ambiguous résumé). It is the conservative-safe default — the same
"unknown → don't assume, but don't punish" posture as defect #1's domain years.
Consequence: neutral-only evidence for the required object does **not** fire the
risk (it isn't contribution-inflation) and does **not** clear it (it isn't
ownership); it simply leaves the object unsubstantiated, which is out of this
risk's scope.

---

## 2. The mismatch logic (the crux) — object-scoped, not résumé-wide
The risk is NOT "résumé contains contribution verbs" (every résumé does). It is
"the posting demands ownership of **X**, and the résumé's evidence **for X** is
contribution-only." Four steps:

**Step A — extract the posting's ownership requirements.** Parse requirement
lines of the form `ownership of <X>` / `own the <X>` / `driving <X> you
personally defined`. Threadline → X = "a measurement function" (with the
explicit contrast "*not just reporting within one*"). Nimbus → X = "a product
line or roadmap" + "strategy". If a posting has **no** ownership requirement, the
risk can never fire (foundational guard, §3).

**Step B — build X's concept set (function-level).** Head noun(s) of X plus a
domain expansion, split into FUNCTION-level vs TASK-level nouns:
- FUNCTION nouns (ownable systems): `function · system · stack · platform ·
  warehouse · infrastructure · model · pipeline · roadmap · strategy · program ·
  org · practice`. Plus X's own domain terms — "measurement function" expands to
  `{data warehouse, data stack, dbt, BI layer, attribution, forecasting,
  marketing mix model, measurement system}`.
- TASK nouns (deliverables *within* a function, EXCLUDED): `report · reporting ·
  dashboard · taxonomy · test · readout · deck · analysis · spreadsheet`. The
  posting's "not just **reporting** within one" clause explicitly seeds this
  exclusion.

**Step C — find object-relevant, function-level bullets.** A bullet is relevant
to X iff its object noun phrase overlaps X's concept set AND its head noun is
FUNCTION-level (TASK-level objects are dropped). This is the step that ties the
verb to the *specific* requirement.

**Step D — classify + fire.** For the relevant bullets, read the leading verb.
> **RISK fires iff:** ≥1 relevant (function-level) bullet exists, at least one
> uses a CONTRIBUTION verb, AND **none** uses an OWNERSHIP verb.
> A single OWNERSHIP verb on X clears the risk.

### Why this avoids the trap (Jordan's "Built recurring reporting")
The trap: counting ownership verbs *anywhere* would clear Jordan, because he says
"**Built** recurring reporting" and "**Maintained** campaign taxonomy" —
ownership/neutral verbs, but on TASK-level objects (`reporting`, `taxonomy`), NOT
on the measurement *function*. Step C drops those bullets (task nouns, and the
posting explicitly excludes "reporting"), so they never count as clearing
evidence. Jordan's only FUNCTION-level measurement bullet is "**Assisted** in the
rollout of a marketing mix **model**" (model = function-level) — a CONTRIBUTION
verb, no ownership → the risk fires. The object-scoping is the whole game.

### Leading-verb rule (avoids a symmetric trap)
Verb class comes from the bullet's **leading** verb, not embedded verbs or
modifiers. "**Partnered** with the agency to *develop* dashboards" → CONTRIBUTION
(the candidate partnered; someone developed). "**Defined** SQL lead-scoring
*jointly with* RevOps" → OWNERSHIP (they defined it; "jointly" is a collaboration
modifier, not a demotion). Without this, "owned X jointly with Y" would wrongly
read as contribution and over-fire on collaborative-but-owned work.

---

## 3. Over-fire guards (the #1 lesson: a mixed résumé is not a faker)
"OWNED three things and SUPPORTED one" must not fire.
- **Guard 1 — posting-demand-gated.** No ownership requirement in the JD → no
  risk, ever. A support-heavy résumé for a support role is fine.
- **Guard 2 — object-scoped, not résumé-wide.** The risk keys ONLY on evidence
  for the *specific* object the posting demands owned. Contribution verbs on
  other objects are irrelevant. Owned-three-supported-one fires only if the
  *supported one* IS the required object AND it has no ownership verb.
- **Guard 3 — one ownership verb clears.** A single OWNERSHIP verb on X clears
  the risk regardless of how many contribution verbs sit elsewhere (mixed is
  normal). Directly answers "owned three, supported one."
- **Guard 4 — leading-verb rule (§2).** "owned X jointly with Y" stays
  ownership. Collaboration modifiers never demote an ownership leading verb.
- **Guard 5 — function-scope filter.** Only function-level relevant bullets
  count; task-level ownership/contribution is ignored on both sides
  (symmetric — it neither clears nor fires).

**Reyna (07) walkthrough — must NOT fire.** X = measurement function.
Relevant function-level bullets: "**Built** the marketing data warehouse and dbt
models … **owned** the BI layer end to end" (OWNERSHIP), "**Owned** CAC/LTV/
payback/pipeline-velocity reporting" (OWNERSHIP on the measurement system —
note the reporting here is *owned as a function*, and there IS an ownership verb),
"**Defined** SQL lead-scoring … jointly with RevOps" (OWNERSHIP, Guard 4). ≥1
ownership verb on X ⇒ **cleared** (Guard 3). Her single collaborative phrase
doesn't matter because the required object is owned. ✓

---

## 4. Plug-in point
- **Résumé side — reuse, don't re-parse.** Extend defect #1's
  `profileEvidence.ts` plumbing (`sectionSplit` + `parseRoles` already split
  roles into per-bullet bodies). Add a sibling extractor
  `extractVerbEvidence(resume)` that returns, per bullet: `{ leadingVerb,
  verbClass, objectPhrase, objectHeadNoun, scope: "function"|"task" }`. Reusing
  parseRoles avoids a second résumé parser that could drift from #1's.
- **Posting side — reuse the segmenter.** Extract ownership requirements from
  the requirements-scoped JD (`filterJobTextToRequirements` / the gate
  classifier's section pass) — parse `ownership of <X>` / `own the <X>`.
- **Output — a RISK, not a gate.** Emit `RISK_OWNERSHIP_VERB_MISMATCH` into the
  engine's `riskCodes` (scoring.ts), severity HIGH, which flows through the
  existing `applyRiskDowngrades` (caps APPLY→REVIEW, never force_pass). Maps to
  the golden vocab id `ownership_via_contribution_verbs`. It composes with the
  gate ledger: on 01 the ledger already floors to PASS, so this risk is
  additive; on 06 (no gates) it is what keeps the verdict off APPLY.
- **Boundary:** this defect only fires/positions the RISK. Whether 06 lands
  exactly REVIEW vs PASS is the score-band question (shared with 08's ticket),
  out of scope — for the golden set 06 is a non-discriminator whose only failure
  is the missing risk, so firing it is sufficient.

---

## 5. Grounding table (per-bullet, the build spec)
X = the posting's ownership object. ✓ = counts toward the decision.

**01 Jordan — X = measurement function → RISK FIRES**
| Bullet (leading verb) | object → scope | class | counts? |
|---|---|---|---|
| **Supported** a growth marketing team | team → function(team) but not measurement | contribution | domain-miss |
| **Partnered** … to develop dashboards | dashboards → TASK | contribution | dropped (task) |
| **Assisted** in the rollout of a marketing mix **model** | model → FUNCTION + measurement | contribution | ✓ **contribution on X** |
| **Collaborated** … on campaign readouts | readouts → TASK | contribution | dropped |
| **Built** recurring **reporting** | reporting → TASK (excluded by JD) | ownership | dropped (not X) |
| **Maintained** campaign **taxonomy** | taxonomy → TASK | neutral | dropped |
Result: ≥1 contribution on X, **no** ownership on X → **FIRE**. ✓

**06 Sofia — X = roadmap / product line / strategy → RISK FIRES**
| Bullet | object → scope | class | counts? |
|---|---|---|---|
| **Supported** the launch of our **product line** | product line → FUNCTION + X | contribution | ✓ |
| **Contributed** to the quarterly **roadmap** | roadmap → FUNCTION + X | contribution | ✓ |
| **Participated** in product **strategy** sessions | strategy → FUNCTION + X | contribution | ✓ |
| **Helped** define requirements for the reporting module | requirements → TASK | contribution | dropped |
Result: contribution on X, no ownership on X → **FIRE**. ✓

**07 Reyna — X = measurement function → RISK MUST NOT FIRE**
| Bullet | object → scope | class | counts? |
|---|---|---|---|
| **Built** the data **warehouse** and dbt models; **owned** the BI **layer** | warehouse/BI → FUNCTION + measurement | ownership | ✓ **ownership on X** |
| **Owned** CAC/LTV/pipeline reporting (as a function) | measurement system → FUNCTION | ownership | ✓ |
| **Defined** SQL lead-scoring jointly with RevOps | scoring logic → FUNCTION | ownership (Guard 4) | ✓ |
| **Hired** and manage one junior analyst; **set** the roadmap | team/roadmap → FUNCTION | ownership | ✓ |
Result: ≥1 ownership on X → **CLEARED** (Guard 3). ✓

The discriminator: 01 and 07 share the Threadline posting (same X). 01's X-evidence
is contribution-only; 07's is ownership. Opposite outcomes on the same requirement.

---

## 6. Production gap (bounds what the golden set proves)
The semantic-hard part is **Step B/C — object matching** (does a bullet's object
belong to X's concept set, and is it function- vs task-level). This is
keyword/vocabulary-fitted to the three résumés (measurement-function expansion,
FUNCTION/TASK noun lists) — the same class of risk as #1's domain-year
attribution. It needs real-résumé hardening or the LLM path before prod breadth.
Safe-direction default: when object-relevance is uncertain, **do not fire** (a
missed risk is a too-high verdict the reviewer can catch; a false risk wrongly
downgrades an honest candidate — the worse error, mirroring #1's under-credit
posture). Verb classification itself is a bounded list and low-risk; the object
tie is where the fitting lives. Reuse the dash-normalization fix from #1's §5a
here too (bullets wrap and use mixed dashes).
