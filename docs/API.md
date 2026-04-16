# API Reference

## Overview

The SIGNAL API is a Next.js App Router REST API deployed on Vercel. Every endpoint lives under `/api/*` as a `route.ts` file that exports one or more HTTP method handlers. The production base URL is `https://wrnsignal-api.vercel.app`; the staging/dev base URL is `https://wrnsignal-api-staging.vercel.app`. All responses are JSON except `/api/dashboard` (HTML) and `/api/reel` (HTML). CORS is handled centrally by `app/api/_lib/cors.ts` using `withCorsJson(req, body, status)` and `corsOptionsResponse(origin)` — allowed origins include `workforcereadynow.com`, `*.framer.app`, `*.framercanvas.com`, and `localhost`. The custom header `x-jobfit-key` is allow-listed for the trial flow. Under the hood, handlers construct a Supabase admin client (service-role key) to read/write the database and bypass RLS; authorization is enforced in application code.

## Authentication

Most authenticated routes use **Supabase Auth Bearer tokens**:

1. The client sends `Authorization: Bearer <access_token>` where the token is the JWT issued by Supabase's `signInWithOtp` magic-link flow.
2. The server extracts it with a small `getBearerToken(req)` helper, then validates it via `supabase.auth.getUser(token)` in `getAuthedUser(req)`.
3. The handler then resolves the SIGNAL profile by `user_id` → fallback `email` → optional re-attach (see `app/api/profile/route.ts`).

Four other auth modes exist:

- **Public** — no token checked (e.g., `/api/ping`, `/api/parse-job-url`, `/api/job-analysis`, `/api/checkout/create-session`).
- **Stripe signature** — `/api/webhooks/stripe` verifies `stripe-signature` against `STRIPE_WEBHOOK_SECRET`.
- **GHL webhook shared secret** — `/api/seat-create` and `/api/webhook-purchase` accept a custom header secret.
- **Coach gating** — routes under `/api/coach/*` additionally verify `is_coach = true` on the caller's profile, and `/api/coach/clients/[clientId]/*` routes verify a `coach_clients` relationship with one of three access levels: `view`, `annotate`, `full`.
- **`x-jobfit-key` / `x-jobfit-test-key` / `x-networking-test-key`** — optional dev/test bypass headers accepted by the trial and jobfit routes.

## Route Reference

### Health & Meta

#### GET /api/ping
**Auth:** Public
**Purpose:** Liveness check.
**Request:** —
**Returns:** `{ ok: true }`
**Errors:** —

#### GET /api/canary
**Auth:** Public
**Purpose:** Deployment fingerprint (build timestamp, SHA, environment).
**Request:** —
**Returns:** `{ ok: boolean, canary: string, vercel_env: string, sha: string, built_at_utc: string }`
**Errors:** —

#### GET /api/version
**Auth:** Public
**Purpose:** Return commit SHA, JobFit logic version, and component stamps.
**Request:** —
**Returns:** `{ env: string, git_sha: string|null, jobfit_logic_version: string|null, route_jobfit_stamp: string|null, ... }`
**Errors:** —

#### GET /api/reel
**Auth:** Public
**Purpose:** Serve a static HTML video player page.
**Request:** —
**Returns:** HTML
**Errors:** —

#### GET /api/dashboard
**Auth:** Public (the page is HTML; it calls other Supabase REST endpoints from the browser using an inline query helper).
**Purpose:** Serve the internal analytics dashboard UI (funnel, sources, events, engagement) as a single self-contained HTML page. Queries `jobfit_page_views` and related tables from the browser.
**Request:** —
**Returns:** HTML
**Errors:** — [NEEDS CLARIFICATION] on how this page authenticates its Supabase queries in production (credentials appear embedded).

### JobFit & Analysis

#### POST /api/jobfit
**Auth:** Authenticated user, or `x-jobfit-test-key` bypass in dev.
**Purpose:** Run the deterministic JobFit scoring engine with fingerprint-based caching and auto-create/update a `signal_applications` row.
**Request:** `profile_text: string`, `job_text: string`, `profile_overrides?: object`, plus many optional structured-input fields consumed by the evaluator.
**Returns:** `{ ok: boolean, decision: string, score: number, why_codes: array, risk_codes: array, job_signals: object, profile_signals: object, gate_triggered?: object, ... }`
**Errors:** 400 bad request, 401 unauthorized, 500 server error.

#### POST /api/jobfit/debug-review
**Auth:** Public (dev tool).
**Purpose:** Run an LLM sanity-check layer over a JobFit result to catch rule bugs or wrong decisions.
**Request:** `{ result_json: object, profile_text: string, job_text: string }` OR `{ jobfit_run_id: string }`.
**Returns:** `{ ok: boolean, review: object, latency_ms: number }`
**Errors:** 400 bad request, 404 not found, 500 server error.

#### POST /api/jobfit-v4-debug
**Auth:** Public (dev tool).
**Purpose:** Debug V4 profile extraction (deterministic, no LLM).
**Request:** `job_text: string` (min 50 chars), `resume_text?: string`.
**Returns:** `{ ok: boolean, job_text_length: number, resume_text_length: number, profile: object, profile_v4_stamp: string }`
**Errors:** 400 bad request, 500 server error.

#### POST /api/job-analysis
**Auth:** Public.
**Purpose:** Public "free analysis" tool — deep JD analysis with company enrichment, hidden requirements, competitiveness. Caches by JD hash.
**Request:** `job_description: string`, `company_name?: string`, `job_title?: string`, `session_id?: string`, `utm_source?`, `utm_medium?`, `utm_campaign?`.
**Returns:** `{ role_level, function, seniority_signals, core_skills, hidden_requirements, competitiveness, risk_flags, target_candidate_profile, summary, market_reality, company_name?, company_context? }`
**Errors:** 400 bad request, 500 server error.

#### POST /api/parse-job-url
**Auth:** Public.
**Purpose:** Fetch and parse a job URL via JSON-LD, platform-specific Cheerio scrapers (Indeed/Greenhouse/Lever/Handshake/Workday/iCIMS), or Claude fallback.
**Request:** `{ url: string }`
**Returns:** `{ jobTitle, companyName, jobDescription, location, jobType, source: string, method: "jsonld"|"cheerio"|"claude", originalUrl: string }`
**Errors:** 400 invalid URL, 422 LinkedIn/blocked/parse failed.

#### POST /api/parse-job-text
**Auth:** Public.
**Purpose:** Parse pasted job posting text using Claude.
**Request:** `{ text: string }` (min 50 chars).
**Returns:** `{ jobTitle, companyName, jobDescription, location, jobType, source: "text_paste", method: "claude", originalUrl: null }`
**Errors:** 400 bad request, 502 parse failed.

#### POST /api/positioning
**Auth:** Authenticated user.
**Purpose:** Generate positioning rewrites (keyword coverage + LLM rewrite) with fingerprint-cached results in `positioning_runs`.
**Request:** `{ job: string }` (resolved profile text is fetched server-side).
**Returns:** `{ ok?: boolean, result: object, fingerprint_code: string, reused: boolean }` — exact shape mirrors `jobfit_runs.result_json` pattern.
**Errors:** 400 missing job, 401 unauthorized, 500 server error.

#### POST /api/coverletter
**Auth:** Authenticated user.
**Purpose:** Generate a cover letter with JobFit + positioning context. Fingerprint-cached.
**Request:** `{ job: string, jobfit_result?: object, positioning?: object }`
**Returns:** `{ letter: string, contact: object, context_used: object, fingerprint_code: string, reused: boolean }`
**Errors:** 400 bad request, 401 unauthorized, 404 profile not found, 500 server error.

#### POST /api/networking
**Auth:** Authenticated user, or `x-networking-test-key` bypass in dev.
**Purpose:** Generate networking outreach messages and contact targets. Fingerprint-cached in `networking_runs`.
**Request:** `{ job: string, application_state?: object, jobfit_context?: object, positioning_context?: object, networking_context?: object }`. Bypass mode additionally accepts `profileText` / `profile` and `profileId`.
**Returns:** `{ contacts: array, messages: array, ... }` — full shape in `result_json`.
**Errors:** 400 missing job or (in bypass) missing profileText, 401 unauthorized, 500 server error.

#### GET /api/runs/[id]
**Auth:** Authenticated user (ownership checked against `client_profile_id`).
**Purpose:** Fetch a JobFit run plus any positioning / cover-letter / networking results linked by fingerprint hash.
**Request:** — (path param `id`).
**Returns:** `{ runId, fingerprintCode, fingerprintHash, verdict, score, createdAt, jobDescription, jobTitle, companyName, jobfit, positioning, coverLetter, networking }`
**Errors:** 401 unauthorized, 403 profile mismatch, 404 not found.

### Trial Flow (isolated — `jobfit_users` / `jobfit_profiles`)

#### POST /api/jobfit-intake
**Auth:** Public (optional `x-jobfit-key` header).
**Purpose:** Register a trial user and capture their initial profile.
**Request:** `{ name: string, email: string, job_type: "internship"|"full_time", target_roles: string, resume_text: string, target_locations?: string, timeline?: string, utm_source?, utm_medium?, utm_campaign? }`
**Returns:** `{ ok: boolean, user_id: string, credits_remaining: number }`
**Errors:** 400 missing required, 401 unauthorized (bad key), 500 server error.

#### POST /api/jobfit-run-trial
**Auth:** Public (optional `x-jobfit-key` header).
**Purpose:** Run JobFit for a trial user and decrement credits.
**Request:** `{ email: string, job: string, company_name?: string, job_title?: string, utm_* }`
**Returns:** `{ ok: boolean, credits_remaining: number, result: object }`
**Errors:** 400 bad request, 401 unauthorized, 402 out of credits, 404 profile not found.

#### POST /api/jobfit-trial-lookup
**Auth:** Public (optional `x-jobfit-key` header).
**Purpose:** Fetch remaining trial credits for an email.
**Request:** `{ email: string }`
**Returns:** `{ ok: boolean, email: string, credits_remaining: number }`
**Errors:** 400 missing email, 401 unauthorized, 404 user not found, 500 server error.

### Profile & Personas

#### GET /api/profile
**Auth:** Authenticated user.
**Purpose:** Fetch the caller's profile (auto-creates if missing; backfills missing fields from `profile_text`).
**Request:** —
**Returns:** `{ ok: boolean, profile: object }`
**Errors:** 401 unauthorized, 500 server error.

#### PUT /api/profile
**Auth:** Authenticated user.
**Purpose:** Update profile fields; rebuilds `profile_text` and recomputes `profile_complete`.
**Request:** profile fields (server strips `email`, `id`, `user_id`, `seat_id`, `profile_version`).
**Returns:** `{ ok: boolean, profile: object }`
**Errors:** 400 invalid JSON, 401 unauthorized, 404 profile not found.

#### POST /api/profile-intake
**Auth:** Authenticated user.
**Purpose:** Full onboarding intake (education, resume, constraints, risk overrides). Sets `profile_complete = true` and auto-creates a default persona.
**Request:** `{ name?, job_type, target_roles, resume_text, target_locations?, university?, major?, grad_year?, strong_skills?, biggest_concern?, timeline?, hard_nos?, constraints?, writing_samples?, extra_context?, risk_overrides? }`
**Returns:** `{ ok: boolean, client_profile_id: string, saved: object }`
**Errors:** 400 missing required, 500 server error.

#### POST /api/profile-risk-overrides
**Auth:** Authenticated user.
**Purpose:** Merge risk-override flags into the profile (merge, not replace).
**Request:** `{ overrides: object }`
**Returns:** `{ ok: boolean }`
**Errors:** 400 bad request, 401 unauthorized, 404 profile not found.

#### GET /api/personas
**Auth:** Authenticated user.
**Purpose:** List the caller's personas.
**Request:** —
**Returns:** `{ ok: boolean, personas: array }`
**Errors:** 401 unauthorized, 404 profile not found.

#### POST /api/personas
**Auth:** Authenticated user.
**Purpose:** Create a persona (max 2 per profile; first becomes default).
**Request:** `{ name: string, resume_text?: string }`
**Returns:** `{ ok: boolean, persona: object }`
**Errors:** 400 bad request, 401 unauthorized, 403 max personas.

#### PUT /api/personas/[id]
**Auth:** Authenticated user (ownership checked).
**Purpose:** Update a persona; if `resume_text` changes, sync it back to `client_profiles.resume_text` and rebuild `profile_text`.
**Request:** `{ name?: string, resume_text?: string, is_default?: boolean }`
**Returns:** `{ ok: boolean, persona: object }`
**Errors:** 400 invalid name, 401 unauthorized, 404 not found.

#### DELETE /api/personas/[id]
**Auth:** Authenticated user (ownership checked).
**Purpose:** Delete a persona; promote the remaining persona to default if the deleted one was default.
**Request:** —
**Returns:** `{ ok: true, deleted: string }`
**Errors:** 401 unauthorized, 404 not found.

#### POST /api/resume-upload
**Auth:** Optional bearer (token is validated if present; anonymous uploads accepted).
**Purpose:** Extract text from a PDF (via Claude), DOCX (via `mammoth`), or TXT file.
**Request:** `multipart/form-data` with `file: File`.
**Returns:** `{ ok: boolean, text: string }`
**Errors:** 400 no file / unsupported / extraction failed, 401 unauthorized (only if token is present and invalid).

#### POST /api/full-access-lookup
**Auth:** Public.
**Purpose:** Check whether an email has an active SIGNAL profile (for access gating on the marketing site).
**Request:** `{ email: string }`
**Returns:** `{ ok: boolean }` (true = profile exists).
**Errors:** 400 missing email, 500 server error.

### Tracker (Applications & Interviews)

#### GET /api/applications
**Auth:** Authenticated user.
**Purpose:** List all applications for the caller.
**Request:** —
**Returns:** `{ ok: boolean, applications: array }`
**Errors:** 401 unauthorized, 500 server error.

#### POST /api/applications
**Auth:** Authenticated user.
**Purpose:** Create a new application entry.
**Request:** `{ company_name, job_title, location?, date_posted?, job_url?, application_location?, application_status?, applied_date?, interest_level?, cover_letter_submitted?, referral?, notes?, signal_decision?, signal_score?, jobfit_run_id?, persona_id? }`
**Returns:** `{ ok: boolean, application: object }`
**Errors:** 400 bad request, 401 unauthorized, 500 server error.

#### PUT /api/applications/[id]
**Auth:** Authenticated user (ownership checked).
**Purpose:** Update application fields (excluding `id`, `profile_id`, `created_at`).
**Request:** application fields to change.
**Returns:** `{ ok: boolean, application: object }`
**Errors:** 400 bad request, 401 unauthorized, 403 forbidden, 404 not found.

#### DELETE /api/applications/[id]
**Auth:** Authenticated user (ownership checked).
**Purpose:** Delete an application.
**Request:** —
**Returns:** `{ ok: boolean, deleted: string }`
**Errors:** 401 unauthorized, 403 forbidden, 404 not found.

#### GET /api/interviews
**Auth:** Authenticated user.
**Purpose:** List the caller's interviews.
**Request:** —
**Returns:** `{ ok: boolean, interviews: array }`
**Errors:** 401 unauthorized.

#### POST /api/interviews
**Auth:** Authenticated user (application ownership checked).
**Purpose:** Create an interview record linked to an application.
**Request:** `{ application_id, interview_stage, interviewer_names?, interview_date?, thank_you_sent?, status?, confidence_level?, notes? }`
**Returns:** `{ ok: boolean, interview: object }`
**Errors:** 400 bad request, 401 unauthorized, 403 forbidden, 404 application not found.

#### PUT /api/interviews/[id]
**Auth:** Authenticated user (ownership checked).
**Purpose:** Update an interview record (excluding `id`, `profile_id`, `application_id`, `created_at`).
**Request:** interview fields to change.
**Returns:** `{ ok: boolean, interview: object }`
**Errors:** 400 bad request, 401 unauthorized, 403 forbidden, 404 not found.

#### DELETE /api/interviews/[id]
**Auth:** Authenticated user (ownership checked).
**Purpose:** Delete an interview record.
**Request:** —
**Returns:** `{ ok: boolean, deleted: string }`
**Errors:** 401 unauthorized, 403 forbidden, 404 not found.

### Coach

#### GET /api/coach/clients
**Auth:** Coach only (`is_coach = true`).
**Purpose:** List active clients with application stats and pending-recommendation counts.
**Returns:** `{ ok: boolean, clients: array }`
**Errors:** 401 unauthorized, 403 forbidden.

#### DELETE /api/coach/clients/[clientId]
**Auth:** Coach-of-client.
**Purpose:** Remove the client by setting `coach_clients.status = 'revoked'`.
**Returns:** `{ ok: boolean }`
**Errors:** 401 unauthorized, 404 relationship not found.

#### PATCH /api/coach/clients/[clientId]/notes
**Auth:** Coach-of-client (any access level).
**Purpose:** Update private coach notes on a client.
**Request:** `{ private_notes: string }`
**Returns:** `{ ok: boolean, relationship_id: string, private_notes: string }`
**Errors:** 400 missing notes, 401 unauthorized, 403 forbidden.

#### GET /api/coach/clients/[clientId]/profile
**Auth:** Coach-of-client (any access level).
**Purpose:** Fetch the client's profile and personas for coach viewing.
**Returns:** `{ ok: boolean, profile: object, personas: array }`
**Errors:** 401 unauthorized, 403 forbidden, 404 not found.

#### GET /api/coach/clients/[clientId]/tracker
**Auth:** Coach-of-client (any access level).
**Purpose:** Fetch the client's applications, coach annotations, recommendations, and JobFit history.
**Returns:** `{ ok: boolean, applications: array, recommendations: array, history: array }`
**Errors:** 401 unauthorized, 403 forbidden.

#### POST /api/coach/invite
**Auth:** Coach only.
**Purpose:** Send a client invite by email (creates or reuses a `coach_clients` row with a fresh `invite_token`).
**Request:** `{ email: string, access_level: "view"|"annotate"|"full", note?: string }`
**Returns:** `{ ok: boolean, status: "invited", scenario: "existing_user"|"new_user" }`
**Errors:** 400 bad request, 401 unauthorized, 403 forbidden.

#### POST /api/coach/accept-invite
**Auth:** Authenticated user.
**Purpose:** A client accepts a coach's invite using an `invite_token`.
**Request:** `{ token: string }`
**Returns:** `{ ok: boolean, coach_name: string, coach_org: string }`
**Errors:** 400 missing token, 401 unauthorized, 403 email mismatch, 404 invite not found, 409 not pending.

#### POST /api/coach/recommend-job
**Auth:** Coach-of-client (`full` access).
**Purpose:** Run JobFit on the client's profile and create a `coach_job_recommendations` row (supports `dry_run`).
**Request:** `{ client_profile_id, job_description, job_title, company_name, job_url?, coaching_note?, priority?, recommended_action?, apply_by_date?, persona_id?, dry_run?, cached_analysis? }`
**Returns (201):** `{ ok: boolean, recommendation: object, application: object, jobfit: object }`
**Errors:** 400 bad request, 401 unauthorized, 403 forbidden.

#### PATCH /api/coach/recommendations/[id]
**Auth:** Coach (ownership checked).
**Purpose:** Update a recommendation's coaching note, priority, recommended action, or apply-by date.
**Request:** `{ coaching_note?, priority?, recommended_action?, apply_by_date? }`
**Returns:** `{ ok: boolean, recommendation: object }`
**Errors:** 401 unauthorized, 403 forbidden, 404 not found.

#### PATCH /api/coach/recommendations/[id]/respond
**Auth:** Authenticated user (client ownership checked).
**Purpose:** Client responds to a recommendation. Values: `interested | not_interested | applying | applied | passed`.
**Request:** `{ client_status: string }`
**Returns:** `{ ok: boolean, recommendation: object }`
**Errors:** 400 invalid status, 401 unauthorized, 403 forbidden, 404 not found.

#### POST /api/coach/annotate
**Auth:** Coach-of-client (`annotate` access or above).
**Purpose:** Add an annotation to a client's application.
**Request:** `{ application_id, client_profile_id, note, annotation_type? }`
**Returns:** `{ ok: boolean, annotation: object }`
**Errors:** 400 bad request, 401 unauthorized, 403 forbidden, 404 application not found.

#### GET /api/coach/my-recommendations
**Auth:** Authenticated user.
**Purpose:** Client fetches coach recommendations sent to them.
**Returns:** `{ ok: boolean, recommendations: array }`
**Errors:** 401 unauthorized.

#### PATCH /api/coach/my-recommendations
**Auth:** Authenticated user.
**Purpose:** Bulk action on the caller's recommendations.
**Request:** `{ action: "mark_all_seen" }`
**Returns:** `{ ok: boolean }`
**Errors:** 400 unknown action, 401 unauthorized.

#### PATCH /api/coach/my-recommendations/[id]/respond
**Auth:** Authenticated user (ownership checked).
**Purpose:** Client responds to a recommendation. Values: `interested | applying | applied | not_for_me`.
**Request:** `{ client_status: string }`
**Returns:** `{ ok: boolean, client_status: string }`
**Errors:** 400 invalid status, 401 unauthorized, 403 forbidden, 404 not found.

#### GET /api/coach/notifications
**Auth:** Authenticated user.
**Purpose:** Fetch unseen recommendation count, preview recommendations, and annotation count.
**Returns:** `{ ok: boolean, unseen_recommendation_count: number, recommendations: array, annotation_count: number }`
**Errors:** 401 unauthorized.

#### POST /api/coach/notifications/mark-seen
**Auth:** Authenticated user.
**Purpose:** Mark notifications as seen (all unseen, or a subset).
**Request:** `{ ids?: string[] }` — if omitted, marks all unseen as seen.
**Returns:** `{ ok: boolean, marked_seen: number }`
**Errors:** 401 unauthorized.

### Resume Rx

All Resume Rx routes require an authenticated user and operate on a single `resume_rx_sessions` row identified by `session_id` (ownership enforced by matching `profile_id` to the caller's profile; 403 on mismatch, 404 if not found). The flow: `start` → `education` → `architecture` → `answer` (repeated per bullet) → `approve` → `complete` → `save-to-profile`.

#### POST /api/resume-rx/start
**Auth:** Authenticated user.
**Purpose:** Create a new Resume Rx session and run the Claude-powered diagnosis stage.
**Request:** `{ resume_text: string (min 200 chars), mode: string, year_in_school: string, target_field: string, source_persona_id?: string }`
**Returns:** `{ ok: boolean, session_id: string, diagnosis: object }` — shape [NEEDS CLARIFICATION] (full output schema defined in the prompt).
**Errors:** 400 validation errors (missing or too-short fields), 401 unauthorized.

#### POST /api/resume-rx/education
**Auth:** Authenticated user (session ownership checked).
**Purpose:** Generate or accept the education section for the session.
**Request:** `{ session_id: string, education?: object }`
**Returns:** `{ ok: boolean, education_intake: object }` — [NEEDS CLARIFICATION] on exact shape.
**Errors:** 400 invalid body, 401 unauthorized, 403 forbidden, 404 session not found.

#### POST /api/resume-rx/architecture
**Auth:** Authenticated user (session ownership checked).
**Purpose:** Produce section architecture; accepts optional `adjustments` text.
**Request:** `{ session_id: string, adjustments?: string }`
**Returns:** `{ ok: boolean, architecture: object }`
**Errors:** 400 invalid body, 401 unauthorized, 403 forbidden, 404 session not found.

#### POST /api/resume-rx/answer
**Auth:** Authenticated user (session ownership checked).
**Purpose:** Produce a bullet rewrite from Q&A input.
**Request:** `{ session_id: string, original?: string, section?: string, answers?: Record<string,string>, source_material?: string }`
**Returns:** `{ ok: boolean, rewrite: object }` — [NEEDS CLARIFICATION] on exact shape.
**Errors:** 400 invalid body, 401 unauthorized, 403 forbidden, 404 session not found.

#### POST /api/resume-rx/approve
**Auth:** Authenticated user (session ownership checked).
**Purpose:** Approve a bullet variant produced in the `answer` stage.
**Request:** `{ session_id: string, ... }` — additional fields [NEEDS CLARIFICATION].
**Returns:** `{ ok: boolean, approved_bullets: array }`
**Errors:** 400 invalid body, 401 unauthorized, 403 forbidden, 404 session not found.

#### POST /api/resume-rx/complete
**Auth:** Authenticated user (session ownership checked).
**Purpose:** Assemble the final resume text and coaching summary.
**Request:** `{ session_id: string }`
**Returns:** `{ ok: boolean, final_resume_text: string, coaching_summary: string }`
**Errors:** 400 missing session_id, 401 unauthorized, 403 forbidden, 404 session not found.

#### POST /api/resume-rx/save-to-profile
**Auth:** Authenticated user.
**Purpose:** Save the completed resume back to the caller's profile / persona.
**Request:** `{ session_id: string, ... }` — persona-related params [NEEDS CLARIFICATION].
**Returns:** `{ ok: boolean }`
**Errors:** 400 invalid body, 401 unauthorized, 403 forbidden, 404 session not found.

#### GET /api/resume-rx/existing-resume
**Auth:** Authenticated user.
**Purpose:** Fetch the caller's existing resume text (likely from the profile or default persona).
**Returns:** `{ ok: boolean, resume_text: string }` — [NEEDS CLARIFICATION] on exact shape.
**Errors:** 401 unauthorized, 404 not found.

#### GET /api/resume-rx/sessions
**Auth:** Authenticated user.
**Purpose:** List the caller's Resume Rx sessions.
**Returns:** `{ ok: boolean, sessions: array }`
**Errors:** 401 unauthorized.

#### GET /api/resume-rx/sessions/[id]
**Auth:** Authenticated user (session ownership checked).
**Purpose:** Load a full Resume Rx session.
**Returns:** `{ ok: boolean, session: object }`
**Errors:** 401 unauthorized, 403 forbidden, 404 session not found.

### Auth & Checkout

#### POST /api/auth/send-link
**Auth:** Public (email-based gate).
**Purpose:** Send a magic-link OTP if the email maps to an active `client_profiles` row. Redirect target depends on profile state: `profile_complete = true` → `/dashboard/tracker`, `profile_complete = false` → `/dashboard`.
**Request:** `{ email: string }`
**Returns:** `{ ok: boolean, sent: boolean, redirectTo: string, profileComplete: boolean }`
**Errors:** 400 missing email, 403 no account (`{ error: "no_account" }`), 500 server error.

#### GET /api/auth/account-ready
**Auth:** Public (polled from the `/checkout/success` page).
**Purpose:** After a Stripe checkout, poll whether the webhook has created the profile.
**Request:** `?session_id=<stripe_checkout_session_id>`
**Returns:** `{ ready: boolean, email?: string }`
**Errors:** 400 missing session_id, 500 server error.

#### POST /api/checkout/create-session
**Auth:** Public.
**Purpose:** Create a Stripe one-time checkout session. Promotion codes are enabled (`allow_promotion_codes: true`) so customers can redeem any Promotion Code defined in the Stripe dashboard. When called from the mobile app with `source: "mobile"`, the session is tagged with `metadata.source = "mobile"` and its `success_url` routes to `/checkout/mobile-success` (which deep-links back into the app via `signalmobile://post-purchase`) instead of the web `/checkout/success` page.
**Request:** `{ email: string, source?: "mobile" }`
**Returns:** `{ url: string }` (Stripe-hosted checkout URL)
**Errors:** 400 missing email, 500 server misconfigured.

#### POST /api/webhooks/stripe
**Auth:** Stripe signature (`stripe-signature` header verified with `STRIPE_WEBHOOK_SECRET`).
**Purpose:** Handles two event types. (1) `checkout.session.completed` — creates or activates the `client_profiles` row; sets `stripe_customer_id`, `purchase_date`, `stripe_payment_intent_id`, `stripe_charge_id`; clears `refunded_at`; and sends an auth email. If `session.metadata.source === "mobile"` the email is an OTP-style email (6-digit code for the mobile app's code-entry screen); otherwise it's a magic link to the web dashboard. (2) `charge.refunded` — safety-net for manual Stripe-dashboard refunds: looks up the profile by `stripe_customer_id` (fallback `stripe_payment_intent_id`), sets `active = false` and `refunded_at = now()`. Returns 200 immediately to prevent retry storms; processing happens after response.
**Request:** Raw Stripe event payload.
**Returns:** `{ received: true }` (200).
**Errors:** 400 missing signature, 400 invalid signature, 500 missing `STRIPE_WEBHOOK_SECRET`.

#### POST /api/stripe/refund
**Auth:** Authenticated user.
**Purpose:** Self-service 7-day money-back refund. Looks up the caller's profile (by `user_id`, fallback `email`), enforces the refund window (`now - purchase_date <= 7 days`), issues a full Stripe refund via `stripe.refunds.create` using `stripe_payment_intent_id` (fallback `stripe_charge_id`), and revokes access by setting `active = false` and `refunded_at = now()`. The `charge.refunded` webhook will also fire and perform the same DB update — both are idempotent.
**Request:** — (no body).
**Returns:** `{ ok: true, refund_id: string }`. If Stripe succeeded but the DB update failed: `{ ok: true, refund_id: string, warning: string }` (HTTP 200 — the refund went through, support needs to finish the cleanup).
**Errors:** 401 unauthorized, 404 profile not found, 409 already refunded / no active purchase / no Stripe payment reference on file, 403 outside 7-day window, 502 Stripe refund failed, 500 server error.

#### GET /checkout/mobile-success
**Auth:** Public (client-rendered page, not a JSON endpoint).
**Purpose:** Bridge page for mobile Stripe checkout. Immediately redirects the in-app browser to `signalmobile://post-purchase` so that `WebBrowser.openAuthSessionAsync` in the mobile app closes itself and returns the user to the post-purchase code-entry screen. Shows a fallback "Open SIGNAL" button if the scheme redirect hasn't resolved within 2.5 seconds.
**Request:** `?session_id=<stripe_checkout_session_id>` (informational only; not currently used server-side).
**Returns:** HTML.
**Errors:** —

### Seat Flow (legacy — GHL + seat claim tokens)

#### POST /api/seat-create
**Auth:** Shared secret header (GHL webhook). Exact header name [NEEDS CLARIFICATION] but the code rejects with 401 if absent.
**Purpose:** Create or rotate a `signal_seats` row from a GHL purchase event, mint a claim token, and return a claim URL.
**Request:** `{ order_id, ghl_contact_id, purchaser_email?, seat_email, intended_user_name, utm_* }`
**Returns:** `{ ok: boolean, seat_id: string, inserted: boolean, claim_url: string, ghl_update_ok: boolean, ... }`
**Errors:** 400 bad request, 401 unauthorized, 500 server error.

#### POST /api/seat-verify
**Auth:** Public.
**Purpose:** Verify a claim token + seat email before prompting a magic-link send.
**Request:** `{ claim_token: string, seat_email: string }`
**Returns:** `{ ok: boolean, verified: boolean, seat_id?: string, intended_user_name?: string }`
**Errors:** Always 200; `verified: false` on failure.

#### POST /api/send-magic-link
**Auth:** Public.
**Purpose:** Send a Supabase magic link to a valid unclaimed seat and mark the seat `sent`.
**Request:** `{ claim_token: string, seat_email: string }`
**Returns:** `{ ok: boolean, sent: boolean, intended_user_name: string, redirect: string }`
**Errors:** Always 200; `sent: false` on invalid or expired seats.

#### POST /api/webhook-purchase
**Auth:** Optional shared secret (`x-webhook-key`).
**Purpose:** Generic purchase webhook from GHL — records the event in `jobfit_page_views` for funnel attribution.
**Request:** `{ email?, session_id?, amount?, currency?, utm_* }` plus any GHL fields.
**Returns:** `{ ok: boolean, tracked: boolean }`
**Errors:** 401 unauthorized (bad key), 500 server error.

### Analytics

#### POST /api/track
**Auth:** Public.
**Purpose:** Record a pageview event (bot-filtered) into `jobfit_page_views`.
**Request:** `{ page_path: string, page_name: string, session_id?, referrer?, utm_* }`
**Returns:** `{ ok: boolean }` (bot requests return `{ ok: true, filtered: "bot" }`).
**Errors:** 500 server error.

## Error Handling

- Handlers wrap their logic in `try/catch`; thrown errors are serialized as `{ ok: false, error: string }` (or `{ error: string }` for some older routes).
- Auth failures from `getAuthedUser` throw messages that start with `Unauthorized:` — the catch block inspects the message and returns HTTP **401**.
- Input validation returns **400** with a descriptive `error` message.
- Resource ownership failures return **403**; not-found returns **404**.
- Special codes used: **402** (`/api/jobfit-run-trial` — out of credits), **409** (`/api/coach/accept-invite` — invite not pending), **422** (`/api/parse-job-url` — blocked or unparseable), **502** (`/api/parse-job-text` — upstream Claude failure).
- Webhook routes return a 200 body quickly (Stripe) or after GHL acknowledgement to avoid retry storms; side-effect failures are logged but not surfaced to the caller.
- CORS preflight (`OPTIONS`) is handled by `corsOptionsResponse(origin)` on most authenticated routes.

## Known Gaps / [NEEDS CLARIFICATION]

1. **`/api/dashboard`** serves HTML with inline calls to a Supabase REST URL. How the page authenticates in production (what key the inline script uses) is not obvious from the handler alone.
2. **Several Resume Rx response shapes** (`start`, `education`, `answer`, `approve`, `existing-resume`, `save-to-profile`) were not fully inspected. Exact response keys beyond `{ ok, session_id, <stage output> }` should be confirmed.
3. **Seat-create auth header name.** `/api/seat-create` rejects with 401 when the shared secret is missing, but the exact header name (`x-webhook-secret` per the earlier QA inventory vs. another name) should be verified against `process.env` usage.
4. **`/api/positioning` and `/api/networking` success shapes** are the persisted `result_json` from their respective tables; the full key set comes from their upstream LLM prompts and wasn't enumerated here.
5. **`/api/jobfit` request body** accepts many optional structured fields beyond `profile_text` / `job_text` that weren't catalogued individually (the handler is ~700 lines).
6. **`/api/webhook-purchase`** secret header presence is inconsistent — "optional shared secret" behavior should be confirmed (does it 401 only when the header is present-but-wrong, or also when missing?).
7. **`/api/reel`** — purpose beyond "serve a static HTML player" is unclear (what video, what audience).
8. **PATCH /api/coach/my-recommendations** accepts `action: "mark_all_seen"` but the effect on the DB (which column gets flipped and for which rows) was not inspected in detail.

## Summary Stats

- **Route files inspected:** 64 (added `app/api/stripe/refund/route.ts`, 2026-04-15).
- **Total endpoints documented:** 68 method+path combinations, plus the `/checkout/mobile-success` bridge page.
- **Endpoints with `[NEEDS CLARIFICATION]`:** 8 (mostly Resume Rx response shapes and the dashboard auth model).
- **Structural surprises:**
  - `/api/jobfit-v4-debug` and `/api/jobfit/debug-review` are public dev tools deployed alongside production code.
  - `/api/dashboard` serves HTML rather than JSON and includes an inline Supabase REST query layer.
  - Two overlapping recommendation-response endpoints exist: `PATCH /api/coach/recommendations/[id]/respond` (5-state enum) and `PATCH /api/coach/my-recommendations/[id]/respond` (4-state enum). Client-side responders should use the second.
  - `/api/resume-rx/*` is a fully staged workflow — 10 endpoints that mutate the same `resume_rx_sessions` row.
  - Seat-flow endpoints (`/api/seat-*`, `/api/send-magic-link`, `/api/webhook-purchase`) and Stripe-flow endpoints (`/api/auth/send-link`, `/api/checkout/*`, `/api/webhooks/stripe`) are two parallel payment/auth pipelines; the seat flow is the older GHL path.
