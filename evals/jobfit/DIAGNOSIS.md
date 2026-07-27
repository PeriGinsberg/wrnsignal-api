# JobFit Diagnosis Method

You are diagnosing SIGNAL's JobFit scoring engine. For each case you get a résumé,
a job description, and the raw JobFit result. Decide whether the result is CORRECT
or a BUG, and if a bug, which detector and why.

**You have the source code. Use it.** Do not reason only from the payload — read the
detector that fired (or should have fired) and check its actual logic. When the
shipped behavior and this document disagree, the code is the truth and the
disagreement is itself a finding worth logging.

---

## Detectors and intended behavior

**1. Knockout gate ledger (defect #1)** — parses HARD requirements from the JD
("required", "must have", "at least N years", "N+ years", clearance, license,
degree-no-waiver) into gates. Any unmet REQUIRED gate CAPS the verdict below APPLY
(floors score to ~55 or lower). PREFERRED / nice-to-have items are NOT gates and
must not cap.
- Gate kinds: experience (years, domain-years), credential (clearance/license/degree),
  tool (named, hands-on).
- `gate_ledger` shows each gate as MET / UNMET / UNKNOWN. UNKNOWN (résumé silent) is
  treated as not-satisfied for a required gate.

**2. Ownership verb-mismatch (defect #2 — the core IP)** —
`RISK_OWNERSHIP_VERB_MISMATCH` / `ownership_via_contribution_verbs`. Fires when the
JD demands OWNERSHIP of a function ("own the X function", "drive Y", "lead the Z")
but the résumé's evidence FOR THAT FUNCTION is only CONTRIBUTION verbs (partnered,
supported, assisted, contributed, helped, collaborated) rather than OWNERSHIP verbs
(owned, built, led, architected, drove, hired, defined).
- Object-scoped: the verb must sit on the SPECIFIC function the JD demands, not
  anywhere on the résumé.
- Function vs task: "built the reporting FUNCTION across fund strategies" = function
  (a durable capability). "built recurring reporting" = task. A FUNCTION_QUALIFIER
  ("across fund strategies / for institutional portfolios / across business units")
  upgrades an ownership-verb bullet from task to function. Contribution verbs never
  upgrade, even with a qualifier.
- ONE genuine ownership verb on the required function CLEARS the risk.

**3. Risk detectors (defect #3)**
- `domain_gap` — required industry/domain absent. Years/recency-aware; a recent role
  at a company in the required domain counts even at low years. Domain is inferred
  from role+employer+stack, NOT the literal keyword (Teladoc = SaaS even if "SaaS"
  never appears). Finance résumé vs SaaS role SHOULD fire.
- `crm_pipeline_absent`, `revenue_metrics_absent` — presence-based.
- `people_mgmt_absent` — HIGH if a hard requirement, MEDIUM if a duty.
- `scope_inversion` — fires on HEADCOUNT / TEAM-SPAN signals only ("N-person team",
  "team of N", "org of N", "managed N people"). NOT dollar amounts. "$400M portfolio"
  is a domain metric, not span — must NOT fire.
- `unsupported_skill_claim` — tool in SKILLS but never evidenced in EXPERIENCE.
- `preferred_item_missing` — LOW, NON-blocking, must not move the verdict.
- `hard_credential_absent` — required clearance/license/degree absent. Enrollment
  ("Candidate for JD", "currently pursuing") is NOT missing when the role accepts
  in-progress.

---

## Known-good behavior (regression canaries)
- SaaS engineer who never writes "SaaS" → `domain_gap` does NOT fire.
- "JD in progress" → `hard_credential_absent` does NOT fire.
- Finance résumé citing "$17B portfolio" → `scope_inversion` does NOT fire.
- Entry-level JD ("0–2 years, recent grads welcome") → no senior-experience false-fire
  even if the title says "Analyst".
- Genuine ownership verbs on the demanded function → ownership risk clears.

## Known OPEN bugs — count them, don't re-open them
- **`RISK_FAMILY_MISMATCH`** — PRE-EXISTING, outside the defect #1–3 work. Fires ~30%
  of scans; ~55% of its caps are FALSE. Hardcoded 12-family taxonomy, no adjacency
  (finance vs investment reads as mismatched), "Other" catch-all gap. A cap on two
  clearly-adjacent families (finance/investment, marketing/growth, analyst/data) is
  THIS bug — log as known, not new.
- **`RISK_EXPERIENCE` seniority edge cases** — mostly fixed (entry-level override
  shipped). Note it only if it fires on a clearly entry-level role.
- Prod regression baseline is stale; extractor domain-year attribution and
  object-matching are keyword-fitted (safe direction: under-credits rather than
  over-credits) — pending §5a/§6 hardening.

---

## Method

1. Check `resume_source`. `'llm'` = span-grounded extraction, trust the read.
   `'regex'` = failed open to the weaker path, odd reads may be extraction failures
   rather than detector bugs. If the field is absent from the payload, find where the
   engine sets it and report whether it exists at all.
2. For each fired risk: is the evidence genuinely absent, or did the extractor MISREAD
   present evidence as absent? Check the résumé text for the thing the detector claims
   is missing.
3. For the verdict: is a gate CAPPING it, and is that gate a REAL hard requirement in
   the JD (correct) or a preferred item / duty line misread as a gate (bug)?
4. For ownership: find the JD's ownership OBJECT, then find the résumé bullet(s) on
   that object and classify their verbs. The fire is correct only if the
   function-scoped evidence is contribution-only.
5. **Attribute the layer.** Wrong output is not automatically an engine defect. Decide
   which of these owns it: JD requirement extraction / résumé extraction / deterministic
   detector / scoring-penalty math / LLM renderer. The renderer can invert a correct
   engine result — that's a different owner and a different fix.
6. Separate KNOWN open bugs from NEW ones.
7. **Confirm wiring before concluding logic.** If a detector produced nothing on a case
   where it clearly should have fired, grep for its call site before writing it up as a
   logic bug. "Not invoked in this path" and "invoked but reasoned wrong" are different
   defects with different fixes.

---

## Output

Lead with the verdict, then the one-line reason. Detail only on request.

```
VERDICT CHECK: correct / bug
IF BUG: [detector] — [false-fire | false-clear | wrong-verdict]
LAYER: extraction-jd | extraction-resume | detector | scoring | renderer
REASON: one or two lines, grounded in the résumé/JD text and the code you read
KNOWN-BUG? yes (family-mismatch / etc.) / no (new)
FIX DIRECTION: one line (only if new)
CODE REF: file:line for the logic you checked
```

Then append the case to `evals/jobfit/REGISTER.md` per the instructions in that file.
