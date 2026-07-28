# Network Tracker — Phase 8: Templates

Add to `docs/network-tracker/` as `TEMPLATES.md`. This is the payoff phase: the tracker
already knows who to contact today; templates make it say *what to send*, personalized,
one click to send and log.

Build in sub-phases (8a→8d). Each is testable on its own. Don't build them as one commit.

---

## The model, in one line

24 system-default templates live in code. A client sees their **override** for a template
if one exists, otherwise the **default**. Either coach or client can edit an override.
Brackets stay literal in storage and resolve at render — a template is always a stencil,
never a filled-in copy.

Three things fall out for free: a brand-new client has 24 working templates instantly (no
seeding), "revert to default" is deleting the override row, and improving a default improves
it for every client who never customized it.

---

## 8a — Storage and the 24 defaults

### The defaults live in code, not the database
`lib/network-tracker/template-defaults.ts` — a constant map of `template_id → { label,
body }`, transcribed from the WRN v3 spreadsheet's Message Templates tab. This is the
seed-in-code pattern the client profile does NOT use (that one seeds rows); here there are
no rows until someone edits.

The 24 IDs, by family:
- `IN` — intro request (ask a mutual to connect you)
- `P1 P2 P3` — personal (someone you already know)
- `A1 A2 A3` — affinity (shared school / employer / group)
- `R1 R2 R3` — referred (a mutual introduced you)
- `C1 C2 C3` — cold (no prior connection)
- `X1 X2 X3` — recruiter
- `S1 S2 S3 S4 S5` — stage/shared replies (thank-you, nurture, ask, etc.)
- `L1 L2 L3` — LinkedIn (connection notes, engagement) — **map from the spreadsheet's L
  tab; if the L bodies aren't final, ship 8a with the other 21 and mark L as TODO rather
  than inventing them**

### The override table
`network_templates`, one row only when edited:

```sql
CREATE TABLE public.network_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  template_id       text NOT NULL,          -- 'C2', 'S1', … must match a default key
  body              text NOT NULL,          -- with [BRACKET] variables, stored literal
  edited_by         text NOT NULL CHECK (edited_by IN ('client','coach')),
  edited_by_id      uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_network_templates_client_template
  ON public.network_templates (client_profile_id, template_id);
```

One override per (client, template) — last save wins, `edited_by` records who. RLS mirrors
the other tables; PATCH gates on `assertBoardAccess(..., "full")` since coach-writable, same
exception as the profile (both are outbound copy the coach helps write, not the pipeline).

### Routes
- `GET /api/network/templates` → all 24, each as `{ template_id, label, body, source:
  'default' | 'override', edited_by? }`. Merges defaults with any overrides.
- `PATCH /api/network/templates/[templateId]` → upsert an override. Owner or coach.
- `DELETE /api/network/templates/[templateId]` → delete the override = revert to default.

**8a is done when** GET returns 24 templates for a client with no overrides, and editing one
then GET-ing shows it as `source: 'override'`.

---

## 8b — The merge-variable renderer

A pure function, unit-tested like the reminder engine. This is where silent wrongness lives,
so it gets the same mutation-test treatment.

`renderTemplate(body, profile, contact) → { text, unresolved: string[], toFill: string[] }`

**BUILT: THREE kinds of variable, not two.** This section originally described two; the third
is documented in `template-variables.md` (which says "add to TEMPLATES.md §8b") and is now
implemented. Fill-at-send prompts — `[MUTUAL]`, `[ONE SPECIFIC QUESTION]`, `[OPTION 1..3]`,
`[ARTICLE / NEWS ABOUT THEIR FIRM]` — are prompts to the WRITER, never resolved from data,
and go to `toFill[]` rather than `unresolved[]`. Counting them as errors would make S1
(scheduling) and C2 (cold follow-up) permanently look broken.

The first two kinds:
- **From the client profile** (same in every message): `[CLIENT_FIRST]`, `[SCHOOL]`,
  `[TARGET_ROLE]`, `[TARGET_FIELD]`, `[CITY]`, `[AFFINITY_1..3]`, `[KEY_STRENGTH]`,
  `[ELEVATOR_PITCH]`, `[CALENDAR_LINK]`, `[RESUME_LINK]`, etc. Note `[CURRENT_ROLE]` resolves
  from the `current_role_title` column.
- **From the contact** (different every time): `[NAME]` (first name), `[FIRM]` (company
  name), `[ADDITIONAL_INFO]` (the per-contact opener from import).

Rules:
- An unresolved variable renders as a **visible gap**, never as raw `[BRACKET]` text in a
  message a user might send. Show it as a highlighted placeholder in the preview and collect
  it in `unresolved[]` so the UI can warn.
- Never partially resolve a bracket. `[TARGET_ROLE]` is all-or-nothing.
- Unknown variables (a bracket matching no known key) are surfaced as unresolved, not left in
  or silently dropped — a typo'd `[TARGETROLE]` should be caught, not shipped.

Fill-at-send prompts KEEP their `[PROMPT]` text in `text` — blanking `[ONE SPECIFIC QUESTION]`
to `_____` would destroy the only clue about what belongs there. The UI turns them into
editable inputs and **8d's copy step is what must warn while `toFill` is non-empty**; the
renderer does not gate copying.

**8b is done when** the renderer resolves a known set correctly, lists unresolved ones, and
the mutation tests confirm an unfilled variable never leaks as raw brackets. DONE — four
mutations verified: leaking a raw bracket, treating fill-at-send as ordinary, mapping
`[CURRENT_ROLE]` by naive lower-casing, and dropping an unknown token silently.

---

## 8c — The join (why the taxonomy is worth it)

This is the piece nothing else can do, because only the tracker knows both halves.

`pickTemplate(contact) → template_id | null`

- **Family from `relationship`**: `personal→P`, `affinity→A`, `referred→R`, `cold→C`,
  `recruiter→X`.
- **Number from the touch position**, via `next_due_reason`: `touch_2` → 2, `touch_3` → 3;
  first outreach → 1.
- **Stage replies map to S**: `thank_you → S-family thank-you`, `nurture_recurring →
  nurture`, `ask_followup → ask`, and so on. Define the exact `next_due_reason → S-id` map in
  code alongside `STAGE_PHASE`, one source.
- **Intro requests → `IN`**: a contact at `intro_requested` gets the intro template.
- No relationship set → return null, and the UI says "set a relationship to get a suggested
  template" (which is also the dashboard's "needs attention" nudge — same gap, two surfaces).

**BUILT — the null rule is scoped to FAMILY derivation, not to the S/IN cases.** Relationship
picks the family for a *first message*; once someone has replied, the S templates read
identically whoever they are addressed to. So a contact with no relationship who is due a
thank-you resolves to `S2`, not null — withholding that suggestion over a blank field would be
unhelpful, and the message would be word-for-word the same once the field was filled. `IN` is
relationship-independent for the same reason: asking a mutual for an intro is not a message to
the contact at all. Only the family path (`C2`, `P1`, `X3` …) returns null without a
relationship, because there the family *is* the relationship.

Resolution order is therefore: `intro_requested → IN`, then an S reply, then family + touch
number. The order is load-bearing, and exactly one case distinguishes it — a contact with NO
relationship and an S-reason. With a relationship present both orderings agree, so that is the
case a test has to cover or it proves nothing.

So a cold contact due for touch 2 resolves to `C2`, rendered with the client's profile and
that contact's name already filled in. On the worklist and the contact record, name the
template and show it ready.

**8c is done when** a seeded contact's relationship + due reason resolves to the right
template id, verified across all five families and the S/IN cases. DONE — 40 assertions:
5 families x 3 touch numbers, S2/S3/S4, IN, and the three intended nulls (S1/S5 are
manual-only and never auto-suggested; no relationship on a first message).

---

## 8d — Copy and mark as sent

The button that closes the loop. SIGNAL never sends anything — the user pastes into Gmail or
LinkedIn — so the risk is the gap between composing and logging. One button removes it.

On the contact record (and optionally the worklist row), the primary action:
1. Copies the resolved message to the clipboard.
2. Logs the corresponding action — derived from `next_due_reason`, same as the inline Log
   button. `touch_2` due → logs `touch_2`.
3. This **counts as pipeline activity** — recomputes `next_due_at`, consumes any
   `reminder_override`. Unlike a note, it's a real outreach.
4. Confirms both happened: "Copied, and logged as touch 2."

Secondary action: **copy only**, for when the user wants to edit before sending, or send
later. Copy-only logs nothing.

If the template has unresolved variables, warn before the copy — "This message has an
unfilled [SCHOOL]. Fill your profile or edit before sending" — but don't hard-block; someone
may fill it by hand in Gmail.

**BUILT.** Two behaviours worth recording because they are not obvious from the spec:

- **The copy happens FIRST, and a failed copy logs nothing.** A false "sent" is worse than a
  failed copy: it silently advances the due date and consumes the override, so the contact
  goes quiet in the tracker while the message never left the building. If the clipboard is
  unavailable the panel says so and logs nothing.
- **The primary button only appears when something is DUE.** The action type is derived from
  `next_due_reason` exactly as the inline Log button derives it, so with no due reason there
  is no action to log — inventing one would put a touch on the record the engine never asked
  for. With nothing due, only "copy only" is offered.

**8d is done when** clicking it on a due contact copies the right rendered template AND
advances the pipeline in one action, and copy-only copies without logging. DONE — 7 component
tests, three mutations verified (copy the raw template instead of the rendered text; log
despite a failed copy; make copy-only log).

---

## The editor (folds into 8a/8b, build after the renderer works)

Coach or client edits an override. Three protections against silent breakage, because the
failure mode is subtle — someone editing for one contact types "Hi Dana" over `Hi [NAME]`
and every contact now gets called Dana:

1. **Variable palette** — a clickable list beside the editor, grouped "from your profile" vs
   "from the contact." Click inserts at the cursor. Nobody types a bracket by hand.
2. **Live preview** — the message rendered against the real profile and a sample contact,
   updating as they type. This is the one that catches the hardcoded-name mistake, because it
   shows "Hi Dana" when the sample contact is someone else.
3. **Save warning, not a block** — if an edit dropped a variable the default had: "This no
   longer uses `[NAME]` — every contact gets the same greeting. Save anyway?" Sometimes
   hardcoding is deliberate.

Plus **revert to default** always available (deletes the override row), and a label showing
whether the client is looking at a default or a customized version, and who last edited it.

---

## Build order and cut lines

1. **8a** — storage, defaults, routes. The spine.
2. **8b** — renderer + its tests. Load-bearing correctness.
3. **8c** — the join. Small once 8a/8b exist.
4. **Editor** — palette + live preview + revert.
5. **8d** — copy and mark as sent. The payoff.

If time is short, cut in this order: the editor's save-warning (nice, not essential), then
the worklist's inline copy button (contact-record copy is enough), then the L family if its
bodies aren't final. **Do not cut:** the renderer's unresolved-variable handling, or that
copy-and-mark-as-sent counts as pipeline activity. Those are where silent wrongness lives.

---

## What this is NOT (v1)

- No AI generation of templates — the 24 defaults are written copy. (Reusing the
  `POST /api/networking` pipeline to *generate* per-client variants is a later upgrade; the
  storage shape already supports it.)
- No A/B testing or per-template analytics — the dashboard's reply-rate-by-relationship is
  the closest signal and it's enough for v1.
- No rich text / HTML email — plain text, since it's pasted into whatever the user sends
  from.
- No scheduling or send-on-behalf — SIGNAL hands the user text; the user sends it.
