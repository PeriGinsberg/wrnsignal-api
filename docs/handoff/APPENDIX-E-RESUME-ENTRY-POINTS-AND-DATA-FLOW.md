# Appendix E: Resume Capabilities, Service Entry Points, and Data Flow

Audit date: 2026-10-07. Branch: `dev` (HEAD f67e24a9). Method: read-only code and migration review of `C:\Users\perig\wrnsignal-api`.

**Limits of this audit.** The live databases (dev or prod) were not inspected. Every statement about tables and columns comes from `supabase/migrations/*` and application code. Whether a given migration is applied in prod, and what data rows exist, is UNKNOWN OR NOT VERIFIED. Paths are relative to the repo root.

Status labels used: BUILT AND FUNCTIONING, BUILT BUT INCOMPLETE, DESIGNED OR DOCUMENTED NOT IMPLEMENTED, PLANNED, UNKNOWN OR NOT VERIFIED. Two extra descriptors appear where accurate: REMOVED (code deleted, schema left behind) and DORMANT (code exists, disabled by flag).

---

## 1. Headline findings

1. SIGNAL treats a resume as **plain text** (one or more named variants per client). It reads that text for analysis (JobFit, Positioning, Cover Letter, Interview Prep). It does **not** edit, rewrite, version, render, or approve resumes as documents.
2. The only resume-rewrite system ever built ("Resume Rx") was **removed on 2026-08-27**. Its table `resume_rx_sessions` still exists and is useful as a schema precedent for a workshop flow.
3. "Resume Workshop" and "Resume" exist today only as **coach-run plan deliverables and tasks** in the package library. The actual resume work happens outside SIGNAL (Google Drive folder named "Resume").
4. Entitlement is **all-or-nothing** (`client_profiles.active`) and is enforced **only at login**. There is no per-service entitlement. Coach engagements are commercial and plan records only; they gate nothing feature-wise.
5. The richest structured accomplishment data (STAR+E stories) lives in **workbook answers**, with full history and authorship, but **no other module reads it**.
6. Client-owned data (profile, resume variants, JobFit runs, applications) follows the `client_profile`. Coach-relationship data (plans, SOW, notes, documents, workbooks, Drive folders) is keyed by `coach_client_id` and does **not** follow the client to a new coach.

---

## 2. Scope 1: Current resume capabilities

### 2.1 Inventory

| Capability | Status | Location | Notes |
|---|---|---|---|
| Resume file upload and text extraction | BUILT AND FUNCTIONING | `app/api/resume-upload/route.ts` | Accepts .pdf, .docx/.doc, .txt. PDF read by Claude `claude-haiku-4-5-20251001` (line 84) as a document block; Word via `mammoth.extractRawText`; text decoded UTF-8. Rejects under 50 chars. **Stores nothing**: returns `{ok, text}`; caller saves. No storage bucket, original file not retained. |
| Upload/paste UI | BUILT AND FUNCTIONING | `app/dashboard/profile/ResumeSection.tsx` (approx. lines 35-52) | Per-persona; labelled as "resume versions". |
| Profile intake (first-run) | BUILT AND FUNCTIONING | `app/api/profile-intake/route.ts` | Requires `resume_text`, `target_roles`, `job_type` (approx. 684-695). Caps resume at 120000 chars. Builds `client_profiles.profile_text` (intake header plus Resume, Writing samples, Extra context sections) and `profile_structured` via `buildProfileStructuredForJobFit` (approx. 521). Saves through RPC `intake_upsert_with_targeting` (`supabase/migrations/20260512_intake_upsert_with_targeting.sql`). Inserts a default `client_personas` row (approx. 876-900). |
| Resume text storage | BUILT AND FUNCTIONING | `client_personas.resume_text` (canonical), `client_profiles.resume_text` (legacy fallback), `client_profiles.profile_text` (header; historically embedded the resume) | Free text only. No structured sections, no file, no text history. |
| Personas (resume variants) | BUILT AND FUNCTIONING | Table `client_personas` (`supabase/migrations/20260403_dashboard_personas.sql`, `20260507_profile_personas_pilot.sql`); routes `app/api/personas/route.ts`, `app/api/personas/[id]/route.ts`, `app/api/coach/clients/[clientId]/personas/*`; UI `app/dashboard/coach/clients/[clientId]/ProfilePersonasTab.tsx` | Columns: `id, profile_id, name (default 'My Resume'), resume_text, is_default, display_order, persona_version`, timestamps. Max 10 per profile. `persona_version` is an integer counter only. |
| Persona/resume resolution | BUILT AND FUNCTIONING (duplicated) | `app/api/_lib/authProfile.ts` `resolveResumeText` (approx. 90), `getProfileTextById` (192), `getAuthedProfileText` (218); `app/api/_lib/runJobFitForProfile.ts` `assembleProfileForScoring` (approx. 194-261) | Order: explicit persona, then default persona, then `client_profiles.resume_text`. Two parallel resolvers implement the same rule. |
| JobFit profile extraction | BUILT AND FUNCTIONING | `app/api/jobfit/extract.ts`: `extractProfileSignals` (approx. 5102), `inferYearsExperienceApprox` (approx. 3394), `extractProfessionalExperienceText` (approx. 3274) | Heuristic. Copies of the professional-experience parser also in `app/api/profile-intake/route.ts` (approx. 246) and `lib/coherence/resumeSegmentation.ts`. |
| LLM resume evidence extractor | BUILT AND FUNCTIONING | `app/api/jobfit/llmResumeExtractor.ts` (Haiku, approx. 259; `resolveResumeEvidence` approx. 320), called from `app/api/_lib/jobfitEvaluator.ts` (approx. 311) | Falls back to regex extraction on failure. Output lives inside `jobfit_runs.result_json`. |
| Resume coherence across lanes | BUILT BUT INCOMPLETE (DORMANT) | `lib/coherence/*` | Gated by `COHERENCE_TRIAL_ENABLED=1`; flag set in any environment is UNKNOWN OR NOT VERIFIED (not found in repo). Imported only by `jobfit-run-trial-open`. |
| Graduation date extraction | BUILT AND FUNCTIONING | `lib/resume/extractGraduationDate.ts` | Only file in `lib/resume`. Haiku temp 0. Used by cover letter and networking generation. |
| Positioning (resume bullet suggestions) | BUILT AND FUNCTIONING | `app/api/positioning/route.ts` | Inputs: persona resume, `profile_text` header, JD, JobFit result. Model OpenAI `gpt-4.1-mini` (line 725). Prompts inline (approx. 480-600). Outputs `resume_bullet_edits` BEFORE/AFTER (BEFORE must match a verbatim resume bullet, else dropped, approx. 279-314), summary statement, role angle, keyword coverage. Stored in `positioning_runs` (approx. 899). **Suggestions only; never written back to the resume.** |
| Cover letter | BUILT AND FUNCTIONING | `app/api/coverletter/route.ts` | Inputs: persona resume, writing sample, JobFit and Positioning results, graduation date. Model `gpt-4.1-mini` (line 661). Prompt inline. Stored in `coverletter_runs`. |
| Interview prep use of resume | BUILT AND FUNCTIONING | `lib/interviewPrep/source.ts` | Uses resume evidence from `jobfit_runs.result_json`, tagged `source: "resume" or "analysis"`. Does not read personas or workbooks directly. |
| Resume Rx (guided resume rebuild) | REMOVED (2026-08-27) | Schema: `supabase/migrations/20260412_resume_rx_sessions.sql`; removal noted in `docs/API.md` (approx. 382-387), `docs/DATABASE.md` (approx. 182, 648) | Stages diagnosis, education, architecture, qa, validation, complete. Columns include `original_resume_text, mode, year_in_school, target_field, source_persona_id, diagnosis, education_intake, architecture, qa_items, approved_bullets, validation_result, coaching_summary, final_resume_text, pdf_url`. Only `app/api/account/delete/route.ts` (approx. 111-115) still touches the table. |
| Resume critique | DESIGNED OR DOCUMENTED NOT IMPLEMENTED | `app/api/_lib/resumeCritiqueEvaluator.ts` | Placeholder stub returning hard-coded notes. No route calls `runResumeCritique`. |
| Resume editing, document generation, templates, export | Not present | None found | No resume DOCX/PDF generation, no Google Doc creation, no ATS check code. |
| Resume version history (text) | Not present | None found | Only integer counters `persona_version`, `profile_version`. `jobfit_runs` stamps `persona_id, persona_version_at_run, profile_version_at_run`, but old text cannot be recovered. |
| Client review / approval of a resume | DESIGNED OR DOCUMENTED NOT IMPLEMENTED (as a resume feature) | Seed task "Approve final resume" in `tests/package-seed/seed.ts`; generic activity `is_signoff` (`supabase/migrations/20260808_engagement_activity_editing.sql`) | Approval is a generic plan task (owner client, state done). No document-level approve, comment, or diff. Comment threads exist only for workbooks (`workbook_comments`). |
| Accomplishment capture | BUILT AND FUNCTIONING (for interviewing only) | Workbooks: `supabase/migrations/20260921_workbooks_v1.sql`; templates `lib/workbook/templates/session-1-foundations.json` ("Walk Me Through Your Resume", keys `resume.anchor`, `resume.sub1-3`), `lib/workbook/templates/session-2-telling-your-stories.json` (STAR+E stories `s2.story1`-`s2.story8`, "accomplishment you are proudest of") | No dedicated accomplishment store. See section 4.1. |
| Proof Project | BUILT AND FUNCTIONING (not resume related) | `lib/proofProject.ts` | `speaking_point`, `why_this_matters` per deliverable. Reward framing, not accomplishment capture. |
| Prospect resume signals | BUILT AND FUNCTIONING | `supabase/migrations/20261002_prospect_phase1.sql` (approx. 90, 103) | `material_resume` ('have', 'needs_work', 'none'); service interest `resume_cover_letter`. Sales triage only. |
| Network profile resume link | BUILT (usage of seed column UNKNOWN OR NOT VERIFIED) | `network_client_profile.resume_link`, `resume_seed_attempted_at` (migrations 20260723, 20260728) | `resume_seed_attempted_at` not referenced in `app/`. |
| Recommended action "tailor_resume" | BUILT AND FUNCTIONING (label only) | `supabase/migrations/20260622_*` | An enum value for application recommendations. |

### 2.2 Resume deliverables in the package library

Source: `tests/package-seed/seed.ts` (generated from `docs/WRN_SIGNAL_Package_Seed.xlsx`), imported by `tests/package-seed/import-packages.ts`. Status: BUILT AND FUNCTIONING as data. Whether it is loaded in prod is UNKNOWN OR NOT VERIFIED from code (memory notes say it was imported; not checked here).

| Deliverable (phase Build) | Task | Owner | Details text |
|---|---|---|---|
| Resume Workshop (approx. line 80) | Book Resume Workshop | client | Upload instructions are in the welcome email |
| | Prepare for Resume Workshop | coach | Review current resume, background, Decode paths |
| | Run Resume Workshop | coach | Define job paths together, confirm paths in writing |
| Resume (approx. line 107) | Draft resume | coach | Full rebuild line by line, variations by path, ATS structure check on all versions |
| | Review draft and book Finalize session | client | |
| | Prepare for Finalize session | coach | |
| | Run Resume Review/Finalize session | coach | |
| | Approve final resume | client | Client sign-off in Coaches Hub |

Packages that include both: Know Where to Aim, Run the Search, All the Way Through, Resume Rebuild (a la carte), Foundations (seed approx. 488-545). Related: `docs/WRN_SOW_Text.md` (approx. 34-39), `docs/WRN_Welcome_Emails.md` (approx. 42-70, client uploads resume to the Drive "Resume" folder), welcome start key `resume_workshop` (`lib/welcome/model.ts`), Calendly event to deliverable mapping (`supabase/migrations/20261014_calendly_sessions.sql`).

### 2.3 Google Drive workspace

| Item | Status | Location |
|---|---|---|
| Drive client (service account, Shared Drive) | BUILT AND FUNCTIONING | `lib/drive/client.ts` (find, create folder, share, PDF create/update) |
| Client workspace folder with subfolders Resume, Cover Letter, LinkedIn, Networking, Interviewing, DNA, Toolkit | BUILT AND FUNCTIONING | `lib/sow/workspace.ts` (line 19); stored on `coach_clients.workspace_folder_id/_url`; Networking subfolder on `coach_clients.drive_folder_id/_url` |
| Google Docs creation, resume templates | Not present | None found |
| Coach document library (links to Drive files) | BUILT AND FUNCTIONING | `supabase/migrations/20260606_coach_client_library.sql`: `coach_document_categories` (default category "Resume", `app/api/coach/document-categories/route.ts` approx. 31), `coach_client_documents(coach_client_id, client_profile_id, category_id, activity_id, title, url, visible_to_client)`; UI `LibraryTab.tsx`; helper `app/api/_lib/coachClientDocuments.ts` |

### 2.4 AI models touching resume text

| Use | Model | Location |
|---|---|---|
| PDF resume text extraction | `claude-haiku-4-5-20251001` | `app/api/resume-upload/route.ts` |
| JobFit resume evidence | Haiku | `app/api/jobfit/llmResumeExtractor.ts` |
| Graduation date | Haiku | `lib/resume/extractGraduationDate.ts` |
| Positioning, Cover Letter | OpenAI `gpt-4.1-mini` | `app/api/positioning/route.ts`, `app/api/coverletter/route.ts` |
| JobFit WHY/RISK bullets | `claude-sonnet-4-5` / Haiku | `app/api/jobfit/bulletGeneratorV5.ts` |
| Brief prefill from `profile_text` | `claude-opus-5` | `lib/briefs/prefill.ts` |
| Interview prep | Haiku via `invokeClaude` | `lib/ai/anthropicClient.ts` (`MODEL` approx. 42) |

The shared wrapper `lib/ai/anthropicClient.ts` is not used consistently; many routes call providers directly, and both Anthropic and OpenAI are in use.

---

## 3. Scope 2: Service entry points and independence

### 3.1 Commercial structure (packages vs a la carte)

| Concept | Status | Location | Notes |
|---|---|---|---|
| Coach library: deliverables, tasks, packages, phases | BUILT AND FUNCTIONING | `coach_milestones`, `coach_milestone_activities`, `coach_packages` (`20260604_coach_packages.sql`), `coach_package_milestones`, `coach_phases` (`20261004_client_phases.sql`) | All keyed by `coach_profile_id`. `coach_packages` has **no kind column**; "a la carte" vs "bundle" exists only in the seed sheet. |
| Client engagements (snapshot copies of a package) | BUILT AND FUNCTIONING | `coach_client_engagements` (`20260605_coach_client_engagements.sql`, `proposal_status` draft/sent/approved/declined), `coach_client_engagement_deliverables`, `coach_client_engagement_activities` | Attach via RPC `attach_package_to_engagement` (latest in `20261015_task_details.sql`), called from `app/api/coach/coach-clients/[id]/engagements/route.ts` (approx. 83). |
| Multiple engagements per client | BUILT AND FUNCTIONING | No unique constraint on `coach_client_id`; `getPlan` (`lib/plan/service.ts` approx. 95) unions all approved engagements | Supports buying more services later. |
| Add a single deliverable later | BUILT AND FUNCTIONING | `addDeliverableFromLibrary` (`lib/plan/service.ts` approx. 679-715) via POST `app/api/coach/coach-clients/[id]/plan/route.ts` (`action: add_deliverable`) | Must go into an **existing** engagement (declined returns 409). A standalone a la carte sale is modelled as a one-deliverable package. Sibling ops: `addTask`, `removeTask`, `removeDeliverable`, `setDeliverableNeeded`, `reorderTasks`. |
| SOW and acceptance | BUILT AND FUNCTIONING | `client_sows` (`20261009_client_sows.sql`, `20261011_sow_send.sql`), `lib/sow/accept.ts` (approx. 44, 86-87), `app/api/public/sow/[token]/accept` | One SOW per engagement. Acceptance approves the engagement, activates the plan, creates the Drive workspace, releases the welcome task. |

### 3.2 Entitlements

| Mechanism | Status | Location | What it grants |
|---|---|---|---|
| `client_profiles.active` | BUILT AND FUNCTIONING | Set by Stripe webhook `app/api/webhooks/stripe/route.ts` (approx. 125-235; refund approx. 339-390) and RevenueCat `app/api/iap/revenuecat-webhook/route.ts` (approx. 113-175; refund approx. 301) | Single all-access product (`NEXT_PUBLIC_STRIPE_PRICE_ID`, `app/api/checkout/create-session/route.ts`). |
| Enforcement of `active` | BUILT BUT INCOMPLETE | Only `app/api/auth/send-link/route.ts` (approx. 49-65) | Service routes (JobFit, Positioning, Cover Letter, Networking) do not check `active` or purchases (verified by grep on those route files). `app/api/_lib/authProfile.ts` (approx. 248) creates a profile on demand for any authenticated user. A refunded user with a live session is not blocked. |
| Coach-created clients | BUILT AND FUNCTIONING | `app/api/coach/create-client/route.ts` (approx. 206-207) | `active: true`, `profile_complete: true` free. Coach seat cap `client_profiles.client_seat_cap` (`20260622_coach_seat_cap.sql`), checked approx. line 72. |
| Seats (GHL claim tokens) | BUILT (legacy, mode-dependent) | `app/api/seat-create`, `app/api/seat-verify`, `app/api/send-magic-link`, table `signal_seats`, env `SIGNAL_ENTRY_MODE` | Same all-access entry. |
| Full access lookup | BUILT AND FUNCTIONING (weak) | `app/api/full-access-lookup/route.ts` (approx. 41-55) | Checks profile existence by email, not `active`. |
| JobFit trial | BUILT AND FUNCTIONING | `jobfit-run-trial` (`jobfit_users.credits_remaining`, `jobfit_trial_runs`); `jobfit-run-trial-open` (IP rate limit, `jobfit_anonymous_runs`) | `jobfit-trial-lookup`, `jobfit-intake` return 410 (frozen). |
| Per-service entitlement (for example "bought Resume only") | DESIGNED OR DOCUMENTED NOT IMPLEMENTED (not present at all) | None | Engagements and deliverables gate no features. |

### 3.3 What the coach relationship gates

`getActiveCoachRelationship` (`app/api/_lib/coachedClient.ts` lines 35-48) returns the first `coach_clients` row with `status='active'` ordered by `accepted_at`, `limit(1)` (comment: "one coach today"). `isCoached` is its boolean form.

| Caller | Effect |
|---|---|
| `app/api/me/activities/route.ts` (approx. 71) | Plan tasks; empty if not coached |
| `app/api/me/activities/[activity_id]/route.ts` (approx. 75) | 404 if not coached |
| `app/api/me/activity-notes/[id]/done/route.ts` (approx. 44) | Gated |
| `app/api/me/proof-project/route.ts` (approx. 86) | Gated |
| `app/api/me/welcome/route.ts` (approx. 32) | Coach card, phases |
| `app/api/profile/route.ts` (approx. 189) | Computed `coached` flag |
| `app/api/auth/send-link/route.ts` (approx. 85) | Coached clients land on `/dashboard/coaching-hub` |

Workbooks and practice rounds require a `coach_client_id`, so they are coach-only services.

### 3.4 Intake and reuse of existing client info

| Item | Status | Location |
|---|---|---|
| `profile_complete` (name, resume_text, target_roles, target_locations) | BUILT AND FUNCTIONING | Set in `app/api/profile-intake/route.ts` (approx. 795-852), recomputed in `app/api/profile/route.ts` (approx. 162) and persona routes; drives login redirect |
| "N fields left" dashboard hint | BUILT AND FUNCTIONING (display only) | `app/dashboard/dashboardState.ts` `profileCompletion()` (approx. 81), `app/dashboard/page.tsx` |
| Generic "collect only missing fields" per service | Not present | None |
| Reuse across services | BUILT AND FUNCTIONING | All services read the same `client_profiles` row plus personas; nothing re-collects resume or targets |
| Contact/education fields | BUILT, duplicated | `client_profiles` (phone, linkedin_url, education_status, university, grad_date; `20260622_client_profiles_intake_fields.sql`) and the same fields on `coach_clients` as prospect fields |
| Welcome flow | BUILT AND FUNCTIONING | `lib/welcome/*` (templates, start keys including `resume_workshop` and `dna`), `app/dashboard/welcome/page.tsx`; not an intake form |

### 3.5 Service independence

| Service | Entry | Prerequisites found |
|---|---|---|
| JobFit | `app/api/jobfit` | Resume text (any persona or fallback) |
| Positioning | `app/api/positioning` | Soft: uses JobFit result if available (`app/api/_lib/runSubject.ts` approx. 56-97) |
| Cover letter | `app/api/coverletter` | Soft: uses JobFit and Positioning if available |
| Networking | `app/api/networking`, `app/api/network/*` | None hard |
| Interviews / prep | `app/api/interviews`, `lib/interviewPrep` | Prep reads a JobFit run |
| Lanes | `app/api/lanes`, `search_lanes` | None hard |
| Workbooks, Practice | coach routes | Active coach relationship (`coach_client_id`) |
| Plan deliverables (incl. Resume Workshop) | coach plan routes | A coach relationship and an engagement |
| DNA | Outside SIGNAL | PLANNED (`docs/signal-dna-site-and-integration-options.md`, `docs/professional-dna/*`) |

No hard prerequisite on DNA, Positioning, or a Resume Workshop was found anywhere. A Resume Workshop integration should not introduce one.

### 3.6 Continuity when a client changes coaches

`coach_clients` has UNIQUE(`coach_profile_id`, `client_profile_id`) (`20260413_coach_client_system.sql`), so a client can hold rows for several coaches, but code assumes one active. Delegates (`20260923_coach_delegates.sql`, `coach_acting_ids()`, `lib/collab/delegation.ts`) let a delegate act as the principal: BUILT AND FUNCTIONING. No coach-transfer mechanism exists: UNKNOWN OR NOT VERIFIED as a design, not implemented in code.

| Follows the client (keyed by `client_profile_id`) | Stays with the relationship (keyed by `coach_client_id`, CASCADE on delete) |
|---|---|
| Profile, resume text, personas, targeting | Engagements, deliverables, tasks, SOWs |
| JobFit, Positioning, Cover Letter runs | `client_phase_status`, `coach_client_events` |
| Applications (`signal_applications`), status history | `coach_client_notes`, `coach_client_documents` |
| `network_companies`, `network_contacts`, `search_lanes` | Workbooks (and their story answers), practice rounds |
| `coach_annotations` (also carries `coach_profile_id`) | Networking briefs, plan sources, plan jobs |
| | `coach_job_recommendations`, Drive workspace folder ids |

`coach_tasks` is mixed (both keys; `coach_client_id` set NULL on delete). `client_profiles.history_boundary_at` (`app/api/_lib/clientHistoryBoundary.ts`) hides older rows from a returning client's own view only. Implication for resume work: anything stored per relationship (for example workbook stories, plan approvals, Drive documents) is lost to a new coach.

---

## 4. Scope 3: Data flow and reuse

### 4.1 Flow table

| Flow | Saved where | Readable by other modules? | Structure | History | Source/author | Resume reuse potential |
|---|---|---|---|---|---|---|
| Accomplishment described in interview prep workbook | `workbook_answers(workbook_id, field_key, value jsonb, updated_by_role, updated_by_id)` (`20260921_workbooks_v1.sql` approx. 68-78); template copy in `workbooks.content` | No. Only `loadAnswers()` (`lib/workbook/server.ts` approx. 69), called by `app/api/me/workbooks/[workbookId]/route.ts` and `app/api/coach/clients/[clientId]/workbooks/[workbookId]/route.ts` | Semi-structured: STAR keys `<key>.s/.t/.a/.r/.reflection` (`lib/workbook/content.ts` approx. 181), STAR+E (approx. 212-222); keys are template-specific | Yes: `workbook_answer_history` filled by trigger `wb_answers_history`, with `source 'typed' or 'accepted_suggestion'` | Yes (`updated_by_role/_id`, `changed_by_*`); coach suggestions in `workbook_comments` | High, but needs a per-template key-to-story extractor and is keyed by `coach_client_id` |
| Interview prep generation | `interview_prep_runs(interview_id, profile_id, jobfit_run_id, content_hash, generated jsonb, checklist_state)` (`20260805_interview_prep_schema.sql` approx. 119-127) | Readable but not consumed elsewhere | Structured JSON | No; regenerated in place (`app/api/interviews/[id]/prep/generate/route.ts` approx. 191) | Evidence tagged resume vs analysis; no author | Low; it is derived from JobFit, not new client facts |
| Practice rounds | `practice_rounds`, `practice_questions`, `practice_takes` (video, bucket `practice-takes`); `lib/practice/server.ts` | No | Video plus free-text coach feedback | Per take | Coach | None without transcripts |
| Interview notes | `signal_interviews.notes` | Via interviews API | Free text | No | No | Low |
| Profile/resume text into JobFit | Read from `client_profiles` + `client_personas` (`app/api/_lib/runJobFitForProfile.ts`); written to `jobfit_runs` with `persona_id, persona_version_at_run, profile_version_at_run` (`app/api/jobfit/route.ts` approx. 439-450) | Yes, `jobfit_runs.result_json` read by Interview Prep, Positioning, Cover Letter, Applications | Free-text input; structured output | Runs kept; input text not snapshotted | Persona id; `sourced_by_coach_id` for coach runs | Medium: evidence extraction reusable for gap analysis |
| Profile/resume text into Positioning | `resolveRunSubject` (`app/api/_lib/runSubject.ts` approx. 40) then `getProfileTextById`; output `positioning_runs(result_json, jobfit_run_id, created_by_role/_id)` | Yes, by Cover Letter | Structured JSON (bullet BEFORE/AFTER) | Runs kept | `createdBy(scope)` | High: bullet edits are per-job resume suggestions, never applied |
| JobFit runs into tracker | `signal_applications` auto-created inline in `app/api/jobfit/route.ts` (cache-hit approx. 323-376, fresh approx. 536-612); match on profile + ILIKE company + title; backlink `jobfit_runs.application_id`; `signal_applications_status_history` (`app/api/_lib/applicationStatusHistory.ts`) | Yes, `app/api/applications/route.ts` (approx. 146) | Structured | Status history only; re-score overwrites `jobfit_run_id` | `changed_by` | Low |
| Coach job recommendation | `app/api/coach/recommend-job/route.ts` (approx. 205-275): `jobfit_runs`, `coach_job_recommendations`, `signal_applications` | Yes | Structured | Status history | Coach | Low |
| Networking brief into plan document | Brief: `networking_campaign_briefs` (`lib/briefs/model.ts` approx. 28-56), prefilled from `client_profiles`, AI suggestions via `claude-opus-5` (`lib/briefs/prefill.ts`). Plan PDF built only from uploaded spreadsheet rows in `networking_plan_sources.rows` (`app/api/network/plan/run/route.ts` approx. 96; `lib/networking-plan/planData.ts` approx. 67; `render.ts`, `pdf.ts`), uploaded to Drive, recorded in `coach_client_documents` | Brief linked only by `brief_id` for automation context (`lib/briefs/resolve.ts`) | Brief structured; plan rows tabular | Brief is a snapshot; plan source overwritten | `submitted_by_id`, `created_by_id` | Medium: brief roles/goals overlap with resume targeting; nothing writes back to profile |
| Coach notes visible to client | Four systems: `coach_client_notes` (coach-private by RLS, `20260509_coach_client_notes_typed.sql`); `coaching_notes` (`visibility 'private' or 'shared'`, `20260722_coaching_notes.sql`, read via `app/api/notes/applications/[applicationId]/route.ts`); `coach_annotations.visible_to_client` (read in `app/api/applications/route.ts` approx. 164-169); `coach_notes` (legacy, no readers found) | Partially | Free text | No edit history | Author role recorded on `coaching_notes` | Low; a resume feedback channel would need its own or one of these |
| Plan task details | `details TEXT` (max 2000) on `coach_milestone_activities` and `coach_client_engagement_activities` (`20261015_task_details.sql`); copied on attach; `normalizeDetails` (`lib/plan/model.ts`); writer `updateTaskDetails` (`lib/plan/service.ts` approx. 540); surfaced on `coach_tasks` via `withPlanDetails` (`lib/plan/todo.ts`); UI `app/components/TaskDetails.tsx` | Yes, Plan, To-Do, Coaching Hub (client tasks) | Free text, one checklist line per row | Event logged (`plan_changed/task_details`) without old/new text | Event actor | Low; no per-item checked state |
| SOW | `client_sows` (opening, price override, payment jsonb, status, `sent_snapshot`, `accepted_name`) plus `coach_sow_lines`, `coach_sow_settings`, `coach_milestones.sow_bullets`, `coach_phases.sow_subtitle/sow_note`; client info from `coach_clients` falling back to `client_profiles` (`lib/sow/client.ts` approx. 82-130) | SOW only | Structured | Frozen `sent_snapshot`; draft edited in place | `sent_by`, `updated_by` | None (no resume content) |

### 4.2 Shared services that support reuse

| Purpose | Helper | Location |
|---|---|---|
| Actor and scope (client vs coach acting for client) | `resolveActor`, `resolveScope`, `createdBy`, `editedBy`, `authorRole` | `lib/collab/scope.ts` |
| Identity | `getProfileId`, `getProfileRow`, `resolveCaller` | `lib/collab/identity.ts` |
| Coach access | `verifyCoachAccess`; delegation | `lib/collab/access.ts`, `lib/collab/delegation.ts` |
| Resume/profile text | `getAuthedProfileText`, `getProfileTextById`, `resolveResumeText`; `resolveRunSubject`; `assembleProfileForScoring` | `app/api/_lib/authProfile.ts`, `app/api/_lib/runSubject.ts`, `app/api/_lib/runJobFitForProfile.ts` |
| Coach relationship | `getActiveCoachRelationship`, `isCoached` | `app/api/_lib/coachedClient.ts` |
| Plan | `getPlan`, `addDeliverableFromLibrary`, `addTask`, `updateTaskDetails` | `lib/plan/service.ts` |
| Tasks | `createTask`, `setTaskStatus` | `lib/tasks/service.ts` |
| Events/history | `logCoachClientEvent`, `logProspectEvent` | `app/api/_lib/coachClientEvents.ts`, `lib/prospects/history` |
| Documents | coach client documents helper | `app/api/_lib/coachClientDocuments.ts` |
| Drive | Drive client, workspace creation | `lib/drive/client.ts`, `lib/sow/workspace.ts` |
| AI | `invokeClaude` (Haiku), cost policy | `lib/ai/anthropicClient.ts`, `lib/ai/costPolicy.ts` |
| Applications | `findOrCreateSignalApplication` (**unused**; logic duplicated inline 3 times) | `lib/signalApplications.ts` (approx. 95) |
| UI | Only `TaskDetails`, `Analytics` shared components; no `hooks/` directory | `app/components/` |

### 4.3 Reuse gaps relevant to a Resume Workshop

| Gap | Impact |
|---|---|
| No central accomplishment or story store | STAR stories are trapped in `workbook_answers` under template keys; Positioning, Interview Prep, Networking and any resume work cannot read them |
| Resume is unstructured text with no history | No sections, bullets, or roles as data; cannot diff drafts or recover an earlier version |
| No resume document model | No link between a persona and a Drive file; documents are URL pointers in `coach_client_documents` |
| No document review/approval | "Approve final resume" is a generic task; no comments, suggestions, or sign-off on content |
| No per-service entitlement | Cannot restrict a resume-only buyer to resume features, nor block a non-buyer |
| Relationship-scoped data does not follow the client | Workbooks, plan approvals, Drive folders, notes are lost on coach change |
| Duplicated resolvers and parsers | Two persona resolvers; three copies of the professional-experience parser; three application-create paths |
| Missing structured profile fields | `client_profiles` targets are prose; no industries, education history or goals fields (`lib/briefs/prefill.ts` approx. 17-22) |
| Mixed AI providers and wrappers | Positioning and Cover Letter on OpenAI; Claude calls mostly bypass `invokeClaude` |
| Overwrite-in-place artifacts | `interview_prep_runs`, `networking_plan_sources`, SOW drafts keep no prior versions |
| Removed precedent | `resume_rx_sessions` schema and stage design exist but no code; decide reuse or drop |

---

## 5. Open questions

1. Should resume work produce a SIGNAL-native structured resume (sections, roles, bullets with history), or remain a Drive document with SIGNAL storing only the approved text into a persona?
2. Should workshop outputs (job paths "confirmed in writing") write to `client_profiles.target_roles` / personas, or stay in plan task details?
3. Is `resume_rx_sessions` to be revived, migrated, or dropped?
4. Should accomplishments be promoted from workbook answers into a client-keyed store (surviving coach changes) with source and author?
5. Is per-service entitlement wanted, and should it derive from approved engagements or from Stripe/IAP products?
6. Is the missing `active` check on service routes intended (coach-led model) or a gap?
7. What should happen to relationship-scoped data on a coach change?
8. Live DB state (applied migrations, presence of seed library, `COHERENCE_TRIAL_ENABLED`) needs verification against dev and prod.
