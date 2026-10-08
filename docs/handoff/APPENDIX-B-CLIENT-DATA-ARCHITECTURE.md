# Appendix B: Client Data Architecture

Audit date: 2026-10-07. Branch `dev` (HEAD `f67e24a9`). Read-only audit.

## 0. How to read this appendix

**Source of truth for this inventory: `supabase/migrations/*.sql` (152 files, read in order) plus the code in `app/api/` and `lib/` that reads or writes each table.** The live databases were NOT inspected. Dev and prod can and do drift:

- The two baseline migrations (`supabase/migrations/20260206165724_remote_schema.sql`, `20260206190000_prod_schema.sql`) are **0-byte files**. Every table that predates 2026-04-03 (`client_profiles`, `jobfit_runs`, `positioning_runs`, `coverletter_runs`, `networking_runs`, `signal_seats`, `jobfit_users`, `jobfit_profiles`, `pending_profiles`, `user_profiles`, `job_analysis_cache`, `signal_attribution`, `qa_*`) was created in the Supabase console and is not represented in migrations. `docs/DATABASE.md` (section "Migrations") says the same.
- For those pre-migration tables the best available column list is `prod_public_schema.sql` at the repo root: a pg_dump, gitignored (`.gitignore:29`), file date 2026-05-03. It is stale for anything added after May.
- `docs/DATABASE.md` (last commit 2026-08-30) documents the early schema but stops covering most tables added from June onward.
- Prod migration drift is a known, recurring failure mode. The user's Claude memory note `project_prod_migration_queue.md` (outside the repo, at `C:\Users\perig\.claude\projects\C--Users-perig-wrnsignal-api\memory\`) records migrations applied to dev and deliberately held from prod, and the 5aa29cd5 outage where deployed code wrote columns prod lacked. As of that note: `20260919_postings_enrichment`, `20260919_postings_function_trading`, `20260920_fingerprint_location_count` were dev-only; `20261004`/`05`/`06` were applied to prod 2026-10-04. **Migrations `20261008` through `20261015` (SOW text, client SOWs, SOW settings, SOW send, Let's Go, welcome templates, Calendly sessions, task details) have no recorded prod status in any repo doc: UNKNOWN OR NOT VERIFIED for prod.** `docs/prod-promotion-2026-08.md` records the 2026-08-10 bundle promotion (`supabase/migrations/_bundles/2026-08-prod-promotion.sql`).

### Status labels

| Label | Meaning here |
|---|---|
| BUILT AND FUNCTIONING | Table exists in migrations AND live code both writes and reads it |
| BUILT BUT INCOMPLETE | Exists and is used, but has known gaps, stalled writers, dormant halves, or duplication |
| DESIGNED OR DOCUMENTED NOT IMPLEMENTED | Spec or doc exists, no table or code |
| PLANNED | Named as future work only |
| UNKNOWN OR NOT VERIFIED | Cannot be confirmed from repo (usually prod state) |
| DORMANT | (sub-case of INCOMPLETE) table exists, no code path reads or writes it |

### Access-control model (applies to every table below)

- **All server data access uses the Supabase service-role key**, which bypasses RLS. The shared helper is `getSupabaseAdmin()` in `lib/collab/identity.ts`; many routes still carry inline copies (e.g. `app/api/profile/route.ts`, `app/api/resume-upload/route.ts`).
- The dashboard browser client (`lib/supabase-browser.ts`) is used for auth only. No `.from('<table>')` calls were found in `app/dashboard`, `components`, `framer`, or `signal-mobile` source (excluding node_modules).
- Authorization is therefore enforced in code: caller resolution `lib/collab/identity.ts` (JWT, then `auth.users.id`, then `client_profiles` row, with a guarded email fall-through), coach relationship check `lib/collab/access.ts` (`verifyCoachAccess`: `coach_clients` row with `status='active'` and `access_level` in view < annotate < full, delegate-aware), subject scoping `lib/collab/scope.ts` (branded `SubjectId`), delegation `lib/collab/delegation.ts`, lane access `lib/collab/laneAccess.ts`, task scoping `lib/tasks/scope.ts`.
- RLS, where present, is defense in depth against a leaked anon/authenticated key. Many newer tables enable RLS with **no policies** (deny-all to non-service roles), which is the intended "service-role only" pattern. Core tables such as `client_profiles`, `client_personas`, `jobfit_runs`, `signal_applications`, and all engagement/plan tables have **no RLS in any migration** (and none in the May snapshot for the pre-migration tables). Whether live grants expose them to `anon` is UNKNOWN OR NOT VERIFIED.
- Helper SQL functions: `public.current_profile_id()` (`20260922_security_coach_clients_signal_interviews.sql`), `public.coach_acting_ids()` and `wb_is_full_coach()` (`20260923_coach_delegates.sql`).

---

## 1. Clients and profiles

| Table | Purpose | Key columns | FKs | Writers | Readers | Access control | Status |
|---|---|---|---|---|---|---|---|
| `client_profiles` | One row per SIGNAL login: client, coach, and coach-created client accounts. The de facto person record. | `id`, `user_id` (auth, unique), `email` (unique), `name`, `job_type`, `target_roles` (prose text), `target_locations`, `preferred_locations`, `timeline`, `resume_text`, `profile_text` (canonical text fed to scoring, NOT NULL), `profile_structured` (jsonb), `risk_overrides` (jsonb), `profile_version`, `profile_complete`, `active`, `is_coach`, `coach_org`, `client_seat_cap`, `coach_notes_avoid/strengths/concerns`, `phone`, `linkedin_url`, `education_status`, `university`, `grad_date`, `target_industries`/`excluded_industries` (jsonb arrays), `history_boundary_at`, Stripe fields (`stripe_customer_id`, `purchase_date`, `stripe_payment_intent_id`, `stripe_charge_id`, `refunded_at`), IAP fields (`apple_transaction_id`, `revenuecat_app_user_id`, `iap_purchased_at`) | none outbound | `app/api/profile/route.ts` (PUT, bumps `profile_version`, rebuilds `profile_text`), `app/api/profile-intake/route.ts` via RPC `intake_upsert_with_targeting`, `app/api/_lib/authProfile.ts`, `lib/collab/identity.ts` (claims unowned row), `app/api/coach/create-client`, `.../coach-clients/[id]/send-invite`, `.../setup-account`, `app/api/coach/clients/[clientId]/profile`, `app/api/profile-risk-overrides`, `app/api/webhooks/stripe`, `app/api/stripe/refund`, `app/api/iap/revenuecat-webhook`, `app/api/account/delete` | ~70 files (see section 9) | No RLS. Service role + `resolveCaller` / `verifyCoachAccess` | BUILT AND FUNCTIONING (columns pre-2026-04 not in migrations; see `prod_public_schema.sql`) |
| `client_personas` | Resume variants per profile (app caps at 2). | `profile_id`, `name`, `resume_text`, `is_default`, `display_order`, `persona_version`, `archived_at` | `profile_id` to `client_profiles` CASCADE | `app/api/personas/*`, `app/api/coach/clients/[clientId]/personas/*`, `app/api/profile-intake`, `app/api/profile` (sync), create-client / send-invite / setup-account | `app/api/_lib/authProfile.ts`, `app/api/_lib/runJobFitForProfile.ts`, profile routes | No RLS | BUILT AND FUNCTIONING (`20260403_dashboard_personas.sql`, `20260507_profile_personas_pilot.sql`) |
| `candidate_targeting` | Structured lane/career-stage targeting, one per profile. | `primary_lane` (12-value enum), sublanes, two secondary lanes, `career_stage` (student/early/mid/executive), `career_stage_locked_by` (intake/inferred/manual_override), `status_premed/prelaw/pregrad`, `source` (intake/migration/manual_update) | `profile_id` UNIQUE to `client_profiles` | RPC `intake_upsert_with_targeting` (`20260512_intake_upsert_with_targeting.sql`) from `app/api/profile-intake`; `lib/candidateTargeting.ts` | `lib/candidateTargeting.ts` (falls back to deriving from `profile_structured.intakeMeta`), `app/api/coverletter`, `app/api/networking`, `app/api/lanes/propose` | No RLS | BUILT BUT INCOMPLETE: only populated through the intake RPC path; the dashboard profile PUT does not write it |
| `profile_structured` (jsonb on `client_profiles`) | Heuristic parse of intake for JobFit. | Shape from `buildProfileStructuredForJobFit` in `app/api/profile-intake/route.ts:521`: `tools[]` (extracted from resume), `gradYear`, `yearsExperienceApprox`, `targetFamilies`, `statedInterests`, `locationPreference`, `constraints` (hard-nos), `intakeMeta` (status, university, major, timeline) | n/a | profile-intake only | `app/api/_lib/authProfile.ts`, `runJobFitForProfile.ts`, `app/api/jobfit/evaluator.ts` | n/a | BUILT BUT INCOMPLETE: written only by intake, not refreshed by profile edits |
| `risk_overrides` (jsonb on `client_profiles`) | Per-profile JobFit risk overrides. | Shape defined in app code only (`docs/DATABASE.md` flags as NEEDS CLARIFICATION) | n/a | `app/api/profile-risk-overrides/route.ts` (merge), profile-intake | JobFit evaluator via profile | n/a | BUILT AND FUNCTIONING (shape undocumented) |
| `pending_profiles`, `user_profiles`, `client_profiles_backfill_snapshot_20260308` | Legacy / one-off. | see `docs/DATABASE.md` | n/a | none found | none found | `user_profiles` has RLS per snapshot | DORMANT (legacy) |
| `network_client_profile` | Networking merge variables (current role, school, degree, key_strength, elevator_pitch, resume_link). | one per profile | `client_profile_id` UNIQUE | none (routes deleted) | none | RLS owner policy | DORMANT: retired, "keeps its 15 rows, unread" (`app/dashboard/profile/page.tsx:36-39`) |

## 2. Coaches and relationships

| Table | Purpose | Key columns | FKs | Writers | Readers | Access control | Status |
|---|---|---|---|---|---|---|---|
| `coach_clients` | The coach to client relationship AND the prospect/CRM record. One row per (coach, client); prospects are rows with `client_profile_id` NULL. | `coach_profile_id`, `client_profile_id` (nullable), `status` (pending/active/paused/revoked), `access_level` (view/annotate/full), `invited_email`, `invite_token`, `invited_at`, `accepted_at`, `private_notes`, `last_viewed_at`, `lifecycle_status` (Prospect/Active/Inactive/Archived), prospect fields (`name`, `phone`, `linkedin_url`, `current_title`, `current_company`, `location`, `education_status`, `university`, `field_of_study`, `grad_date`, `years_experience_approx`, `job_type`, `target_roles`, `target_locations`, `preferred_locations`, `timeline`, `tags`, `target_industries` TEXT), source (`source_category`, `source_detail`, `referred_by_*`), parent (`parent_name/email/phone`), pipeline (`prospect_status`, `current_stage_key`, legacy `phase_*` booleans), loss (`lost_reason`, `lost_reason_detail`, `lost_notes`, `lost_at`), `is_returning`, `created_by`, Drive (`drive_folder_id/url`, `workspace_folder_id/url`), GHL (`ghl_contact_id`, `_name`, `_source`, `_resolved_at`) | both profile ids to `client_profiles` CASCADE; UNIQUE (coach, client) | `app/api/coach/create-client`, `coach/invite`, `coach/accept-invite`, `coach/prospects/*`, `coach/clients/[clientId]/*` (coaches, profile, send-invite), `coach/coach-clients/[id]/*` (drive-folder, ghl-contact, setup-account, send-invite), `lib/prospects/{workflow,stages,bookingForm}.ts`, `lib/calendly/webhook.ts`, `lib/sow/workspace.ts`, `lib/networking-plan/job.ts`, `lib/plan/service.ts` | ~60 files | RLS SELECT-only policy `coaches_see_own_clients` (rewritten in `20260922_*` and `20260923_coach_delegates.sql`); INSERT/UPDATE/DELETE revoked from anon/authenticated | BUILT AND FUNCTIONING. Note the prospect-field duplication of `client_profiles` |
| `coach_delegates` | Delegate coach acts inside a principal coach's practice. | `principal_coach_profile_id`, `delegate_coach_profile_id`, `status` | both to `client_profiles` | none in code (seeded manually; memory note says `erin+coach@` is the prod delegate) | `lib/collab/delegation.ts`, `lib/tasks/scope.ts`, `coach-clients/[id]/plan` | RLS SELECT for principal or delegate; writes revoked | BUILT AND FUNCTIONING (no admin UI for creating delegates) |
| `coach_client_events` | Per-relationship History log. | `coach_client_id`, `event_type` (49 types in `lib/coach/clientEventTypes.ts`, e.g. `prospect_created`, `converted_to_client`, `proposal_approved`, `sow_accepted`, `workspace_created`, `welcome_email_sent`, `task_completed`, `phase_status_changed`, `session_booked`), `actor_profile_id`, `context` jsonb | `coach_client_id` CASCADE | `app/api/_lib/coachClientEvents.ts`, `lib/prospects/history.ts` | same + `app/api/me/proof-project`, `lib/calendly/webhook.ts` | No RLS | BUILT AND FUNCTIONING (append-only by convention, not constraint) |
| `prospect_stage_progress`, `coach_pipeline_stages` | Configurable prospect pipeline and the timestamp a prospect reached each stage. | stage_key, label, sort_order, is_terminal; `reached_at` | `coach_client_id` CASCADE | `app/api/coach/pipeline` (seeds defaults on GET), `coach/prospects/[id]/stage`, `lib/prospects/stages.ts` | same | No RLS | BUILT BUT INCOMPLETE: backward moves deferred (memory `project_pipeline_followups.md`) |
| `prospect_consults` | Discovery consult record for a prospect. | `why_now`, `search_goal`, `services[]`, timeline fields, `tried_so_far`, `material_resume/linkedin/cover_letter`, `recommendation`, `outcome`, `minutes_logged` | PK `coach_client_id` | `lib/prospects/workflow.ts` | `coach/prospects/[id]` | RLS on, no policies | BUILT AND FUNCTIONING (applied to prod 2026-10-02 per memory) |
| `coach_engagement_signal_dismissals`, `coach_preferences`, `coach_calendar_connections` | Coach-side settings. | | coach profile | dismiss/restore routes; calendar callback/disconnect/today | `app/api/_lib/coachEngagementHeuristics.ts` | calendar has owner RLS | dismissals and calendar BUILT; `coach_preferences` DORMANT (no code hits) |

## 3. Engagements, packages, services, entitlements

### 3a. Coach library (templates)

| Table | Purpose | Key columns | Writers | Readers | Status |
|---|---|---|---|---|---|
| `coach_phases` | Coach's phase list (seeded Know, Build, Prove, Search, Land). | `phase_key`, `label`, `sort_order`, `sow_subtitle`, `sow_note` | `lib/phases/service.ts` | `lib/plan/home.ts`, `lib/sow/*`, `lib/welcome/service.ts` | BUILT AND FUNCTIONING (`20261004_client_phases.sql`) |
| `coach_milestones` | Library deliverables. | `name`, `description`, `category`, `time_estimate_days`, `fee_cents`, `phase_id`, `sow_bullets` | `app/api/coach/milestones/*` | `_lib/coachPackages.ts`, `_lib/coachActivities.ts`, `lib/plan/service.ts`, `lib/sow/client.ts` | BUILT AND FUNCTIONING |
| `coach_milestone_activities` | Library tasks under a deliverable. | `name`, `owner` (coach/client; 'both' removed in `20261005_plan_tasks.sql`), `sort_order`, `details` | `app/api/coach/milestones/[id]/activities/*`, `lib/plan/service.ts` | milestones routes | BUILT AND FUNCTIONING |
| `coach_packages`, `coach_package_milestones` | Packages bundle milestones. | `discount_cents`, `default_payment` jsonb | `app/api/coach/packages/*` | `_lib/coachPackages.ts`, `lib/prospects/workflow.ts`, `lib/sow/client.ts` | BUILT AND FUNCTIONING. Package seed loaded dev+prod 2026-10-04 per memory `project_package_seed.md` |
| `coach_sow_lines`, `coach_sow_settings`, `coach_welcome_templates` | SOW boilerplate lines, default SOW opening, four welcome email templates (`start_key` in dna/resume_workshop/search/land). | | `lib/sow/service.ts`, `lib/welcome/service.ts` | same | BUILT; prod UNKNOWN OR NOT VERIFIED |

All library tables: no RLS except `coach_sow_*` and `coach_welcome_templates` (RLS on, no policies). Scoped by `coach_profile_id` in code.

### 3b. Per-client plan (instances copied from the library)

| Table | Purpose | Key columns | FKs | Writers | Readers | Status |
|---|---|---|---|---|---|---|
| `coach_client_engagements` | A package attached to a relationship. | `name`, `discount_cents`, `proposal_status` (draft/sent/approved/declined), `is_proof_project`, `source_package_id` (provenance) | `coach_client_id` CASCADE | RPC `attach_package_to_engagement` (called from `app/api/coach/coach-clients/[id]/engagements/route.ts:83`, `lib/prospects/workflow.ts:599`), `lib/plan/todo.ts`, `lib/sow/accept.ts`, `lib/sow/send.ts` | `_lib/coachEngagements.ts`, `lib/plan/*`, `app/api/me/*` | BUILT AND FUNCTIONING |
| `coach_client_engagement_deliverables` | Deliverable instances. | `name`, `fee_cents`, `category`, `phase_id`, `why_this_matters`, `speaking_point`, `not_needed`, `source_milestone_id` | `engagement_id` CASCADE | `lib/plan/service.ts`, `lib/phases/service.ts`, deliverable route | plan, `me/*` | BUILT AND FUNCTIONING |
| `coach_client_engagement_activities` | Plan tasks with a state machine. | `owner`, `state` (upcoming, active, waiting_on_client, done, skipped, not_needed), legacy `status` derived by trigger `ccea_status_from_state`, `assignee_profile_id`, `released_at`, `state_changed_at`, `due_date`, `is_signoff` (one per deliverable), `welcome_release`, `details`, `source_activity_id` | `engagement_deliverable_id` CASCADE | `lib/plan/service.ts` (state rules), activities routes | `lib/plan/*`, `app/api/me/activities*`, `lib/welcome/service.ts` | BUILT AND FUNCTIONING (`20261005_plan_tasks.sql`) |
| `client_phase_status` | Per-relationship phase progress. | `status` (not_started/in_progress/complete), `updated_by` | `coach_client_id`, `phase_id` | `lib/phases/service.ts` | `lib/plan/home.ts` | BUILT AND FUNCTIONING |
| `client_sows` | Statement of Work per engagement, public token link, Let's Go acceptance. | `opening`, `price_override_cents`, `payment` jsonb, `status` (draft/sent/accepted), `token_hash`, `sent_snapshot` jsonb, `accepted_name`, `accepted_at`, `sent_to/cc`, `send_count` | `engagement_id` UNIQUE, `coach_client_id` | `lib/sow/client.ts`, `lib/sow/send.ts`, `lib/sow/accept.ts` | `lib/sow/public.ts`, `app/api/public/sow/[token]*` | BUILT; prod UNKNOWN OR NOT VERIFIED (memory `project_sow_letsgo.md`: Steps 3+4 on dev only) |
| Let's Go / welcome | Not a table: `lib/sow/accept.ts` approves the package, moves stage to Onboarding, creates the Drive workspace (`coach_clients.workspace_folder_*`), flags the welcome task (`welcome_release`), creates a "Send invoice" To-Do; `lib/welcome/service.ts` sends the welcome email and releases the task. | | | | | BUILT; prod UNKNOWN OR NOT VERIFIED |

All plan tables: no RLS; service role plus `coach_clients` ownership checks in code (the RPC itself checks `coach_profile_id`).

### 3c. Money and entitlements

| Table / field | Purpose | Writers | Status |
|---|---|---|---|
| `purchases` | One row per Stripe checkout, attribution, refund stamp. FK `client_profile_id` SET NULL. RLS on, no policies. | `app/api/webhooks/stripe/route.ts`, `app/api/stripe/refund`, `app/api/account/delete` | BUILT AND FUNCTIONING |
| `iap_purchases` | Apple IAP mirror (RevenueCat). RLS on, no policies. | `app/api/iap/revenuecat-webhook/route.ts` | BUILT AND FUNCTIONING |
| `client_profiles.active` / `refunded_at` | The only entitlement switch: refund sets `active=false` (`app/api/webhooks/stripe/route.ts:355-360`, revenuecat webhook line 301). Paid access = a `client_profiles` row that is active. | as above | BUILT AND FUNCTIONING |
| `signal_seats` | Legacy claim-token seats. | `app/api/seat-create`, `seat-verify`, `send-magic-link` | BUILT BUT INCOMPLETE (legacy flow, `docs/DATABASE.md`) |
| `client_profiles.client_seat_cap` | Max relationships per coach, enforced in `app/api/coach/create-client`. | manual | BUILT AND FUNCTIONING |
| `jobfit_users`, `jobfit_profiles`, `jobfit_trial_runs` | Free-trial track keyed by email, not linked to `client_profiles`. | `app/api/jobfit-run-trial/route.ts` | BUILT AND FUNCTIONING (isolated) |
| `jobfit_anonymous_runs`, `unlock_email_captures` | Anonymous trial telemetry (hashes, not text). | trial-open route | BUILT |
| Coaching invoices / payments | No table. "Send invoice" is a To-Do (`lib/sow/accept.ts` step 6); legacy `coach_clients.phase_invoice_sent/paid` booleans. | | DESIGNED OR DOCUMENTED NOT IMPLEMENTED (no invoice data model) |
| Per-feature entitlements (full_access, tiers) | None. `app/api/full-access-lookup` only looks up a profile by email. | | Not present |

## 4. Goals and preferences

| Where | What | Status |
|---|---|---|
| `client_profiles.target_roles`, `target_locations`, `preferred_locations`, `timeline`, `job_type` | Prose text, not structured. `lib/briefs/prefill.ts` header notes the profile parser keeps "Primary Roles" and discards "Secondary Roles". | BUILT BUT INCOMPLETE |
| `client_profiles.target_industries` / `excluded_industries` | jsonb arrays of hiring.cafe labels; lanes inherit at creation (`20260818_industry_filters.sql`). | BUILT AND FUNCTIONING |
| `coach_clients` prospect copies (`target_roles`, `target_locations`, `target_industries` TEXT, `timeline`, `job_type`) | Copied once into `client_profiles` at account setup (`app/api/coach/coach-clients/[id]/setup-account/route.ts:206-215`); no ongoing sync. | BUILT BUT INCOMPLETE (duplicate source) |
| `candidate_targeting` | Lanes and career stage (section 1). | BUILT BUT INCOMPLETE |
| `client_personas` | Resume variants as positioning personas. | BUILT AND FUNCTIONING |
| `search_lanes` | Saved repeatable job search per client: `titles`, `location`, `years_max`, `companies`, `exclusions`, `filters`. Owner RLS policy. Writers `app/api/lanes/*`; reader `app/api/internal/lanes/run-due`. | BUILT BUT INCOMPLETE: `20260918_ingest_schema.sql` header says lane_results writes stopped after 2026-09-01; prod lane state unknown (memory `project_lanes_not_in_prod.md`) |
| `networking_campaign_briefs` | Coach-built campaign brief: `primary/secondary_roles[]`, `primary/secondary_industries[]`, `locations[]`, `immediate_goals`, `education_status`, `ai_suggestions` jsonb, `prefilled_fields[]` (provenance of prefill), draft/submitted. RLS on, no policies. Writers `app/api/coach/briefs*`. | BUILT AND FUNCTIONING |
| `prospect_consults.search_goal`, `services[]` | Consult-time goals. | BUILT |

## 5. Resumes and documents

| Where | What | Status |
|---|---|---|
| `client_profiles.resume_text`, `client_personas.resume_text` | Resume stored as **plain text only**. `app/api/resume-upload/route.ts` extracts text (PDF via Claude, DOCX via mammoth) and returns it; it writes nothing and stores no file. | BUILT AND FUNCTIONING |
| Storage buckets | Only one bucket created in migrations: `practice-takes` (private, video/audio, `20260929_practice_rounds.sql:104`). No resume file bucket. | BUILT |
| `coach_client_documents` | Coach document library per relationship: `title`, `url` (link, not file), `category_id`, `activity_id`, `visible_to_client`, soft delete. Writers `app/api/coach/coach-clients/[id]/documents*`, `lib/networking-plan/job.ts`. Reader `app/api/me/documents`. No RLS. | BUILT AND FUNCTIONING |
| `coach_document_categories` | Coach's categories (seeded on first GET, memory `project_coach_get_seeds_defaults.md`). | BUILT |
| Google Drive | `coach_clients.workspace_folder_id/url` (client workspace with subfolders Resume, Cover Letter, LinkedIn, Networking, Interviewing, DNA, Toolkit: `lib/sow/workspace.ts:19`) and `drive_folder_id/url` (Networking Plan target). Client `lib/drive/client.ts`. | BUILT AND FUNCTIONING |
| `networking_plan_jobs` | Networking Plan generation job: status, step, `drive_file_id/url`, `document_id`, `shared_at`, `source_hash`, `brief_id`. RLS on, no policies. Writer `lib/networking-plan/job.ts`. | BUILT AND FUNCTIONING |
| `networking_plan_sources` | Uploaded contact sheet rows (jsonb) per relationship, `source_hash`, `uploaded_by_id`, `brief_id`. Writers `app/api/network/import/commit`, `network/plan/run`. | BUILT AND FUNCTIONING |
| `resume_rx_sessions` | Resume rewrite workflow (diagnosis, architecture, `approved_bullets`, `final_resume_text`, `pdf_url`). Owner RLS. | DORMANT: only `app/api/account/delete` references it |

## 6. Work history, education, projects, accomplishments, skills, evidence

**No structured tables exist for work history, employment, education history, projects, accomplishments, skills, or evidence.** Grep of migrations for `accomplishment|work_history|employment_history` returns nothing; code hits for "accomplishment" are LLM prompt text only (`app/api/positioning/route.ts:491`, `app/api/networking/route.ts:750`). Where this information actually lives:

| Information | Where it lives | Form |
|---|---|---|
| Work history, roles, accomplishments | `client_profiles.resume_text`, `client_profiles.profile_text`, `client_personas.resume_text` | Free text |
| Skills / tools | `client_profiles.profile_structured.tools` (regex-extracted at intake, `app/api/profile-intake/route.ts:528`); JobFit re-extracts profile signals per run (`app/api/jobfit/extract.ts`) and stores them only inside `jobfit_runs.result_json` | Derived JSON, not editable |
| Years of experience | `profile_structured.yearsExperienceApprox` (inferred); `coach_clients.years_experience_approx` (prospect, typed) | Derived / typed int |
| Education | `client_profiles.education_status`, `university`, `grad_date`; `profile_structured.intakeMeta.university/major`; `coach_clients.education_status`, `university`, `field_of_study`, `grad_date`; `network_client_profile.school/degree/grad_year` (retired); `networking_campaign_briefs.education_status` | Scattered scalar fields, no degree-field model (memory `project_jobfit_degree_fieldkind_deferred.md`) |
| Stories / evidence (STAR) | `workbook_answers` (`field_key` such as `s2.q1`, `tmay.present`, `hook.final`; `value` jsonb) per `workbooks` row; templates `lib/workbook/templates/session-2-telling-your-stories.json`, `session-1-foundations.json` | Free-text answers keyed by template field |
| Proof project | `coach_client_engagements.is_proof_project` plus `coach_client_engagement_deliverables.speaking_point` / `why_this_matters`; read by `app/api/me/proof-project` | Text on plan rows |
| Key strength / pitch | `network_client_profile.key_strength`, `elevator_pitch` (retired); `client_profiles.coach_notes_strengths` | Text |
| Matched evidence for a job | `jobfit_runs.result_json` (WHY/RISK codes, evidence) | Per-run JSON snapshot |

Status: DESIGNED OR DOCUMENTED NOT IMPLEMENTED for any structured evidence model. The Professional DNA methodology (`docs/professional-dna/04-evidence-and-confidence.md`, `07-result-schema.md`) specifies provenance-bearing evidence but is DRAFT and explicitly "not implementable yet" (`docs/professional-dna/README.md`).

## 7. Coaching notes and session records

There are **at least seven separate note stores**:

| Table / field | Scope | Visibility | Writers | Status |
|---|---|---|---|---|
| `coach_client_notes` | Relationship feed: `type` session_recap / action_item / other, `priority`, `completed_at`, `topic` (phase/deliverable/milestone), `link_tab`, soft delete; `client_profile_id` nullable for prospects. RLS coach-owner policy. | coach only | `app/api/coach/clients/[clientId]/note-feed`, `coach/prospects/*/notes`, `lib/notes/edit.ts`, `lib/tasks/service.ts` | BUILT AND FUNCTIONING |
| `coaching_notes` | Per job (application / jobfit run), threaded (`parent_note_id`), `author_role` coach/client, `visibility` private/shared. RLS coach-owner + client-read-shared. | shared or private | `app/api/coach/clients/[clientId]/applications/[applicationId]/notes`, `app/api/notes/applications/[applicationId]` | BUILT AND FUNCTIONING |
| `coach_client_activity_notes` | Per plan task, `visible_to_client`, `action_required`. No RLS. | per flag | activities notes routes, `app/api/me/activity-notes/[id]/done` | BUILT AND FUNCTIONING |
| `coach_annotations` | Legacy notes on application / run / recommendation / general, `visible_to_client`. RLS. | per flag | `app/api/coach/annotate` | BUILT BUT INCOMPLETE (legacy, still read by tracker and notifications) |
| `coach_notes` | Per run notes (`20260518_coach_notes.sql`). | | none | DORMANT (no code hits) |
| `coach_clients.private_notes`; `client_profiles.coach_notes_avoid/strengths/concerns` | Free-text fields | coach | clients/notes, profile routes | BUILT |
| `workbook_comments`, `network_comments` | Workbook threads; network comments (`network_comments` referenced only in delete paths) | | | workbook BUILT; network_comments effectively DORMANT |

Session and task records:

| Table | Purpose | Status |
|---|---|---|
| `coach_tasks` + `coach_task_events` | To-Do list: assignee, due, status, `source` manual/auto, `template_id`, `plan_activity_id` (synced to plan tasks), `brief_id`, `decision`, `link`, `legacy_note_id`. Events log created/assigned/completed etc. RLS assignee-or-creator policy. Writers `lib/tasks/service.ts`, `lib/plan/todo.ts`. | BUILT AND FUNCTIONING |
| `coach_automation_events`, `coach_automation_rules`, `coach_task_templates`, `coach_automation_timers` | Event-driven task automation and 3-day timers. RLS on, no policies. `lib/automation/*`. | BUILT AND FUNCTIONING |
| `calendly_event_type_actions`, `calendly_webhook_deliveries` | Calendly mapping (`consult_booked`, `session_booked`, `milestone_id`) and an idempotent delivery log linking `coach_client_id`, `book_task_id`, `prep_task_id`, `todo_task_id`. `lib/calendly/webhook.ts`. | BUILT; session mapping prod UNKNOWN OR NOT VERIFIED |
| Session content (what happened in a session) | No session table. Session recaps are `coach_client_notes` with `type='session_recap'`. | BUILT BUT INCOMPLETE |
| `practice_rounds`, `practice_questions`, `practice_takes` | Video practice rounds with coach feedback (`fb_works`, `fb_fix`, `fb_overall`), recordings in `practice-takes` bucket. RLS SELECT policies compare `client_profile_id = auth.uid()` (profile id vs auth user id, so they likely never match for real users; harmless under service role but incorrect). | BUILT AND FUNCTIONING (RLS policy defect noted) |

## 8. Job targets, applications, opportunities

| Table | Purpose / key columns | FKs | Writers | Status |
|---|---|---|---|---|
| `signal_applications` | Job tracker: company, title, url, `application_status` (saved...withdrawn, coach_recommended), `interest_level`, `signal_decision/score`, `jobfit_run_id`, `persona_id`, `positioning_run_id`, `coverletter_run_id`, `company_id` (network company). No RLS. | `profile_id` CASCADE | `app/api/applications*`, `app/api/jobfit`, `coach/recommend-job`, `coach/my-recommendations/[id]/respond`, `lib/signalApplications.ts`, `lib/network-tracker/link-application.ts` | BUILT AND FUNCTIONING |
| `signal_applications_status_history` | Status transitions with `changed_by`. | application CASCADE | `app/api/_lib/applicationStatusHistory.ts` | BUILT AND FUNCTIONING |
| `jobfit_runs` | Deterministic score cache, `result_json`, `job_description`, `persona_id`, `profile_version_at_run`, `persona_version_at_run`, `sourced_by_coach_id`, `application_id`. Pre-migration table. | profile | `app/api/jobfit`, `coach/recommend-job`, `_lib/runJobFitForProfile.ts` | BUILT AND FUNCTIONING |
| `positioning_runs`, `coverletter_runs`, `networking_runs` | LLM run caches; `jobfit_run_id` links; `created_by_role/id` on positioning and cover letter (`20261007_run_actor.sql`). | profile | respective routes | BUILT AND FUNCTIONING |
| `positioning_runs_v2` | Abandoned 2026-08-10, nothing writes it (`20260810_positioning_runs_v2_dormant.sql`). | | none | DORMANT |
| `coach_job_recommendations` + `coach_recommendation_responses` | Coach-sourced jobs with priority, action, `client_status`, `full_analysis`; responses are append-only history. | relationship, profiles | `coach/recommend-job`, `coach/recommendations/[id]`, `my-recommendations/[id]/respond` | BUILT AND FUNCTIONING |
| `jobfit_feedback` | Client rating of a run. | run, profile | `app/api/feedback/jobfit` | BUILT |
| `search_lanes`, `lane_results`, `lane_runs` | Per-client job discovery with triage (`action` push/dismiss, `reason`). "Push" is recorded on `lane_results` only; no code found that turns a push into a recommendation or application. | lane | `app/api/lanes/*`, `lib/laneRunner.ts` | BUILT BUT INCOMPLETE (see section 4) |
| `postings`, `ingest_pairs`, `ingest_runs`, `ingest_boards` | Global posting ingest, no client ownership by design (`20260918_ingest_schema.sql` header). Enrichment columns dev-only per memory. | none to clients | `lib/ingest/*` | BUILT BUT INCOMPLETE (not connected to client records) |
| `network_companies`, `network_contacts`, `network_actions` | Client networking board: tiers, contacts with stage machine and reminders, actions and drafted messages (`body`, `channel`, `status`, `application_id`), attribution (`created_by_role/id`, `edited_by_*`). Owner RLS policies. | profile | `app/api/network/*`, `lib/network-tracker/*` | BUILT AND FUNCTIONING |
| `network_templates` | Per-client message template overrides. | profile | none | DORMANT |

## 9. Interview prep (listed only; see Appendix C)

`signal_interviews` (RLS owner + coach select), `interview_prep_runs` (`content_hash`, `generated`, `checklist_state`), `workbooks`, `workbook_answers`, `workbook_answer_history`, `workbook_comments`, `workbook_sends`, `workbook_section_marks` (RLS with policies and SECURITY DEFINER RPCs `workbook_for_client`, `workbook_send_to_coach`, etc.), `practice_rounds`, `practice_questions`, `practice_takes`.

## 10. SIGNAL DNA and Career Paths

| Item | Evidence | Status |
|---|---|---|
| DNA data tables (assessment answers, report, career paths) | None in migrations or code. Grep for `dna`, `career path`, `decode` hits only names: `coach_welcome_templates.start_key='dna'` (`20261013_welcome_templates.sql`), `lib/welcome/model.ts:15-26`, Drive subfolder "DNA" (`lib/sow/workspace.ts:19`), SOW text "Know: Your SIGNAL DNA and Career Paths" (`docs/WRN_SOW_Text.md:13-31`), test fixtures. | Deliverable / task names only |
| Current DNA delivery | Outside SIGNAL: separate live-assessment app with its own Supabase, hand-written report pages, `wrn-client-portal` site (`docs/signal-dna-site-and-integration-options.md`, untracked, dated 2026-09-30). | Exists outside this repo |
| Professional DNA methodology and result schema | `docs/professional-dna/*` v0.8 DRAFT, "Nothing in this directory is implementable yet". | DESIGNED OR DOCUMENTED NOT IMPLEMENTED / PLANNED |
| Career Paths as data | Only as SOW deliverable text ("Four career paths, each with...supporting evidence", `docs/WRN_SOW_Text.md:26`) and seed deliverable rows. | PLANNED |

## 11. Is there a unified client record?

**No.** There is a hub identity, not a unified record.

| Key | What it identifies | Tables keyed on it |
|---|---|---|
| `client_profiles.id` | A person with a SIGNAL login (client or coach). Clients without a login yet can have a row with `user_id` NULL (coach-created), claimed later by `lib/collab/identity.ts`. | personas, targeting, runs, applications, interviews, network board, lanes, coaching_notes, tasks (`client_profile_id`), workbooks, practice |
| `coach_clients.id` | One coach's relationship with one person, or a prospect with no profile. | engagements and plan, phases status, SOWs, events, documents, briefs, plan sources/jobs, consults, stage progress, notes (`coach_client_notes`), timers, Calendly deliveries |
| email | Trial users (`jobfit_users`, `jobfit_trial_runs`), `purchases.email`, `signal_seats`, `coach_clients.invited_email` | trial and purchase records; not FK-linked |
| hashes | `jobfit_anonymous_runs.resume_hash/jd_hash` | anonymous telemetry |

Consequences:
- **Prospects have no `client_profiles` row.** Their profile-like data lives on `coach_clients` (and `prospect_consults`). At account setup the fields are copied once into `client_profiles` (`setup-account/route.ts:206-215`); after that the two copies diverge silently.
- **Collaboration (Shape 1)** gives one client several `coach_clients` rows. Notes, documents and action items are re-scoped across all of them (`app/api/_lib/coachClientIds.ts`), but engagements/plans remain per relationship row.
- Account-creation logic exists in three near-identical copies (`create-client`, `coach-clients/[id]/send-invite`, `setup-account`), noted in the setup-account header.
- Module data is siloed: networking board, lanes, workbooks, plan, notes and job tracker each own their tables keyed on the profile or relationship, joined only by those ids and a few optional cross-links (`signal_applications.company_id`, `network_actions.application_id`, `coaching_notes.application_id`, `workbooks.signal_interview_id`, `interview_prep_runs.jobfit_run_id`, `coach_tasks.plan_activity_id` / `brief_id`).

## 12. Reuse, provenance, verification, updates

| Mechanism | Where | Status |
|---|---|---|
| Copy-on-attach provenance | `source_package_id`, `source_milestone_id`, `source_activity_id` (SET NULL, "provenance only") in `20260605_coach_client_engagements.sql`; `attach_package_to_engagement` RPC | BUILT |
| Version stamps | `client_profiles.profile_version`, `client_personas.persona_version`, captured on `jobfit_runs.profile_version_at_run/persona_version_at_run` | BUILT |
| History tables | `signal_applications_status_history`, `workbook_answer_history` (with `source` typed / accepted_suggestion), `coach_recommendation_responses` (append-only), `coach_task_events`, `coach_client_events`, `client_sows.sent_snapshot` | BUILT |
| Actor / source columns | `created_by_role/id` on positioning/coverletter runs and network contacts/companies, `network_actions.author_role`, `workbook_answers.updated_by_role`, `candidate_targeting.source` + `career_stage_locked_by`, `networking_campaign_briefs.prefilled_fields` + `ai_suggestions` (fact vs AI guess kept apart, `lib/briefs/prefill.ts`), `coach_clients.ghl_contact_source`, `jobfit_runs.sourced_by_coach_id` | BUILT (inconsistent across modules) |
| Profile change history | None. `client_profiles` updates overwrite in place; no `client_profiles_history`. `history_boundary_at` only filters client-facing reads for returning clients. | Not present |
| Data reuse across modules | Brief prefill from profile (`lib/briefs/prefill.ts`), prospect-to-profile carryover, network import seeding (`lib/network-tracker/import-load.ts`), lanes inherit industries, interview prep reads JobFit run (`lib/interviewPrep/source.ts`). Each is a one-time copy or a read, not a shared canonical record. | BUILT BUT INCOMPLETE |
| Verification of client facts | No verified/confirmed flags on any profile fact, education, or evidence. Nearest analogues: SOW `accepted_name`/`accepted_at`, workbook suggestion accept/keep-own, lane push/dismiss, `career_stage_locked_by`. | Not present |
| Soft delete | `deleted_at` on notes, documents, tasks, briefs, practice rounds | BUILT |

## 13. Contradictions and open questions

1. `lib/briefs/prefill.ts` header says client_profiles has "no education field, no industries field", but `20260622_client_profiles_intake_fields.sql` added `education_status/university/grad_date` and `20260818_industry_filters.sql` added `target_industries`. The comment is stale or the brief prefill ignores those columns.
2. `coach_clients.target_industries` is TEXT (`20261002_prospect_phase1.sql`) while `client_profiles.target_industries` is a jsonb array of hiring.cafe labels: same name, different shape and vocabulary.
3. `docs/DATABASE.md` RLS table lists only early tables and predates most of the schema; treat it as historical.
4. `practice_*` RLS policies compare a profile id to `auth.uid()`.
5. Prod state of `20261008`-`20261015` is unrecorded; lanes prod state unknown; postings enrichment dev-only.
6. `coach_notes`, `coach_preferences`, `resume_rx_sessions`, `network_client_profile`, `network_templates`, `positioning_runs_v2`, `pending_profiles`, `user_profiles` are dormant but still in schema.
7. Whether `anon`/`authenticated` hold table grants on no-RLS core tables (`client_profiles`, `signal_applications`, plan tables) cannot be determined from the repo.
