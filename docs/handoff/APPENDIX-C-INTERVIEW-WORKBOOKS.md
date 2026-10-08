# Appendix C: Interview Workbooks and Practice Rounds (current-state audit)

Audit date: 2026-10-07. Branch inspected: `dev` (working tree at `f67e24a9`). Read-only review of code, migrations, templates, tests and docs in `C:\Users\perig\wrnsignal-api`.

Purpose: a design reference for a future interactive, coach-led Resume Workshop. This appendix describes what exists. It does not design the workshop.

## C.0 Scope, method and caveats

| Item | Note |
|---|---|
| Live database | NOT inspected. Every statement about tables, policies and functions comes from `supabase/migrations/*.sql`. Whether each migration is applied to dev and to prod is UNKNOWN OR NOT VERIFIED. |
| Deployment state | `origin/main` is stale (last commit 2026-08-04) because prod is deployed by Vercel promote from dev previews, so git cannot say what is live. `docs/signal-what-exists-today-2026-09-29.md` (dated 2026-09-29) says Session 1 workbooks were live, and Session 2 plus Practice rounds were staging only. Anything since that date is UNKNOWN OR NOT VERIFIED. |
| Name collision | "Workbook" also means the networking contact upload (an .xlsx "Outreach Messages" workbook) in `lib/network-tracker/*`, `lib/networking-plan/*`, `supabase/migrations/20260926_plan_sources.sql`, `20260923_networking_plan_jobs.sql`. That is a different feature and is out of scope here. |
| AI | No LLM call exists anywhere in `lib/workbook`, `components/workbook`, `lib/practice`, or the workbook and practice API routes (grep for anthropic/openai/claude returned nothing). |

Status labels used throughout: **BUILT AND FUNCTIONING**, **BUILT BUT INCOMPLETE**, **DESIGNED OR DOCUMENTED NOT IMPLEMENTED**, **PLANNED**, **UNKNOWN OR NOT VERIFIED**. "Functioning" here means the code path is complete and covered by tests or smoke scripts in the repo; it does not mean verified against the live database.

## C.1 File map

| Area | Path |
|---|---|
| Build spec | `docs/workbooks/WORKBOOK_V1_SPEC.md` |
| Design references (HTML mockups) | `docs/workbooks/design-reference/client-workbook-desktop.dc.html`, `client-workbook-phone.dc.html`, `coach-review-desktop.dc.html` |
| Per-client interview prep content files (hand-authored) | `docs/workbooks-v1/workbooks-v1/*.json` (9 files) plus `.md`/`.html` drafts; zipped copy `docs/workbooks-v1.zip` |
| Session 2 authoring spec | `docs/workbooks-v1/workbooks-v1/session-2-telling-your-stories.md` |
| Content model, validator, progress, template substitution | `lib/workbook/content.ts` |
| Template registry | `lib/workbook/templates.ts` |
| Session templates (JSON) | `lib/workbook/templates/session-1-foundations.json`, `lib/workbook/templates/session-2-telling-your-stories.json` |
| Shared route helpers | `lib/workbook/server.ts`, `app/api/_lib/workbookError.ts`, `lib/supabase/caller.ts` |
| Client UI | `app/dashboard/workbooks/[workbookId]/page.tsx`, `app/dashboard/workbooks/[workbookId]/summary/page.tsx`, `components/workbook/ClientWorkbook.tsx`, `Blocks.tsx`, `Summary.tsx`, `HomeworkComplete.tsx`, `useAutosave.ts`, `api.ts`, `WorkbookFrame.tsx`, `styles.ts`, `fonts.ts` |
| Coach UI | `app/dashboard/coach/clients/[clientId]/WorkbooksTab.tsx`, `AddWorkbookModal.tsx`, tab registered in `app/dashboard/coach/clients/[clientId]/page.tsx` |
| Client hub entry | `app/dashboard/coaching-hub/page.tsx` (`workbooksFromCoach` provider, `WorkbooksEntry`), `PracticeEntry.tsx` |
| Operator scripts | `scripts/create-workbook.ts`, `scripts/create-practice-round.ts` |
| Practice library code | `lib/practice/model.ts`, `server.ts`, `presets.ts`, `questionBank.ts`, `autoRound.ts`; email `lib/email/sendPracticeRound.ts` |
| Practice UI | `app/dashboard/practice/[roundId]/page.tsx`, `Recorder.tsx`; coach `app/dashboard/coach/practice/page.tsx`, `app/dashboard/coach/practice/[roundId]/page.tsx`, `app/dashboard/coach/clients/[clientId]/PracticeTab.tsx` |
| Task and History glue | `lib/tasks/links.ts` (`workbookLink`, `practiceRoundLink`, `clientLink`), `lib/tasks/service.ts`, `lib/notes/actionItems.ts`, `lib/coach/clientEventTypes.ts` |

### Migrations (in order)

| Migration | What it does |
|---|---|
| `20260921_workbooks_v1.sql` | All six workbook tables, RLS, definer helpers, client read functions, send/resolve/opened functions, `coach_client_notes.link_tab` |
| `20260922_workbooks_action_text.sql` | Rewords the coach Required Actions text to "<Name> sent the workbook for review (N questions)" |
| `20260922_security_coach_clients_signal_interviews.sql` | Locks `coach_clients` to read-only under RLS (a view coach could otherwise PATCH itself to `full`, which workbook policies trust); adds `current_profile_id()` |
| `20260923_coach_delegates.sql` | `wb_is_full_coach` now accepts `coach_acting_ids()` so delegates act at the principal's level |
| `20260923_workbook_homework_complete.sql` | `workbooks.homework_completed_at`, `homework_webhook_at`; `workbook_mark_homework_complete()`, `workbook_record_homework_webhook()` |
| `20260924_workbook_session_number.sql` | Homework function returns `content->'session'` |
| `20260924_workbooks_coach_insert.sql` | `workbooks_coach_insert` policy: coaches create workbooks under RLS (reverses "operator script only") |
| `20260925_workbook_rpcs_return_link.sql` | Send and homework functions return `coach_client_id` and `title` for History logging |
| `20260929_homework_complete_coach_task.sql` | Homework function stops writing a `coach_client_notes` action item; the route raises a `coach_tasks` row instead |
| `20260929_task_links.sql` | `coach_tasks.link`; backfills Go links for homework and practice tasks |
| `20260930_action_item_note_catchup.sql` | Backfills `coach_tasks` for legacy action-item notes, including workbook review notes (link `?tab=workbooks&workbook=<id>`) |
| `20260929_practice_rounds.sql` | `practice_rounds`, `practice_questions`, `practice_takes`, storage bucket `practice-takes` |
| `20260929_practice_feedback.sql` | Feedback columns and the `feedback_sent` status |
| `20260929_practice_presets.sql` | `practice_questions.source` accepts `preset` |

## C.2 Two kinds of workbook content

All workbook content is a single JSON document in one schema (`WorkbookContent`, `lib/workbook/content.ts`). It is frozen onto the row (`workbooks.content`) when the workbook is created. There are two sources.

| Kind | Where the content lives | How it is personalised | How it becomes a workbook | Status |
|---|---|---|---|---|
| Session template (program curriculum, same for every client) | Repo JSON, `lib/workbook/templates/*.json`, registered in `lib/workbook/templates.ts`. Deliberately NOT in the database ("adding a template is a deploy") | Only three placeholders: `{first_name}`, `{full_name}`, `{coach_first_name}`, replaced in every string by `applyTemplate()` | Coach clicks Add workbook (API) or operator runs `scripts/create-workbook.ts` | BUILT AND FUNCTIONING (Session 1). Session 2: BUILT, staging only as of 2026-09-29, prod UNKNOWN |
| Per-client interview prep (one client, one interview) | Hand-authored JSON files outside the app; examples in `docs/workbooks-v1/workbooks-v1/*.json` | Fully bespoke text: the job decoded from the posting, company research, panel names, tailored STAR prompts, word tracks, pick options. Authored before upload, not generated in SIGNAL | Only via `scripts/create-workbook.ts` (service role). No upload UI | BUILT BUT INCOMPLETE (creation is operator-only; generation pipeline is outside the repo) |

Per-client files in the repo (titles and section names from the files):

| File | Title | Sections |
|---|---|---|
| `ryan-hecht_skyhawks-le-coordinator.json` | (none) | The Job, Decoded / What Will They Remember You For? / Tell Me About Yourself / Your Stories / HR Questions / The Hard Questions / Game-Day Scenarios / Know the Skyhawks / Your Questions for Them |
| `aiden-ginsberg_bond-sports-sdr.json` | Bond Sports Interview Prep | Start Here / Your Hook and Tell Me About Yourself / Walk Me Through Your Resume / The Why Questions / Handling Rejection / The Cold Call / Story Bank / More Questions to Prep / The Hard Stuff and Comp / Questions for Andy / Before and After |
| `alex-dupuy_perrigo-day-before.json` | Perrigo Engineering Internship: Day Before Prep | 13 sections incl. The Role Decoded, Why Perrigo?, Story Bank (STAR + E), Know Perrigo (Sourced, Current) |
| `alex-nachman_jpmc-mldp-superday.json` | JPMorganChase MLDP Superday | The Program Decoded / Superday Game Plan / ... / Story Bank (STAR + E) / Marketing Thinking Questions / The Hard Questions / Questions for Them |
| `ethan-blansky_wealthspire.json` | Wealthspire Interview Workbook | 11 sections incl. Market and Product Check, Your Questions for Madison |
| `harry_recruiter-call-lease-coordinator.json` | Recruiter Call Prep: Lease Coordinator | What This Call Is / What Will They Remember You For / Your 60-Second Intro / Two Stories Ready / Questions to Ask / Pay / Close the Call |
| `lukas-goldenberg_regions-ipf-final-round.json`, `lukas-goldenberg_regions-re-banking.json` | Regions Bank rounds | IPF Decoded, Know Your Panel, Technical Refresher, etc. |
| `sasha-haber_jpmc-mldp-hirevue.json` | JPMorganChase MLDP HireVue | Prompt-by-prompt HireVue prep |

How these bespoke files were authored is not in the repo. The spec lists "the Skill" and "direct push from Claude" as out of scope for v1, which implies authoring happens in an external Claude workflow. UNKNOWN OR NOT VERIFIED.

## C.3 Content schema: sections, blocks and field types

Top level (`WorkbookContent`): `schema_version: 1`, `slug`, optional `template`, `template_id`, `session` (required on templates), `title`, `client {first_name, full_name}`, `interview {company, role, date, time, interviewer_name, interviewer_title, location} | null` (null on session workbooks), `coach {first_name}`, `sections[]`, `summary {title, eyebrow, blocks[]}`.

Section: `{ id, number, title, mode?: "in_session" | "homework", blocks[] }`. `_general` is reserved for the general question box.

### Block types (rendered by `components/workbook/Blocks.tsx`)

| Block | Purpose | Owns answer keys | Notes |
|---|---|---|---|
| `text` | Paragraph; optional `label`, `size: lead` | No | |
| `heading` | Sub-heading | No | |
| `list` | `bullets`, `numbers`, `quotes`; optional `title` | No | |
| `callout` | Tinted box, `tone: peach or paleblue`, optional `title` | No | |
| `coach_note` | Client-visible tip; margin on desktop, inline on phone | No | Visible to the client despite the name |
| `big_quote` | Example answer (`text` or `body`) | No | |
| `word_track` | Suggested script line, optional `label` | No | |
| `coach_only` | Coach guide; stripped before the client sees content | No | Stripped in SQL by `wb_strip_coach_only()` and mirrored in TS by `stripCoachOnly()` |
| `field` | Text input, `input: short or long`, `label`, optional `number`, `prefix`, `placeholder`, `style: hook`, `starter`, `optional` | `key` | `style: hook` renders the live sentence "Oh yeah, <name>. The one who ___". `starter` text shows until the client saves and is never stored or counted |
| `pick` | Radio choice with optional "other" free text | `key`, value `{choice, other}` | `__other__` sentinel |
| `select` | Dropdown, grouped options (`{group, items}`), `multi`, or `options_from` glob over the client's own answers | `key`, value string or string[] | Session 2 Section 8 builds its options from `s2.story*.name` |
| `star` | STAR story (interview-prep files) | `<key>.story`, `.s`, `.t`, `.a`, `.r`, `.reflection`, `.time` | Labels: "The story I'm using", Situation, Task, Action, Result, "That experience taught me...", "My time" |
| `scenario` | Situational prompt | `<key>.calm`, `.fix`, `.communicate`, `.prevent`, `.before` | Labels: Stay calm, Fix it now, Communicate, Prevent it next time, Has this happened to me before? |
| `story` | STAR + E story slot (Session 2) | `[.name]`, `.trait`, `.life_area`, `.s`, `.t`, `.a`, `.r`, `.e`, `.reflection`, `[.other_questions]`, `[.seconds]` | `copy_from` pre-fills from another slot as starter text (not stored). Reflection and seconds optional |
| `coverage` | Derived gap analysis, stores nothing | No | `computeCoverage()`: questions with no story, stories used 4+ times, traits and trait groups with no story, life areas missing once one area carries more than half |

### Summary block types (`components/workbook/Summary.tsx`, page `/dashboard/workbooks/[id]/summary`, "Read This 1 Hour Before")

`interview_details`, `hook`, `tmay` (present/past/future/close), `story_map` (list of `star` keys), `story_list` (glob), `coverage`, `quick_answers` (label to field or static text), `questions`, `checklist` (ticks stored as answers under reserved keys `summary.check.<n>`), `signoff`. Empty answers render a muted placeholder.

### Validation

`validateContent()` rejects: wrong `schema_version`, bad slug, missing client/coach first name, unknown block types, duplicate field keys, reserved keys, bad options, coverage without globs, summary references to keys the content does not own, and a template without `template_id` or `session`. `templates.ts` throws at load on an invalid template; `lib/workbook/templates.test.ts` is the CI gate. Server-side answer validation (`validateAnswerValue`, `isWritableKey`) enforces closed option lists and a 20,000 character cap.

## C.4 Session template content (reproduced from the JSON)

### Session 1: Foundations (`session-1-foundations`, `session: 1`)

Picker description: "The WRN Three, your hook, Tell Me About Yourself, and Walk Me Through Your Resume, plus five homework questions." Summary title "{first_name}, here's your Session 1 work.", eyebrow "SESSION 1".

| # | Section id / title | Mode | Teaching content | Client fields (key: label) | Coach guide (coach_only) highlights |
|---|---|---|---|---|---|
| 1 | `welcome` Welcome | in_session | "We'll work through the first five sections together today, and you'll type as we go." Callout "Today you'll leave with": a hook; a TMAY of 60 to 90 seconds; a clear way to walk through the resume | none | TIME 5 min. Program framing: "up to 8 hours together: three teaching sessions, two practice mock interviews, an AI mock, and then prep for your real interviews." HOUSE RULE: "In live sessions, the client always does the typing. You coach." Before the session: share the workbook from the Workbooks tab, have the resume open |
| 2 | `wrn-three` The WRN Three | in_session | Numbered list: RELEVANT, LIKABLE, MEMORABLE. Callout: "Being qualified gets you in the room. These three get you the offer." | `three.remember`: "Think of someone you met once and still remember. What made them stick?" | TIME 7 min. Ties to scorecard dimensions in practice mocks. LISTEN FOR / IF YOU HEAR / MOVE ON WHEN structure |
| 3 | `hook` Your Hook | in_session | "Imagine you're the 7th interview of the day." Examples: identical triplet; family dog rescue; been to Antarctica | `hook.final` (hook style): prefix "Oh yeah, {first_name}. The one who" | TIME 10 min. "DO NOT offer ideas for their hook. It has to come from them" |
| 4 | `tmay` Tell Me About Yourself | in_session | Present, Past, Future. Worked example "Here's how Kaitlyn did it" as three big quotes; callout "What Kaitlyn left out" | `tmay.present` My Present; `tmay.past` My Past; `tmay.future` My Future; word track close; `tmay.time` "My time out loud (seconds)" | TIME 23 min, "the core of the session". Build one part at a time. Over 90 s: cut Past first |
| 5 | `resume` Walk Me Through Your Resume | in_session | Word track "The experience most relevant to this role is ___, so let me start there." Anchor and sub-anchor rules; "Job titles carry little weight. What you did carries a lot." | `resume.anchor`, `resume.anchor_shows`, `resume.sub1`, `resume.sub1_shows`, `resume.sub2`, `resume.sub2_shows`, `resume.sub3` (labelled optional), `resume.sub3_shows`; word track close | TIME 10 min. LISTEN FOR chronological walk-through, same skill in every role, leaning on titles |
| 6 | `homework` Homework: Five Questions | homework | Five headed questions with a client-visible `coach_note` each: strengths; weakness; five years; something interesting not on your resume; three words friends would use | `hw.strength1`, `hw.strength1_proof`, `hw.strength2`, `hw.strength2_proof`, `hw.strength3`, `hw.strength3_proof`, `hw.weakness`, `hw.weakness_shown`, `hw.weakness_action`, `hw.weakness_progress`, `hw.five_years`, `hw.interesting`, `hw.word1..3`, `hw.word1..3_example` | "Reviewing the homework": review in SIGNAL before watching the VideoAsk; per-question LISTEN FOR; "YOUR VIDEO REPLY: One thing that works, one or two to fix. Keep it under 3 minutes." |
| 7 | `finish` Finish Up | homework | Steps: answer all five; click Mark homework complete; watch for an email with your video practice round (five questions, no notes, 60 to 90 s each); coach sends a video reply | `finish.due` "My homework is due by" | Scripted close, step by step |

Summary: `hook`, `tmay`, `quick_answers` (MY RESUME ANCHOR, STRENGTH 1, STRENGTH 2, MY WEAKNESS, FIVE YEARS, SOMETHING INTERESTING, WORD 1 to 3).

Note: Session 1 labels "Sub-anchor 3 (optional)" and "Strength (optional)" in text but does not set `optional: true` on those fields, so they count against progress. BUILT BUT INCOMPLETE (minor).

### Session 2: Telling Your Stories (`session-2-telling-your-stories`, `session: 2`)

Picker description: "STAR + E, two stories built live, then eight stories of their own matched to twenty interview questions." Summary title "{first_name}, here are your stories.", eyebrow "SESSION 2".

| # | Section | Mode | Content | Client fields |
|---|---|---|---|---|
| 1 | `welcome` Welcome | in_session | "By the end of this session you'll have two stories built" | none |
| 2 | `star` STAR + E | in_session | "Know the trait, do not announce it." S, T, A ("Say 'I,' not 'we.' This is the longest part."), R, E: "The relatable moment. Something the interviewer has felt too... This is what makes them nod." Callouts: Bonus Reflection; "The 90-second rule" | `s2.star.notes` (optional) |
| 3 | `sayless` Say Less, Let Them Ask | in_session | Example answer (baseball injury story) | `s2.sayless.left_out`, `.why`, `.e`, `.memorable` |
| 4 | `challenge` Build It Live: A Challenge | in_session | "Pick a real one." | story `s2.q1` (timed) |
| 5 | `priorities` Build It Live: Competing Priorities | in_session | "Try a different part of your life than your first story." | story `s2.q2` (timed) |
| 6 | `great` What Makes a Great Story | in_session | Three rules: know the trait then show it; one story many questions; spread them out | `s2.great.other_questions`, `s2.great.reopen`, multi-select `s2.great.areas` (School, Work, Sports, Clubs and activities, Volunteering, Personal life) |
| 7 | `builder` Homework: Your Story Builder | homework | Aim for 8 stories covering every trait group. Trait taxonomy (below). Tip: check which traits a real job description asks for (Session 3) | story slots `s2.story1` to `s2.story8` (named, other_questions); story1 `copy_from: s2.q1`, story2 `copy_from: s2.q2` |
| 8 | `match` Homework: Match Your Stories | homework | 20 questions, each tagged with a trait | per question `s2.match.qNN.story` (select from own story names) and `s2.match.qNN.lean` "What you would lean on"; `coverage` panel |
| 9 | `finish` Finish Up | homework | Build, match, Mark homework complete; "Your coach will send you a VideoAsk with 3 or 4 of your stories to record." | `s2.finish.due` |

Trait taxonomy (grouped options on every story slot): How you work with people (Teamwork, Conflict resolution, Influence, Leadership); How you handle hard things (Resilience, Composure, Adaptability, Accountability); How you get things done (Time management, Initiative, Drive, Problem solving); How you learn and think (Learning agility, Coachability, Analytical thinking). Life areas: School, Work, Sports, Clubs and activities, Volunteering, Personal life.

The 20 match questions (trait in brackets): q01 faced a challenge [Resilience]; q02 competing priorities or deadlines [Time management]; q03 worked on a team [Teamwork]; q04 conflict with a teammate or coworker [Conflict resolution]; q05 made a mistake [Accountability]; q06 failed [Resilience]; q07 took the lead [Leadership]; q08 had to persuade someone [Influence]; q09 went above and beyond [Initiative]; q10 learn something new quickly [Learning agility]; q11 received critical feedback [Coachability]; q12 dealt with a difficult person [Composure]; q13 solved a problem creatively [Problem solving]; q14 adapt to a change [Adaptability]; q15 used data or research to make a decision [Analytical thinking]; q16 worked with someone very different from you [Teamwork]; q17 set a goal and reached it [Drive]; q18 worked under pressure [Composure]; q19 spotted a problem before anyone else [Initiative]; q20 accomplishment you are proudest of [Drive].

Summary: `story_list` "Your stories", `coverage` "Your coverage", `signoff` "Build them once, and you will use them for every interview you have." from `{coach_first_name}`.

### Session 3

Referenced in the package seed (`tests/package-seed/seed.ts`: plan task "Prepare for Interview Session 3", details "Session 3 workbook") and in the Session 2 tip ("You will do this in Session 3"). No template file exists. **PLANNED.**

## C.5 Data model

| Table | Key columns | Purpose |
|---|---|---|
| `workbooks` | `id`, `coach_client_id` (FK `coach_clients`), `client_profile_id`, `signal_interview_id` (nullable FK `signal_interviews`), `slug` (UNIQUE per client), `content` jsonb (frozen), `status` (`draft`, `with_client`, `with_coach`), `created_by`, `homework_completed_at`, `homework_webhook_at`, timestamps | One workbook instance |
| `workbook_answers` | `workbook_id`, `field_key` (UNIQUE pair), `value` jsonb, `updated_by_role` (`client`/`coach`), `updated_by_id`, `updated_at` (trigger-set with `clock_timestamp()`) | Current answer per field |
| `workbook_answer_history` | `workbook_id`, `field_key`, `old_value`, `new_value`, `changed_by_role`, `changed_by_id`, `source` (`typed`, `accepted_suggestion`), `changed_at` | Append-only, written only by trigger `wb_answers_history()` |
| `workbook_comments` | `section_id` (or `_general`), `field_key`, `kind` (`coach_comment`, `coach_suggestion`, `client_question`, `coach_answer`), `parent_id`, `body`, `suggested_value`, `suggestion_status` (`pending`, `accepted`, `kept_own`), `author_role`, `author_id`, `released_at` (NULL = draft) | All review traffic, threaded, anchored to a section or field |
| `workbook_sends` | `direction` (`to_coach`, `to_client`), `sent_by`, `sent_at`, `item_count`, `coach_note_id` (to_coach), `opened_at` (to_client) | Handoff log; drives coach queue and client hub item |
| `workbook_section_marks` | `workbook_id`, `section_id` (UNIQUE), `marked_by`, `marked_at` | Coach-only "Reviewed" marker |
| `coach_client_notes.link_tab` | added column | Lets the legacy action-item note open the Workbooks tab |

Versioning: there is no version column. Content is frozen per row; a new template version only affects workbooks created afterwards. A repeat of the same template for one client gets slug `-2`, `-3` (route retries up to 20). There is no UPDATE or DELETE policy on `workbooks` and no delete or archive route, so a workbook cannot be removed or edited from the app. BUILT AND FUNCTIONING by design; removal is a gap.

## C.6 Access control

| Actor | Can | Mechanism |
|---|---|---|
| Client | Read own non-draft workbooks (content with `coach_only` stripped), write own answers, write and edit own question drafts, send to coach, accept or keep suggestions, mark opened, mark homework complete | No policy on `workbooks` at all. Reads only through definer functions `workbook_client_list()` and `workbook_for_client()`. Writes through RLS policies keyed on `wb_is_client_of()` (requires status not `draft`) |
| Full-access coach | Read workbooks, answers, history, sends; create workbooks; write comment, suggestion and answer drafts; edit or delete own drafts; mark sections; send to client | `wb_is_full_coach()` (active `coach_clients` row with `access_level = 'full'`), INSERT policy `workbooks_coach_insert` |
| Delegate coach | Same as full coach, at the principal's level; rows carry the delegate's own id | `coach_acting_ids()` inside `wb_is_full_coach()` (`20260923_coach_delegates.sql`) |
| View or annotate coach | Nothing | Spec decision 4; proven in `tests/workbooks/rls-smoke.ts` |
| Coach (any) | Never writes answers | No coach insert or update policy on `workbook_answers` |

Workbook routes are the only routes in the repo that run under the caller's JWT (`getCallerClient`, `lib/supabase/caller.ts`) so RLS is the real guard. Route-level scope uses `resolveActor` / `resolveScope(require: "write")` in `coachWorkbookScope()`. Cross-side effects (release drafts plus create the other side's queue item) are single-transaction SECURITY DEFINER functions. Task creation for the coach after a client action uses the service role in the route (the client JWT cannot write a coach's task). Status: BUILT AND FUNCTIONING (per code and smoke script; live policies UNKNOWN OR NOT VERIFIED).

Coach drafts are visible to every full coach on the client (policy shows `author_role = 'coach'` rows to any coach of the workbook), editable only by their author, and a Send back releases all coaches' drafts together.

## C.7 API routes

| Route | Method | Effect |
|---|---|---|
| `/api/coach/workbook-templates` | GET | Template summaries (id, title, description, section and field counts). Any coach |
| `/api/coach/workbook-templates/[templateId]` | GET | One template with placeholders, for preview |
| `/api/coach/clients/[clientId]/workbooks` | GET | List with last `to_coach` and `to_client` sends |
| `/api/coach/clients/[clientId]/workbooks` | POST | Create from template. Body: `template_id`, `first_name`, `full_name`, `coach_first_name` only (never content). Server substitutes, validates, inserts as `draft`, logs `workbook_created` |
| `/api/coach/clients/[clientId]/workbooks/[workbookId]` | GET | Full content (with coach_only), answers, comments, sends, marks, linked interview |
| `.../[workbookId]/comments` | POST | Coach draft: `coach_comment`, `coach_suggestion` (validated as an answer value), `coach_answer` (must reply to a released client question) |
| `.../[workbookId]/comments/[commentId]` | PATCH, DELETE | Own unreleased drafts only |
| `.../[workbookId]/sections/[sectionId]/mark` | PUT | `{reviewed: boolean}` |
| `.../[workbookId]/send` | POST | `workbook_send_to_client()`: release coach drafts, status `with_client`, complete note, insert send; route closes review task, logs `workbook_shared` (first) or `workbook_returned` |
| `/api/me/workbooks` | GET | `workbook_client_list()` |
| `/api/me/workbooks/[workbookId]` | GET | `workbook_for_client()` plus answers, comments, sends |
| `/api/me/workbooks/[workbookId]/answers/[fieldKey]` | PUT | Autosave with optimistic concurrency |
| `/api/me/workbooks/[workbookId]/questions` | POST | Client question draft (field, section, `_general`, or reply under a released coach item) |
| `/api/me/workbooks/[workbookId]/questions/[commentId]` | PATCH, DELETE | Own unsent questions |
| `/api/me/workbooks/[workbookId]/suggestions/[commentId]` | POST | `{action: accept or keep_own}` via `workbook_resolve_suggestion()` |
| `/api/me/workbooks/[workbookId]/send` | POST | `workbook_send_to_coach()`; route ensures the coach task |
| `/api/me/workbooks/[workbookId]/opened` | POST | `workbook_mark_opened()` stamps `opened_at` (kept out of GET so reads have no side effects) |
| `/api/me/workbooks/[workbookId]/homework-complete` | POST | See C.10 |

## C.8 Lifecycle and loops

| Step | Who | What happens | Status |
|---|---|---|---|
| 1. Create | Coach (Add workbook) or operator script | Row in `draft`. Client cannot see it | BUILT AND FUNCTIONING |
| 2. Share | Coach "Send to <first>" | `workbook_send_to_client()`, status `with_client`, `workbook_sends(to_client)` | BUILT AND FUNCTIONING |
| 3. Client notified | System | Coaching Hub Required Actions provider `workbooksFromCoach` shows "<coach> shared an interview workbook" or "<coach> sent your workbook back" while latest `to_client.opened_at` is NULL. No email | BUILT AND FUNCTIONING |
| 4. Open | Client | Page POSTs `/opened`, stamps `opened_at`, item clears on next load | BUILT AND FUNCTIONING |
| 5. Fill in | Client | Per-field autosave; questions as drafts | BUILT AND FUNCTIONING |
| 6. Send to coach | Client | Partial allowed, repeatable. Releases client drafts, status `with_coach`, creates or refreshes one open `coach_client_notes` action item (body "<Name> sent the workbook for review (N questions)", N = released questions without a released coach answer), records the send; route then calls `ensureSystemNoteTask` so a `coach_tasks` row with a Go link (`?tab=workbooks&workbook=<id>`) reaches the coach dashboard | BUILT AND FUNCTIONING |
| 7. Review | Coach | Drafts comments, suggestions, answers; marks sections | BUILT AND FUNCTIONING |
| 8. Send back | Coach | Releases all coach drafts, status `with_client`, completes note, route closes task via `closeTasksForNotes`; loop returns to step 3 | BUILT AND FUNCTIONING |
| 9. Resolve suggestions | Client | Accept writes the value (history `source = accepted_suggestion`) or keep own | BUILT AND FUNCTIONING |
| 10. Homework complete | Client | One-shot stamp and side effects (C.10) | BUILT AND FUNCTIONING (Session 1); staging-era for practice side effects |

Status does not lock editing: the client can keep typing while `with_coach` and after homework completion (`editable: true` always in `ClientWorkbook.tsx`).

## C.9 Saving, drafts and history

| Mechanism | Detail | Status |
|---|---|---|
| Autosave | `components/workbook/useAutosave.ts`: 700 ms debounce per field, one request in flight per field, queued follow-up, flush on unmount, `beforeunload` warning while saving; checklist ticks save immediately (`setNow`) | BUILT AND FUNCTIONING |
| Clash detection | PUT carries `expected_updated_at`; insert path catches unique violation; update filters on `updated_at`; 409 returns the current value; UI shows both versions and the person chooses (`resolveConflict`). No realtime | BUILT AND FUNCTIONING |
| Starter text | `starter` and `copy_from` show until the client saves; never stored; never counted | BUILT AND FUNCTIONING |
| Drafts vs sent | `workbook_comments.released_at` NULL = draft; RLS hides the other side's drafts; only the send functions set it | BUILT AND FUNCTIONING |
| Answer history | Every insert or changed update writes `workbook_answer_history` by trigger, readable by both sides | BUILT BUT INCOMPLETE: nothing in the UI or API reads it (confirmed by grep; also stated in `docs/signal-what-exists-today-2026-09-29.md`) |
| Content versioning | Frozen per row; none beyond that | BUILT AND FUNCTIONING (no diff, by spec) |

## C.10 Progress, completion and "Mark homework complete"

| Item | Detail | Status |
|---|---|---|
| Progress | `progress()` in `lib/workbook/content.ts`: filled required keys over total required keys, per section done set. Optional keys excluded from both. Computed in the browser, never stored | BUILT AND FUNCTIONING |
| Coach section status | WorkbooksTab shows Reviewed / In progress / Not started per section | BUILT AND FUNCTIONING |
| Section modes | `in_session` vs `homework` tag; the "Mark homework complete" button sits on the last homework section (`lastHomeworkSectionId`) | BUILT AND FUNCTIONING |
| Completion gate | `workbook_mark_homework_complete()` sets `homework_completed_at` only when NULL and returns `fired: true` only to that call | BUILT AND FUNCTIONING |
| Side effects on `fired` (route) | 1) History `homework_complete`. 2) If the session has a preset (`lib/practice/presets.ts`, only Session 1), create and send the preset practice round and email the client. 3) One coach task via `raiseCoachTask` (`createTask`): title "<First> finished Session N homework", description either "Review it. Their practice round was sent automatically." (link to the workbook) or "Review it and build their practice round." (link to Practice tab). 4) Only for sessions without a preset, POST to `GHL_HOMEWORK_WEBHOOK_URL` (`email`, `first_name`, `last_name`, `session`, `event`, `workbook_id`), stamp `homework_webhook_at`, log `homework_webhook_failed` on failure | BUILT AND FUNCTIONING in code; prod wiring UNKNOWN OR NOT VERIFIED |
| Session number | Read from `content.session`; regex on `template_id` as legacy fallback; logs and reports 1 if neither | BUILT AND FUNCTIONING |
| Name source | Task and email use the live `client_profiles.name`, not the frozen `content.client.first_name` (documented bug where a demo workbook said "Ryan") | BUILT AND FUNCTIONING |

## C.11 Coach review and feedback

| Feature | Detail | Status |
|---|---|---|
| Review modes | WorkbooksTab toggles "Review", "See it as <first>" (`stripCoachOnly` on the same content) and "1-hour summary" | BUILT AND FUNCTIONING |
| Field comment | "Comment" per answer | BUILT AND FUNCTIONING |
| Suggested edit | "Suggest an edit" (not offered on `pick` fields); client sees strike-through of current answer and highlighted suggestion with "Use this wording" / "Keep mine" | BUILT AND FUNCTIONING |
| Section comment | "Comment on this whole section" | BUILT AND FUNCTIONING |
| Answering questions | Coach answers threaded under released client questions; client can reply under any released coach item (stored as threaded `client_question`) | BUILT AND FUNCTIONING |
| Private drafts | Banner "N unsent notes. <first> sees nothing you write until you send." | BUILT AND FUNCTIONING |
| Reviewed marker | Private, notifies nobody | BUILT AND FUNCTIONING |
| "NEW" tag | Client marks coach items released in the latest send back as NEW | BUILT AND FUNCTIONING |
| Diff view, realtime co-editing | Out of scope in spec | DESIGNED OR DOCUMENTED NOT IMPLEMENTED (deliberately) |
| Coach in-session typing | Spec house rule is that the client types; coach cannot write answers | BUILT AND FUNCTIONING (by design) |

## C.12 Personalisation and reuse of prior client data

| Data source | Used by workbooks? | Detail |
|---|---|---|
| `client_profiles.name` | Yes, at creation | Coach confirms first and full name in AddWorkbookModal (prefilled, editable); script derives from profile with overrides. Frozen into content |
| Coach name | Yes, at creation | `{coach_first_name}` |
| `signal_interviews` | Optional link only | `workbooks.signal_interview_id`; company, job title, date, time, interviewer names are shown in the list and `interview_details` summary. Only `scripts/create-workbook.ts --interview` sets it; the Add workbook API never does. BUILT BUT INCOMPLETE |
| Resume / profile text | No | Session 1 coach guide tells the coach to have the resume open on screen; nothing is pulled in |
| JobFit runs, job postings, applications | No | Per-client interview files clearly paraphrase postings ("What the posting says"), but that happened outside SIGNAL. The Session 2 tip defers JD-to-trait mapping to Session 3 |
| SIGNAL DNA | Explicitly excluded | Spec decision 3, restated in `docs/signal-dna-site-and-integration-options.md` |
| Earlier workbook answers | Within one workbook only | `copy_from` (q1 to story1) and `options_from` (story names into Section 8). No cross-workbook carry-over (Session 2 does not read Session 1 answers) |
| AI generation | None in SIGNAL | |

## C.13 Practice rounds

Deliberately separate from workbooks (`20260929_practice_rounds.sql`: "They share a client and a coach and nothing else"). Joined only through tasks, the Session 1 preset, and the question bank being read from the Session 2 template.

| Aspect | Detail | Status |
|---|---|---|
| Tables | `practice_rounds` (`coach_client_id`, `client_profile_id`, `coach_profile_id`, `title`, `status` `draft`/`sent`/`submitted`/`feedback_sent`, `sent_at`, `submitted_at`, `fb_overall`, `feedback_sent_at`, `deleted_at`); `practice_questions` (`round_id`, `position`, `text`, `source` `bank`/`custom`/`preset`, `fb_works`, `fb_fix`); `practice_takes` (`question_id`, `storage_path`, `mime`, `duration_ms`) | BUILT |
| Storage | Private bucket `practice-takes`, 100 MB per file, video/webm, video/mp4, video/quicktime, audio/webm, audio/mp4. Browser uploads directly via one-shot signed upload URL; server chooses path `<round>/<question>/<id>`. Playback via 10-minute signed URLs | BUILT |
| Access | Route checks via `resolveActor`/`resolveScope` (full access, delegate aware), then service role for data. RLS is SELECT-only "safety" policies | BUILT BUT INCOMPLETE: the policies compare `client_profile_id`/`coach_profile_id` to `auth.uid()` (a user id, not a profile id), so they match nothing. Acknowledged in `docs/signal-what-exists-today-2026-09-29.md` as a failing backup layer |
| Coach builder | PracticeTab and `/api/coach/clients/[clientId]/practice-rounds`: 1 to 6 questions, 400 chars each, de-duplicated; question bank = the 20 Session 2 match questions parsed from the template (`lib/practice/questionBank.ts`) or custom text. Draft editable, soft delete | BUILT |
| Send | `/api/coach/practice-rounds/[roundId]/send`: status first, then email (`sendPracticeRoundEmail`); resend allowed | BUILT |
| Client recording | `/dashboard/practice/[roundId]`, `Recorder.tsx`: 90 s cap (`ANSWER_SECONDS`), cancel discards, finish saves; re-recording keeps earlier takes, newest wins; submit when every question answered raises "Watch <first>'s practice round" coach task | BUILT |
| Feedback | Per question "what works" (`fb_works`) and "what to fix" (`fb_fix`), plus `fb_overall`; PATCH autosaves draft, POST releases (status `feedback_sent`), emails client, closes the watch task via its link. Client API returns feedback only when `feedback_sent_at` is set | BUILT |
| Session 1 preset | Five fixed questions sent automatically on homework completion: strengths; weakness; five years; "something interesting about you that's not on your resume"; three words | BUILT |
| Sessions 2+ | No preset; coach builds; GHL webhook still fires (external VideoAsk flow) | BUILT (as designed) |
| Hub and lists | Client `PracticeEntry.tsx`; coach cross-client page `/dashboard/coach/practice` grouped by `practiceGroup()` (needs_feedback, waiting, done) | BUILT |
| Video feedback reply from coach | Templates promise "a video reply with feedback"; the app supports written feedback only | DESIGNED OR DOCUMENTED NOT IMPLEMENTED |
| Deployment | "Staging only, proof of concept, not behind a flag" as of 2026-09-29; needs migrations, bucket and two email templates in prod | UNKNOWN OR NOT VERIFIED |

## C.14 History, tasks and Required Actions

| Signal | Writer | Reader |
|---|---|---|
| `coach_client_events` types `workbook_created`, `workbook_shared`, `workbook_sent_for_review`, `workbook_returned`, `homework_complete`, `homework_webhook_failed`, `practice_round_sent`, `practice_round_submitted`, `practice_feedback_sent` (`lib/coach/clientEventTypes.ts`) | Routes via `logCoachClientEvent` | Coach History tab (`HistoryTab.tsx`) |
| `coach_client_notes` action item (`link_tab = 'workbooks'`) | `workbook_send_to_coach()` SQL | Legacy; since 2026-09-26 needs-attention counts `coach_tasks` instead |
| `coach_tasks` (with `link`) | Send route (`ensureSystemNoteTask`), homework route (`raiseCoachTask`), practice submit | Coach dashboard and Tasks; closed on send back (`closeTasksForNotes`) and on feedback release (`closePracticeRoundTask`) |
| Client hub item | Derived from `workbook_sends` (to_client, `opened_at` NULL) | Coaching Hub Required Actions |

Field contents are deliberately not logged as events; they live in `workbook_answer_history`.

## C.15 Tests

| Test | Covers |
|---|---|
| `lib/workbook/content.test.ts` (tsx) | Field-key contract for STAR and scenario, coach_only stripping, reserved checklist keys, validator |
| `lib/workbook/templates.test.ts` (tsx) | Every template validates, no unresolved placeholders |
| `lib/workbook/session2.test.tsx` | Session 2 blocks (story, select, coverage) |
| `app/dashboard/workbooks/workbook.test.tsx` | Renderers on Ryan's file: live hook sentence, coach_only hidden, coach notes, summary placeholders, checklist |
| `app/dashboard/workbooks/template.test.tsx` | Mode tags, coach guide hidden, big_quote `body`, summary with no interview, homework button posts once |
| `app/dashboard/coach/clients/[clientId]/AddWorkbookModal.test.tsx` | Posts three names and a template id, never content; preview defaults to client view |
| `HistoryTab.test.tsx`, `lib/tasks/links.test.tsx`, `tests/tasks/assignment-and-locking.test.ts` | Event and task wiring |
| `lib/practice/practice.test.tsx`, `presets.test.tsx`, `Recorder.test.tsx` | Question cleaning, feedback gate, presets, recorder |
| `tests/workbooks/rls-smoke.ts` | Real-JWT RLS proof on dev (refuses prod), including view/annotate getting nothing |
| `tests/coach-delegate/rls-smoke.ts` | Delegate access including workbooks |
| `tests/workbooks/seed-demo-client.ts`, `scripts/create-workbook.ts`, `scripts/create-practice-round.ts` | Seeding and operator creation |

Not run during this audit.

## C.16 Spec versus implementation

| Spec says (`WORKBOOK_V1_SPEC.md`) | Implementation | Classification |
|---|---|---|
| Creation by operator script (migration comment: "Creation is the operator script") | Coaches create from templates in the UI (`20260924_workbooks_coach_insert.sql`); per-client files still script-only | Superseded, documented in the migration |
| Required Actions item for the coach | Note still written by SQL, but the real surface is now a `coach_tasks` row raised by the route | Implementation moved; SQL note is legacy residue |
| Block list (text through coach_only) | Adds `select`, `story`, `coverage`, `starter`, `optional`, section `mode`, `session`, summary `story_list` and `coverage` | Extended |
| No email in v1 | True for workbooks. Practice rounds do send email | Consistent within workbooks |
| Spec header says content files live in `docs/workbooks-v1/workbooks-v1/`, spec path cited as `docs/workbooks-v1/workbooks-v1/WORKBOOK_V1_SPEC.md` | Spec is at `docs/workbooks/WORKBOOK_V1_SPEC.md` | Stale path |
| Homework migration cites `docs/workbook-templates/` | Directory does not exist; templates are in `lib/workbook/templates/` | Stale path |
| Homework route comment "the note this RPC still writes" | `20260929_homework_complete_coach_task.sql` removed that note | Stale comment |
| Session 1 copy: "Watch for an email with your video practice round", coach guide: "watch the VideoAsk", "send you a video reply" | Session 1 now auto-sends a SIGNAL practice round with written feedback; VideoAsk and video replies are external | Copy contradicts current behaviour |
| Session 2 copy: "Your coach will send you a VideoAsk" | Session 2 has no preset; GHL webhook fires; coach can alternatively build a SIGNAL round | Two parallel paths |
| Coaching Hub label "shared an interview workbook", title fallback "Interview workbook" | Session workbooks have no company, so they display as "Interview workbook" | Minor copy gap |
| "(optional)" in two Session 1 labels | Not flagged `optional: true` | Minor content gap |

## C.17 Known limitations and open gaps

| Gap | Status |
|---|---|
| Answer history captured but never shown or restorable | BUILT BUT INCOMPLETE |
| No upload UI for bespoke content; no in-app authoring or generation | DESIGNED OR DOCUMENTED NOT IMPLEMENTED (out of scope v1) |
| No workbook delete, archive or content edit after creation | BUILT BUT INCOMPLETE |
| `signal_interview_id` cannot be set from the Add workbook flow | BUILT BUT INCOMPLETE |
| No lock on editing during review or after homework complete | By design (not flagged as a defect anywhere) |
| No cross-workbook reuse of answers (Session 2 does not see Session 1) | Not designed |
| Session 3 template | PLANNED |
| Practice RLS compares profile id to `auth.uid()` | BUILT BUT INCOMPLETE (backup layer only) |
| Coach video reply | DESIGNED OR DOCUMENTED NOT IMPLEMENTED |
| Prod deployment of Session 2, practice, task links, homework fix | UNKNOWN OR NOT VERIFIED |

## C.18 Patterns reusable for a Resume Workshop

This lists mechanisms only. It does not propose the workshop's design.

### Reusable as-is or with trivial generalisation

| Mechanism | Where | Why it transfers |
|---|---|---|
| Content-as-data document with a typed block schema, validator and per-block field-key ownership | `lib/workbook/content.ts` (`Block`, `blockFieldKeys`, `validateContent`) | Any guided exercise is sections of teaching blocks plus input blocks; new block types slot into the same switch statements |
| Repo-hosted template registry with CI validation gate and frozen per-instance content | `lib/workbook/templates.ts`, `templates.test.ts`, `workbooks.content` | Same program content for every client, no dev/prod seed drift, safe edits |
| Placeholder substitution with server-side re-application (browser posts names, never content) | `applyTemplate`, `unresolvedPlaceholders`, POST `/workbooks`, `AddWorkbookModal` | Prevents a coach's browser from authoring client-facing content |
| `coach_only` blocks stripped in SQL plus a client with no direct table policy, reading via definer functions | `wb_strip_coach_only`, `workbook_for_client` | Facilitator guide inline with client content, without leakage |
| Per-field answer rows (jsonb value) with trigger-set `updated_at`, optimistic concurrency, 409 with current value and a choose-a-version UI | `workbook_answers`, answers PUT route, `useAutosave.ts` | Works for any form-like artifact edited from several devices, no realtime needed |
| Append-only answer history written by trigger with a `source` tag | `wb_answers_history`, `workbook.answer_source` setting | Free audit trail of edits and accepted suggestions; UI to read it does not exist yet |
| Draft-until-released review comments anchored to section or field, with kinds, threading and suggestion accept/keep | `workbook_comments`, `workbook_resolve_suggestion` | Line-level coach feedback and suggested rewording map directly onto document review |
| Bidirectional send log with `opened_at`, driving both sides' queues, in one definer transaction per handoff | `workbook_sends`, `workbook_send_to_coach`, `workbook_send_to_client`, `workbook_mark_opened` | Generic "your turn" handoff loop |
| Private per-section "Reviewed" marker | `workbook_section_marks` | Coach progress tracking without notifying anyone |
| One-shot completion gate decided by the database, with best-effort side effects that never roll it back | `workbook_mark_homework_complete`, homework-complete route | Exactly-once triggers for tasks, emails, webhooks |
| Task, History and Go-link plumbing | `createTask`/`raiseCoachTask`, `ensureSystemNoteTask`, `closeTasksForNotes`, `lib/tasks/links.ts`, `logCoachClientEvent` | Coach-side surfacing of client actions already standardised |
| Coaching Hub Required Actions provider pattern | `ActionProvider` list in `app/dashboard/coaching-hub/page.tsx` | Add a provider for any new artifact |
| Access helpers: full-access and delegate-aware scope | `wb_is_full_coach`, `coach_acting_ids()`, `coachWorkbookScope`, `resolveScope` | Same permission model, including delegates |
| Progress with optional keys excluded; section modes (`in_session` vs `homework`) | `progress()`, `SectionMode` | Live-session vs async work distinction already exists |
| Starter text and `copy_from` (shown, never stored, never counted) | `field.starter`, `story.copy_from`, `displayValue` | Seeding a client's draft without claiming it as their work |
| Answer-driven options and a derived coverage panel shared by page and summary | `optionsFromAnswers`, `computeCoverage` | Pure functions over answers that can flag gaps |
| Separate summary view built from answer keys with placeholders for blanks | `summary.blocks`, `Summary.tsx` | A distilled output view of the worked document |
| Release-gated written feedback columns (autosave draft, explicit release) and private media with signed URLs | `practice_*` feedback columns, `practice-takes` bucket | If a workshop needs attachments or post-session written feedback |
| RLS smoke script with real JWTs, refusing prod | `tests/workbooks/rls-smoke.ts` | Template for proving a new caller-JWT surface |

### Workbook-specific (not transferable without redesign)

| Mechanism | Why it is specific |
|---|---|
| STAR, STAR + E, scenario and story block part lists, trait taxonomy, life areas, 20-question bank, coverage rules | Interview methodology content baked into code constants and templates |
| `hook` field style and the "Oh yeah, <name>. The one who" live sentence; `tmay` and `story_map` summary blocks | Interview-specific rendering |
| `interview` object and `signal_interview_id` link, `interview_details` summary | Tied to one interview event |
| Session number semantics, presets keyed by session, GHL homework webhook and VideoAsk handoff | Program-specific integration with external tools |
| Practice round recorder, 90-second cap, take model | Spoken-answer rehearsal, not document editing |
| Client cannot be edited by coach (no coach answer writes) | Matches the interview "client types, coach coaches" rule; a workshop may need a different rule |
| Single JSON value per field with a 20,000 character cap and no rich text | Fits short written answers; long structured documents were not a design target |
