# JobFit free-path fix — acceptance suite

Frozen acceptance cases for the two candidate fixes to the free-path
over-crediting problem (intent-blind scan crediting generic "analysis /
reporting / strategic analysis / PowerPoint" language as finance/role fit,
with no field-mismatch penalty because `targetFamilies` is forced to `[]`).

A fix is acceptable only if it satisfies **all** the cases below.

- **Ticket 1** — context-aware capability matcher (the `.includes()` fix; unblocks Fix C).
- **Ticket 2** — lightweight free-path JD-family-vs-résumé-evidence check (tag-membership variant).

Validation is run read-only via `extractProfileSignals(résumé,{})` (résumé
function_tags + tag-based family) and `extractJobSignals(jd,{})` (JD family),
with membership = "does the JD family's tag appear in the résumé's tag set?".

## MUST FIRE a penalty / pull down (fix the false-positives)

| Case | JD family | Expected | Status (tag-membership) |
|---|---|---|---|
| **Jordan Reyes × Zurich UA Associate (Large Property)** — REAL, was Apply/80 | **Sales** (`sales_bd`)¹ | **Pass** (or low-Review) | ✗ **FAILS** — JD classifies as Sales; Jordan has `sales_bd` → no penalty → **Apply/80 survives** |
| Catherine Lees × J6 (Financial Analyst) | Finance | Pass / low-Review | ✅ fires (no `finance_corp`) |
| Ava Goldenberg × J6 (Financial Analyst) | Finance | down from Apply | ✅ fires (`accounting_finops` ≠ `finance_corp`) |
| Ava Goldenberg × J4 (IB Analyst) | Finance | down from Apply | ✅ fires (no `finance_corp`) |

¹ EMPIRICAL (2026-06-18): There is **no** insurance/underwriting/risk function_tag.
Contrary to the earlier Finance guess, the Zurich UA JD resolves to **Sales**
(`sales_bd`) — its account-servicing / customer-service / broker-customer-
interaction language outweighs the underwriting/risk terms. Jordan's tags are
`content_social, data_analytics_bi, communications_pr, sales_bd, operations_general`
(no `finance_corp`). Because the JD is Sales and Jordan genuinely has `sales_bd`
(high-volume sportsbook/NIL sales), tag-membership sees a "field match" and does
NOT fire — so the Apply/80 false-positive **survives**. The role is insurance
underwriting, which Jordan has never done; family-level matching cannot tell
"underwriting" from "reactivation sales" because both live under Sales/servicing
language. This is the decisive evidence that **Ticket 2 (tag-membership) is
insufficient** for the real-world case and **Ticket 1 (context-aware matcher) is
the necessary fix** — the Apply/80 came from the matcher over-crediting Jordan's
generic outreach/analytical/Excel language against the underwriting requirements.

## MUST NOT FIRE (protect true fits)

| Case | JD family | Expected | Status (tag-membership) |
|---|---|---|---|
| Nachman × J1 (Marketing & Research) | Sales | no penalty | ✅ has `sales_bd` |
| Lees × J5 (Content Intern) | Marketing | no penalty | ✅ has marketing tags |
| George × J4 (IB Analyst) | Finance | no penalty | ✅ has `finance_corp` |
| Hamorsky × J6 (Financial Analyst) | Finance | no penalty | ✅ has `finance_corp` |
| Rutstein × J9 (Recruiter) | HR (no tag) | no penalty | ✅ ambiguous → no penalty |
| Rutstein × J10 (SDR) | IT_Software² | no penalty | ✗ MISS — fires (JD misclassified) |

² J10 (SDR) is mis-classified as `IT_Software` ("B2B software"), and J12 (Data
Scientist) as `Engineering` — both are upstream JD-classification errors that
tag-membership *inherits* as false-positive penalties. These argue for Ticket 1
(classifier fix) landing first, and for Ticket 2 firing only on high-confidence
JD families.

## Notes
- The Goldenberg edge is the design decider: tag-membership must key strictly
  on the JD family's own tag (Finance ← `finance_corp`) and must NOT treat
  `accounting_finops` as finance-adjacent, or the Ava correction re-breaks.
- Jordan Reyes is the highest-value case here — a confirmed real-world
  false-positive (screenshot), not a constructed one.
