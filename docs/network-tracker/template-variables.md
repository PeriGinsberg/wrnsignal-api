# Template Variables — three kinds, not two

Add to `TEMPLATES.md` §8b. The real template bodies use variables that split into three
categories, and the renderer must treat the third differently or every scheduling and
thank-you message shows false "unfilled" errors.

## The full variable set (from the 24 bodies)

### 1. Profile variables — auto-resolve from `network_client_profile`
Same in every message the client sends. Resolve silently.

| Variable | Column |
|---|---|
| `[CURRENT_ROLE]` | `current_role_title` (note the rename — the token stays CURRENT_ROLE) |
| `[CURRENT_EMPLOYER]` | `current_employer` |
| `[TARGET_ROLE]` | `target_role` |
| `[TARGET_FIELD]` | `target_field` |
| `[CITY]` | `city` |
| `[AFFINITY_1]` | `affinity_1` |
| `[KEY_STRENGTH]` | `key_strength` |

(Others exist in the profile — `[SCHOOL]`, `[ELEVATOR_PITCH]`, `[CALENDAR_LINK]`,
`[GRAD_YEAR]`, etc. — and resolve the same way if a template uses them. The seven above are
the ones the current 24 bodies actually reference.)

### 2. Contact variables — auto-resolve from the contact record
Different per contact. Resolve silently.

| Variable | Field |
|---|---|
| `[NAME]` | contact first name |
| `[FIRM]` | company name (blank for a standalone contact) |

`[ADDITIONAL_INFO]` is available too though the current bodies don't use it.

### 3. Fill-at-send variables — NEVER auto-resolve
These are prompts to the writer, not data. There is no stored value and there never will be
— they depend on the specific person, conversation, or moment. The renderer must render them
as **editable highlighted blanks the user completes before copying**, and must NOT count them
as errors.

| Variable | What the writer supplies |
|---|---|
| `[MUTUAL]` | the person making the introduction (IN, R1, R2, R3) |
| `[ONE SPECIFIC QUESTION]` | the one question the client is actually asking (C2) |
| `[OPTION 1]` `[OPTION 2]` `[OPTION 3]` | proposed meeting times (S1) |
| `[SPECIFIC THING THEY SAID]` | a callback to the conversation (S2) |
| `[ONE CONCRETE THING YOU'LL DO BECAUSE OF IT]` | follow-through (S2) |
| `[SPECIFIC THING THEY MENTIONED]` | a callback (S3) |
| `[ARTICLE / NEWS ABOUT THEIR FIRM]` | the thing being shared (S3) |

## How the renderer classifies a variable

A bracket is fill-at-send if it's in the fill-at-send set (define it as a constant), OR — a
good heuristic — if it contains a space or a slash, since every profile/contact variable is a
single UPPER_SNAKE token. `[MUTUAL]` is the one single-token exception, so keep an explicit
list rather than relying on the heuristic alone.

## What this changes in `renderTemplate`

`renderTemplate(body, profile, contact) → { text, unresolved, toFill }`

- **Profile/contact variable, value present** → substitute silently.
- **Profile/contact variable, value missing** → `unresolved[]`. This is the real gap — a
  client with no `[SCHOOL]` set. Warn before copy.
- **Fill-at-send variable** → `toFill[]`, rendered as a highlighted editable blank. NOT an
  error. The copy button is still allowed; the message is meant to be finished by hand.

The distinction matters because S1 (scheduling) has three `[OPTION]` blanks and C2 has
`[ONE SPECIFIC QUESTION]` — if those counted as unresolved errors, the two templates a client
uses most right after a reply would look broken every time.

## `[MUTUAL]` and the referred/intro flow

`[MUTUAL]` appears in IN, R1, R2, R3 — the referral templates. Worth considering (not v1
required): the tracker could know the mutual if the referral was logged, but there's no field
for it today. For v1, treat `[MUTUAL]` as fill-at-send. A later enhancement could add a
`referred_by` field to the contact and auto-resolve it.
