# Design — LLM Résumé Extractor (§5a + §6 hardening)

Status: DESIGN ONLY. No code. This is the prod-readiness gate for #1–#3 and the
parity flip (PARITY-decision.md).

## The problem it solves
Diagnosis established that the dangerous failure mode is a **résumé-side parse
failure masquerading as "evidence absent" → false-fire on a good candidate**
(non-standard sections, role headers, dates, unlisted verbs/tools/nouns). ~15 of
the fitted assumptions fail that way, and they cluster in the résumé extractor.
Fix: replace the fragile regex résumé parser with an **LLM extraction pass** that
reads messy formats and diverse vocabulary, producing the **same** structured
evidence the deterministic detectors already consume. The detectors, gates,
mismatch logic, and caps stay **100% deterministic** — same split as §6's JD-side
LLM classification.

## Architecture — one seam, two producers
```
résumé text ─► [ LLM extractor ]  ─┐
              (reads messy formats)  ├─► ProfileEvidence + VerbBullet[]  ─► detectors / gates / #2 / #3 (DETERMINISTIC, unchanged)
résumé text ─► [ regex extractor ] ─┘        (the seam)
              (fail-open fallback)
```
`ProfileEvidence` (+ the `VerbBullet[]` the verb/mgmt/scope detectors read) is
the **only** interface. The LLM and the regex extractor are interchangeable
*producers* of it — exactly the `gateCandidates` seam pattern from §6, applied to
the résumé side. Detectors are downstream of the seam and change **nothing**.

**JD-independence (the key caching property):** the extractor reads the résumé
ONLY — it never sees the JD. It tags each role's industry from a controlled
vocabulary and sums years per industry (so `domainYears` holds *all* the
candidate's industries; `domain_gap` looks up the JD's required one downstream).
Tools, recency, mgmt evidence, credentials, and per-bullet verb/object/scope are
all résumé-only facts. So the whole extraction caches on `hash(résuméText)` — one
read per résumé version, reused across every JD that candidate is scanned against.

---

## Q1 — Same-shape seam (drop-in swap, zero detector rework)
**Confirmed.** The LLM extractor emits the identical `ProfileEvidence` interface
(`totalYears`, `domainYears`, `toolsInExperience`/`toolsInSkillsOnly`,
`skillRecency`, `licensesHeld`, `clearancesHeld`, `citizenshipStated`,
`degreeHeld`, `waiverOnFile`, `managerOfManagersYears`) **plus** `VerbBullet[]`
(`leadingVerb`, `verbClass`, `objectPhrase`, `objectHeadNoun`, `scope`) — the two
shapes #1/#2/#3 already consume. A thin deterministic adapter maps the LLM's
structured output onto those exact types (slugify industry tags → `domainYears`
keys; role list → recency indices; etc.).

`extractProfileEvidence`/`extractVerbEvidence` become **dispatchers**: LLM when
enabled + cache-hit/live; **regex on miss/error/disabled**. Both return the same
type. No detector, gate, mismatch, or cap changes — they are behind the seam.
This is why the swap is safe: the LLM changes *how evidence is read*, never *what
shape it is* or *how it's judged*.

---

## Q2 — Determinism (the blocker, already solved once)
**Confirmed — identical mechanism to §6 / the shipped semantic layer.**
- **Résumé-keyed frozen cache.** Key = `hash(résuméText)` (JD-independent, so one
  stable entry per résumé — smaller/cleaner than a per-scan key).
- **`allowLive:false` + frozen fixture in the golden harness** (mirror of
  `frozenSemanticOption()`); prod uses `allowLive:true` + runtime cache.
- **Regex fail-open on cache miss** — a miss / LLM error / no key falls back to
  the deterministic regex extractor, which is itself deterministic. The harness
  never makes a live call and never hard-fails.
- **Freeze script** `freeze-resume-evidence.ts` (clone of the §6/semantic freeze
  scripts) runs the golden résumés once live and commits the fixture; the harness
  replays it → identical `ProfileEvidence` every run → detector assertions stay
  repeatable.
- temp-0 is necessary but **not** sufficient; the frozen cache is the guarantee.

Re-validation note: the golden résumés are clean-format, so frozen LLM evidence
should ≈ the current regex evidence — detectors keep passing. The freeze + a
diff-against-regex on the 8 synthetic résumés is the acceptance check.

---

## Q3 — Over-fire floor: preventing the OPPOSITE failure (hallucinated evidence → false-CLEAR)
The whole point is killing false-fires; the new risk is the LLM **inventing
evidence a candidate doesn't have → false-CLEAR (waving through a faker)**. Three
deterministic guards, all vetoing only the *clear* direction — the résumé-side
analogue of §6's veto-only denylist:

1. **Span-grounding (universal anti-hallucination).** Every extracted fact — each
   tool, each domain-year attribution, each credential, each bullet's verb —
   must cite the **verbatim résumé substring** it came from. A deterministic
   post-check verifies the span is an actual substring of the résumé; **ungrounded
   facts are dropped.** The LLM cannot credit a tool/domain/credential the text
   doesn't literally contain. (A candidate's own *false claim* they wrote down is
   NOT hallucination — it's grounded, and it's the detectors' job to judge, see
   below.)
2. **Contribution-verb denylist (no laundering to ownership).** A curated set of
   contribution verbs (partnered/supported/assisted/contributed/helped/
   collaborated) can **never** be classified `ownership` by the LLM — a
   deterministic override forces them to `contribution`. This stops the LLM from
   laundering a faker's contribution verb into ownership (which would false-CLEAR
   the #2 risk). The denylist can only DOWNGRADE the LLM's class, never upgrade.
3. **Task-noun denylist (no laundering task→function scope).** Known task nouns
   (reporting/dashboard/taxonomy/deck) can never be labeled `function` scope —
   deterministic override to `task`. Stops "Built recurring reporting" from being
   laundered into function-level ownership.

**Why this is sufficient:** the LLM's job is to faithfully extract what the
résumé *claims* (grounded in spans); it does **not** judge *sufficiency*. The
deterministic detectors judge sufficiency — Tyler's stuffed skills still fire
`unsupported_skill_claim` (skills-only locus), Jordan's contribution verbs still
fire the ownership risk (denylist keeps them contribution). So a faker's own
written claims flow through to the judges that already catch them; the LLM only
prevents the *parse-failure* under-credit and cannot manufacture credit. The
false-CLEAR surface is bounded to "the résumé text plausibly supports it," which
is exactly where the deterministic sufficiency detectors operate.

Highest-stakes clears (a required credential reading MET, an ownership
requirement clearing) get the strictest grounding — the citing span must be in
the EXPERIENCE section (not the skills blob), which the tool-locus rule already
enforces.

---

## Q4 — Cost / latency, and the LLM-free paid-loop question
**Yes, this puts an LLM read on the résumé — but in EXTRACTION, not the decision
loop, and cached.** Honest accounting:

- **It caches per résumé, not per scan.** JD-independent extraction → `hash(résumé)`
  key → **one** LLM read per résumé version, reused across every job that
  candidate scans. A coach scanning a client against 30 postings pays one read,
  not 30.
- **Pre-warmable.** The read can fire on résumé upload/update (`/api/resume-upload`,
  persona save), not on the scan path — so the scan itself hits a warm cache.
- **Fails open to regex.** LLM unavailable / errored / no key → deterministic
  regex extractor. The paid path **never hard-depends** on the LLM; availability
  is preserved.
- **The decision loop stays deterministic.** Gates, risk detectors, verb
  mismatch, and the cap are all downstream of the seam and unchanged. Given the
  extracted evidence, the verdict is fully deterministic and reproducible.

**Does it break "no LLM in the paid scoring loop"?** It reframes it: today the
principle is literally "no LLM anywhere on paid scoring." This moves an LLM into
**résumé extraction** (reading), keeping the **decision** deterministic — the same
posture the JD-side LLM classification (§6) already takes for the JD. So the
honest statement becomes **"no LLM in the DECISION loop; a cached LLM read in
extraction."** Given parity (option B) requires #1–#3 ON both paths, and the LLM
extractor is what makes them prod-safe (kills the false-fires), this is the
enabling trade. **Flagging it explicitly as the one principle-level change for
you to accept** — it is not a silent shift.

---

## What the LLM extracts (schema sketch) + what stays deterministic
**LLM produces (JD-independent, span-grounded):**
- `roles[]`: `{title, company, startYear, endYear, industry (controlled vocab),
  bullets[]}` — parses messy date formats, non-bold headers, plain text.
- per bullet: `{text, leadingVerb, verbClass (own/contrib/neutral), objectPhrase,
  objectHeadNoun, scope (function/task), tools[], metrics[], grounding_span}`.
- `skills[]`: `{name, location: experience|skills-only, recency: {roleIndex,
  version?}}`.
- `credentials`: `{degreeHeld, waiverOnFile, clearancesHeld[], citizenshipStated,
  licensesHeld[]}` — reads "Coursework toward", "Secret clearance", "MBA
  candidate", bootcamp phrasings.
- `management`: bullets where the candidate led/hired/grew/ran/oversaw people
  (diverse verbs) → `managerOfManagersYears` + mgmt evidence.

**Deterministic adapter + guards produce the seam types:** slugify industries →
`domainYears`; apply span-grounding veto, contribution-verb denylist, task-noun
denylist; assemble `ProfileEvidence` + `VerbBullet[]`.

**Deterministic (unchanged, behind the seam):** every gate check, the ledger cap,
the verb-mismatch object-scoping + fire logic, all #3 detectors, the score cap,
`applyRiskDowngrades`.

---

## Residual (real-corpus sized)
- **Industry controlled-vocabulary coverage** — the LLM tags role industry from a
  fixed list that JD domain requirements map to; a JD domain outside the vocab
  falls back conservatively. Real-corpus testing sizes how broad the vocab must be.
- **Contribution-verb / task-noun denylist completeness** — they veto the
  clear direction; unlisted ones just aren't vetoed (the LLM's judgment stands),
  which is the *safe* direction (they'd need the LLM to actively mislabel).

## Rollout posture
LLM extractor is opt-in behind the same flag family as #1–#3, OFF until: the
freeze fixture is built and the 8 synthetic + supplied real résumés validate
(false-fire rate → 0 on qualified candidates, no false-CLEAR on the plants).
When green, it becomes the résumé-side producer on BOTH paths — completing the
§5a/§6 hardening that unblocks the parity flip. Regex stays as the permanent
fail-open fallback.
