# Appendix D: Methodologies and Decisions

Audit date: 2026-10-07. Branch `dev` at `f67e24a9`. This appendix was written read-only from the repo: code, `supabase/migrations/`, `docs/`, and `docs/WRN_SIGNAL_Package_Seed.xlsx`. It records what the repo says, and it marks contradictions without resolving them.

**Deploy state was not checked.** Whether a capability is live in production was not verified against Vercel or the prod database. Anything this appendix says about prod comes from a doc or a code comment, and the source is cited.

Quotations are verbatim, so the em dashes inside some quoted source text are kept as written. None are used in this appendix's own prose.

## Status labels

| Label | Meaning |
|---|---|
| BUILT AND FUNCTIONING | Code, schema and a caller exist, and nothing in the repo says it is broken. |
| BUILT BUT INCOMPLETE | Code exists, but parts are missing, dormant, flag-gated or known-broken. |
| DESIGNED OR DOCUMENTED NOT IMPLEMENTED | A spec exists and there is no code. |
| PLANNED | Named as future work, with no full spec. |
| UNKNOWN OR NOT VERIFIED | The repo contradicts itself, or the answer depends on prod state not checked here. |

---

## Part 1. Methodology inventory

### 1.0 Summary table

| # | Methodology | Status | Primary sources |
|---|---|---|---|
| 1 | WRN coaching engagement model (phases Know, Build, Prove, Search, Land; deliverables; packages) | BUILT AND FUNCTIONING (library, plan, phases). The seed sheet's triggers, emails and follow-ups are partly built. | `tests/package-seed/seed.ts`, `docs/WRN_SIGNAL_Package_Seed.xlsx`, `lib/plan/*`, `lib/phases/*` |
| 2 | Onboarding: SOW, Let's Go, welcome email, Drive workspace | BUILT AND FUNCTIONING on dev; prod state UNKNOWN OR NOT VERIFIED | `lib/sow/*`, `lib/welcome/*`, `docs/WRN_SOW_Text.md`, `docs/WRN_Welcome_Emails.md` |
| 3 | Prospects pipeline (pre-sale CRM) and Calendly | BUILT AND FUNCTIONING (move back a stage is not built) | `lib/prospects`, `lib/calendly/webhook.ts`, `lib/automation/timers.ts` |
| 4 | Your SIGNAL DNA, the service sold today (Assessment, Report, Decode and Career Path Session) | Delivered outside SIGNAL. In SIGNAL it exists only as deliverables, tasks, emails and labels. | seed, `docs/signal-dna-site-and-integration-options.md` |
| 5 | Professional DNA methodology (the in-product assessment) | DESIGNED OR DOCUMENTED NOT IMPLEMENTED (and explicitly forbidden to implement yet) | `docs/professional-dna/*` |
| 6 | Career Paths (Career Trajectory, CNL R2) | DESIGNED OR DOCUMENTED NOT IMPLEMENTED | `docs/professional-dna/00`, `09` |
| 7 | Job Decoder by SIGNAL | Exists outside this repo. Not in SIGNAL. | `docs/signal-dna-site-and-integration-options.md` |
| 8 | Resume development | Coaching is delivered by people, with plan tasks only. Product support is BUILT BUT INCOMPLETE. | seed, `app/api/resume-upload`, `app/api/personas` |
| 9 | Cover letter | BUILT AND FUNCTIONING (generator) | `app/api/coverletter/route.ts` |
| 10 | LinkedIn Rebuild | Plan tasks only. No product feature. | seed |
| 11 | Positioning (v1, per-job resume tailoring) | BUILT AND FUNCTIONING. v2 was abandoned and deleted. | `app/api/positioning/route.ts`, `docs/positioning-v2-abandoned.md` |
| 12 | JobFit scoring | BUILT AND FUNCTIONING | `app/api/jobfit/*`, `app/api/_lib/jobfitEvaluator.ts` |
| 13 | Job search strategy: search lanes, sourcing, ingest | BUILT BUT INCOMPLETE. Lanes on prod: UNKNOWN OR NOT VERIFIED. | `lib/lane*.ts`, `app/api/lanes`, `lib/ingest`, `lib/hiringcafe.ts` |
| 14 | Networking: campaign brief, task chain, networking plan PDF | BUILT AND FUNCTIONING | `lib/briefs`, `lib/networking-plan/*`, `app/api/network/plan/*` |
| 15 | Network tracker (contact CRM, three-touch rule, templates) | BUILT AND FUNCTIONING | `lib/network-tracker`, `app/dashboard/network`, `docs/network-tracker/*` |
| 16 | Legacy per-job networking generator | BUILT BUT INCOMPLETE (retired from web 2026-08-08, kept for mobile) | `app/api/networking/route.ts` |
| 17 | Interview preparation: workbooks, practice rounds, Prep Now | Workbooks BUILT AND FUNCTIONING. Practice and Session 2 were staging-only per the 2026-09-29 audit. Prep Now built. Covered in depth by another appendix. | `lib/workbook`, `lib/practice`, `lib/interviewPrep` |
| 18 | The Proof Project | Product view BUILT AND FUNCTIONING. Offering is parked and excluded from the seed. | `lib/proofProject.ts`, seed sheet |
| 19 | Career exploration (coherence, targeting taxonomy) | BUILT BUT INCOMPLETE. Coherence is dormant, and targeting has no intake UI. | `lib/coherence`, `lib/candidateTargeting.ts`, `lib/laneTaxonomy.ts` |
| 20 | Package library (deliverables, tasks, packages, seed import) | BUILT AND FUNCTIONING | `coach_milestones`, `coach_packages`, `tests/package-seed/import-packages.ts` |

---

### 1.1 The WRN engagement model and the package seed

**Purpose.** The seed defines WRN's whole coaching offer as data. Five phases contain deliverables, and each deliverable contains ordered tasks, each owned by the coach or the client. Packages bundle deliverables at a price.

**Source.** `docs/WRN_SIGNAL_Package_Seed.xlsx` has three sheets: "Deliverables and Tasks", "Packages" and "Client Emails". `tests/package-seed/seed.ts` is a TS copy of the importable columns only. Its header says "The Proof Project is left out (parked)." `tests/package-seed/import-packages.ts` says it loads "13 deliverables with phase and fee, their 54 tasks, and 8 packages", and was "Approved 2026-10-04".

The sheet's legend: "Pale blue headers = import into SIGNAL now. Peach headers = reference only, for features not built yet (triggers, release, emails, follow-ups). Follow-ups apply to client tasks only. Every coach task has an optional time log."

**Where it lives once imported:**

| Item | Table |
|---|---|
| Library deliverables, with SOW bullets | `coach_milestones` (`sow_bullets`) |
| Library tasks | `coach_milestone_activities` |
| Packages | `coach_packages`, `coach_package_milestones` |
| Phases | `coach_phases` |
| Client copy of a package | `coach_client_engagements`, `coach_client_engagement_deliverables`, `coach_client_engagement_activities` |
| Phase status per client | `client_phase_status` |

**Plan rules as built.** From `lib/plan/service.ts`, "agreed 2026-10-03":

- "approving a package activates the first task of its first deliverable"
- "finishing a task (Done or Skipped) activates the next one in that deliverable by order, skipping Not needed ones"
- "activation never releases a client task: it becomes Active, 'Release: [task]', and the coach releases it by hand"

Task states, from `lib/plan/model.ts`: Upcoming, Active, Waiting on client, Done, Skipped, Not needed.

Phase statuses, from `lib/phases/model.ts`: Not in plan (computed, never stored), Not started, In progress, Complete ("coach click only, allowed with tasks still open"). The default phases are Know, Build, Prove, Search, Land.

**Gap between the sheet's peach columns and the code.** Most cross-deliverable "On done" chains are reference only. Examples: "Package continues into Build: releases Book Resume Workshop. Otherwise: closing email", "Sends AI practice email", "Creates Draft cover letter framework". The built rule only advances within a deliverable.

Some cross-deliverable chains are built:

- the Networking chain (1.11)
- Calendly booking, which closes the Book task and activates Prepare (`lib/calendly/webhook.ts`, migration `20261014_calendly_sessions.sql`)
- the welcome task
- Share plan, which closes the "Share plan with client" task (commit `2b80d730`)

#### 1.1a Deliverables and tasks (sheet "Deliverables and Tasks", reproduced)

Columns abbreviated: Ord = Order, Fup = Follow-up (days). Blank cells are blank in the sheet.

| Phase | Deliverable | Ord | Task | Details / checklist | Type | Owner | Trigger | On done | Milestone | Client email | Send mode | Fup | Calendly type | Land cap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Know | Your SIGNAL DNA Assessment | 1 | Book Your SIGNAL DNA Assessment | | Client | Client | Released by welcome email (starts with Your SIGNAL DNA) | Creates prep task | | #2 Welcome: starts with Your SIGNAL DNA | Preview | 3 | Your SIGNAL DNA Assessment | |
| Know | Your SIGNAL DNA Assessment | 2 | Prepare for Your SIGNAL DNA Assessment | | Coach | Peri | Booking made | Ready for session | | | | | | |
| Know | Your SIGNAL DNA Assessment | 3 | Run Your SIGNAL DNA Assessment | Live on Teams | Coach | Peri | Session held | Creates Prepare Your SIGNAL DNA report | Assessment complete | | | | | |
| Know | Your SIGNAL DNA Report | 1 | Prepare Your SIGNAL DNA report | Review all responses, write report (10 sections, four paths, entry points, comparison table), add Decoder links (write missing pages) | Coach | Peri | Run assessment done | Library link added; releases Book Decode session | Report delivered | #6 Report ready + Decode booking link | Preview | | | |
| Know | Your SIGNAL DNA Decode and Career Path Session | 1 | Book Decode session | | Client | Client | Released by report email | Creates prep task | | (sent by #6) | | 3 | Your SIGNAL DNA Decode and Career Path (60 min) | |
| Know | Your SIGNAL DNA Decode and Career Path Session | 2 | Prepare for Decode session | | Coach | Peri | Booking made | Ready for session | | | | | | |
| Know | Your SIGNAL DNA Decode and Career Path Session | 3 | Run Decode session | Walk through report and path comparison, capture questions and reactions, confirm paths | Coach | Peri | Session held | Package continues into Build: releases Book Resume Workshop. Otherwise: closing email | | #7 Decode recap + Resume Workshop link, or #23 closing email | Preview | | | |
| Build | Resume Workshop | 1 | Book Resume Workshop | Upload instructions are in the welcome email | Client | Client | Released by #7, or by welcome email (starts with Resume Workshop) | Creates prep task | | (sent by trigger) or #3 Welcome: starts with Resume Workshop | Preview | 3 | Resume Workshop | |
| Build | Resume Workshop | 2 | Prepare for Resume Workshop | Review current resume, background, Decode paths | Coach | Peri | Booking made | Ready for session | | | | | | |
| Build | Resume Workshop | 3 | Run Resume Workshop | Define job paths together, confirm paths in writing | Coach | Peri | Session held | Creates Draft resume | Job paths defined | | | | | |
| Build | Resume | 1 | Draft resume | Full rebuild line by line, variations by path, ATS structure check on all versions | Coach | Peri | Workshop done | Library link added; releases Review draft | | #8 Draft resume ready + Finalize booking link | Edit and send | | | |
| Build | Resume | 2 | Review draft and book Finalize session | | Client | Client | Released by #8 | Creates prep task | | (sent by #8) | | 3 | Resume Review/Finalize | |
| Build | Resume | 3 | Prepare for Finalize session | | Coach | Peri | Booking made | Ready for session | | | | | | |
| Build | Resume | 4 | Run Resume Review/Finalize session | | Coach | Peri | Session held | Releases Approve final resume | | #9 Resume sign-off request | Preview | | | |
| Build | Resume | 5 | Approve final resume | Client sign-off in Coaches Hub | Client | Client | Released by #9 | Creates Draft cover letter framework | Resume finalized | | | 3 | | |
| Build | Cover Letter | 1 | Draft cover letter framework | Capture client voice, write custom cover letter, build reusable framework; walkthrough is in the email | Coach | Peri | Resume finalized | Library link added; releases Review cover letter | | #10 Cover letter draft ready | Preview | | | |
| Build | Cover Letter | 2 | Review and edit cover letter | | Client | Client | Released by #10 | Creates Finalize cover letter | | (sent by #10) | | 3 | | |
| Build | Cover Letter | 3 | Finalize cover letter | Back and forth by email, no session | Coach | Peri | Client review done | Releases Approve final cover letter | | #11 Cover letter sign-off request | Preview | | | |
| Build | Cover Letter | 4 | Approve final cover letter | Client sign-off in Coaches Hub | Client | Client | Released by #11 | History | Cover letter finalized | | | 3 | | |
| Build | LinkedIn Rebuild | 1 | Build LinkedIn Rebuild plan | Headline, summary, experience, positioning | Coach | Peri | Coach starts | Library link added; releases Implement LinkedIn changes | | #12 LinkedIn plan ready | Preview | | | |
| Build | LinkedIn Rebuild | 2 | Implement LinkedIn changes | | Client | Client | Released by #12 | Creates Review LinkedIn updates | | (sent by #12) | | 3 | | |
| Build | LinkedIn Rebuild | 3 | Review LinkedIn updates | No client sign-off; coach review is enough | Coach | Peri | Client marks done | Approve: milestone. Changes needed: reopens Implement task (coach writes note personally) | LinkedIn complete | | | | | |
| Search | SIGNAL Setup and Job Search Strategy | 1 | Book Job Search Strategy/Networking session | | Client | Client | Released by coach, or by welcome email (starts with Search) | Creates prep task | | #13 Book your strategy session, or #4 Welcome: starts with Search | Preview | 3 | Job Search Strategy/Networking | |
| Search | SIGNAL Setup and Job Search Strategy | 2 | Prepare for strategy session | Update profile, create personas, enter target roles/locations/goals, seed 1 to 2 jobs (required) | Coach | Peri | Booking made | Ready for session | | | | | | |
| Search | SIGNAL Setup and Job Search Strategy | 3 | Run strategy session | Send SIGNAL invite live, full walkthrough, pursue and ignore rules, prioritization and sequencing, confirm campaign requirements | Coach | Peri | Session held | Creates Complete Client Brief | SIGNAL live | #14 SIGNAL invite | System, sent live | | | |
| Search | Networking Campaign | 1 | Complete Client Brief | Built in SIGNAL | Coach | Peri | Strategy session done | Creates Build networking campaign; emails Erin | | | | | | |
| Search | Networking Campaign | 2 | Build networking campaign | 100 to 300 targeted professionals; workbook saved to client Drive. Built in SIGNAL | Coach | Erin | Client Brief done | Creates Review campaign; emails Peri | | | | | | |
| Search | Networking Campaign | 3 | Review campaign | Approve or request changes with feedback. Built in SIGNAL | Coach | Peri | Build done | Approve: creates Upload. Changes: reopens Build, emails Erin | | | | | | |
| Search | Networking Campaign | 4 | Upload campaign and build plan | Built in SIGNAL | Coach | Peri | Approved | Creates Share plan | | | | | | |
| Search | Networking Campaign | 5 | Share plan with client | Built in SIGNAL | Coach | Peri | Upload done | Library link added; releases Book Review Networking Plan | | #15 Networking plan ready + Review Networking Plan link (add link) | Auto | | | |
| Search | Networking Campaign | 6 | Book Review Networking Plan session | Client sends outreach from their own email | Client | Client | Released by #15 | Creates prep task | | (sent by #15) | | 3 | Review Networking Plan (30 min) | |
| Search | Networking Campaign | 7 | Prepare for review session | | Coach | Peri | Booking made | Ready for session | | | | | | |
| Search | Networking Campaign | 8 | Run Review Networking Plan session | No recap email | Coach | Peri | Session held | History | Campaign launched | | | | | |
| Land | Interview Sessions 1 to 3 | 1 | Book Interview Session 1 | | Client | Client | Released by coach, or by welcome email (starts with Land) | Creates prep task | | #16 Book Interview Session, or #5 Welcome: starts with Land | Preview | 3 | Interview Session 1 | |
| Land | Interview Sessions 1 to 3 | 2 | Prepare for Interview Session 1 | Session 1 workbook | Coach | Peri | Booking made | Ready for session | | | | | | |
| Land | Interview Sessions 1 to 3 | 3 | Run Interview Session 1 | | Coach | Peri | Session held | Releases homework | Interview strategy set | #17 Session recap + homework | Preview | | | Yes |
| Land | Interview Sessions 1 to 3 | 4 | Complete Session 1 homework | | Client | Client | Released by #17 | Sends AI practice email | | #18 AI practice email | Auto | 3 | | |
| Land | Interview Sessions 1 to 3 | 5 | Book Interview Session 2 | | Client | Client | Released by coach | Creates prep task | | #16 Book Interview Session | Preview | 3 | Interview Session 2 | |
| Land | Interview Sessions 1 to 3 | 6 | Prepare for Interview Session 2 | Session 2 workbook | Coach | Peri | Booking made | Ready for session | | | | | | |
| Land | Interview Sessions 1 to 3 | 7 | Run Interview Session 2 | | Coach | Peri | Session held | Releases homework | | #17 Session recap + homework | Preview | | | Yes |
| Land | Interview Sessions 1 to 3 | 8 | Complete Session 2 homework | | Client | Client | Released by #17 | Sends AI practice email | | #18 AI practice email | Auto | 3 | | |
| Land | Interview Sessions 1 to 3 | 9 | Book Interview Session 3 | | Client | Client | Released by coach | Creates prep task | | #16 Book Interview Session | Preview | 3 | Interview Session 3 | |
| Land | Interview Sessions 1 to 3 | 10 | Prepare for Interview Session 3 | Session 3 workbook | Coach | Peri | Booking made | Ready for session | | | | | | |
| Land | Interview Sessions 1 to 3 | 11 | Run Interview Session 3 | | Coach | Peri | Session held | Releases homework | | #17 Session recap + homework | Preview | | | Yes |
| Land | Interview Sessions 1 to 3 | 12 | Complete Session 3 homework | | Client | Client | Released by #17 | Sends AI practice email | | #18 AI practice email | Auto | 3 | | |
| Land | Mock Interview | 1 | Book Mock Interview | | Client | Client | Released by coach | Creates prep task | | #19 Book your mock interview | Preview | 3 | Mock Interview | |
| Land | Mock Interview | 2 | Prepare for mock interview | | Coach | Peri | Booking made | Ready for session | | | | | | |
| Land | Mock Interview | 3 | Run and record mock interview | Save recording | Coach | Peri | Session held | Creates Evaluate mock | | | | | | Yes |
| Land | Mock Interview | 4 | Evaluate mock interview | Scorecard for content and delivery; shared via Library and email | Coach | Peri | Mock done | Library link added | Mock interview evaluated | #20 Scorecard ready | Preview | | | |
| Land | Pre-Interview Prep | 1 | Prepare for pre-interview prep | Repeatable; client books anytime, no release | Coach | Peri | Client books Pre Interview Prep | Ready for session | | | | | Pre Interview Prep | |
| Land | Pre-Interview Prep | 2 | Run pre-interview prep | | Coach | Peri | Session held | History | Interview ready (first time) | | | | | Yes |
| Land | Offboarding | 1 | Book Offboarding session | | Client | Client | Released by coach | Creates prep task | | #21 Book your offboarding | Preview | 3 | Offboarding (30 min) | |
| Land | Offboarding | 2 | Prepare for offboarding | | Coach | Peri | Booking made | Ready for session | | | | | | |
| Land | Offboarding | 3 | Run offboarding | | Coach | Peri | Session held | History | Engagement complete | #22 Closing email, Offboarding packages (keeps 25% off) | Preview | | | |

**Prove phase.** It has one deliverable, "The Proof Project (to define)". It appears only on the Packages sheet, has no tasks, and is "parked, do not import".

#### 1.1b Packages (sheet "Packages", reproduced)

Sheet note: "A package is a group of deliverables. Prices from the current pricing page. Offboarding is included only in All the Way Through and Interview Performance. All the Way Through excludes Prove while it is parked."

| Phase | Deliverable | Your SIGNAL DNA | Know Where to Aim | Run the Search | All the Way Through | Resume Rebuild | Foundations | The Proof Project | Job Search Strategy | Interview Performance |
|---|---|---|---|---|---|---|---|---|---|---|
| | Kind | Bundle and a la carte | Bundle | Bundle | Bundle | A la carte | A la carte | A la carte (parked, do not import) | A la carte | A la carte |
| | Price ($) | 350 | 800 | 1750 | 2500 | 250 | 500 | 1800 | 1200 | 1500 |
| | Welcome email | #2 starts with Your SIGNAL DNA | #2 | #2 | #2 | #3 starts with Resume Workshop | #3 | Later | #4 starts with Search | #5 starts with Land |
| Know | Your SIGNAL DNA Assessment | Yes | Yes | Yes | Yes | | | | | |
| Know | Your SIGNAL DNA Report | Yes | Yes | Yes | Yes | | | | | |
| Know | Your SIGNAL DNA Decode and Career Path Session | Yes | Yes | Yes | Yes | | | | | |
| Build | Resume Workshop | | Yes | Yes | Yes | Yes | Yes | | | |
| Build | Resume | | Yes | Yes | Yes | Yes | Yes | | | |
| Build | Cover Letter | | Yes | Yes | Yes | | Yes | | | |
| Build | LinkedIn Rebuild | | Yes | Yes | Yes | | Yes | | | |
| Prove | The Proof Project (to define) | | | | | | | Yes | | |
| Search | SIGNAL Setup and Job Search Strategy | | | Yes | Yes | | | | Yes | |
| Search | Networking Campaign | | | Yes | Yes | | | | Yes | |
| Land | Interview Sessions 1 to 3 | | | | Yes | | | | | Yes |
| Land | Mock Interview | | | | Yes | | | | | Yes |
| Land | Pre-Interview Prep | | | | Yes | | | | | Yes |
| Land | Offboarding | | | | Yes | | | | | Yes |

The sheet's footer: "Pricing page fixes still pending: 300 to 500 contacts becomes 100 to 300; remove AI interview simulator; rename Professional DNA and Career Paths to Your SIGNAL DNA."

**Count.** The sheet lists 9 packages, of which 8 are imported. With The Proof Project parked, there are 13 importable deliverables.

#### 1.1c Client emails (sheet "Client Emails", reproduced)

Sheet note: "Preview = coach chooses Send, Edit and send, or Don't send. Only Auto and System emails go out without preview."

| # | Email | Phase | Send mode | Status (per sheet) |
|---|---|---|---|---|
| 1 | SOW with Let's Go | Prospect | Preview | To write |
| 2 | Welcome: starts with Your SIGNAL DNA | Onboarding | Preview | Draft exists, revisit |
| 3 | Welcome: starts with Resume Workshop | Onboarding | Preview | To write |
| 4 | Welcome: starts with Search | Onboarding | Preview | To write |
| 5 | Welcome: starts with Land | Onboarding | Preview | To write |
| 6 | Report ready + Decode booking link | Know | Preview | To write |
| 7 | Decode recap + Resume Workshop link (only if package continues into Build; else #23) | Know | Preview | To write |
| 8 | Draft resume ready + Finalize booking link | Build | Edit and send | To write |
| 9 | Resume sign-off request | Build | Preview | To write |
| 10 | Cover letter draft ready (includes framework walkthrough) | Build | Preview | To write |
| 11 | Cover letter sign-off request | Build | Preview | To write |
| 12 | LinkedIn plan ready | Build | Preview | To write |
| 13 | Book your strategy session | Search | Preview | To write |
| 14 | SIGNAL invite | Search | System, sent live | Built, revisit |
| 15 | Networking plan ready + Review Networking Plan link | Search | Auto on share | Built, add link, revisit |
| 16 | Book Interview Session 1 to 3 | Land | Preview | To write |
| 17 | Session recap + homework | Land | Preview | Session 1 exists, revisit; 2 and 3 to write |
| 18 | AI practice email | Land | Auto | Exists, revisit |
| 19 | Book your mock interview | Land | Preview | To write |
| 20 | Scorecard ready | Land | Preview | To write |
| 21 | Book your offboarding | Land | Preview | To write |
| 22 | Closing email, Offboarding packages (keeps 25% off) | Land | Preview | Exists, revisit |
| 23 | Closing email, all other packages (no discount) | Any | Preview | Drafted, revisit |

**The sheet's statuses are now stale.** Since the sheet was written, #1 (SOW send, commit `4ab2d09f`) and #2 to #5 (four welcome templates, commit `b58b4ce0`, `lib/welcome/model.ts`) have been built on dev.

---

### 1.2 Onboarding: SOW, Let's Go, welcome email

**Purpose.** Turn a prospect into a client. The coach sends a Statement of Work built from the package. The client accepts it with "Let's Go". SIGNAL then approves the plan, creates the Drive workspace, and stages the welcome email.

**Status.** BUILT AND FUNCTIONING on dev. Commits: `af05011e`, `10e59213`, `05e02cff`, `672a84d7`, `4ab2d09f`, `4db4a4fe`, `b58b4ce0`, `2ecb78a6`. Prod: UNKNOWN OR NOT VERIFIED.

**SOW content** (`docs/WRN_SOW_Text.md`, "All lines confirmed by Peri"):

- Phase subtitles:
  - "Know: Your SIGNAL DNA and Career Paths"
  - "Build: Foundations"
  - "Search: Job Search Strategy"
  - "Land: Interview Performance"
- Deliverable bullets, for example Networking Campaign: "A curated list of 100 to 300 targeted professionals... A structured three-touch outreach campaign... You send the campaign from your own email account".
- Phase closing notes, for example Know: "This is not a personality test. Nothing is scored or typed... It narrows to four paths. It does not choose the career for you."
- Standard sections: "Included at no charge", "Optional addition" (The Proof Project at $1,800, shown for Know), "How we work", "Not included".
- Each standard line has a show rule: "Every plan", "Only when Land is NOT in the plan", or a phase.

**Workflow, send** (`lib/sow/send.ts`, steps quoted):

1. check the SOW and the email
2. freeze the SOW and make a new private link (only its SHA-256 is stored)
3. withdraw any other package's SOW that is out ("one sent SOW per client")
4. send the email through Postmark
5. if the email fails, restore steps 2 and 3
6. record it: package to Sent, prospect to the SOW sent stage, History, and the `sow.sent` event that starts the 3-day follow-up timer

**Workflow, Let's Go** (`lib/sow/accept.ts`):

1. record the typed name and time (first click only)
2. approve the package
3. move the prospect through SOW Executed to Onboarding
4. create the Drive workspace
5. flag the welcome task "Send welcome email (releases: [task])"
6. create a "Send invoice to [name]" task
7. History, plus an email to the coach
8. emit `sow.accepted`, which cancels the follow-up

**Welcome email** (`lib/welcome/model.ts`). There are four templates, picked by the phase of the first task: "Know is Your SIGNAL DNA, any plan starting in Build is the Resume Workshop, Search is Search, Land is Land". This was "agreed 2026-10-05". The coach can Send or Don't send. Releasing the task shares the Drive workspace (`lib/sow/workspace.ts`; subfolders include "DNA").

**Storage:** `client_sows`, `coach_sow_lines`, `coach_sow_settings`, `coach_milestones.sow_bullets`, `coach_phases.sow_subtitle/sow_note`, `coach_welcome_templates`, `coach_automation_timers`, `coach_clients.workspace_folder_id/_url`.

**Connections:** Prospects pipeline, plan and tasks, Google Drive, Postmark, automation timers.

**Independence:** none. It depends on the package library and the coach-client relationship.

### 1.3 Prospects pipeline and Calendly

**Status.** BUILT AND FUNCTIONING. Per `docs/signal-what-exists-today-2026-09-29.md`, there are 11 default stages: "Lead Identified, Initial Contact, Consult Scheduled, Consult Completed, SOW Drafted, SOW Sent, SOW Executed, Invoice Drafted, Invoice Sent, Invoice Paid, Convert to Client".

Not built: "A prospect cannot be moved back a stage."

Prospect statuses are active, inactive, won and lost. Lost reasons: not_a_fit, price, timing, chose_other, no_response, other.

**Calendly** (`lib/calendly/webhook.ts`): `consult_booked` handles Peri's Initial Consult. `session_booked` maps a Calendly event type to a library deliverable. When a booking matches a plan, the Book task is marked Done and Prepare becomes Active, due the day before. With no match, "a one-off 'Prepare for [session] with [name]'" task is created.

Commit `780bbd5b`: "Workforce Ready Now Working Session is the catch-all, Review Networking Plan books Networking Campaign, WRN Meetings ignored". Tables: `calendly_event_type_actions`, `calendly_webhook_deliveries`, `prospect_consults`, `coach_pipeline_stages`, `prospect_stage_progress`.

### 1.4 Your SIGNAL DNA, the service sold today

**Purpose.** WRN's front-end career-direction offer. The seed and SOW name three deliverables: Assessment, Report, Decode and Career Path Session.

**Status.** Delivered outside SIGNAL. Inside SIGNAL it is only:

- deliverables, tasks and package rows (1.1)
- welcome template `dna`
- Calendly mapping (`scripts/calendly-setup.ts`)
- the Drive "DNA" subfolder
- an optional Library link to the report

There is no DNA table, route or scoring code.

**Workflow and stages:**

- Seed: "Book Your SIGNAL DNA Assessment", then "Prepare for...", then "Run Your SIGNAL DNA Assessment" ("Live on Teams"); then "Prepare Your SIGNAL DNA report" ("Review all responses, write report (10 sections, four paths, entry points, comparison table), add Decoder links (write missing pages)"); then "Book Decode session", "Prepare for Decode session", "Run Decode session" ("Walk through report and path comparison, capture questions and reactions, confirm paths").
- SOW Report bullets: "Four career paths, each with the reasoning for fit, supporting evidence from your own background, the primary tradeoff, and what remains untested"; "Realistic early-career entry points identified for each path"; "Side-by-side comparison of all four paths against your own priority conditions"; "Links from each path into the WRN Decoder library".

**Outside SIGNAL** (`docs/signal-dna-site-and-integration-options.md`, dated 2026-09-30):

- **Assessment.** "Your SIGNAL DNA Live" is a host-paced session of 23 questions: Manager, Ambiguity, Learning, Contribution, People, Risk, Tradeoffs (5 forced), "What makes a job unsustainable", and 3 "Real life" open answers.
  - Answers go to a separate Supabase project.
  - Source exists only as zips, not in git.
  - "No decode conclusions are generated. No scoring is exposed."
- **Report.** Hand-written HTML pages on the `wrn-client-portal` Vercel site, with no login and guessable `/first-last` URLs (16 pages).
  - Sections: "The Biggest Pattern", "01 The Pattern", "02 SIGNAL DNA at a Glance" (Look for / Investigate / Watch for), "03 SIGNAL DNA Map", "04 Where it gets interesting", "05 Job Compass", "06 What Happens Next".
  - A separate generation, "Professional DNA + Career Paths", uses a tabbed shape framed "Not a ranking. Four hypotheses to test."
  - The doc's own words: "Nothing in SIGNAL knows any of this happened."
- **Integration options.** The doc recommends "Option 0 + 5 this week; then Option 3 + 6a + 4". Option 8, the full build, is "Blocked by your own gate."

**Independence:** fully independent of SIGNAL today.

### 1.5 Professional DNA methodology (future in-product assessment)

**Purpose.** From `docs/professional-dna/README.md`: "canonical source of truth for the Professional DNA methodology... what Professional DNA measures, how it is measured, what may and may not influence it, and what a client receives." Initiative: "SIGNAL Career Navigation Loop (CNL), Release 0".

**Status.** DESIGNED OR DOCUMENTED NOT IMPLEMENTED, and implementation is barred: "Nothing in this directory is implementable yet. No SIGNAL application code may be written against any of it until the relevant document reaches `LOCKED` and the `CNL R0 — GO / NO-GO: Professional DNA methodology frozen` gate in SIGNAL PM is approved." The methodology is at v0.8, and v1.0 is required before "The first client artifact may be produced".

**Stages** (`09-context-boundary.md`, quoted):

- **"STAGE 1 — BLIND DNA CALCULATION".** "Entry: assessment starts. Exit: the DNA artifact is frozen."
  - Allowed inputs: assessment answers, adaptive clarifier answers, and direct experiential evidence requested inside the assessment.
  - Excluded: resume, LinkedIn, coach notes, `client_profiles.profile_text`, `candidate_targeting`, personas, `lib/coherence/`.
  - Enforcement is to be "by construction... not by a prompt instruction".
- **"STAGE 2 — DNA INTERPRETATION / VALIDATION".** "Entry: the blind DNA result is frozen. Not before."
  - Allowed purposes: Test, Explain, Identify contradictions, Improve confidence, Distinguish preference from demonstrated capability.
  - Rule: "Stage 2 must NOT retroactively rewrite inconvenient DNA findings simply to match the resume."
- **"STAGE 3 — CAREER NAVIGATION".** "Discover / Contextualize / Recommend".

**Information collected (designed):**

- 44 constructs in six families: "HOW YOU WORK", "WHAT YOU LIKE DOING", "RESPONSIBILITY + PEOPLE", "WHAT MAKES IT WORTH IT", "WHAT YOU PROTECT", "HOW YOU GROW" (doc 01).
- Tradeoff edges (doc 11).
- Needs, strong preferences and flexibility tiers (doc 02, all OPEN).
- Confidence on five dimensions (Coverage, Consistency, Independence, Consequence, Resolution) and four states, C0 "INSUFFICIENT" to C3 "HIGHLY SUPPORTED" (doc 04).
- Adaptive clarifiers (doc 05).
- Target length "~15–20 minutes typical, 25 minutes maximum" (doc 03).

**Storage:** none. The doc 07 schema is "every field is OPEN", and the owner key is `client_profile_id`.

**Outputs (designed):** a frozen immutable artifact (P11); decoded insights DI-01 to DI-06 ("candidate intersections, not personality types"); a growth edge.

**Connections (designed):** Stage 3 consumers are "Career Trajectory CNL R2 · Job Decoder CNL R3 · Path Positioning CNL R4 · Lanes CNL R5 · JobFit career context CNL R6 · Evidence gaps R7 · Resume strategy R8 · Networking / Interview (extended) · Opportunity / offer decisions R9".

The JobFit wall: "`CNL R6 — JobFit score isolation guarantee` — the deterministic qualification score receives no DNA input at all."

**Independence:** Stage 1 is designed to be fully independent.

### 1.6 Career Paths

**Purpose.** P3 (doc 00): "Career paths are hypotheses, not prescriptions. Up to four paths. No forced single lane." The client responds to each path with "PURSUE · TEST · KEEP OPEN · NO". "A career trajectory is not a job-title matching exercise."

**Status.** DESIGNED OR DOCUMENTED NOT IMPLEMENTED as CNL R2. Today paths are hand-written inside the DNA report and confirmed in the Decode session. The seed also has "Run Resume Workshop: Define job paths together, confirm paths in writing".

In code, "Career Paths" is only a label: the SOW phase subtitle and the deliverable name.

### 1.7 Job Decoder by SIGNAL

**Purpose.** "A public, indexed guide to about 35 entry-level roles, generated from the spreadsheet" at `decode.workforcereadynow.com`. DNA reports link clients to it "to read roles against their DNA".

**Status.** Not in this repo, which has zero code references. The source (`build.py`, `Job_Decoder_Table.xlsx`) is outside git. It captures "nothing, apart from a search box that runs in the browser". In the methodology it is CNL R3.

**Naming varies:** "Job Decoder", "WRN Decoder library" (SOW), "Decoder links" (seed).

### 1.8 Resume development

**Coaching method.** From the seed and SOW: Resume Workshop ("Define job paths together, confirm paths in writing"), then Draft resume ("Full rebuild line by line, variations by path, ATS structure check on all versions"), then a Review/Finalize session, then client sign-off "in Coaches Hub". SOW: "This is 1-on-1 coaching, not a templated or AI-generated resume."

**Product support.** BUILT BUT INCOMPLETE.

- `app/api/resume-upload/route.ts` extracts text only: "it stores nothing".
- Resumes live in `client_personas.resume_text` (up to 10 personas). `client_profiles.resume_text` is a "TRANSITIONAL fallback".
- `app/api/profile-intake` builds `profile_text` and `profile_structured`.
- `lib/resume/extractGraduationDate.ts` is the only resume library.

Not built:

- Resume Rx: the `resume_rx_sessions` table exists, but no route.
- Resume Audit (20 ATS and 33 formatting rules): "Fully designed; on hold" per the positioning design reference, with no code.

**Independence:** the coaching runs without SIGNAL, and the product pieces feed JobFit, Positioning and Cover Letter.

### 1.9 Cover letter

**Coaching method.** Seed: "Capture client voice, write custom cover letter, build reusable framework". The finalize step is "Back and forth by email, no session". SOW: "A custom cover letter system written in your own voice, plus a reusable framework".

**Product.** BUILT AND FUNCTIONING. `app/api/coverletter/route.ts` uses OpenAI gpt-4.1-mini with prompt `coverletter_v5_status_verdict_2026_05_29`.

- Inputs:
  - intake header and persona resume
  - the JD
  - JobFit `cover_letter_strategy` (OPEN WITH, ADDRESS GAP, TONE)
  - a Positioning summary
  - a writing sample
  - candidate status (graduated, student or unknown)
- Fixed structure "1) Opener ... 2) Fit proof ... 3) Close", with banned openers.
- Stored in `coverletter_runs`, keyed on `(client_profile_id, fingerprint_hash)` plus `jobfit_run_id`.

**Gap:** `signal_applications.coverletter_run_id` is never written.

### 1.10 Positioning

**Purpose.** "How do I make my resume competitive for this specific job?"

**v1.** BUILT AND FUNCTIONING. `app/api/positioning/route.ts` uses gpt-4.1-mini with prompt `positioning_v2_2026_05_27_jobfit_reframe`. The "v2" here is a prompt label only.

- Output sections: `student_intro`, `role_angle`, `arrange_resume {lead_with, support_with, then_include, de_emphasize}`, `summary_statement`, `resume_bullet_edits` (0 to 6), `keyword_analysis`.
- Mode switches from "keyword_injection" to "jobfit_reframe" when JobFit context is present.
- Storage: `positioning_runs` (with `jobfit_run_id`).

**v2.** Abandoned and deleted. It was a case-based flow: "Case A: Well-positioned", "Case B: Targeted changes needed", "Case C: Significant repositioning", over five phases from "Phase 1: Setup and Inheritance" to "Phase 5: Output - The Change List".

What survives:

- `positioning_runs_v2`, an empty table still read by three routes: coach client-runs, positioning feedback, networking.
- The "Foundation" pieces, which are still live: `lib/laneTaxonomy.ts` (12 lanes), `candidate_targeting`, and `deriveCareerStage` (student, early_career, mid_career, executive).

**Independence:** standalone; JobFit is optional.

### 1.11 Networking: campaign brief, task chain, networking plan

**Coaching method.** Seed and SOW: "100 to 300 targeted professionals", "A structured three-touch outreach campaign", "We build your target companies, contacts, and proposed messaging behind the scenes. You send the campaign from your own email account".

**Campaign brief.** BUILT AND FUNCTIONING.

- Table: `networking_campaign_briefs`.
- Fields: name, education_status, immediate_goals, notes_for_builder, primary and secondary roles, primary and secondary industries, locations, `ai_suggestions`.
- Statuses: draft, submitted. A submitted brief "is not edited, because Erin may already be working from it".
- AI prefill (`lib/briefs/prefill.ts`, `claude-opus-5`): "Return ONLY what the profile actually says. This is extraction, not advice." The coach confirms each suggested field.

**Task chain** (from `docs/signal-what-exists-today-2026-09-29.md` §3 and the `tests/automation/seed-networking-chain.ts` rows):

1. "Define Networking Campaign" (lead coach, no due date)
2. Submitting the brief creates **Create Networking Campaign**, assigned to Erin
3. completing Create creates **Review**, assigned to Peri
4. approving creates **Upload Campaign and Build Plan**; requesting changes reopens Create, with a required note
5. completing Build creates **Share Plan with Client**
6. generating the plan closes Build, and sharing it closes Share

Trigger event: `campaign_brief.submitted`. Tables: `coach_tasks`, `coach_task_events`, `coach_task_templates`, `coach_automation_events`, `coach_automation_rules`.

**Networking plan PDF** (`lib/networking-plan/*`). BUILT AND FUNCTIONING. It is not AI-generated. It renders the "Outreach Messages" tab of a workbook that Erin builds outside SIGNAL.

- Source columns: `Channel | Touch | When | Subject line | Message | How to use it`.
- PDF sections: "How the sequence works", "Before you send anything", "Email touches", "LinkedIn touches", "After every conversation", "Adjust for who you're writing to", "Track it in SIGNAL", "Weekly checklist".
- Job status: pending, running, complete, failed. Step: none, generated, uploaded, filed.
- Sharing:
  - opens Drive access
  - shows the plan in the client Library
  - writes History and a GHL note
  - sends the Postmark email "Your networking plan is ready"
  - emits `networking_plan.shared`
- Tables: `networking_plan_jobs`, `networking_plan_sources`, `coach_client_documents`, and the `coach_clients.ghl_contact_*` and `drive_folder_*` columns.

**Connections:** Drive, Postmark, GHL (note only), tasks. The PDF takes no input from JobFit, Positioning or Lanes.

**Independence:** the plan needs stored source rows. It does not need a brief.

### 1.12 Network tracker (client contact CRM)

**Status.** BUILT AND FUNCTIONING.

**Tables:** `network_companies`, `network_contacts`, `network_actions`, `network_comments`, `network_client_profile`, `network_templates`.

**Contact stages** (DB value, then UI label from `app/dashboard/network/vocab.ts`):

| DB value | UI label |
|---|---|
| `identified` | "Not started" |
| `intro_requested` | "Asked for an intro" |
| `sequence_active` | "Message sent" |
| `replied` | "They replied" |
| `chat_scheduled` | "Chat booked" |
| `chat_done` | "You talked" |
| `nurture` | "Keeping in touch" |
| `ask_made` | "Asked for a referral" |
| `outcome` | "Got a result" (referral, intro or lead) |
| `dormant_no_answer` | "No answer yet" |
| `dormant_declined` | "Not interested" |

**Other vocabulary:**

- Company tier: dream, strong, backup, shown as "Priority 1/2/3".
- Contact priority: A, B, C.
- Relationship: personal, affinity, referred, cold, recruiter. These map to template families P, A, R, C, X.

**Three-touch rule:**

- Touch 2 at +7 days, touch 3 at +5 days, then `dormant_no_answer`, which resurfaces at +35 days.
- Declined contacts resurface at +90 days.
- Nurture repeats every 42 days.
- `next_due_at` is computed only by `computeNextDue`.

**Templates:** 24 defaults in code (IN, P1-3, A1-3, R1-3, C1-3, X1-3, S1-5, L1-3), with per-client overrides.

**Independence:** fully standalone. It works for a direct-to-consumer user with no coach.

### 1.13 Legacy per-job networking generator

**Status.** BUILT BUT INCOMPLETE. It was retired from the web UI "Decision 2026-08-08" and kept for mobile and for coach history in `networking_runs`. That table has no migration in `supabase/migrations`.

**Model and prompt:** `claude-haiku-4-5-20251001`, prompt `networking_v9_status_verdict_2026_05_29`.

**Methodology encoded in the prompt:**

- "THE WRN COACHING VOICE ... appropriately aggressive"
- "Exactly 3 moves": "closest to the work", "credibility bridge", "process owner"
- Exemplar types: "Doing this job", "Similar background", "Recruiter / HR / hiring manager"
- Banned phrases, such as "pick your brain"

**Inputs:** JobFit, Positioning and targeting context.

### 1.14 Job search strategy: search lanes, sourcing, ingest

**Coaching method.** Seed: "Prepare for strategy session: Update profile, create personas, enter target roles/locations/goals, seed 1 to 2 jobs (required)". "Run strategy session: Send SIGNAL invite live, full walkthrough, pursue and ignore rules, prioritization and sequencing, confirm campaign requirements". SOW: "Clear rules for which postings to pursue and which to ignore".

**Product.** Three disconnected systems:

1. **Search lanes.** These are saved hiring.cafe searches: `lib/lane*.ts`, `app/api/lanes/*`, and the tables `search_lanes`, `lane_results`, `lane_runs`.
   - Workflow: Propose, Discover titles, Create, Run (nightly or manual), Review queue, Decide (push, dismiss, cleared).
   - Dismiss reasons are a fixed set: too_senior, too_junior, wrong_function, wrong_industry, wrong_location, right_employer_wrong_level, doesnt_meet_requirements, already_applied, other.
   - Seniority bands: "No Prior Experience Required", "Entry Level", "Mid Level", "Senior Level".
   - Push goes through the coach's "Source a Job" (a JobFit run plus annotation). That writes `coach_job_recommendations`, which shows as "From your coach" on the client tracker.
   - Status: BUILT BUT INCOMPLETE. Prod: UNKNOWN OR NOT VERIFIED (see contradiction C10).
2. **Taxonomy lanes.** `lib/laneTaxonomy.ts` holds 12 lanes. It is unrelated to search lanes despite the shared word.
3. **Ingest.** `lib/ingest/*` covers Greenhouse, SmartRecruiters and Workday, with tables `postings`, `ingest_*`. No route outside ingest reads `postings`. Status: BUILT BUT INCOMPLETE.

`lib/jobs/isolatePosting.ts` strips page noise from pasted JDs for JobFit.

### 1.15 JobFit scoring

**Purpose.** Score a pasted job against the user's profile and return a decision with evidence.

**Status.** BUILT AND FUNCTIONING.

**Pipeline** (`runJobFit()` in `app/api/_lib/jobfitEvaluator.ts`):

1. `isolatePosting`
2. `extractJobSignals` (regex, or LLM when `JOBFIT_LLM_EXTRACTION=on`)
3. `extractProfileSignals`
4. `evaluateGates`
5. optional semantic suppression (free path only; Haiku, temp 0, fail open)
6. `scoreJobFit`
7. positive boost (70 to 74 becomes 75 under strict conditions)
8. risk detectors
9. `decisionFromScore`, then `applyGateOverrides`, `applyRiskDowngrades` and `applyEvidenceGuardrails`
10. optional gate ledger
11. `capScoreForDecision`
12. V4 deterministic bullets
13. V5 Haiku bullets (fall back to V4)
14. `enforceClientFacingRules`

**Decisions** (`app/api/jobfit/decision.ts`):

| Decision | Score |
|---|---|
| Priority Apply | 96 or more |
| Apply | 75 or more |
| Review | 60 or more |
| Pass | below 60 |

`maxScore` is 97.

**Gates and codes:**

- `force_pass` gates: FIELD_MISMATCH, MBA_REQUIRED, CREDENTIAL_REQUIRED, EXPERIENCE_GAP, HARD_SALES, HARD_GOV, REMOTE_MISMATCH, PARTTIME_MISMATCH, GRAD_MISMATCH.
- `floor_review` gate: CONTRACT.
- Five WHY codes. About 35 RISK codes, 9 of them behind detector flags. 18 job families.

**Storage:** `jobfit_runs`, `signal_applications` (auto-created per authed scan), `jobfit_anonymous_runs`, `jobfit_trial_runs`, `jobfit_semantic_verdicts`.

**Outputs:** decision, score, WHY and RISK codes and bullets, next step. V5 adds `cover_letter_strategy`, `positioning_strategy` and `networking_strategy` (null on Pass).

**Connections:** `jobfit_runs` is the anchor row for cover letter, positioning, interview Prep Now, the legacy networking generator and coach recommend-job. No DNA input, by design (CNL R6).

**Independence:** the core (extract, scoring, decision) has no database access and is self-contained.

### 1.16 Interview preparation (summary only; covered in depth elsewhere)

Seed method: three Interview Sessions, each with a workbook ("Session N workbook") and homework, then "AI practice email". After that: a recorded Mock Interview with "Scorecard for content and delivery", a repeatable Pre-Interview Prep, and a Land cap of 8 hours (SOW: "The Land stage is capped at 8 hours of live support").

**Product:**

- **Workbooks** (`lib/workbook`; tables `workbooks`, `workbook_*`). Built. Session 1 "Foundations" is live. Session 2 "Telling Your Stories" was on staging per the 2026-09-29 audit.
- **Practice rounds** (`lib/practice`; tables `practice_*`). Recorded video answers, with coach feedback held until released. Staging-only per the 2026-09-29 audit.
- **Prep Now** (`lib/interviewPrep`). One LLM call grounded in the JobFit run.

### 1.17 The Proof Project

**Offer.** SOW: "Six weeks of guided project work producing one real, completed project for your resume and substantive material you can discuss in an interview. This is for candidates whose gap is experience rather than positioning." Price $1,800, optional. The seed sheet marks it "(to define)" and "parked, do not import".

**Product.** BUILT AND FUNCTIONING as a view. A Proof Project is a `coach_client_engagements` row with `is_proof_project`, "a view selector, not a new kind of engagement" (`lib/proofProject.ts`).

- Deliverables contain activities. Owner: coach, client or both. Status: not_started, in_progress, complete.
- Unlock rule: a deliverable unlocks when its sign-off activity is complete.
- Reward: `speaking_point` ("You can now say:") and `why_this_matters`, withheld server-side until unlock.
- Journey node states: complete, current, future.
- Progress is capped at 99 until every task is complete.

**Prod decision.** `docs/prod-promotion-2026-08.md`: "DECIDED 2026-08-09: apply migrations 11 and 12, keep the code."

### 1.18 Career exploration: coherence and targeting

- **Coherence** (`lib/coherence`). BUILT BUT INCOMPLETE (dormant).
  - One Haiku call classifies resume role blocks into the 12 taxonomy lanes, then a Herfindahl index is computed.
  - Locked gate: "fire 'scattered' iff H < 0.42 AND >=2 lanes each >= 0.20 AND top_lane_share < 0.50".
  - Its only caller is the free scan, gated by `COHERENCE_TRIAL_ENABLED==="1"`, which is "set in no environment".
- **Candidate targeting** (`candidate_targeting`, `lib/candidateTargeting.ts`). BUILT BUT INCOMPLETE.
  - No UI sends the targeting payload.
  - The status flags (premed, prelaw, pregrad) are hardcoded false.
- **Methodology fence.** The DNA methodology forbids both from feeding Stage 1 DNA.

### 1.19 Package library (Settings, Services)

**Status.** BUILT AND FUNCTIONING.

**The coach's catalog:**

- deliverables: name, description, category, time estimate, fee, phase, SOW bullets
- tasks: owner, details/checklist (commit `f67e24a9`)
- packages, with a discount that brings the fee total to the sheet price

**Attaching a package** copies it to the client as an engagement. After that, "catalog edits do not change it" (`docs/signal-what-exists-today-2026-09-29.md`).

**Seed import:** `tests/package-seed/wipe.sql` and `import-packages.ts`. It refuses a non-empty library and rolls back on failure.

---

## Part 2. Documentation and decisions

### 2.1 Classification of documents

Key: LOCKED = LOCKED decision; WORKING = WORKING design; OPEN = Open decision; DEBT = Technical debt or known limitation.

#### Architecture, state and reference

| Doc | Class | Text that makes it so |
|---|---|---|
| `CLAUDE.md` | WORKING, with a DEBT list | "Known architectural debt (ranked by impact)" (see 2.3) |
| `docs/ARCHITECTURE.md` | Presents itself as LOCKED; stale | "This is the locked SIGNAL architecture. Treat it as source of truth." Last changed 2026-05-03. Describes "a job-search decision system for college students", with a Framer front end and "magic link only". |
| `docs/README.md` | Stale index | Lists `SIGNAL_ARCHITECTURE.md`, which does not exist (the file is `ARCHITECTURE.md`). |
| `docs/signal-what-exists-today-2026-09-29.md` | Reference snapshot, plus DEBT | "Written from the code, the migrations and the live `/api/version` endpoints, not from the plans." Has "Half-built" and "Still open after these fixes" lists. |
| `docs/signal-build-snapshot.md` | Stale snapshot | "Last updated: 2026-05-29". Its "Current scoped work" is the May feedback widget. Phase 2 "REMOVED 2026-07-20". |
| `docs/API.md`, `docs/DATABASE.md` | Reference, plus OPEN | DATABASE.md: "[NEEDS CLARIFICATION] on whether this table is live or superseded"; "`user_profiles` appears to be a legacy table". |
| `docs/owner-column-naming.md` | DEBT (accepted) | "The column is `profile_id`... What is missing is a written note that the convention SPLITS"; "What to do about it: Nothing, for now." |
| `docs/silent-write-failures.md` | DEBT inventory | "Taken 2026-08-05, after `positioning_runs` stopped persisting on production for roughly two weeks with zero signal." Tier 1 "STATUS: addressed 2026-08-05 (Commit A)". |
| `docs/applications-payload-weight.md` | DEBT / OPEN | "the fix is not a tweak: it needs a decision about who actually reads that field." |
| `docs/ATTRIBUTION_ARCHITECTURE.md`, `ATTRIBUTION_TESTING.md` | WORKING (built) | "Server-side attribution... added in the `feature/attribution-infrastructure` branch (Phases 1–6, April 2026)". |
| `docs/QA_UI_INVENTORY_2026-04-12.md` | Historical reference | "Generated: 2026-04-12". |

#### Coaching operations, onboarding and tasks

| Doc | Class | Text that makes it so |
|---|---|---|
| `docs/WRN_SIGNAL_Package_Seed.xlsx` | LOCKED (import columns); WORKING (peach columns) | "Pale blue headers = import into SIGNAL now. Peach headers = reference only, for features not built yet". The import was "Approved 2026-10-04" (`import-packages.ts`). |
| `docs/WRN_SOW_Text.md` | LOCKED | "All lines confirmed by Peri." |
| `docs/WRN_Welcome_Emails.md` | WORKING copy | The template wording. The sheet marks #2 "Draft exists, revisit" and #3 to #5 "To write". |
| `docs/coaching-task-automation-plan.md` | LOCKED decisions, plus OPEN and DEBT | "## 1. The decisions. Taken 2026-09-24"; "STANDING RULE: every client-facing email carries the signature... Decided 2026-09-25"; "STANDING RULE: Notes are written by people, History is written by the system"; "## 9. Open questions"; "## 11. Backlog, found here, not fixed here". |
| `docs/coaching-tasks-prod-deploy-plan.md` | WORKING (runbook) | "Prod deploy: coaching tasks, and the client email moving to Postmark". |
| `docs/prod-promotion-2026-08.md` | LOCKED (Proof Project) | "DECIDED 2026-08-09: apply migrations 11 and 12, keep the code... This is a reversal of the earlier 'cut them' decision". |
| `docs/my-settings-ia-restructure-spec.md` | LOCKED | "## 5. Tab mechanism (LOCKED)"; "## 7. Decisions locked (2026-06-04)"; "Status: Shipped to dev — Steps 1–3 (not prod-promoted)". |
| `docs/Features/coaches-center-prospects-frd.md` | WORKING, superseded by code | "Status: Draft, awaiting Peri approval". The 2026-09-29 audit says "The written spec describes that first version, and the newer spec it points to is not in this repo." |
| `docs/Features/beta-feedback-frd.md` and the preflight doc | WORKING / OPEN | "Status: Draft — awaiting Peri approval". Preflight: "three load-bearing assumptions are wrong and change the build". |
| `docs/sprint-1/2/3-*-build.md`, `coach-dashboard-redesign-build.md`, `dev-password-auth-build.md` | Historical build records | Each has "Phase 3 (verification)... walkthrough is yours". sprint-2: "Migration NOT applied to DEV Supabase". |

#### DNA methodology

| Doc | Class | Text that makes it so |
|---|---|---|
| `docs/professional-dna/README.md` | WORKING (draft), with a LOCKED rule | "As of 2026-08-22, no document in this directory is LOCKED." "No SIGNAL application code may be written against any of it until..." |
| `00-methodology-principles.md` | WORKING (review) | "P8–P12 have been written... but have not been explicitly approved" (D-PRIN-01). |
| `01-construct-registry.md` | WORKING, containing LOCKED entries | "LOCKED (5): 1.1 Guidance / Development Support · 2.4 Create · 3.1 Outcome Ownership · 3.3 Decision Influence · 5.1 Life Protection". "Scoring approach and confidence requirement remain OPEN for all 44." |
| `02-needs-preferences-flexibility.md` | OPEN | "Every definition is OPEN. Nothing here is implementable." |
| `03-assessment-architecture.md` | WORKING | "Three things settled, everything else OPEN." |
| `04-evidence-and-confidence.md` | OPEN | "Nothing is LOCKED. Every threshold in this document is OPEN." DL-004 is closed. |
| `05-adaptive-clarifiers.md` | WORKING / OPEN | "Four things settled at principle level." D-AC-03 "Blocks R1". |
| `06-decoded-insights.md` | OPEN | Six "candidates with OPEN trigger conditions". |
| `07-result-schema.md` | OPEN | "every field is OPEN". |
| `08-validation-framework.md` | OPEN | "Every threshold is OPEN." |
| `09-context-boundary.md` | WORKING | "Five decisions are OPEN". The three-stage boundary is the core design. |
| `10-version-history.md` | WORKING | v0.8; v1.0 is required for the first client artifact. |
| `11-tradeoff-model.md` | WORKING | "Nothing here is LOCKED"; it does "not satisfy" `CNL R0 — Tradeoff model`. |
| `DECISION-LOG.md` | LOCKED (append-only log) | "LIVE — append-only". DL-005 to DL-009 are "the first construct-definition LOCK". DL-010 supersedes DL-009's definition. |
| `OPEN-DECISIONS.md` | OPEN | "Count: 92 open. 3 closed. 95 entries." "Blocking R1 engineering: D-AC-03 · D-CR-01 · D-AA-01 · D-EC-04 · D-EC-12 · D-RS-01". |
| `docs/signal-dna-site-and-integration-options.md` | WORKING (options memo) | Recommends "Option 0 + 5 this week; then Option 3 + 6a + 4". Option 8 is "Blocked by your own gate." |

#### JobFit

| Doc | Class | Text that makes it so |
|---|---|---|
| `docs/JOBFIT_LOGIC_SPEC.md` | Stale (reads as locked) | "Apply = 70 / Review 40–69 / Pass < 40", with three labels. Contradicted by code (C1). |
| `docs/JOBFIT_CURRENT_STATE.md` | Stale | Lists only `client_profiles`, `jobfit_runs`. Omits V5, the semantic layer, guardrails and the ledger. |
| `docs/JOBFIT_CHANGELOG.md` | Stale | A single entry, "rules_v3_2026_02_27". |
| `docs/jobfit-semantic-relevance-layer-scope.md` | LOCKED in effect (implemented) | Header: "Status: SCOPE ONLY — no implementation." Yet `semanticGate.ts` and `semanticRelevance.ts` ship it. "Known edges (accepted, not bugs)... accepted 2026-06-18". |
| `docs/jobfit-ticket1-plan.md` | LOCKED (closed), plus OPEN | "Status: CLOSED (2026-06-18) — rules track complete." Still open: "Stage 4 (re-enable Fix C)... READY, NOT YET ATTEMPTED." DEBT: "Scorer reads the email local-part (candidate name)". |
| `docs/jobfit-ticket-acceptance-suite.md` | LOCKED | "Decision (2026-06-18) — Ticket 1 is THE fix"; "Ticket 2 ... DOWNGRADED to an optional coarse backstop." |
| `docs/Features/case-determination-tuning-plan.md` | Abandoned; lessons kept as DEBT | "ABANDONED 2026-08-10 ... This document describes a system that does not exist." DEBT: "Field-mismatch risks consistently tag `medium` ... when they should tag `high`". |
| `docs/prep-now-invented-detail.md` | DEBT, plus OPEN | "Reduced ... not eliminated, and the remaining lever is weak." The drafts framing was "Proposed and deliberately not built on 2026-08-06." |
| `docs/test_cases/*`, `docs/DEV Regression Harness.txt` | Test reference | n/a |

#### Positioning

| Doc | Class | Text that makes it so |
|---|---|---|
| `docs/positioning-v2-abandoned.md` | LOCKED | "It is abandoned. We are not building it." "If you are adding positioning storage, use `positioning_runs`." |
| `docs/Features/positioning-design-reference-v2.md` | Superseded | Banner: "ABANDONED 2026-08-10... do not build from it". |
| `docs/Features/positioning-foundation-frd.md` | Mislabeled | ABANDONED banner, but the deliverables are live. Body: "Status: Draft - awaiting Peri approval". |
| `docs/Features/positioning-foundation-completion.md` | LOCKED (shipped record), plus DEBT | "Foundation SHIPPED (dev + prod)". KI-01 to KI-07, e.g. "coverletter_run_id ... Cover Letter route doesn't populate it yet". |
| `docs/Features/foundation-migration-runlog.md` | LOCKED design decisions, plus DEBT | e.g. DD-18 "Locked decision: operational acceptance metric is 'high-confidence rate on inferrable subset'". The 2026-07-20 drop checkboxes are unchecked. |
| `docs/Features/foundation-real-data-sample-design.md` | WORKING (complete) | "Operational guards (locked)". |
| `docs/Features/positioning-phase1-frd.md`, `docs/positioning-v2-phase1-readiness-2026-05-27.md`, `docs/dev-positioning-routing-investigation-2026-05-27.md` | Historical | ABANDONED banners. Readiness: "Enhance-v1 wins decisively for the near term". |

#### Networking and network tracker

| Doc | Class | Text that makes it so |
|---|---|---|
| `docs/Features/networking-plan-delivery-frd.md` | WORKING (outdated), with LOCKED "Settled" items and one OPEN | "Status: plan only. Nothing here is built." Settled: "SIGNAL does not draft, send, or store any email". Open: "Whether ending a coaching relationship should prompt the coach to unshare". |
| `docs/networking-plan-delivery-plan.md` | Superseded WORKING | "Status: plan only, nothing built. Written 2026-09-22." §6 has 7 open questions. |
| `docs/networking-plan-ghl-sync-plan.md` | Superseded WORKING, plus DEBT | "Status: plan only, nothing built." Open: "Is `GHL_API_KEY` a Private Integration Token or a legacy v1 key?" |
| `docs/network-tracker/networking-unification-spec.md` | Mixed | "Status: BRAINSTORM / architecture, not yet built." LOCKED: "Decision 2026-08-08: the old networking function is retired." DEBT: "KNOWN LIMITATION, the board cannot find people... taken knowingly." |
| `network-tracker-cc-brief.md` | LOCKED, plus DEBT and OPEN | "## 3. Locked decisions, with the reasons"; "## 7. Stack & conventions (LOCKED)"; "## 8. Future ideas, NOT scoped, NOT decided". |
| `network-tracker-data-model.md` | LOCKED reference | "This doc reflects v3". Its import section is "SUPERSEDED". |
| `network-tracker-reconciliation.md` | LOCKED (top precedence) | "Where this doc and BRIEF.md disagree, this doc wins". |
| `COLOR-SYSTEM.md` | LOCKED design standard | "These rules are definitive"; "rules locked and applied the same day" (2026-07-30). |
| `network-tracker-dashboard.md` | LOCKED, with DEFERRED items | "Locked, per the Coach". "Follow-ups completed this week" is DEFERRED. |
| `network-tracker-import.md` | LOCKED | "`contact_method`, DECIDED: no column". |
| `coach-contacts-import.md` | LOCKED reversal | "This change reverses that decision for import, deliberately". |
| `network-tracker-templates.md` | WORKING (built), plus DEBT | "Known issue, `isKnownTemplateId` runs before the access check, leaking valid ids". |
| `network-tracker-pages.md` | Historical | "Low authority". |
| `network-tracker-ux-*.md`, `template-variables.md` | WORKING | UX restructures of built screens. |

#### Interview preparation and design standards

| Doc or file | Class | Text that makes it so |
|---|---|---|
| `docs/workbooks/WORKBOOK_V1_SPEC.md` | LOCKED | "## Locked decisions": "No SIGNAL DNA in workbooks"; "No separate workbooks dashboard"; "No email in v1". |
| `lib/theme/surfaces.ts`, `lib/theme/coachSurface.ts`, `lib/dashboard-theme.ts` | Design tokens in code (WORKING) | surfaces.ts: "BRAND ORANGE, 2026-09-27. Was coral #F26B52". |
| `app/dashboard/layout.tsx` `LIGHT_ROUTES` | WORKING (incremental light-theme conversion) | "A route is light because it is listed there, and the list is deliberately exact". |

### 2.2 Key LOCKED decisions (cross-cutting)

1. **JobFit gets no DNA input.** CNL R6 "JobFit score isolation guarantee" (`docs/professional-dna/09`). Workbooks also exclude DNA (`WORKBOOK_V1_SPEC.md`).
2. **DNA Stage 1 is blind and frozen before any context.** Code must not be written against the methodology until the CNL R0 gate passes.
3. **Five DNA construct definitions are locked**, from DL-005 to DL-010. For example, DL-009 lock 3 says support is "Orthogonal to autonomy, not the opposite end of an autonomy spectrum".
4. **Task model:** a dedicated `coach_tasks` table; statuses open, done, cancelled; the assignee must be a coach (2026-09-24).
5. **Every client email carries the Postmark `signal-client` layout signature.** "Notes are written by people, History is written by the system."
6. **Plan rules (2026-10-03):** activation within a deliverable only; client tasks are released by hand.
7. **Welcome template chosen by the first task's phase** (2026-10-05).
8. **SOW text confirmed by Peri.** The Proof Project is an optional $1,800 add-on and is parked in the library.
9. **Positioning v2 is abandoned.** Use `positioning_runs`.
10. **The old networking function is retired** (2026-08-08). The networking colour system is definitive (2026-07-30).
11. **JobFit:** Ticket 1 is the fix, Ticket 2 a backstop (2026-06-18). Quality-gated direct WHYs need a weight of 75 or more (CLAUDE.md).
12. **Proof Project migrations ship and the code stays** (2026-08-09).

### 2.3 CLAUDE.md "Known architectural debt" (as written, with observed state)

| # | Item as written | Observed in this audit |
|---|---|---|
| 1 | "Bare-word `.includes()` matching — biggest recurring bug source... Next major refactor target." | Partly resolved. Ticket 1 Stage 1 shipped word-boundary PhraseSpec, so the text is stale. |
| 2 | "Section-aware JD parsing — SHIPPED (2026-04-09, commit `b2b0c387`)." | Shipped. |
| 3 | "Adjacency graph produces semantic nonsense matches... Medium priority." | Open. |
| 4 | "Professional-experience scoped years parser — DONE." | Done. |
| 5 | "Quality-gated direct WHYs in guardrails — SHIPPED (2026-04-09, commit `d45c49da`)." | Matches `decision.ts`. |
| 6 | "Detector registration is triplicated." | Open. |

Other debt found:

- Backup files in the live JobFit directory: `jobfitEvaluator.corrupt-backup.ts`, `jobfitEvaluator.ts.bak-step9`, `extract.BROKEN_BACKUP.txt`, `signals.ts.bak-step1`, and two V4 renderer backups.
- Account creation is triplicated.
- The sign-in check is copied by hand into about eight routes.
- The owner column has two names (`profile_id` vs `client_profile_id`).
- The coach-side prospects pipeline cannot move a prospect back a stage.
- The network-tracker `isKnownTemplateId` id leak.
- The `networking_runs` table has no migration.

### 2.4 Contradictions between docs and implementation (flagged, not resolved)

| # | Topic | Doc says | Code or other doc says |
|---|---|---|---|
| C1 | JobFit thresholds | `JOBFIT_LOGIC_SPEC.md`: "Apply = 70, Review 40–69, Pass < 40", three labels | `decision.ts`: Priority Apply 96 or more, Apply 75 or more, Review 60 or more, Pass below 60. The clamp is Pass at most 55, Review at most 74, Apply at most 95 (a Pass can never display 56 to 59). |
| C2 | JobFit file sizes | CLAUDE.md: extract.ts "~4200", decision.ts "~180", jobfitEvaluator.ts "~160" | `wc -l`: 5214, 240, 465. |
| C3 | No LLM in paid scoring | CLAUDE.md: "On the paid/authed paths there is no LLM in the scoring loop." | True by default. False if `JOBFIT_LLM_EXTRACTION=on` or `JOBFIT_DETECTORS_PAID=on` (`jobfitEvaluator.ts:81-97, 208-231`). |
| C4 | Raw JD storage | CLAUDE.md: `jobfit_runs` "has full output but NOT raw jobText" | `jobfit_runs.job_description` stores the raw JD (`app/api/jobfit/route.ts:447`). |
| C5 | Semantic layer | Scope doc: "SCOPE ONLY — no implementation" | Implemented on the free path. |
| C6 | Regression size | CLAUDE.md: 26 cases | Evaluator comments cite "68 core and 628 prod regression cases". |
| C7 | `floor_review` gate | Spec: the gate floors the decision to Review | Code demotes only Apply, so Priority Apply passes through `applyGateOverrides`. |
| C8 | DNA instrument | Seed: "Run Your SIGNAL DNA Assessment, Live on Teams" (1:1). The welcome email says it is 1:1 with the phone used to answer. | The integration doc: a 23-question host-paced group app. Methodology 03: a self-serve adaptive 15 to 20 minute assessment, with v1 items "running to at least Q82". Three instruments, none reconciled. |
| C9 | Number of paths | P3: "Up to four paths"; the welcome email says "up to four career paths" | SOW: "Four career paths", "narrows to four paths". Seed: "four paths". |
| C10 | Where paths are set | SOW and seed: the Report contains four paths; Decode "confirm paths" | `WRN_Welcome_Emails.md`: paths are identified "in a live decode session". Seed Build: "Run Resume Workshop: Define job paths together". |
| C11 | Report shape | Seed: "10 sections" | Integration doc: a headline plus 6 numbered sections. |
| C12 | Support vs autonomy | DL-009 lock 3: support is "Orthogonal to autonomy" | Live reports' DNA Map uses one slider, "More manager involvement" to "Autonomy after clarity". |
| C13 | Blind Stage 1 | `09-context-boundary.md`: freeze before context | The current hand-written report mixes DNA with "supporting evidence from your own background", with no recorded freeze. |
| C14 | DNA registry status | 01, lines 16 and 31: five definitions "LOCKED" | 01, line 59 and footer: "Nothing is LOCKED"; README: "no document in this directory is LOCKED" (dated before DL-005). |
| C15 | Networking plan email | FRD: "SIGNAL does not draft, send, or store any email" | `lib/networking-plan/job.ts` sends the Postmark `networking-plan-ready` email on share and resend. |
| C16 | Folder sharing | FRD: "The folder is never shared." | `job.ts`: "The client folders are deliberately shared with anyone who has the link". |
| C17 | GHL sync | GHL plan: custom field, then note, then tag `networking-plan-shared` | Note only. "The tag is gone." The column is `ghl_tagged_at`, not `ghl_tag_added_at`. |
| C18 | Coach writes to the client's pipeline | Tracker CC brief LOCKED: coaches "can never mutate the PIPELINE... return 403 for a coach" | Contacts POST and stage routes allow a full-access coach (`resolveRequestScope({require:"write"})`). Import was reversed deliberately. |
| C19 | Networking chain trigger | `coaching-task-automation-plan.md`: `client_profile.submitted` | The code uses `campaign_brief.submitted`. |
| C20 | Template origin | Reconciliation §8: "SIGNAL generates these [24 templates]" | The defaults are static code (`lib/network-tracker/template-defaults.ts`). |
| C21 | Stage count | Reconciliation heading: "Stages: 10, not 6" | The table and schema have 11. |
| C22 | Plan template | Delivery plan: Peri supplies the HTML design | `print-template.html` hardcodes `<h1>` "Noah Sperling", which render.ts replaces. Sections 2 and 5 to 8 are fixed copy. |
| C23 | Two task systems | n/a | Share completes the automation task "Share Plan with Client" and the plan task "Share plan with client". Near-identical names, two systems. |
| C24 | Phase 2 history | `positioning-v2-abandoned.md`: Phase 2 "never built"; `phase2_runs` "does not exist in any database and has no migration" | Runlog and `signal-build-snapshot.md`: 5 endpoints were built and the table was applied to dev and prod, then removed 2026-07-20. The drop checkboxes are unchecked. |
| C25 | Foundation FRD | Banner: ABANDONED | The Foundation tables and libraries are live. `lib/candidateTargeting.ts` cites the FRD. |
| C26 | Application link columns | Foundation design: `signal_applications.positioning_run_id` and `coverletter_run_id` | No route writes either. |
| C27 | Empty v2 reads | `positioning-v2-abandoned.md`: use `positioning_runs` | Positioning feedback, coach client-runs and the networking route still read the empty `positioning_runs_v2`. |
| C28 | Lanes on prod | `docs/signal-what-exists-today-2026-09-29.md` lists "Job-search lanes" as existing | `app/api/internal/lanes/run-due/route.ts`: "Prod Supabase has no lane tables at all". Not verified here. |
| C29 | Proof Project migration comments | `20260808_proof_project.sql`: "no coach-side editor was built"; no one-per-relationship rule | The coach editor exists, and the PATCH unflags other engagements. |
| C30 | Colour tokens | `COLOR-SYSTEM.md` (definitive): `T.WRN_ORANGE` `#FEB06A`, `T.WRN_BLUE` `#51ADE5` | `lib/theme/coachSurface.ts`: `WRN_ORANGE "#FF6B00"`, `WRN_BLUE "#009BFF"`. |
| C31 | Light-theme status | `coaching-task-automation-plan.md` §10: updating `surfaces.ts` LIGHT to the brand palette is "Not started, deliberately" | `surfaces.ts` has the brand orange and blue, dated 2026-09-27. |
| C32 | Architecture doc | `docs/ARCHITECTURE.md` ("locked... source of truth"): "college students", Framer front end, "magic link only" | The Next.js Coaches Center, coach and delegate roles, and dev password auth exist. README points to a nonexistent `SIGNAL_ARCHITECTURE.md`. |
| C33 | Seed email statuses | Sheet: #1 SOW and #3 to #5 welcome emails "To write" | Built on dev (commits `4ab2d09f`, `b58b4ce0`). |
| C34 | Workbook email | `WORKBOOK_V1_SPEC.md`: "No email in v1" | Session 1 homework triggers a practice round email (staging, per the 2026-09-29 audit). This may be a later version rather than v1. |
| C35 | Seed vs code chains | Sheet "On done": cross-deliverable releases (e.g. Decode releases Book Resume Workshop; homework "Sends AI practice email") | `lib/plan/service.ts` activates only within a deliverable. The sheet calls these columns reference-only, so this is expected but undocumented in code. |

### 2.5 Open decisions worth carrying forward

- 92 open DNA decisions (`OPEN-DECISIONS.md`). Six block R1: D-AC-03, D-CR-01, D-AA-01, D-EC-04, D-EC-12, D-RS-01.
- Whether a single career path is valid (CNL R2 research).
- Defining The Proof Project ("to define").
- Automation plan §9: cancelled-task visibility, orphaned task client ids, and the digest for inactive coaches.
- Networking FRD: unsharing when a coaching relationship ends.
- GHL key type and API version header.
- JobFit Ticket 1 Stage 4 (re-enable Fix C): "READY, NOT YET ATTEMPTED".
- `applications-payload-weight.md`: who reads `job_description` on the applications list.
- Pricing page fixes listed on the seed sheet.
