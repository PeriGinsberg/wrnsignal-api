# Free-vs-Paid Parity — Decision (DECIDED, pending hardening)

Status: DECISION RECORD. No code shipped. Parity architecture is chosen; the
prod flip is BLOCKED on §5a + §6 hardening.

## The bug
The free scan caught two signals — "consumer marketing, not B2B SaaS" and "no
dbt" — that paid JobFit lost, converting the dbt gap into a *strength*. Paid
should never lose a signal free caught.

## Diagnosis (see the three-path trace)
- **Free and paid share one scoring spine — `runJobFit` (`jobfitEvaluator.ts`).**
  They are not separate engines; they are two callers passing different **args**.
- **The divergence is the `semantic` arg.** Free (`jobfit-run-trial-open`) passes
  `semantic` (live LLM evidence-relevance suppression, `allowLive:true`); paid
  (`runJobFitForProfile`) does **not** pass it (confirmed — zero references). With
  `semantic` undefined, the `if (args.semantic)` suppression block is skipped, so
  every adjacent/generic "right skill, wrong domain" match is kept and scored —
  paid credits gaps free would drop. (Secondary divergences also push the same
  direction: free forces `targetFamilies: []`; paid *infers* families and passes
  user title/company + an intake header.)
- **Aligning args (Option A) would NOT reliably fix the bug.** The semantic
  layer's Stage-1 gate uses curated sets (`semanticGate.ts` `GENERIC_CAPABILITIES`
  / `SPECIALIZED_REQUIREMENTS`) that are **finance/clinical/policy-scoped** —
  "B2B SaaS" and "dbt / marketing-analytics" vocabulary is absent. So the exact
  bug signals would likely never pass the gate, never reach Haiku, and be kept
  even on free. Turning `semantic` on for paid inherits that coverage gap.
- **Parity is not structural.** Same spine, but the divergent args pull opposite
  ways (free = more conservative, paid = less). "Paid ⊇ free" must be *enforced*,
  not assumed.

## Decision — Option B: deterministic detector floor on BOTH paths
The #1–#3 fixes (gate ledger, ownership-verb-mismatch risk, risk detectors) are
opt-in flags **on the shared spine**, currently OFF on both paths. They are
**deterministic** and catch the actual bug signals **without any LLM**:
- `domain_gap` = "consumer, not B2B SaaS" (0 domain-years in the required domain).
- `adjacency_inflation` = "Tableau/MMM credited as dbt-equivalent" — literally the
  dbt-gap-as-strength.

Enabling #1–#3 on **both** `jobfit-run-trial-open` and `runJobFitForProfile`
makes paid inherit the same deterministic floor as free — **parity by
construction**, independent of the finance-scoped semantic gate, and it
generalizes beyond that gate's curated vocabulary. This is the direction the
#1–#3 work already set up (all three are spine-level opt-in flags).

Option A (align args / put `semantic` on paid) is rejected: it keeps the LLM in
the paid loop and inherits the semantic gate's coverage gaps — it wouldn't
reliably catch the SaaS/dbt signals that motivated the bug.

## BLOCKED ON — hardening before the prod flip
Do **not** flip #1–#3 ON in prod until both are real-corpus hardened:
- **§5a** (DESIGN-gate-ledger) — domain-year attribution (keyword-fitted) +
  dash normalization.
- **§6** (DESIGN-gate-ledger / DESIGN-verb-classifier) — object-matching and the
  FUNCTION/TASK noun taxonomy (currently allowlist approximations of the
  decidable rule).
These are the corpus-fitted parts; shipping them unhardened risks false-fires on
real résumés (the one error direction the whole effort guards against).

## The flip, when hardening lands
Enable, on **both** entry points, the three spine flags:
`applyGateLedger`, `applyVerbMismatchRisk`, `applyRiskDetectors`
— i.e. `jobfit-run-trial-open/route.ts` and `runJobFitForProfile.ts` pass all
three `true` (as `_engine_bridge.ts` already does for the golden harness). Prod
posture flips from OFF→ON in one place per path; the golden set stays the
correctness gate.

## Deferred — parity regression test
Add a test that runs the **same (résumé, posting)** through both the free and
paid entry points and asserts they produce the **same detector risk set**
(domain_gap, adjacency_inflation, etc.). This turns "paid ⊇ free" from a
one-time diagnosis into a standing invariant — if a future arg divergence
reopens the gap, the test catches it. Deferred until the flip; noted here so it
ships with parity, not after.

## Status
Parity is **DECIDED (Option B) — not yet shipped.** Unblocks when §5a + §6 land.
