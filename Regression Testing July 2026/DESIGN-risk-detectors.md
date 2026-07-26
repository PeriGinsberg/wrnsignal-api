# Design — Risk Under-Detection Detectors (defect #3)

Status: DESIGN ONLY. No engine code. Grounded on 01 Jordan / 03 Marcus / 04 Dana
(fire) and 07 Reyna / 08 Omar / 09 Alex (must stay clean). Same discipline as
#1/#2.

## The defect
The engine finds ~1 of 6 risks the golden set expects on Jordan (01). Build
detectors for the missed ones. Six detectors in scope (per your list):
`domain_gap`, `crm_pipeline_absent`, `revenue_metrics_absent`,
`people_mgmt_absent`, `scope_inversion`, `stale_skill`.
`ownership_via_contribution_verbs` is defect #2 (done). `adjacency_inflation`
(01's 6th miss) and the `seniority_gap` **severity** bump on 03 are adjacent and
NOT in this scope — flagged at the end.

All emit RISK codes through `applyRiskDowngrades` (never gate), same opt-in
posture as #1/#2 (OFF by default; §Prod).

---

## The core over-fire principle (why 09 Alex is the crucial control)
Four of the six are **presence-based, verb-agnostic**: they fire only when a
required domain/tool/metric is **entirely absent** from the résumé — checked via
the #1 `ProfileEvidence` extractor, which reads *presence*, not verb class. This
is what keeps them off **Alex (09)**: Alex has Reyna's B2B-SaaS/dbt/Salesforce/
CAC-LTV evidence (via contribution verbs), so `domain_gap`, `crm_pipeline_absent`,
and `revenue_metrics_absent` all see the evidence **present** → don't fire. Only
#2's verb detector catches Alex. **The presence-based risks and the verb risk are
cleanly orthogonal** — that separation is the whole reason 09 works.

The two *degree*-based detectors (`people_mgmt_absent`, `scope_inversion`) are
the ones that interact with 09 — see the **Case-09 collision** flag below.

---

## 1. `domain_gap` — HIGH
- **Fires:** JD requires a NAMED domain (the `experience`/domain gate, e.g. "3 in
  B2B SaaS") AND `ProfileEvidence.domainYears[domain]` is absent/0.
- **Reuse:** `ProfileEvidence.domainYears` + `gateClassifier` domain gate. This is
  literally "the domain gate is UNMET because the domain is absent" narrated as a
  risk.
- **Ground:** 01 Jordan — JD needs B2B SaaS, `domainYears` has no `b2b_saas` (CPG/
  consumer) → FIRE. 07 Reyna / 09 Alex — have `b2b_saas` → no fire (presence).
- **Guard:** no domain requirement → no fire; domain present → no fire. 08 Omar
  (no B2B-SaaS req) → no fire; 03/04 (same-domain roles) → no fire.
- **Severity HIGH:** a required domain entirely absent is a binary hard gap.

## 2. `crm_pipeline_absent` — HIGH
- **Fires:** JD requires CRM/pipeline tooling (Salesforce/HubSpot pipeline data —
  the `crm_pipeline` tool gate) AND neither tool appears in
  `ProfileEvidence.toolsInExperience` **or** `toolsInSkillsOnly`.
- **Reuse:** `ProfileEvidence` tools + `gateClassifier` crm gate.
- **Ground:** 01 Jordan — Meta/Google/Tableau, no Salesforce/HubSpot → FIRE.
  07/09 — have both → no fire.
- **Guard:** no CRM req → no fire; tool present anywhere → no fire. 08 → no fire.
- **Severity HIGH:** a required tool category entirely absent.

## 3. `revenue_metrics_absent` — HIGH
- **Fires:** the JD's core is reporting revenue metrics to leadership (tokens:
  `CAC · LTV · MRR · ARR · payback · pipeline velocity · churn · retention · NRR`)
  AND **none** of those tokens appear in the résumé.
- **Reuse:** `ProfileEvidence` section text + a new small `REVENUE_METRIC_TOKENS`
  list (the one genuinely new extraction — a token scan, verb-agnostic).
- **Ground:** 01 Jordan — role reports CAC/LTV/payback/pipeline/MRR to the board;
  Jordan's résumé has campaign measurement / MMM / paid-social, none of these →
  FIRE. 07 Reyna / 09 Alex — "CAC, LTV, payback, and pipeline-velocity" present
  (Alex via "Partnered with RevOps on CAC, LTV…" — present, verb-agnostic) → no
  fire.
- **Guard:** no metric-reporting demand in JD → no fire; any metric present → no
  fire. 08 (ML role, no revenue metrics) / 03 / 04 → no fire.
- **Severity HIGH:** the role's core deliverable entirely absent. (Phrased as a
  duty, but the metrics *are* the job — see §Severity.)

## 4. `people_mgmt_absent` — HIGH (03) / MEDIUM (01)
- **Fires:** JD demands managing people (hire / manage / lead a team / manage
  managers) AND the résumé has NO management evidence — i.e. no bullet with an
  ownership/lead verb (`hired · managed · led`) on a people/team object. Support
  verbs on a team ("**Supported** a 12-person team") and "**mentored** one intern"
  are NOT management.
- **Reuse:** `verbEvidence` (leading verb + object) — a management bullet =
  ownership-class verb on a people-noun (`team · analyst · engineers · reports ·
  staff · managers`). No new parser.
- **Ground:** 01 Jordan — duty "hire and mentor one junior analyst"; his team
  bullet is "**Supported** a 12-person team" (support, not managed) → FIRE
  (MEDIUM). 03 Marcus — requirement "5+ years managing managers"; "**Mentored**
  one intern" only → FIRE (HIGH). 07 Reyna — "**Hired** and manage one junior
  analyst" → management present → no fire.
- **Guard:** no management demand → no fire; any management bullet → no fire.
  08 (no mgmt req) → no fire.
- **Severity — the requirement-vs-duty rule:** **HIGH** when the management demand
  is in the **Requirements** section (a hard req: 03 "managing managers"),
  **MEDIUM** when it's only a **duty** in "What you'll do" (01 "hire and mentor
  one junior analyst"). Reuse `extractRequirementsSection` (from #2) to decide.

## 5. `scope_inversion` — MEDIUM
- **Fires:** the JD requires owning/managing a large span (an N-person org,
  managing managers, an 8-figure budget, "build and own the function + a team")
  AND the candidate's **owned** span is far below it — either they never
  led/owned a team (IC/support only), or they cite a large scope (team size /
  budget) they merely **supported/participated in** rather than owned.
- **Reuse:** `verbEvidence` (ownership vs contribution verb on a scope/team/org
  object) + a small scope-token read (`N-person`, `$N portfolio/budget`,
  `org`, `N services`) + `ProfileEvidence` seniority (totalYears / IC-level).
- **Ground:** 01 Jordan — "**Supported** a 12-person team across a $400M
  portfolio" (support verb on a large scope he didn't own) vs role "own + build
  from the ground up, hire a team" → FIRE (inflated-scope-via-association). 03
  Marcus — 2yr IC, "Mentored one intern" (owned span ≈ 0) vs 40-person org /
  manage managers / 8-figure budget → FIRE (small span → big role). 07 Reyna —
  "Hired and manage one junior analyst; **set** the team's roadmap" (owns the
  function + a small team, matching the role's scope) → no fire.
- **Guard:** no large-scope requirement → no fire (08 Omar: own ML models, no
  team/org span → no fire); candidate owns a matching span → no fire.
- **Severity MEDIUM:** a degree/scale mismatch, softer than a binary absence.

## 6. `stale_skill` — MEDIUM
- **Fires:** the JD requires a skill to be RECENT/versioned (the recency gate)
  AND the skill is **present** in the résumé but fails recency — old version
  and/or last used outside the recency window.
- **Reuse:** `ProfileEvidence.skillRecency` + the #1 recency gate — this is "the
  recency gate is UNMET because the present skill is stale (not absent)."
- **Ground:** 04 Dana — JD "recent hands-on Angular (v14+), last two roles";
  `skillRecency.angular = {version 5, lastUsedRoleIndex 1}` — Angular present but
  v2–5 and from 2016–2019 → FIRE. 07/08/09 (no recency req) → no fire.
- **Guard:** fires ONLY when the skill is present-but-stale; skill absent →
  different concern (not this risk); skill recent → no fire.
- **Severity MEDIUM:** present-but-stale is a softer gap than entirely absent.

---

## Severity principle (Q3, cross-cutting)
- **HIGH** = a required capability / domain / tool / core-deliverable is
  **entirely absent** (binary hard gap): `domain_gap`, `crm_pipeline_absent`,
  `revenue_metrics_absent`, and `people_mgmt_absent` *when management is a hard
  requirement*.
- **MEDIUM** = a **degree** mismatch or a **duty-level** demand unmet:
  `scope_inversion` (scale), `stale_skill` (present-but-stale),
  `people_mgmt_absent` *when management is only a duty* (01).
The one variable-severity detector is `people_mgmt_absent`, keyed on
Requirements-section (HIGH) vs "What you'll do" (MEDIUM) — the same
requirement-vs-duty scoping #2 introduced.

## Extractor reuse (Q4 — no third résumé parser)
- `ProfileEvidence` (#1): `domainYears` (domain_gap), tools (crm), `skillRecency`
  (stale_skill), seniority (scope_inversion).
- `verbEvidence` (#2): leading-verb + object per bullet (people_mgmt_absent,
  scope_inversion).
- `gateClassifier` (#1) + `extractRequirementsSection` (#2): JD requirement/gate
  extraction and the requirement-vs-duty split (people_mgmt severity).
- **New, small, additive:** a `REVENUE_METRIC_TOKENS` list (revenue_metrics), a
  people-noun list (people_mgmt), and scope-token reads (scope_inversion). No new
  résumé parse — all ride the existing section split + bullets.

## Prod posture (Q5)
Opt-in, **OFF by default** — same as #1/#2 (`applyRiskDetectorsV3?` or per-flag).
None is prod-ready:
- **Closest to prod-ready:** `domain_gap`, `crm_pipeline_absent`, `stale_skill` —
  they only re-narrate the #1 gate ledger's already-computed MET/UNMET, so they
  inherit #1's fitting (and #1 is itself OFF pending §5a hardening).
- **Most corpus-fitted (hardest):** `revenue_metrics_absent` (token list),
  `people_mgmt_absent` (management-evidence heuristic), and especially
  `scope_inversion` (the "supported-a-big-team-they-didn't-own" pattern is
  genuinely semantic). These are the LLM-path candidates. All OFF until hardened.

---

## Grounding table
Fire = ✓, clean = —.

| Risk | 01 Jordan | 03 Marcus | 04 Dana | 07 Reyna | 08 Omar | 09 Alex |
|---|---|---|---|---|---|---|
| domain_gap | ✓ HIGH | — (same domain) | — | — (has B2B SaaS) | — | — (has B2B SaaS) |
| crm_pipeline_absent | ✓ HIGH | — | — | — (has CRM) | — | — (has CRM) |
| revenue_metrics_absent | ✓ HIGH | — | — | — (has CAC/LTV) | — | — (has CAC/LTV) |
| people_mgmt_absent | ✓ MEDIUM | ✓ HIGH | — | — (Hired+manage) | — (no mgmt req) | **⚠ see collision** |
| scope_inversion | ✓ MEDIUM | ✓ MEDIUM | — | — (owns span) | — | **⚠ see collision** |
| stale_skill | — | — | ✓ MEDIUM | — | — | — |

## ⚠ Case-09 collision — flag, your call (you maintain the cases)
The three **presence-based** risks keep Alex (09) clean — he has the evidence.
But **`people_mgmt_absent` + `scope_inversion` would fire on Alex as his résumé
is currently written**, because I built case 09 (for #2) *without* Reyna's
management/scope bullet — Alex "**Collaborated** with a senior analyst on the
measurement roadmap" (no team ownership). Those two risks firing on him are
**technically correct** (he does lack management/scope evidence) and do **not
break** 09's grading (verdict stays REVIEW; ownership risk still asserted; the two
extra risks are unasserted, and MEDIUM risks don't lower REVIEW further). But they
**muddy 09's intent** as a *single-risk* verb-cap guard.

**Recommended fix (yours):** add Reyna's management bullet to Alex —
"**Hired** and manage one junior analyst; set the team's roadmap." That is
ownership of the **team** object, which clears `people_mgmt_absent` and
`scope_inversion` **without** clearing #2's measurement-function verb mismatch
(that keys on the warehouse/dbt/CAC-LTV objects, not the team). Result: 09 stays
a clean single-risk (ownership-only) verb-cap guard. I did **not** touch the case
file — flagging for your decision.

## Out of scope (adjacent, noted)
- `adjacency_inflation` (01's 6th miss) — a different pattern (a different skill
  credited as equivalent to a named one); its own detector, not in your list.
- `seniority_gap` **severity** on 03 (emits MEDIUM, golden wants HIGH) — a
  severity bump on an existing detector, not a new detector. Flag if you want it
  folded into this ticket.
