# Interview Workbooks v1: Build Spec (SIGNAL Coaches Center)

## What we're building
A coach builds an interview prep workbook for a client. The client fills it in inside SIGNAL, sends it to the coach, the coach comments and sends it back. A phone-first "Read This 1 Hour Before" summary is built from the client's answers.

Content for each workbook comes from a JSON content file (see `ryan-hecht_skyhawks-le-coordinator.json`). The app renders any content file. No per-client code.

## Locked decisions
1. Lives in wrnsignal-api (Coaches Center). Deploy protocol as usual: `npx tsc --noEmit`, push to dev, test on staging, then promote. Stop and report before promoting.
2. Workbook optionally links to a `signal_interviews` row. Standalone when there isn't one.
3. No SIGNAL DNA in workbooks.
4. Only full-access coaches can comment, suggest, answer questions, or send back. Annotate-level gets nothing new.
5. Look: the WRN editorial workbook style below. Not the dark coach theme, not the light theme. The coach Workbooks tab can sit inside the existing coach shell, but its content area uses the workbook style.
6. No separate workbooks dashboard. Coach entry point is a **Workbooks tab** on `clients/[clientId]`. Client entry point is the **Coaches Hub**.
7. No email in v1.

## Flow and events
**Client**
- Fills in fields at their own pace. Autosave per field. Use `updated_at` to catch clashing edits. No realtime.
- Can "Ask your coach" on any section or field, plus one general question box.
- One button: **Send to your coach**. Partial is fine. Sends everything filled in so far plus any unsent questions. Can keep editing and send again.

**On Send to your coach:** create one item in the coach's **Required Actions** queue: "Ryan sent his workbook for review (N questions)", linking to the Workbooks tab.

**Coach**
- Sees the full workbook every time (no diff view in v1).
- Can add comments, suggested edits, and answers to client questions on any field or section. These stay **drafts** until sent.
- Optional per-section "Reviewed" marker for the coach's own tracking. Notifies nobody.
- One button: **Send back to [Client first name]**.

**On Send back:** releases all draft comments, suggestions, and answers to the client, and creates one action item in the client's **Coaches Hub**.

**Suggested edits:** client can accept (writes the value into the answer and logs history) or keep their own.

## Data (new migrations, dev first, RLS ON with policies for every new table)
Follow the survey's proposal, with these adjustments:
- `workbooks`: coach_client_id, client_profile_id, optional signal_interview_id, slug, `content` jsonb (the full content file, frozen per workbook; a new content file means a new version), status (`draft`, `with_client`, `with_coach`), timestamps.
- `workbook_answers`: one row per (workbook_id, field_key). value, updated_by, updated_at.
- `workbook_answer_history`: append-only, like the existing `*_status_history` tables.
- `workbook_comments`: workbook_id, anchor (section_id, optional field_key), kind (`coach_comment`, `coach_suggestion`, `client_question`, `coach_answer`), parent_id, body, suggested_value, suggestion_status (`pending`, `accepted`, `kept_own`), author_role, `released_at` (null = draft, not visible to the other side).
- `workbook_sends`: workbook_id, direction (`to_coach`, `to_client`), sent_by, sent_at. Drives the queue items.
- `workbook_section_marks`: coach-only "reviewed" marker per section.
- Hook into the existing Required Actions and Coaches Hub action-item mechanisms rather than building new ones.

## Security
- New routes use `resolveScope` / `verifyCoachAccess`. No new inline access checks.
- New routes use a caller-JWT Supabase client so RLS actually applies. Do not use the service-role client for workbook routes.
- `coach_only` blocks in content must never be sent to the client. Filter server-side.
- Client can only read/write their own workbook. Coach only for clients they have full access to.

## Routes (suggested)
- Coach: `/api/coach/clients/[clientId]/workbooks/*`
- Client: `/api/me/workbooks/*`
- Client pages: `/dashboard/workbooks/[workbookId]` and `/dashboard/workbooks/[workbookId]/summary`
- Coach page: new Workbooks tab on `/dashboard/coach/clients/[clientId]`

## Content file format
See the Ryan file. Block types to render:
`text` (optional `label`, `size: lead`), `heading`, `list` (`bullets` | `numbers` | `quotes`, optional `title`), `callout` (`tone: peach | paleblue`, optional `title`, body may contain `\n\n` paragraphs), `coach_note` (margin on desktop, inline on phone), `big_quote`, `field` (`input: short | long`, `label`, optional `number`, `prefix`, `placeholder`, `style: hook`), `word_track`, `pick` (options plus optional "other" free text), `star` (renders: story I'm using, S, T, A, R, reflection "That experience taught me...", my time; field keys are `<key>.story`, `.s`, `.t`, `.a`, `.r`, `.reflection`, `.time`), `scenario` (renders: stay calm, fix it now, communicate, prevent it next time, has this happened to me before; keys `<key>.calm`, `.fix`, `.communicate`, `.prevent`, `.before`), `coach_only`.
Hook field with `style: hook` shows the live sentence "Oh yeah, Ryan. The guy who ___." filling in as they type.
Summary blocks are defined in `summary` and pull from field keys. Empty answers show a muted placeholder.

## Design (match the files in `design-reference/`)
- Colors: navy `#08203F` headings and body; bright blue `#009BFF` accents, focus states, progress bars; pale blue `#B6F2F8` callout fills; teal `#00B3B3` saved and success states; orange `#FF6B00` section numbers, rules, eyebrow labels, bullets only, never body text; peach `#FFEEDC` coach notes and highlight boxes. Background `#FCFBF8`, borders `#DCE1E8`, muted text `#4A5A70`.
- Fonts via next/font/google: Fraunces (headlines, numbers, big quotes) and Instrument Sans (everything else).
- Square corners. No gradients, no left-border cards, no emoji, no chat bubbles.
- Fill-ins look like writing on a page: underline only, no boxed inputs.
- Desktop: left section nav, main column, right margin column for coach notes and review comments. Phone: single column, coach notes inline, sticky bottom bar with progress and Next.
- Touch targets at least 44px. Real buttons, inputs, and labels.
- Client-facing copy: no em dashes.

## Seed
Seed Ryan's content file on dev against his dev client record so it can be tested end to end.

## Out of scope for v1
Email, the Skill, upload UI for content files, direct push from Claude, diff view, realtime co-editing, DNA.
