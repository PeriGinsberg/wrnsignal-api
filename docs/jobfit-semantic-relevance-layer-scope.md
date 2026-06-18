# JobFit — Semantic Evidence-Relevance Layer (scope for build/no-build)

**Status:** SCOPE ONLY — no implementation. Decision doc.
**Relationship to Ticket 1:** This is the "bigger rethink," NOT part of Ticket 1's
rules track. See disposition recommendation at the end.
**Author context:** Written after Ticket 1 Stage 2b lever 2 (`27dc9dff`). The
cheap rules levers are exhausted; the remaining false-positives are confirmed
SEMANTIC.

---

## The problem this solves (one line)

The deterministic matcher credits a *real, generic* capability against a
*specialized* requirement it does not actually satisfy — "right skill, wrong
domain." Keyword rules, anchors, and family classification all failed to make
this call cleanly (confirmed across Ticket 1).

The residual class, with the matched evidence vs the requirement it wrongly satisfies:

| Case | Generic evidence credited | Specialized requirement | Now |
|---|---|---|---|
| Jordan/Zurich | guest-services at a charity event (`customer_service_guest_experience`) | underwriting-support broker/customer interaction | Review/61 (want Pass) |
| Ava/J4 | marketing KPI/conversion analytics (`analysis_reporting` → adj. `financial_analysis`) | financial analysis for IB | Apply/82 (want not-Apply) |
| Ava/J6 | same | same | Apply/81 (want not-Apply) |

The pattern is identical: a transferable capability matches by keyword, but a
human reads the evidence and says "that's not the same work." That judgment is
**semantic relevance between two short texts** (evidence snippet ↔ requirement
text), which is the one thing the deterministic engine cannot express.

---

## WHAT it is — mechanism comparison

A gated check that, for a *suspect* credit, asks: **does this matched evidence
genuinely satisfy this specific requirement?** Two candidate mechanisms:

### (a) Gated LLM relevance call
For each suspect match, send `{requirement_text, evidence_snippet}` to Haiku with
a forced structured output (`{satisfies: boolean, confidence: "high"|"med"|"low"}`),
temp 0. The engine then deterministically down-weights or suppresses the credit
on a `satisfies:false, confidence:high` verdict.

- **Strength:** can reason about *domain specificity* — "marketing KPI analytics
  is not financial modeling for an IB role," "charity guest-services is not
  underwriting-support customer interaction." This is exactly the discrimination
  the residuals need.
- **Weakness:** reintroduces an LLM into the scoring loop (determinism section
  below). One extra serial call per suspect match.

### (b) Embedding cosine similarity
Embed the evidence snippet and the requirement text; if cosine < threshold,
suppress the credit. Requirement embeddings precomputed/cached.

- **Strength:** ~free, fast, fully numeric (no generation variance).
- **Fatal weakness for THIS problem:** embeddings capture *topical* similarity,
  not "does X satisfy specialized requirement Y." The Ava case is precisely where
  this fails — "marketing analytics" and "financial analysis" are embedding-close
  (both are *analytics*), so cosine would rate them similar and KEEP the bogus
  credit. Embeddings discriminate topic, not specialty/seniority/domain. They'd
  need a per-requirement learned threshold and would still confuse near-topics.
  Cost savings are irrelevant if the mechanism can't separate the cases we built
  it for.

### Recommendation: **(a) gated LLM relevance call.**
The residuals are near-topic, wrong-domain — the exact failure mode embeddings
can't separate. The cost delta between (a) and (b) at our volume is cents/month
(see COST), so cost is not the tiebreaker; discrimination quality is, and only
(a) has it. Keep (b) in mind only as a *pre-filter* to cheapen (a) at scale
(embedding-cheap triage of which matches are "obviously fine"), not as the
decision mechanism — and we are nowhere near the volume that would justify it.

---

## WHERE it sits in the pipeline

```
extract.ts → scoring.ts (build evidence matches + weights)
                 │  ← matches exist here as {match_key, job_fact, profile_fact, strength, weight}
                 ▼
        [SEMANTIC RELEVANCE GATE]   ← NEW, runs on SUSPECT matches only
                 │  verdict → deterministic down-weight/suppress
                 ▼
        base score → decision.ts → bullets → route
```

- **Gate point:** after evidence matches are built (scoring.ts), **before** base
  score / decision. It consumes the already-computed match list.
- **Adjust vs flag-and-recheck:** **adjust** — the LLM returns a narrow boolean;
  the engine applies a *deterministic* transform (down-weight the match to weak,
  or zero it + zero what it seeds via ADJACENCY). The existing deterministic
  decision then re-runs unchanged. The LLM never produces a score, only a verdict.
- **Every match vs suspect-only:** **suspect-only.** A match is suspect when a
  *generic/transferable* capability (`analysis_reporting`,
  `customer_service_guest_experience`, transferable `prospecting`, etc. — a small
  curated set) is credited toward a *specialized* JD/requirement (finance,
  underwriting, clinical, legal — a curated set). In-field matches (George's
  `financial_analysis` on a finance JD) are NOT cross-domain → never reach the
  LLM. This keeps calls to ~0–2/scan and structurally protects true-fits.

---

## COST (at real free-scan volume)

**Volume (prod, measured 2026-06):** `jobfit_anonymous_runs` = 71/mo (free path is
new; this is the path with the over-crediting problem). Authed `jobfit_runs` =
257/mo. Total AI spend today ≈ $12/mo, all Haiku.

**Per suspect-match call (a):** ~400 tok in (requirement + evidence + schema) +
~40 tok out. Haiku 4.5 @ ~$1/MTok in, ~$5/MTok out → **~$0.0006/call.**
Suspect matches/scan: 0–2 (most scans 0; only cross-domain résumés trigger).

| Free scans/mo | Worst case (2 calls/scan) | Realistic (~0.5 call/scan) |
|---|---|---|
| 71 (today) | $0.09/mo | $0.02/mo |
| 1,000 (promo growth) | $1.20/mo | $0.30/mo |
| 10,000 | $12/mo | $3/mo |

So at today's volume it's **rounding error**; even at 100× growth it at most
doubles current spend, worst case. **(b) embeddings:** ~$0.00002/match (Voyage/
OpenAI; Anthropic has no embeddings API → new vendor) — a few cents/mo, but buys
the wrong discrimination. **Cost does not drive this decision.**

---

## DETERMINISM (the thing that made the scorer valuable)

Option (a) puts an LLM back in the SCORE path. This is the real cost of the
feature and must be managed deliberately. CLAUDE.md's "no LLM in the scoring
loop" property weakens to **"deterministic given a frozen/cached verdict layer."**
Honest framing: that is a genuine architectural change, not a free lunch.

Controls:
1. **temp 0 + forced structured output** (boolean + enum confidence) → minimal
   generation variance; no free-text parsing.
2. **Schema validation, fail-OPEN.** Malformed/timeout/uncertain → KEEP the
   deterministic credit (no suppression). A flaky call can never *fabricate* a
   suppression, so the failure mode degrades to today's behavior, never worse.
3. **Verdict cache, keyed by `hash(requirement_text + evidence_snippet)`** — same
   pair → same verdict. This is the existing `haiku-overrides.local.json` pattern.
   For the acceptance + 68-case harnesses, verdicts are **frozen** → the
   deterministic test suites stay byte-deterministic. CI never calls the live LLM.
4. **Pinned model version.** A model bump re-freezes verdicts behind a reviewed
   diff (same discipline as `--update-baseline`).
5. **Score is a pure function of (matches, verdicts).** The only non-determinism
   is the verdict, which is temp-0+structured in prod and frozen in tests.

Net: production scores are stable run-to-run (cache), tests are fully
deterministic (frozen), and the blast of model drift is gated to a reviewed
re-freeze. But it is no longer literally "no LLM in scoring" — accept that
explicitly or don't build it.

---

## COVERAGE

| Target | Resolved? | Mechanism |
|---|---|---|
| Jordan → Pass | **Yes (high)** | suspect: guest-services `customer_service` on underwriting JD → `satisfies:false` → suppress +97 → Pass |
| Ava/J4 → not-Apply | **Yes (high)** | suspect: marketing analytics `analysis_reporting` on IB JD → suppress credit **and** its ADJACENCY seed of `financial_analysis` → drops |
| Ava/J6 → not-Apply | **Yes (high)** | same |
| **Broader class** | **Yes — this is the point** | any generic-capability-on-specialized-requirement match, not just these 3 |

Two caveats:
- Coverage = (suspect-gating recall) × (LLM judgment accuracy). If the gating
  heuristic doesn't flag a pair, no check runs. Both are tunable; start
  conservative (high-precision gating) and widen.
- The Ava fix **must suppress the ADJACENCY seed**, not just the direct credit —
  her score is carried by `analysis_reporting` *seeding* adjacent
  `financial_analysis`. Suppressing only the direct match leaves the adjacent
  credit. This is a known sharp edge from Ticket 1's reverted 1b experiment.

This resolves all 3 residuals AND the class — which is why it's worth more than
three more rules levers.

---

## BLAST RADIUS

Inserting semantic judgment into a deterministic scorer. Risks, ranked:

1. **False suppression of a true-fit** (mirror of rules over-correction): the LLM
   wrongly says an in-field credit doesn't satisfy → George/Matthew/Allison drop.
   *Mitigations:* suspect-gating means in-field matches never reach the LLM;
   fail-open; down-weight before hard-zero; true-fit acceptance cases are the gate.
2. **Determinism drift on model bump** — mitigated by frozen verdicts + pinned
   model + reviewed re-freeze (above).
3. **Latency/cost** — +1–2 serial Haiku calls on the scan path. The free path
   *already* runs a Haiku pre-pass, so the infra and latency budget exist;
   ~300–800ms worst case.
4. **Availability** — LLM down → fail-open → degrades to current deterministic
   behavior. No hard failure.
5. **Historical runs** — forward-only; the 1,058 prod runs are untouched.

The structural protection (suspect-gating excludes in-field matches) is what
keeps this from being the same over-correction trap as the rules track.

---

## ACCEPTANCE (the gate)

Build is GREEN only when ALL hold, with verdicts frozen:
1. **Frozen 28-suite** (`docs/jobfit-ticket-acceptance-suite.md` must-fire /
   must-not-fire cells) — no regressions.
2. **Free-path acceptance** (`tests/jobfit-regression/acceptance/`):
   - **Jordan/Zurich → Pass**
   - **Ava/J4 & Ava/J6 → not-Apply**
   - **Catherine/J6 → Pass** (already fixed; must hold)
   - True-fits hold: George not-Pass; Matthew, Allison J9/J10, Lees/J5,
     Nachman/J1, Ava/J7 → Apply-or-better.
3. **68-case regression** clean (verdicts frozen → byte-deterministic).
4. **NEW determinism check:** run the suite twice → identical scores (verdict
   cache hit). This guards the property the feature puts at risk.

---

## Where this leaves Ticket 1 — recommendation: **CLOSE it**

Ticket 1's thesis was a context-aware *rules* matcher, and it is delivered:
- Stage 1 — word-boundary PhraseSpec schema (behavior-neutral).
- Stage 2a — finance anchors: **Catherine fixed** (Pass), Jordan halved
  (Apply/80 → Review/69).
- Stage 2b lever 1 — coursework-vs-experience hygiene (general rule).
- Stage 2b lever 2 — JD-classifier precision: **Zurich reclassified** Sales →
  Operations, Jordan → Review/61.

The residuals are now *proven* not rules-solvable (semantic). Keeping Ticket 1
open until they resolve would (a) conflate two different fixes, (b) block
shipping the rules wins, and (c) mis-frame a deterministic-engine change as
unfinished rules work. **Close Ticket 1 as "rules track complete"**; open the
semantic layer as a separate ticket (this doc) whose acceptance gate *includes*
the 3 residuals.

**Stage 4 (re-enable Fix C, family-distance override)** was gated on "the matcher
upgrade," which is now done. It is a *deterministic/rules* change → keep it in
Ticket 1's close-out (or its own small ticket), **out of** the semantic ticket.

**Backlog (unchanged, separate):** lab/science capability rule.

---

## Build / no-build summary

- **What:** gated LLM relevance check on suspect matched-evidence-vs-requirement
  pairs; deterministic down-weight on the verdict. Recommend mechanism **(a)**
  over embeddings (embeddings can't separate near-topic, wrong-domain — our exact
  cases).
- **Cost:** negligible now (~$0.09/mo worst case at 71 scans), ≤ doubles spend at
  100× growth. Not a constraint.
- **Real price:** trades literal "no LLM in scoring" for "deterministic given
  frozen verdicts." Managed by temp 0 + structured + fail-open + verdict cache +
  pinned model. This is the actual decision — accept that tradeoff or don't build.
- **Payoff:** resolves all 3 residuals AND the whole "generic skill, specialized
  role" class that rules structurally cannot.
