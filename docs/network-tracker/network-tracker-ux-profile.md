# Profile Screen — UX Redesign

Add to `docs/network-tracker/` as `UX-PROFILE.md`. The profile is already built. This is a
presentation restructure — no fields added or removed, no route or data change. The current
screen is honest but flat: 17 fields across five identical navy blocks, done and empty fields
look alike, a lot of scrolling.

## The principle

The profile is a **one-time setup the user rushes through once.** So design for speed and
completion: make progress the point, make "what's left" obvious at a glance, and let the user
stop when it's useful rather than demanding all 17.

## What changes

### 1. Progress-forward header
Move the completeness meter to the top and make it the focal point.
- Large count ("10 of 17 filled"), a warm-filled progress bar (`--fill-brand`).
- A **"Enough to start sending" signal** in success color, shown once the must-have fields are
  filled — so completion doesn't feel all-or-nothing. Must-haves for the threshold: first name,
  target role, target field, and elevator pitch. Below that threshold, show what's still needed
  to cross it ("2 more to start sending").
- Keep the existing helper line ("Templates leave a blank wherever one of these is empty") and
  the "Refresh from profile" action.

### 2. Per-field state — the biggest change
Every field shows its own done/empty state so a rushing user can scan for what's left:
- **Filled**: a success-color check icon by the label, value in normal `--text-primary`.
- **Empty + required**: a warning-color dot by the label, warning-tinted border
  (`--border-warning`), placeholder in muted text.
- **Empty + optional**: label reads "· optional" in muted text, quiet border, no warning.

This is what turns "read every field to find the gaps" into "scan and see the gaps." Keep the
icons — they're the point, not clutter.

### 3. Optional fields labeled optional
Mark the genuinely-skippable ones so a rushing user skips without guilt: grad year, degree,
résumé link, calendar link. Everything else reads as expected-but-not-blocking. (Only the four
must-haves gate the "enough to start" threshold.)

### 4. Elevator pitch pulled up and emphasized
It's the highest-value field for templates — it's what makes a message sound human. Give it an
accent border (`2px solid var(--border-accent)`, the featured-item exception) and a small "most
useful" badge. It does NOT have to move to the literal top, but it must stop looking like every
other field. Keep its helper text ("write it how you'd say it out loud").

### 5. Section-level progress + tighter layout
- Each section header shows its own count ("About you · 4 of 6") so the user feels movement.
- Two-column field grid where fields are short (name, school, role, employer, grad year, degree,
  affinities), full-width only where the content is long (elevator pitch, links).
- Denser rows, less vertical scrolling. The five sections stay (About you · Your target · Your
  affinities · Links · Elevator pitch) but read as quick steps, not five long blocks.

## Color treatment

Color carries state, not decoration:
- **Success (green)** = field done.
- **Warning (amber)** = required field still empty.
- **Accent** = the elevator pitch (the one high-value field) and the progress bar.
- **Quiet/muted** = optional fields, helper text, section chrome.

Sections can carry a subtle differentiating tint or a colored left accent on the header if it
helps separate "who you are" from "what you're reaching for" — but keep it restrained, a hint
not a block of color. Break the all-navy wall without turning it into a rainbow.

## What must NOT change

- The 17 fields, their grouping, seeding, and "from your résumé" labels.
- The two-phase load (fast column reads, résumé fields fill after).
- The auto-fill-on-GET for empty untouched fields, the "N fields filled in" banner, and Refresh.
- Any route or data shape. Presentation only, no migration.

## Build approach

Lighter than the contact record — same fields, reorganized. Still:
1. Propose the component structure briefly (a shared Field component carrying its own filled/
   required/optional state is the natural core) before building.
2. Keep the existing profile tests passing; add coverage for the field-state display (a filled
   field shows the check, an empty required field shows the warning) and the "enough to start"
   threshold crossing.

---

# BUILT

Shipped as one unit. New: `fieldState.ts` (pure — `fieldState`, `sendReadiness`, `groupProgress`,
`OPTIONAL_FIELDS`, `MUST_HAVE`), `Field.tsx`, `ProgressHeader.tsx`. `ProfileForm.tsx` kept every
line of its data logic — two-phase load, blur-save, auto-fill banner, Refresh, the résumé-pending
disable — and had only its render replaced. Tests: 43 tsx-script assertions in
`fieldState.test.ts`, 8 new cases in `ProfileForm.test.tsx`.

**All 8 pre-existing profile tests pass untouched.** That is the check that "presentation only"
actually held, and it is worth more than any of the new assertions.

## Two calls the spec left open

**Amber on the BORDER, never as a fill.** A fresh profile has thirteen required-empty fields.
Tinting all thirteen would read as thirteen errors rather than thirteen invitations — the screen
would look broken on the one open where the user has done nothing wrong. The dot beside the label
plus a warm border carries the same state without the accusation.

**"Enough to start sending" is a different claim from "complete", on purpose.** The threshold
test asserts ready at **10 of 17**. A signal that only fired at 17 would say nothing the existing
meter did not already say, and the whole reason for it is that a user who has done the four
must-haves and stopped is *finished enough* — not "still incomplete", which is what one
all-or-nothing bar tells them. The four are `client_first`, `target_role`, `target_field`,
`elevator_pitch`: [NAME] and [FIRM] come from the contact, so these are what the profile has to
supply before a first message renders without blanks. A mutant making the threshold pass on ANY
must-have rather than all four is killed by both test layers.

## Fixture note

`grad_year` is seeded in the test profile, so it reads **filled**, not optional — asserted
explicitly. A test that checked all four optional fields showed "· optional" would have quietly
failed to notice, since the optional label is for empty fields only.
