# Prep Now: invented detail in drafted answers

Known limitation. Reduced across three commits on 2026-08-06, **not eliminated**,
and the remaining lever is weak. Logged so the next person does not rediscover
the diagnosis or reach for the fix that does not work.

---

## The failure

An answer cites a real evidence id and then elaborates past what that evidence
says. From a live pack on the dev test account:

```
evidence   "- Automated a recurring account reconciliation using pivot tables
            and VLOOKUP, cutting a three-hour manual process to under 30 minutes"

answer     "...used VLOOKUP to match transactions from system A against
            system B. The formula flagged mismatches so we only had to
            investigate the exceptions."
```

Nothing about system A, system B, or exception flagging is in the resume. The
citation is genuine; only the elaboration is invented.

**Why it matters more than an ordinary inaccuracy.** The page renders the
evidence directly beneath the answer, under a heading naming its source. A
student reads a traceable-looking answer, repeats it, and is caught on the first
follow-up: *"which system?"*. The harm is not a wrong sentence on a page, it is
a wrong sentence said out loud in a room.

---

## Diagnosis: the cause was a conflicting instruction, not a weak rule

RULE 1 required every claim to come from the EVIDENCE block. The TASK asked for
**"2 to 4 sentences each"**.

When the evidence is one resume line those two instructions are in direct
conflict, and **length wins**, because a sentence count is by far the easier
instruction to satisfy. The model padded, and padding is where the invention
came from. Every detail it invented existed to reach the count.

This is worth stating plainly because the obvious response, adding more
prohibition, would have left the conflict in place and lost to it again.

---

## What was done

| | |
|---|---|
| **Removed the sentence target** | Length is now a consequence of the evidence: "if the evidence is one line, one or two sentences is a complete answer" |
| **RULE 1a** | Bans systems, tools, thresholds, numbers, names, dates, mechanism the evidence does not contain, with the counter-example verbatim |
| **A test the model applies to itself** | "Before writing a detail, ask whether an interviewer could follow up on it. If they asked *which system?* and the evidence does not answer, you invented it." |
| **Answer cap 2000 → 700 chars** | A bound, not a content judgement. Truncates, never drops |

Measured effect on the same interview, same inputs, temperature 0:

```
v5   answers 292-600 chars   "system A against system B", "flagged mismatches"
v6   answers 253-459 chars   "our accounting system", "our planning spreadsheet"
v7   answers 211-322 chars   none of the above present
```

---

## Why there is no semantic validation, and why there should not be

The check that catches this would have to judge whether an answer's *content*
stays inside its evidence. That is semantic, and it is the trap this repo has
already fallen into once.

Phase 2's `groundingValidator.ts` did exactly that. The runlog measures it at a
**~100% false-reject rate** on realistic output, five times past its own FRD
threshold, rejecting ordinary English: connectives, prepositions, paraphrase
verbs, numeric format variants. It was deferred as **KI-11** and never
redesigned. In production it would have meant nobody got anything.

So Prep Now validates by **set membership on evidence ids**, which cannot
false-reject: an id is either in the input or invented.

**One mechanical check was considered and rejected.** Extract digit sequences
from the answer, require each to appear in the cited evidence or the JD.
Genuinely non-semantic. It breaks immediately on real data: `$18,000` is
rendered as *"18,000 dollar"*, `three-hour` as *"3"*. Normalising well enough to
avoid false rejections is the same slope KI-11 fell down, for partial coverage
of one detail type.

---

## The lever is diminishing

Three prompt revisions moved this from several inventions per pack to none in
the latest sample. **One sample at temperature 0 is not proof of a fix**, and
the mechanism that produced the invention has not been removed, only starved.
A model asked to write prose about a one-line fact will sometimes add texture.

Further prompt tuning is **not** the next move. It has already taken the largest
available step (removing the conflicting instruction) and is now into wording
adjustments with no way to measure a real improvement against a single account.

## What would actually move it

**A framing change at the point of use.** The page presents drafted answers as
finished. If one survives, the student reads it as theirs. Naming them drafts in
the heading itself, with a specific instruction to cut any detail naming a
system, tool or number they did not put in their resume, changes what the
student *does* with a flawed line rather than trying to prevent every one.

Proposed and deliberately **not built** on 2026-08-06: the generation work had
just landed and the honest next step was a real user reading a real pack rather
than another change. The argument for it is that it is the same class of fix as
the evidence-label correction, both being the presentation claiming more
certainty than the artifact has.

**The rule if it is built:** framing changes what a student does with a flawed
line. It never licenses generating one. A specific invention that recurs gets
fixed at generation, not absorbed by a disclaimer.

---

## Related

- `lib/interviewPrep/prompt.ts` — the header explains why there is no sentence target
- `lib/interviewPrep/validate.ts` — drop-not-fail, and why
- `docs/Features/foundation-migration-runlog.md` — KI-11
