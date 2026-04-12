# SIGNAL Product — Complete UI Inventory for QA Test Case Generation

**Generated:** 2026-04-12
**Scope:** All Framer components, Next.js dashboard, API routes, checkout flow
**Purpose:** Exhaustive inventory of every surface, state, interactive element, navigation, API call, and Supabase operation for QA test coverage

---

## FILE: `framer/landingpage.txt`

### Surfaces & States
- Marketing landing page (single page, no routing)
- Hero section with purchase form
- Bottom CTA section with purchase form
- Free analysis email capture (hero + bottom)
- Loading/success/error states per form

### Interactive Elements

**Forms & Inputs (4 email inputs):**
- `heroEmailRef` — hero purchase email, type=email
- `bottomEmailRef` — bottom purchase email, type=email
- `freeEmailRef` — hero free analysis email, type=email
- `freeEmailRef2` — bottom free analysis email, type=email

**Buttons:**
| Label | Handler | Behavior |
|---|---|---|
| "Get full access . $99 ->" (hero) | `handlePurchase(heroEmailRef, ...)` | POST `/api/checkout/create-session`, redirect to Stripe |
| "Get full access . $99 ->" (bottom) | `handlePurchase(bottomEmailRef, ...)` | Same endpoint |
| "Try job analysis free ->" (hero) | `handleFreeAnalysis(freeEmailRef)` | Opens job analysis with `?email=` param |
| "Try job analysis free ->" (bottom) | `handleFreeAnalysis(freeEmailRef2)` | Same pattern |

**Links (all target=_blank):**
| Label | Destination |
|---|---|
| "Try free job analysis" (nav) | `wrnsignal.workforcereadynow.com/signal/job-analysis` |
| "Log in" (nav) | `wrnsignal.workforcereadynow.com/signal/jobfit` |
| "Run free analysis" (banner) | `wrnsignal.workforcereadynow.com/signal/job-analysis` |
| "Log in to your dashboard" (hero) | `wrnsignal.workforcereadynow.com/signal/jobfit` |
| "Log in to dashboard" (bottom) | `wrnsignal.workforcereadynow.com/signal/jobfit` |
| YouTube embed | `youtube.com/embed/uB6pQjSgd04` |
| "Get SIGNAL for your student" | Scrolls to `#bottom-cta` |

### States
- `heroState` / `bottomState`: "idle" | "loading" | "success" | "error"
- `heroError` / `bottomError`: error message strings

### API Calls
| Endpoint | Method | Trigger | Body | Success | Error |
|---|---|---|---|---|---|
| `/api/checkout/create-session` | POST | Purchase button click | `{ email }` | Redirect to `data.url` (Stripe) after 500ms | Show error message |

---

## FILE: `framer/jobanalysis.txt`

### Surfaces & States
1. **Input state** — company name, job title, JD textarea, analyze button
2. **Loading state** — rotating messages every 2.5s through 5 messages
3. **Results state** — Zone 1 (header), Zone 2 (intelligence grid), Zone D (dashboard showcase), Zone 3 (locked preview + upgrade)

### Interactive Elements

**Inputs:**
| Field | Variable | Type | Validation |
|---|---|---|---|
| Company name | `companyName` | text | Required before submit |
| Job title | `jobTitle` | text | Required before submit |
| Job description | `jd` | textarea | Min 100 chars |

**Buttons:**
| Label | Handler | Loading State |
|---|---|---|
| "Analyze this role" | `handleAnalyze()` | Disabled during loading |
| "Run another ->" | `onStartOver()` | N/A |
| "Unlock full SIGNAL ->" (InputState) | `onUpgrade()` | "Setting up checkout..." |
| "Unlock full SIGNAL ->" (ResultsState) | `onUpgrade()` | "Setting up checkout..." |
| "Get Full Access ->" (InputState teaser) | `onUpgrade()` | Same |

**State Variables:**
- `capturedEmail` — read from `?email=` URL param on mount
- `upgradeLoading` — boolean, disables upgrade buttons

**Loading Messages (rotate every 2.5s):**
1. "Reading the job description..."
2. "Identifying hidden requirements..."
3. "Assessing the applicant pool..."
4. "Checking what they're not telling you..."
5. "Building your intelligence report..."

### API Calls
| Endpoint | Method | Trigger | Body | Success | Error |
|---|---|---|---|---|---|
| `/api/job-analysis` | POST | Analyze button | `{ job_description, company_name, job_title, session_id, utm_* }` | `setResult(data)` | Show error message |
| `/api/checkout/create-session` | POST | handleUpgrade (if capturedEmail exists) | `{ email }` | `window.open(data.url, "_blank")` | Fallback to landing page |
| `/api/track` | POST | Page mount + upgrade CTA click | `{ session_id, page_path, page_name, utm_* }` | Fire-and-forget | Silent |

### Results Data Fields Used
- `result.role_level`, `result.function`, `result.company_name` — breadcrumb
- `result.summary` — hero paragraph
- `result.competitiveness` — stat pill with color mapping (Low=teal, Medium=orange, High/Very High=coral)
- `result.core_skills[]` — skill tags + count pill
- `result.company_context.{what_they_do, company_stage, clients, marketing_context, recent_news, application_insight}` — Company Intel card
- `result.target_candidate_profile[]` — Strong Candidate checklist
- `result.hidden_requirements[]` — numbered Hidden Reality list
- `result.risk_flags[]` — Risk Flags cards
- `result.market_reality.stats[]` — stat pills
- `result.market_reality.competitive_dynamic` — narrative block

---

## FILE: `framer/maincomponent.txt`

### Surfaces & States
1. **Auth checking** — loading spinner (1.5s timeout)
2. **Logged out (trial mode)** — login form + trial email capture
3. **Email sent** — magic link confirmation
4. **Logged in** — 4-tab interface (JobFit, Positioning, Cover Letter, Networking)
5. **Deep link hydration** — `?run=<id>` loads cached results
6. **Locked tab state** — trial users see upgrade hint on non-jobfit tabs

### Tabs
| Tab | State Variable | Loading Variable | Result Variable |
|---|---|---|---|
| JobFit | `tab === "jobfit"` | `loadingJobFit` | `jobFitResult` |
| Positioning | `tab === "positioning"` | `loadingPositioning` | `positioningResult` |
| Cover Letter | `tab === "coverletter"` | `loadingCoverLetter` | `coverLetterResult` |
| Networking | `tab === "networking"` | `loadingNetworking` | `networkingResult` |

### Interactive Elements

**Auth:**
| Element | Variable | Behavior |
|---|---|---|
| Email input | `email` | For magic link |
| "Send magic link" button | `sendMagicLink()` | POST `/api/auth/send-link` |
| 403 response message | — | "No account found for that email. Purchase access or run a free job analysis below." |

**Job Input:**
| Element | Variable | Validation |
|---|---|---|
| Company name input | `manualCompanyName` | Required |
| Job title input | `manualJobTitle` | Required |
| JD textarea | `job` | Required |
| Persona selector dropdown | `selectedPersonaId` | Optional |
| "Active Job" toggle | `jobInputOpen` | Collapsible |
| "Run JobFit ->" button | `runJobFit()` | Validates all fields |

**JobFit Results:**
| Element | Variable |
|---|---|
| WHY codes section | `jobfitWhyOpen` (expandable) |
| RISK codes section | `jobfitRisksOpen` (expandable) |
| Decision badge | Priority Apply / Apply / Review / Pass |
| Score display | 0-100 scale |

**Cover Letter:**
| Element | Variable |
|---|---|
| Name input | `clName` |
| Company input | `clCompany` |
| Hiring manager input | `clHiringManager` |
| "Generate" button | POST `/api/coverletter` |

**Networking:**
| Element | Variable |
|---|---|
| Expandable contact cards | `netOpenSet` (Set of indices) |

**Side Nav:**
| Element | Handler |
|---|---|
| Tab buttons (jobfit/positioning/coverletter/networking) | `goTo(tabKey)` |
| "Run new job" button | `runNewJob()` — clears all state |
| "Upgrade" button | `openUpgradePage()` |
| "Log out" button | `logout()` |
| Locked tab indicator | `isLockedTab(key)` — trial users |

### Auth Flow (useEffect #2)
1. Read `?code=` -> `exchangeCodeForSession(code)` -> clean URL
2. Read `?access_token=` + `?refresh_token=` -> `setSession()` -> clean URL
3. Read `?run=` -> fetch `/api/runs/<id>` -> hydrate all 4 result tabs + job/title/company
4. `getSession()` -> set auth state
5. `onAuthStateChange()` listener -> update auth state

### API Calls
| Endpoint | Method | Trigger | Success | Error |
|---|---|---|---|---|
| `/api/auth/send-link` | POST | Magic link button | setMagicLinkSent(true) | Show error |
| `/api/personas` | GET | On auth | Populate persona dropdown | Silent |
| `/api/jobfit` | POST | Run JobFit button | setJobFitResult | setErrorMsg |
| `/api/positioning` | POST | Auto or manual | setPositioningResult | setErrorMsg |
| `/api/coverletter` | POST | Generate button | setCoverLetterResult | setErrorMsg |
| `/api/networking` | POST | Auto or manual | setNetworkingResult | setErrorMsg |
| `/api/runs/<id>` | GET | `?run=` param on mount | Hydrate all tabs | Silent fallthrough |
| `/api/track` | POST | Page mount, tab changes | Fire-and-forget | Silent |
| `/api/checkout/create-session` | POST | Upgrade button | Redirect to Stripe | Fallback |

### Supabase Operations
- `supabase.auth.exchangeCodeForSession(code)` — magic link code exchange
- `supabase.auth.setSession(access_token, refresh_token)` — token handoff from dashboard
- `supabase.auth.getSession()` — check current session
- `supabase.auth.signInWithOtp({ email })` — send magic link (now via server API)
- `supabase.auth.signOut()` — logout
- `supabase.auth.onAuthStateChange()` — listener for auth state updates

---

## FILE: `app/dashboard/layout.tsx`

### Surfaces & States
1. **Loading** — "Loading..." spinner
2. **Unauthenticated** — magic link login form
3. **Link sent** — confirmation card with email shown
4. **Authenticated** — sidebar nav + main content area
5. **Framer banner** — optional top banner when `fromFramer=true`

### Interactive Elements

**Magic Link Form:**
| Element | Behavior |
|---|---|
| Email input | `email` state |
| "Send magic link" button | POST `/api/auth/send-link`, disabled during sending |
| "Use a different email" link | Resets form state |

**Navigation Sidebar:**
| Label | Destination | Behavior |
|---|---|---|
| "Overview" | `/dashboard` | Internal link |
| "Job Tracker" | `/dashboard/tracker` | Internal link |
| "Back to SIGNAL ->" | `wrnsignal.workforcereadynow.com/signal/jobfit` | External, new tab, appends `?access_token=&refresh_token=` |

### Auth Flow
- Token handoff from Framer: `?token=<handoffToken>` in URL -> stored in sessionStorage
- `supabase.auth.setSession()` -> `supabase.auth.getSession()` -> `onAuthStateChange()` listener

### API Calls
| Endpoint | Method | Trigger | Success | Error |
|---|---|---|---|---|
| `/api/auth/send-link` | POST | Form submission | setLinkSent(true) | Display error message |

---

## FILE: `app/dashboard/page.tsx` (Overview)

### Surfaces & States
1. **Welcome modal** — shows when `profile_complete=false` AND no `signal_welcomed` localStorage
2. **Profile card** — read-only display
3. **Profile edit form** — expandable
4. **Personas list** — cards with edit/delete
5. **Add persona form** — expandable with resume upload
6. **Toast notifications**

### Interactive Elements

**Welcome Modal:**
| Element | Behavior |
|---|---|
| "Build my profile" button | Sets `localStorage.signal_welcomed=true`, closes modal |
| No X button, no skip, no outside-click dismiss | Modal only closes via CTA |

**Profile Edit:**
| Field | Type | Notes |
|---|---|---|
| Name | text input | |
| Job Type | select dropdown | Options: "Full Time", "Internship", "Both" (dark bg options) |
| Target Roles | text input | |
| Target Locations | text input | |
| Preferred Locations | text input | Optional |
| Timeline | text input | Hint: "e.g. Immediate, Summer 2026, Fall 2026, Spring 2027, Summer 2027" |
| "Save Changes" button | PUT `/api/profile` | Disabled during save |
| "Cancel" button | Closes form | |

**Personas:**
| Element | Behavior |
|---|---|
| Resume upload button | File picker -> POST `/api/resume-upload` -> populate textarea |
| "or paste manually" textarea | Direct text input |
| "Create Persona" button | POST `/api/personas` with name + resume_text |
| "Edit" link (per persona) | Opens inline edit form |
| "Set as default" link | PUT `/api/personas/:id` with `is_default: true` |
| "Delete" link | DELETE `/api/personas/:id` |
| "+ Add Persona" button | Opens add form (hidden if >= 2 personas) |

### API Calls
| Endpoint | Method | Trigger | Notes |
|---|---|---|---|
| GET `/api/profile` | GET | Mount | Loads profile data |
| GET `/api/personas` | GET | Mount | Loads persona list |
| PUT `/api/profile` | PUT | Save profile | Also rebuilds profile_text + re-evaluates profile_complete |
| POST `/api/resume-upload` | POST | Resume file upload | Returns extracted text |
| POST `/api/personas` | POST | Create persona | |
| PUT `/api/personas/:id` | PUT | Edit persona | Also syncs resume_text to client_profiles + rebuilds profile_text |
| DELETE `/api/personas/:id` | DELETE | Delete persona | |

---

## FILE: `app/dashboard/tracker/page.tsx` (Job Tracker)

### Surfaces & States
1. **Applications tab — List view**: grid table with sortable columns
2. **Applications tab — Pipeline view**: Kanban board (saved/applied/interviewing/offer/rejected)
3. **Interviews tab**: interview cards
4. **Add Job form** (expandable)
5. **Add Interview form** (expandable)
6. **Expanded application detail** (inline edit)
7. **Expanded interview detail** (inline edit)

### Interactive Elements

**Top Controls:**
| Element | Options |
|---|---|
| Tab toggle | "Applications" / "Interviews" |
| View mode toggle | "List" / "Pipeline" (applications only) |
| Status filter dropdown | "All" / saved / applied / interviewing / offer / rejected / withdrawn |
| "Add Job" button | Opens add job form |
| "Add Interview" button | Opens add interview form (interviews tab) |

**Application Card (List View):**
| Column | Content |
|---|---|
| Company / Role | Company name + job title |
| Persona | Persona name (orange if set, dim if empty) |
| Location | Location text |
| Status | Colored pill (saved/applied/interviewing/offer/rejected/withdrawn) |
| SIGNAL | Decision pill (Priority Apply/Apply/Review/Pass) or "-" |
| Score | Numeric score with color coding |
| Interest | 5-star clickable rating |
| Actions | "SIGNAL" deep link (green, if `jobfit_run_id` exists) + "View"/"Close" button |

**"SIGNAL" Deep Link:**
- URL: `wrnsignal.workforcereadynow.com/signal/jobfit?run=<jobfit_run_id>`
- Opens in new tab (target=_blank)
- Only visible when `a.jobfit_run_id` exists

**Application Card (Pipeline View):**
- Company name, Job title, Decision + Score
- "View in SIGNAL ->" link (same deep link pattern)

**Add/Edit Application Fields:**
| Field | Type | Options |
|---|---|---|
| company_name | text | |
| job_title | text | |
| location | text | |
| job_url | text | |
| application_location | select | Company Website, LinkedIn, Indeed, Handshake, Referral, Other |
| interest_level | 5-star rating | Clickable 1-5 |
| application_status | select | saved, applied, interviewing, offer, rejected, withdrawn |
| date_posted | date input | |
| notes | textarea | |
| persona_id | select dropdown | From loaded personas |

**Add/Edit Interview Fields:**
| Field | Type | Options |
|---|---|---|
| application_id | select dropdown | From loaded applications |
| interview_stage | select | Phone, Zoom, AI/HireVue, In-person, Take-home, Final-round, HR screening, Other |
| interviewer_names | text | |
| interview_date | date input | |
| status | select | not_scheduled, scheduled, awaiting_feedback, offer_extended, rejected, ghosted |
| confidence_level | 1-5 dots | Clickable |
| notes | textarea | |
| thank_you_sent | yes/no toggle | |

### API Calls
| Endpoint | Method | Trigger |
|---|---|---|
| GET `/api/applications` | GET | Mount |
| GET `/api/interviews` | GET | Mount |
| GET `/api/personas` | GET | Mount |
| POST `/api/applications` | POST | Add job save |
| PUT `/api/applications/:id` | PUT | Edit/save application |
| DELETE `/api/applications/:id` | DELETE | Delete application |
| POST `/api/interviews` | POST | Add interview save |
| PUT `/api/interviews/:id` | PUT | Edit/save interview |
| DELETE `/api/interviews/:id` | DELETE | Delete interview |

---

## FILE: `app/dashboard/personas/[id]/edit/page.tsx`

### Surfaces & States
- Persona edit form with back navigation
- Loading state (persona lookup)
- Error state (persona not found)
- Toast notification on save

### Interactive Elements
| Element | Behavior |
|---|---|
| "<- Back to Personas" button | `router.push("/dashboard/personas")` |
| Persona name input | Editable |
| Resume text textarea | 320px min height |
| "Save Persona" button | PUT `/api/personas/:id`, disabled during save |
| Version label | Display only |

### API Calls
| Endpoint | Method | Trigger |
|---|---|---|
| GET `/api/personas` | GET | Mount (finds persona by ID) |
| PUT `/api/personas/:id` | PUT | Save button |

---

## FILE: `app/checkout/success/page.tsx`

### Surfaces & States
1. **Polling**: "Setting up your account..." — emoji clock, polls every 2s for 30s
2. **Ready**: "Check your email — your SIGNAL access link is on its way" — shows email address
3. **Timeout**: "Taking longer than expected — please check your email or contact support"

### Interactive Elements
- None (informational page only)

### API Calls
| Endpoint | Method | Trigger | Polling |
|---|---|---|---|
| GET `/api/auth/account-ready?session_id={id}` | GET | Mount | Every 2s, max 15 attempts (30s) |

---

## SERVER-SIDE API ROUTES

### POST `/api/auth/send-link`
| Aspect | Detail |
|---|---|
| Input | `{ email }` |
| Gate | Queries `client_profiles` WHERE email AND active=true |
| 400 | Missing email |
| 403 | No active account (`{ error: "no_account" }`) |
| 500 | OTP send failure |
| Redirect (complete) | `wrnsignal.workforcereadynow.com/signal/jobfit` |
| Redirect (incomplete) | `wrnsignal-api.vercel.app/dashboard` |
| Supabase | SELECT `client_profiles`, `auth.signInWithOtp()` |

### GET `/api/auth/account-ready`
| Aspect | Detail |
|---|---|
| Input | `?session_id=` (Stripe checkout session ID) |
| Process | Stripe session retrieve -> get email -> check `client_profiles` |
| Response | `{ ready: boolean, email?: string }` |
| External | Stripe API, Supabase `client_profiles` |

### POST `/api/checkout/create-session`
| Aspect | Detail |
|---|---|
| Input | `{ email }` |
| Process | Create Stripe checkout session (mode: payment) |
| Price | `NEXT_PUBLIC_STRIPE_PRICE_ID` (price_1TL2XTAiNxFDFWtLwubm6stk) |
| Success URL | `wrnsignal-api.vercel.app/checkout/success?session_id={CHECKOUT_SESSION_ID}` |
| Cancel URL | Request origin |
| Response | `{ url }` (Stripe checkout URL) |

### POST `/api/webhooks/stripe`
| Aspect | Detail |
|---|---|
| Verification | Stripe webhook signature via `STRIPE_WEBHOOK_SECRET` |
| Event | `checkout.session.completed` only (all others ignored) |
| Response | Returns 200 `{ received: true }` immediately |
| Processing | Async after response |
| New user | INSERT `client_profiles` with email, active=true, profile_complete=false, stripe_customer_id |
| Existing user | UPDATE `client_profiles` set active=true, stripe_customer_id |
| Magic link | `auth.signInWithOtp()` redirecting to `wrnsignal-api.vercel.app/dashboard` |

### GET `/api/runs/:id`
| Aspect | Detail |
|---|---|
| Auth | Bearer token required, validates profile ownership |
| Response | `{ runId, fingerprintCode, fingerprintHash, verdict, score, createdAt, jobDescription, jobTitle, companyName, jobfit, positioning, coverLetter, networking }` |
| Related tables | `positioning_runs`, `coverletter_runs`, `networking_runs` (nullable, may not exist) |
| Error | 404 not found, 403 profile mismatch, 401 unauthorized |

---

## COMPLETE NAVIGATION MAP

### Purchase Flow
1. Landing page -> "Get full access . $99 ->" -> POST `/api/checkout/create-session` -> Stripe checkout
2. Stripe checkout complete -> `/checkout/success` -> polls `/api/auth/account-ready`
3. Webhook fires -> INSERT `client_profiles` -> send magic link
4. User clicks magic link -> `wrnsignal-api.vercel.app/dashboard` (profile_complete=false)
5. User completes profile + persona on dashboard
6. "Back to SIGNAL ->" -> `wrnsignal.workforcereadynow.com/signal/jobfit?access_token=...&refresh_token=...`
7. Framer component reads tokens -> `setSession()` -> user is authenticated

### Free Analysis Flow
1. Landing page -> "Try job analysis free ->" -> `wrnsignal.workforcereadynow.com/signal/job-analysis?email=...`
2. Job analysis page reads `?email=` -> `setCapturedEmail()`
3. User pastes JD -> "Analyze" -> POST `/api/job-analysis`
4. Results display -> "Unlock full SIGNAL ->" -> POST `/api/checkout/create-session` (if email captured) or open landing page

### Returning User Flow
1. Landing page or Framer -> "Log in" -> `wrnsignal.workforcereadynow.com/signal/jobfit`
2. Framer login form -> POST `/api/auth/send-link`
3. 403 if no account, 200 if account exists -> magic link sent
4. profile_complete=true -> redirect to `/signal/jobfit`
5. profile_complete=false -> redirect to `/dashboard`

### Deep Link Flow (Tracker -> SIGNAL)
1. Dashboard tracker -> "SIGNAL" button on application card
2. Opens `wrnsignal.workforcereadynow.com/signal/jobfit?run=<id>`
3. Framer reads `?run=` -> GET `/api/runs/<id>` with bearer token
4. Hydrates all 4 tabs (jobfit, positioning, cover letter, networking)
5. Hydrates job description, job title, company name inputs

---

## SUPABASE TABLES REFERENCED

| Table | Operations | Triggered By |
|---|---|---|
| `client_profiles` | SELECT, INSERT, UPDATE | Auth gate, webhook, profile save, persona resume sync |
| `client_personas` | SELECT, INSERT, UPDATE, DELETE | Dashboard persona CRUD |
| `jobfit_runs` | SELECT, INSERT | JobFit scoring, deep link fetch, tracker display |
| `positioning_runs` | SELECT | Deep link fetch (nullable) |
| `coverletter_runs` | SELECT | Deep link fetch (nullable) |
| `networking_runs` | SELECT | Deep link fetch (nullable) |
| `signal_applications` | SELECT, INSERT, UPDATE, DELETE | Tracker CRUD |
| `signal_interviews` | SELECT, INSERT, UPDATE, DELETE | Tracker CRUD |
| `signal_seats` | SELECT, UPDATE | Legacy magic link flow |
| `job_analysis_cache` | SELECT, INSERT | Job analysis caching |
| `jobfit_page_views` | INSERT | Tracking/analytics |

---

*End of inventory. Use this document to generate comprehensive QA test cases covering every surface, state transition, API interaction, and error path in the SIGNAL product.*
