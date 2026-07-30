# Templates Page — Onboarding & Help

Add to `docs/network-tracker/` as `UX-TEMPLATES-HELP.md`. First slice of the help pass.
The Templates page is the one screen where the *concept* (merge variables, brackets that
auto-fill) is genuinely unfamiliar — a first-timer with no coach and no prior tool will not
understand why a message says `Hi [NAME]`. This makes it self-explaining, in layers, without
forcing anyone through a tutorial.

## Principle

Layered help, lightest first. A confident user reads one line and goes; a lost user expands
"How this works"; a stuck user hits a "?". Nobody is forced, nobody is abandoned. And the
single biggest trap — an empty profile making every preview look broken — is caught before
it confuses anyone.

## Layer 1 — the intro line (always visible)

Under the "Your message templates" heading, replace/augment the current dense explainer with
one warm, plain sentence:

> These are your outreach messages, ready to send. The highlighted bits fill in automatically
> from your profile and each contact — so every message is personal without rewriting it.

Plain, first-person-friendly, and it answers all three of "what is this," "it pulls from my
profile," and "what are the brackets" in one breath. No jargon ("merge variable," "template
variable," "token" never appear).

## Layer 2 — "How this works" callout (dismissible, first-time)

A small callout below the intro, shown by default, with a clear dismiss (×). Once dismissed it
stays dismissed (persist a flag — a `dismissed_templates_help` boolean on the client profile,
or the lightest per-user store already in use). A "How this works" affordance remains available
to re-open it.

Content — three plain steps, no codes:

> **How this works**
> 1. Pick who you're messaging — the buttons up top.
> 2. Your three messages for that kind of person appear, already written.
> 3. Edit any of them to sound like you. Your version is saved and used from then on.
>
> The [highlighted] parts fill in for you: calm ones come from your profile and the contact
> automatically; **amber ones are yours to write** when you send, like a specific question.

That last line is the one concept text can teach better than color alone: calm = automatic,
amber = you. Reinforces what the bracket coloring already shows.

## Layer 3 — "?" popovers (in-context, for the specific confusions)

Small "?" affordances on the two things still non-obvious after layers 1–2:

- Next to the **Insert field** control: "These drop a fill-in blank into your message. Calm ones
  fill themselves; amber ones you write when you send."
- Next to a template's **edit area** (or the "your version is used from then on" line): "Editing
  here changes this message for *every* future contact. To change one message for one person,
  edit it on their contact page instead."

Keep each to one or two plain sentences. Popover, not modal — never leave the page.

## The empty-profile soft gate (the real idiot-proofing)

This matters more than any text. If the profile is empty (or below the "enough to start"
threshold), every bracket resolves to a blank and the previews look broken — and no explanation
saves that. So:

When the client profile is empty or below the send-ready threshold, show a **soft banner** at
the top of the Templates page:

> Your messages pull from your profile — and yours is mostly empty, so the previews below will
> have gaps. Fill in your profile first and these will read like you. **→ Go to your profile**

Rules:
- **Soft, not blocking.** The page stays fully usable; the banner informs, it doesn't gate. Never
  block someone from their own tool.
- Uses the same "enough to start sending" threshold already defined on the profile (first name,
  target role, target field, elevator pitch). Above the threshold, no banner.
- The "→ Go to your profile" link navigates to `/dashboard/network/profile`.
- Warm/attention styling (this is a "needs your attention" state — consistent with the color
  system: warm = attention).

## Consistency note for the rest of the help pass

This page sets the pattern the spreadsheet and dashboard help will follow:
- one plain intro line,
- a dismissible "how this works" for genuinely new concepts,
- "?" popovers for specific confusions,
- and a soft, warm banner for any "you need to do X first" precondition.

Written for someone who has never networked and never seen a mail-merge. No jargon anywhere.

## Build notes

- Persist the help-dismissed flag per user (lightest existing mechanism; a boolean on the
  profile is fine — additive, note if it needs a migration).
- The empty-profile check reuses the profile completeness/threshold logic already built — don't
  duplicate it; import it.
- Presentation + one small persistence flag. No change to templates, routes, or the renderer.
- Component-test: the banner shows below threshold and hides above it, the callout dismisses and
  stays dismissed, and the "?" popovers open and close.
